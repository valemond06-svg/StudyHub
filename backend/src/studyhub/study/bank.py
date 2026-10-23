"""Dal materiale del corso (fino a oggi) agli ARGOMENTI e alla BANCA DI DOMANDE della modalità Studia.

Unità di studio, in ordine cronologico:
  - ogni lezione registrata: se non ha ancora gli appunti AI li genera Claude Sonnet (1 chiamata,
    serve per le pagine scritte a mano), poi dagli appunti nasce la banca di domande;
  - ogni documento del corso (slide, dispense, esercitazioni, soluzioni), a blocchi di pagine;
  - per i corsi già conclusi (es. esami arretrati del 1° anno) anche i testi degli appelli passati.
Una chiamata per unità (Gemini via Antigravity, Claude come riserva) produce: argomenti con peso
d'esame e scheda "cosa devi sapere", e 8-25 domande di tipo diverso con soluzione e criteri.

Si parte solo da un tuo clic ("Analizza il corso"); quello che è già pronto non si rigenera.
"""
from __future__ import annotations

import hashlib
import json
import re
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime
from pathlib import Path

import pymupdf

from ..ai.claude_runner import RateLimited
from ..ai.lecture_notes import _exam_rules, existing
from ..ai.llm import run_json
from ..config import settings
from ..db import session
from ..ingest.extract import extract
from ..paths import uni_path

BANK_VERSION = "bank-v1"
PART_MAX_CHARS = 30_000
PART_MAX_PAGES = 30
BOOK_PAGES = 150             # oltre: libro di riferimento, non materiale delle lezioni
MIN_CHARS = 1_200
MIN_CHARS_PER_PAGE = 120     # sotto: scansione o appunti a mano senza testo estraibile
SKIP_NAME = re.compile(r"^intro|diario|tavola|calendari|assemblea|orario|internazionalizz|esiti|risultati|contatt|_sezione|_avvisi", re.I)
EXAM_PATH = re.compile(r"appell|storico|chiave|/esame|parziale|parzialino|compit", re.I)
KINDS = ("richiamo", "multipla", "vero_falso", "aperta", "esercizio")
WEIGHT = {"alto": 3, "medio": 2, "basso": 1}

SYSTEM = """Sei un docente universitario esigente che prepara uno studente di Ingegneria all'esame.
Dal materiale di UNA unità del corso (appunti di una lezione, slide, dispense, esercitazioni o un appello
passato) estrai gli ARGOMENTI e scrivi una BANCA DI DOMANDE per verificare se lo studente li sa davvero.

Argomenti:
- 1-6 argomenti per unità, ciascuno un blocco studiabile (es. "Serie di Taylor e resto di Lagrange"),
  non un singolo termine. Se un argomento coincide con uno di quelli GIÀ ESISTENTI elencati, riusa
  ESATTAMENTE quel nome (così i progressi si sommano).
- peso: quanto conta all'esame (alto/medio/basso). Usa il profilo d'esame e le regole se ci sono,
  altrimenti il tuo giudizio (definizioni e teoremi centrali, esercizi tipici = alto).
- scheda_md: 120-250 parole, cosa bisogna sapere e saper fare, con le formule chiave in LaTeX ($...$).

Domande (in italiano, formule in LaTeX con $...$):
- richiamo: domanda secca da recuperare a memoria (definizione, enunciato, formula). Risposta breve.
- multipla: 4 opzioni, UNA corretta, distrattori plausibili che colpiscono errori tipici.
- vero_falso: affermazione precisa, spesso con una trappola sottile.
- aperta: "spiega/dimostra/confronta", come all'orale o nella parte di teoria dello scritto.
- esercizio: calcolo o problema nello stile dell'esame, con soluzione completa passo per passo.
- Mescola difficoltà 1 (base), 2 (da esame), 3 (difficile). Almeno metà a livello 2 o 3.
- criteri: 2-5 punti che una risposta completa DEVE contenere (per aperta ed esercizio; per gli altri lista vuota).
- Niente domande banali o sul formato del corso; niente domande che dipendono da figure non descritte.
- Basati SOLO sul materiale fornito. Indica minuto (secondi) o pagina quando li conosci."""

SCHEMA = {
    "type": "object", "additionalProperties": False, "required": ["argomenti", "domande"],
    "properties": {
        "argomenti": {"type": "array", "items": {
            "type": "object", "additionalProperties": False, "required": ["nome", "peso", "scheda_md"],
            "properties": {"nome": {"type": "string"}, "peso": {"type": "string", "enum": ["alto", "medio", "basso"]},
                           "scheda_md": {"type": "string"}, "inizio_s": {"type": "number"},
                           "pagina": {"type": "integer"}}}},
        "domande": {"type": "array", "items": {
            "type": "object", "additionalProperties": False,
            "required": ["argomento", "tipo", "difficolta", "testo_md", "opzioni", "corretta", "risposta_md", "criteri"],
            "properties": {
                "argomento": {"type": "string", "description": "nome esatto di uno degli argomenti"},
                "tipo": {"type": "string", "enum": list(KINDS)},
                "difficolta": {"type": "integer", "description": "1 base · 2 da esame · 3 difficile"},  # Gemini: niente enum di interi
                "testo_md": {"type": "string"},
                "opzioni": {"type": "array", "items": {"type": "string"}},
                "corretta": {"type": "integer", "description": "indice per multipla; 1 vero / 0 falso; -1 altrimenti"},
                "risposta_md": {"type": "string", "description": "risposta modello / soluzione completa"},
                "criteri": {"type": "array", "items": {"type": "string"}},
                "inizio_s": {"type": "number"}, "pagina": {"type": "integer"}}}},
    },
}


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def course_finished(course: dict) -> bool:
    """Corso di un anno accademico passato (es. esame arretrato): conta tutto, appelli compresi."""
    return bool(course.get("academic_year")) and course["academic_year"] != settings.current_academic_year


def _doc_day(db, doc: dict) -> str:
    """Data nel nome del file (es. 20251009-...), altrimenti quella di caricamento su Moodle."""
    m = re.search(r"(20\d\d)[-_.]?([01]\d)[-_.]?([0-3]\d)", Path(doc["path"]).name)
    if m:
        try:
            return date(int(m[1]), int(m[2]), int(m[3])).isoformat()
        except ValueError:
            pass
    row = db.execute("SELECT timemodified FROM files WHERE path=?", (doc["path"],)).fetchone()
    ts = (row[0] if row and row[0] else None) or doc["mtime"]
    return datetime.fromtimestamp(ts).date().isoformat() if ts else "9999-12-31"


def _lecture_pdf_ids(db, course_id: int) -> set[int]:
    """PDF che sono gli appunti di una lezione registrata: entrano negli appunti AI, non come unità a sé."""
    from ..ai.lecture_notes import _lecture_pdf
    ids = set()
    for lec in db.execute("SELECT * FROM lectures WHERE course_id=?", (course_id,)):
        d = _lecture_pdf(db, dict(lec))
        if d:
            ids.add(d["id"])
    return ids


def page_texts(path: Path) -> list[str]:
    """Solo il testo, pagina per pagina (più veloce di extract(), che analizza anche formule e figure)."""
    if path.suffix.lower() == ".pdf":
        with pymupdf.open(path) as doc:
            return [p.get_text("text").strip() for p in doc]
    return [p.text for p in extract(path).pages]


_sig_cache: dict[str, tuple[list[int], frozenset]] = {}


def _signature(doc: dict) -> tuple[list[int], frozenset]:
    """Caratteri per pagina e insieme delle parole: serve a riconoscere versioni diverse delle stesse slide."""
    if doc["sha256"] not in _sig_cache:
        texts = page_texts(uni_path(doc["path"]))
        words = frozenset(w for t in texts for w in re.findall(r"\w{4,}", t.lower()))
        _sig_cache[doc["sha256"]] = ([len(t) for t in texts], words)
    return _sig_cache[doc["sha256"]]


def _similar(a: frozenset, b: frozenset) -> float:
    return len(a & b) / len(a | b) if a and b else 0.0


def _doc_parts(chars: list[int]) -> list[tuple[int, int]]:
    parts, start, acc = [], 1, 0
    for i, c in enumerate(chars, start=1):
        if acc and (acc + c > PART_MAX_CHARS or i - start >= PART_MAX_PAGES):
            parts.append((start, i - 1))
            start, acc = i, 0
        acc += c
    parts.append((start, len(chars)))
    return parts


def sync_units(course_id: int) -> dict:
    """Registra le unità di studio del corso fino a oggi. Nessuna chiamata AI."""
    today = date.today().isoformat()
    with session() as db:
        course = dict(db.execute("SELECT * FROM courses WHERE id=?", (course_id,)).fetchone())
        finished = course_finished(course)
        lecture_pdfs = _lecture_pdf_ids(db, course_id)
        known = {(r["kind"], r["ref_id"], r["part"]) for r in db.execute(
            "SELECT kind, ref_id, part FROM study_units WHERE course_id=?", (course_id,))}
        wanted = []
        for lec in db.execute("""SELECT * FROM lectures WHERE course_id=? AND status IN ('media_ok','trascritta')
                                 AND (date IS NULL OR date <= ?) ORDER BY date, number""", (course_id, today)):
            if (uni_path(lec["folder"]) / "transcript.json").exists():
                wanted.append(("lezione", lec["id"], 0, None, None, lec["title"], lec["date"]))
        docs = []
        for d in map(dict, db.execute("""SELECT * FROM documents WHERE course_id=? AND duplicate_of IS NULL
                                         AND kind IN ('pdf','md','docx','pptx','text') ORDER BY path""", (course_id,))):
            d["day"] = _doc_day(db, d)
            docs.append(d)
    skipped, candidates = [], []
    for d in docs:
        p = d["path"]
        if d["id"] in lecture_pdfs or "/studio_ai/" in p or "/lezioni/" in p or SKIP_NAME.search(Path(p).name):
            continue
        if EXAM_PATH.search(p) and not finished:
            continue  # corso in corso: gli appelli passati coprono anche argomenti non ancora fatti
        if not uni_path(p).exists():
            continue
        if (d["n_pages"] or 1) > BOOK_PAGES:
            skipped.append({"path": p, "motivo": "libro di riferimento"})
            continue
        chars, words = _signature(d)
        if sum(chars) < MIN_CHARS:
            skipped.append({"path": p, "motivo": "troppo poco testo"})
        elif sum(chars) / max(1, len(chars)) < MIN_CHARS_PER_PAGE:
            skipped.append({"path": p, "motivo": "scansione senza testo"})
        else:
            candidates.append((d, chars, words))
    # Versioni della stessa dispensa (slide ricaricate, testo e chiave dello stesso appello):
    # resta la più recente, a parità di data la più completa.
    kept: list[tuple[dict, list[int], frozenset]] = []
    for d, chars, words in sorted(candidates, key=lambda c: (c[0]["day"], sum(c[1])), reverse=True):
        if EXAM_PATH.search(d["path"]):  # gli appelli si somigliano tutti: doppione = stesso giorno
            twin = next((k for k in kept if EXAM_PATH.search(k[0]["path"]) and k[0]["day"] == d["day"]), None)
        else:
            twin = next((k for k in kept if not EXAM_PATH.search(k[0]["path"]) and _similar(words, k[2]) >= 0.6), None)
        if twin:
            skipped.append({"path": d["path"], "motivo": f"altra versione di {Path(twin[0]['path']).name}"})
            continue
        kept.append((d, chars, words))
    for d, chars, _ in kept:
        title = d["title"] or Path(d["path"]).stem
        parts = _doc_parts(chars)
        for i, (a, b) in enumerate(parts):
            label = title if len(parts) == 1 else f"{title} (pp. {a}-{b})"
            wanted.append(("documento", d["id"], i, a, b, label, d["day"]))
    added = 0
    with session() as db:
        for kind, ref, part, a, b, title, day in wanted:
            if (kind, ref, part) in known:
                continue
            db.execute("""INSERT INTO study_units (course_id, kind, ref_id, part, page_from, page_to, title, day)
                          VALUES (?,?,?,?,?,?,?,?)""", (course_id, kind, ref, part, a, b, title, day))
            added += 1
    return {"added": added, "skipped": skipped}


# --- Generazione ------------------------------------------------------------------

def _profile_topics(course: dict) -> str:
    f = uni_path(course["folder"]) / "studio_ai" / "profilo_esame.json"
    if not f.exists():
        return ""
    prof = json.loads(f.read_text(encoding="utf-8"))
    rows = [f"- {a['nome']} (peso {a['peso']}, {a['frequenza']})" for a in prof.get("argomenti", [])]
    return "Profilo d'esame (argomenti ricorrenti negli appelli):\n" + "\n".join(rows) if rows else ""


def _unit_text(db, unit: dict) -> tuple[str, str, dict]:
    """Testo dell'unità, hash della fonte e riferimenti (lezione/documento) per le domande."""
    if unit["kind"] == "lezione":
        out = existing(unit["ref_id"])
        if not out or not uni_path(out["md_path"]).exists():
            raise LookupError("appunti mancanti")
        md = uni_path(out["md_path"]).read_text(encoding="utf-8")
        return f"=== Appunti della lezione (▶ mm:ss = minuto della registrazione) ===\n{md}", out["input_hash"], \
            {"lecture_id": unit["ref_id"]}
    doc = dict(db.execute("SELECT * FROM documents WHERE id=?", (unit["ref_id"],)).fetchone())
    ex = extract(uni_path(doc["path"]))
    a, b = unit["page_from"] or 1, unit["page_to"] or len(ex.pages)
    body = "\n".join(f"--- pagina {p.number} ---\n{p.text}" for p in ex.pages if a <= p.number <= b and p.text.strip())
    kind = "Appello d'esame passato" if EXAM_PATH.search(doc["path"]) else "Documento del corso"
    return f"=== {kind}: {Path(doc['path']).name} ===\n{body}", f"{doc['sha256']}:{a}-{b}", {"doc_id": doc["id"]}


_claude_lock = threading.Lock()


def prepare_unit(unit_id: int) -> dict:
    with session() as db:
        unit = dict(db.execute("SELECT * FROM study_units WHERE id=?", (unit_id,)).fetchone())
        course = dict(db.execute("SELECT * FROM courses WHERE id=?", (unit["course_id"],)).fetchone())
    if unit["kind"] == "lezione" and not existing(unit["ref_id"]):
        from ..ai.lecture_notes import process
        with _claude_lock:  # appunti con Claude Sonnet, uno alla volta
            process(unit["ref_id"])
    with session() as db:
        text, src_hash, refs = _unit_text(db, unit)
        rules = _exam_rules(db, course["id"])
        topics = [r[0] for r in db.execute("SELECT name FROM study_topics WHERE course_id=? ORDER BY id", (course["id"],))]
    h = hashlib.sha256(f"{BANK_VERSION}|{src_hash}".encode()).hexdigest()
    if unit["source_hash"] == h and unit["status"] == "pronta":
        return {"cached": True}
    n_q = max(8, min(25, len(text) // 1200))
    prompt = [f"Corso: {course['fullname']}", f"Unità: {unit['title']} ({unit['day'] or ''})"]
    if rules:
        prompt.append(f"Regole d'esame ufficiali:\n{rules}")
    prof = _profile_topics(course)
    if prof:
        prompt.append(prof)
    if topics:
        prompt.append("Argomenti GIÀ ESISTENTI nel corso (riusa il nome esatto se è lo stesso):\n"
                      + "\n".join(f"- {t}" for t in topics[-120:]))
    prompt += [text, f"Scrivi circa {n_q} domande in totale, di tutti i tipi adatti a questo materiale."]
    res = run_json(SYSTEM, "\n\n".join(prompt), SCHEMA, quality="accurato")
    added = _store(unit, course["id"], res.data, refs)
    with session() as db:
        db.execute("UPDATE study_units SET status=?, source_hash=?, provider=?, message=?, done_at=? WHERE id=?",
                   ("pronta" if added else "vuota", h, res.model, f"{added} domande", _now(), unit_id))
    return {"cached": False, "items": added, "provider": res.provider}


def _store(unit: dict, course_id: int, data: dict, refs: dict) -> int:
    added = 0
    with session() as db:
        # Rigenerazione: tolgo le domande mai usate, sospendo quelle con uno storico.
        db.execute("""DELETE FROM study_items WHERE unit_id=? AND id NOT IN (SELECT item_id FROM study_attempts)""",
                   (unit["id"],))
        db.execute("UPDATE study_items SET suspended=1 WHERE unit_id=?", (unit["id"],))
        ids: dict[str, int] = {}
        for t in data.get("argomenti", []):
            name = t["nome"].strip()[:160]
            row = db.execute("SELECT id FROM study_topics WHERE course_id=? AND name=?", (course_id, name)).fetchone()
            if row:
                ids[name.lower()] = row[0]
                # l'argomento era già comparso più avanti: lo sposto alla prima volta in cui lo vedi
                db.execute("""UPDATE study_topics SET day=?, unit_id=?, lecture_id=COALESCE(?, lecture_id),
                              t_start=COALESCE(?, t_start) WHERE id=? AND (day IS NULL OR day > ?)""",
                           (unit["day"], unit["id"], refs.get("lecture_id"), t.get("inizio_s"), row[0], unit["day"]))
                continue
            ids[name.lower()] = db.execute(
                """INSERT INTO study_topics (course_id, name, weight, summary_md, unit_id, day, lecture_id, t_start,
                                             doc_id, page) VALUES (?,?,?,?,?,?,?,?,?,?)""",
                (course_id, name, WEIGHT.get(t.get("peso"), 2), t.get("scheda_md"), unit["id"], unit["day"],
                 refs.get("lecture_id"), t.get("inizio_s"), refs.get("doc_id"), t.get("pagina"))).lastrowid
        fallback = next(iter(ids.values()), None)
        for q in data.get("domande", []):
            tid = ids.get(q["argomento"].strip().lower()) or fallback
            if tid is None or q["tipo"] not in KINDS:
                continue
            if q["tipo"] == "multipla" and not (len(q["opzioni"]) >= 2 and 0 <= q["corretta"] < len(q["opzioni"])):
                continue
            if q["tipo"] == "vero_falso" and q["corretta"] not in (0, 1):
                continue
            key = hashlib.sha1(f"{unit['id']}:{q['testo_md'].strip().lower()}".encode()).hexdigest()
            cur = db.execute(
                """INSERT OR IGNORE INTO study_items (course_id, unit_id, topic_id, kind, difficulty, prompt_md, options,
                       correct, answer_md, rubric, lecture_id, t_start, doc_id, page, origin_key)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (course_id, unit["id"], tid, q["tipo"], max(1, min(3, int(q["difficolta"] or 2))), q["testo_md"],
                 json.dumps(q["opzioni"], ensure_ascii=False) if q["tipo"] == "multipla" else None,
                 q["corretta"] if q["tipo"] in ("multipla", "vero_falso") else None, q["risposta_md"],
                 json.dumps(q["criteri"], ensure_ascii=False), refs.get("lecture_id"), q.get("inizio_s"),
                 refs.get("doc_id"), q.get("pagina"), key))
            if cur.rowcount:
                added += 1
            else:  # stessa domanda già presente (sospesa dalla rigenerazione): torna attiva
                db.execute("UPDATE study_items SET suspended=0 WHERE origin_key=?", (key,))
    return added


# --- Lavoro in background (parte solo da un clic) -----------------------------------

_jobs: dict[int, dict] = {}
_jobs_lock = threading.Lock()


def prepare_status(course_id: int) -> dict:
    with session() as db:
        counts = {r[0]: r[1] for r in db.execute(
            "SELECT status, COUNT(*) FROM study_units WHERE course_id=? GROUP BY status", (course_id,))}
        no_notes = db.execute("""SELECT COUNT(*) FROM study_units u WHERE u.course_id=? AND u.kind='lezione'
                                 AND u.status IN ('nuova','errore') AND NOT EXISTS (SELECT 1 FROM ai_outputs a
                                 WHERE a.kind='lecture_notes' AND a.target_id=u.ref_id)""", (course_id,)).fetchone()[0]
        errors = [dict(r) for r in db.execute(
            "SELECT title, message FROM study_units WHERE course_id=? AND status='errore' LIMIT 5", (course_id,))]
    job = _jobs.get(course_id) or {}
    return {"units": counts, "todo": counts.get("nuova", 0) + counts.get("errore", 0) + counts.get("in_corso", 0),
            "ready": counts.get("pronta", 0), "lectures_without_notes": no_notes, "errors": errors,
            "running": bool(job.get("running")), "current": job.get("current"), "stopped": job.get("stopped")}


def claim(unit_id: int) -> bool:
    """Prende in carico un'unità solo se nessun altro (server o elaborazione completa) la sta facendo."""
    with session() as db:
        return db.execute("""UPDATE study_units SET status='in_corso', message=NULL, done_at=?
                             WHERE id=? AND status IN ('nuova','errore')""", (_now(), unit_id)).rowcount == 1


def release_stale(minutes: int = 40) -> int:
    """Unità rimaste "in corso" da un processo chiuso a metà (done_at = ora della presa in carico)."""
    with session() as db:
        return db.execute("""UPDATE study_units SET status='nuova' WHERE status='in_corso'
                             AND (done_at IS NULL OR done_at < strftime('%Y-%m-%dT%H:%M:%S', 'now', ?, 'localtime'))""",
                          (f"-{minutes} minutes",)).rowcount


def run_claimed(uid: int) -> str | None:
    """Elabora un'unità già presa in carico. Ritorna il messaggio se si è raggiunto un limite d'uso."""
    try:
        prepare_unit(uid)
    except RateLimited as e:
        with session() as db:
            db.execute("UPDATE study_units SET status='nuova', message=? WHERE id=?", (str(e)[:300], uid))
        return str(e)
    except Exception as e:
        with session() as db:
            db.execute("UPDATE study_units SET status='errore', message=? WHERE id=?", (str(e)[:300], uid))
    return None


def _work(course_id: int, unit_ids: list[int]) -> None:
    job = _jobs[course_id]

    def one(uid: int) -> None:
        if job.get("stopped"):
            return
        if not claim(uid):
            return  # la sta già facendo l'elaborazione completa (altro processo)
        with session() as db:
            job["current"] = db.execute("SELECT title FROM study_units WHERE id=?", (uid,)).fetchone()[0]
        limited = run_claimed(uid)
        if limited:
            job["stopped"] = limited

    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            list(pool.map(one, unit_ids))
    finally:
        job.update(running=False, current=None)
        try:  # argomenti nuovi: si rifà l'ordine didattico del corso
            from .syllabus import order_course
            order_course(course_id)
        except Exception:
            pass


def start_prepare(course_id: int, limit: int | None = None) -> dict:
    sync_units(course_id)
    release_stale()
    with _jobs_lock:
        if (_jobs.get(course_id) or {}).get("running"):
            return prepare_status(course_id)
        with session() as db:
            ids = [r[0] for r in db.execute(
                "SELECT id FROM study_units WHERE course_id=? AND status IN ('nuova','errore') ORDER BY day, id",
                (course_id,))]
        if limit:
            ids = ids[:limit]
        _jobs[course_id] = {"running": bool(ids), "current": None, "stopped": None}
        if ids:
            threading.Thread(target=_work, args=(course_id, ids), name=f"studia-{course_id}", daemon=True).start()
    return prepare_status(course_id)


def stop_prepare(course_id: int) -> None:
    if course_id in _jobs:
        _jobs[course_id]["stopped"] = "interrotto da te"
