"""Preparazione all'esame: profilo d'esame, simulazioni con voto, appelli in calendario.

- Profilo (1 chiamata Sonnet, on-demand): regole ufficiali + appelli passati (appelli/) + programma
  → formato della prova, argomenti ricorrenti con frequenza, esercizi tipo, teoria richiesta, consigli.
- Simulazione (1 chiamata Sonnet): una prova nuova nello stesso formato, con soluzioni e criteri.
- Correzione (1 chiamata Sonnet): risposte scritte e/o FOTO del tuo svolgimento su carta → punti per
  domanda, voto in trentesimi applicando le regole del corso (sbarramenti, minimi per parte, …).
"""
from __future__ import annotations

import hashlib
import json
import re
from datetime import date, datetime
from pathlib import Path

import pymupdf

from ..ai.claude_runner import image_block, run
from ..ai.lecture_notes import _exam_rules, _render
from ..db import session
from ..paths import uni_path

MODEL = "sonnet"
PROFILE_VERSION = "profile-v1"
MAX_EXAM_IMAGES = 8
SYLLABUS_SECTION = re.compile(r"registro|programma|diario|argomenti|syllabus", re.I)


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _course(db, course_id: int) -> dict:
    row = db.execute("SELECT * FROM courses WHERE id=?", (course_id,)).fetchone()
    if not row:
        raise ValueError("Corso non trovato")
    return dict(row)


# --- Appelli in calendario ------------------------------------------------------

def add_exam(course_id: int, day: str, kind: str = "scritto", note: str | None = None) -> int:
    date.fromisoformat(day)  # valida
    with session() as db:
        return db.execute("INSERT INTO exams (course_id, date, kind, note, created_at) VALUES (?,?,?,?,?)",
                          (course_id, day, kind, note, _now())).lastrowid


def delete_exam(exam_id: int) -> None:
    with session() as db:
        db.execute("DELETE FROM exams WHERE id=?", (exam_id,))


def upcoming_exams() -> list[dict]:
    with session() as db:
        rows = db.execute("""SELECT e.*, c.fullname AS course FROM exams e JOIN courses c ON c.id=e.course_id
                             WHERE e.done=0 AND e.date >= date('now','localtime') ORDER BY e.date""").fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["days_left"] = (date.fromisoformat(d["date"]) - date.today()).days
        out.append(d)
    return out


# --- Profilo d'esame ---------------------------------------------------------------

PROFILE_SYSTEM = """Sei un esperto di didattica universitaria. Analizzi le regole d'esame ufficiali e i testi
degli appelli passati di un corso e produci il PROFILO D'ESAME per uno studente che deve prepararlo.
Basati SOLO sul materiale fornito. Conta in quanti appelli compare ogni argomento/tipologia (frequenza).
Sii concreto: esercizi tipo con i passaggi standard per risolverli, teoria che viene chiesta, errori tipici,
come distribuire il tempo. Formule in LaTeX ($...$). In italiano."""

PROFILE_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["sintesi_md", "formato", "argomenti", "esercizi_tipo", "teoria_richiesta", "consigli_md"],
    "properties": {
        "sintesi_md": {"type": "string"},
        "formato": {"type": "object", "additionalProperties": False,
                    "required": ["durata_min", "parti", "orale", "materiale_consentito", "regole_voto"],
                    "properties": {
                        "durata_min": {"type": "integer"},
                        "parti": {"type": "array", "items": {
                            "type": "object", "additionalProperties": False, "required": ["nome", "descrizione"],
                            "properties": {"nome": {"type": "string"}, "descrizione": {"type": "string"},
                                           "punti": {"type": "number"}, "minimo": {"type": "number"}}}},
                        "orale": {"type": "string"},
                        "materiale_consentito": {"type": "string"},
                        "regole_voto": {"type": "string"}}},
        "argomenti": {"type": "array", "items": {
            "type": "object", "additionalProperties": False, "required": ["nome", "frequenza", "peso", "note"],
            "properties": {"nome": {"type": "string"},
                           "frequenza": {"type": "string", "description": "es. '4 appelli su 4'"},
                           "peso": {"type": "string", "enum": ["alto", "medio", "basso"]},
                           "note": {"type": "string"}}}},
        "esercizi_tipo": {"type": "array", "items": {
            "type": "object", "additionalProperties": False, "required": ["titolo", "metodo_md", "frequenza"],
            "properties": {"titolo": {"type": "string"}, "metodo_md": {"type": "string"},
                           "frequenza": {"type": "string"}, "errori_tipici": {"type": "string"}}}},
        "teoria_richiesta": {"type": "array", "items": {"type": "string"}},
        "consigli_md": {"type": "string"},
    },
}


def _syllabus(db, course_id: int) -> str:
    parts = []
    for s in db.execute("SELECT name, folder FROM sections WHERE course_id=? ORDER BY number", (course_id,)):
        if SYLLABUS_SECTION.search(s["name"] or "") and s["folder"]:
            f = uni_path(s["folder"]) / "_sezione.md"
            if f.exists():
                parts.append(f.read_text(encoding="utf-8")[:4000])
    return "\n\n".join(parts)[:5000]


def _past_exams(db, course: dict) -> list[dict]:
    prefix = course["folder"].rstrip("/") + "/appelli/"
    return [dict(r) for r in db.execute(
        "SELECT * FROM documents WHERE path LIKE ? AND kind='pdf' AND duplicate_of IS NULL ORDER BY path",
        (prefix + "%",))]


def _exam_docs_content(db, docs: list[dict], max_images: int) -> tuple[list[dict], list[str]]:
    content, used, n_img = [], [], 0
    for d in docs:
        path = uni_path(d["path"])
        pages = db.execute("SELECT * FROM pages WHERE doc_id=? ORDER BY page", (d["id"],)).fetchall()
        doc = pymupdf.open(path)
        content.append({"type": "text", "text": f"\n=== Appello: {path.name} ==="})
        for p in pages:
            text = doc[p["page"] - 1].get_text("text").strip()
            if (p["is_scan"] or (p["is_visual"] and len(text) < 300)) and n_img < max_images:
                content.append({"type": "text", "text": f"--- pagina {p['page']} (immagine) ---"})
                content.append(image_block(_render(path, p["page"], d["sha256"])))
                n_img += 1
            elif text:
                content.append({"type": "text", "text": f"--- pagina {p['page']} ---\n{text}"})
        doc.close()
        used.append(d["path"])
    return content, used


def profile_paths(course: dict) -> tuple[Path, Path]:
    base = uni_path(course["folder"]) / "studio_ai"
    return base / "profilo_esame.json", base / "profilo_esame.md"


def get_profile(course_id: int) -> dict | None:
    with session() as db:
        course = _course(db, course_id)
    jp, _ = profile_paths(course)
    return json.loads(jp.read_text(encoding="utf-8")) if jp.exists() else None


def _profile_md(p: dict, course: dict) -> str:
    f = p["formato"]
    out = [f"# Profilo d'esame — {course['fullname']}", "", p["sintesi_md"], "", "## Formato della prova",
           f"- **Durata:** {f['durata_min']} minuti", f"- **Materiale consentito:** {f['materiale_consentito']}",
           f"- **Orale:** {f['orale']}", f"- **Voto:** {f['regole_voto']}", ""]
    for part in f["parti"]:
        extra = ", ".join(x for x in [f"{part['punti']:g} punti" if part.get("punti") else "",
                                      f"minimo {part['minimo']:g}" if part.get("minimo") else ""] if x)
        out.append(f"- **{part['nome']}**{f' ({extra})' if extra else ''}: {part['descrizione']}")
    out += ["", "## Argomenti per frequenza"]
    for a in sorted(p["argomenti"], key=lambda a: {"alto": 0, "medio": 1, "basso": 2}[a["peso"]]):
        out.append(f"- **{a['nome']}** — {a['frequenza']} · peso {a['peso']}. {a['note']}")
    out += ["", "## Esercizi tipo"]
    for e in p["esercizi_tipo"]:
        out += [f"### {e['titolo']} ({e['frequenza']})", e["metodo_md"]]
        if e.get("errori_tipici"):
            out.append(f"\n*Errori tipici:* {e['errori_tipici']}")
        out.append("")
    out += ["## Teoria richiesta", *[f"- {t}" for t in p["teoria_richiesta"]], "", "## Consigli", p["consigli_md"], ""]
    return "\n".join(out)


def build_profile(course_id: int, force: bool = False) -> dict:
    with session() as db:
        course = _course(db, course_id)
        rules = _exam_rules(db, course_id)
        syllabus = _syllabus(db, course_id)
        exams = _past_exams(db, course)
        exam_content, used = _exam_docs_content(db, exams, MAX_EXAM_IMAGES)
        notes = [r[0] for r in db.execute(
            "SELECT md_path FROM ai_outputs WHERE kind='lecture_notes' AND course_id=? ORDER BY id", (course_id,))]
    if not rules and not exams:
        raise ValueError("Nessuna regola d'esame né appello passato trovati per questo corso: "
                         "metti i testi degli appelli in appelli/ o sincronizza il corso da Moodle.")
    note_titles = []
    for p in dict.fromkeys(notes):
        f = uni_path(p)
        if f.exists():
            note_titles.append(f.read_text(encoding="utf-8").splitlines()[0].lstrip("# "))
    intro = (f"Corso: {course['fullname']}\n\n=== Regole d'esame ufficiali ===\n{rules or '(non disponibili)'}\n\n"
             f"=== Programma / registro lezioni ===\n{syllabus or '(non disponibile)'}\n\n"
             + (f"=== Lezioni già studiate (appunti) ===\n" + "\n".join(f"- {t}" for t in note_titles) + "\n\n" if note_titles else "")
             + f"Appelli passati forniti: {len(exams)}.")
    content = [{"type": "text", "text": intro}, *exam_content,
               {"type": "text", "text": "\nProduci il profilo d'esame secondo lo schema."}]
    h = hashlib.sha256(json.dumps([PROFILE_VERSION, intro, used], ensure_ascii=False).encode()).hexdigest()
    jp, mp = profile_paths(course)
    if jp.exists() and not force:
        old = json.loads(jp.read_text(encoding="utf-8"))
        if old.get("input_hash") == h:
            return {**old, "cached": True}
    res = run(PROFILE_SYSTEM, content, PROFILE_SCHEMA, model=MODEL)
    payload = {**res.data, "course_id": course_id, "input_hash": h, "sources": used, "model": res.model,
               "created_at": _now(), "prompt_version": PROFILE_VERSION}
    jp.parent.mkdir(parents=True, exist_ok=True)
    jp.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    mp.write_text(_profile_md(res.data, course), encoding="utf-8")
    return {**payload, "cached": False, "utilization": res.utilization}


# --- Simulazioni --------------------------------------------------------------------

SIM_SYSTEM = """Sei il docente del corso e prepari una SIMULAZIONE D'ESAME nuova, realistica, nello stesso formato,
livello e stile degli appelli passati e del profilo d'esame. Non copiare gli esercizi: crea varianti nuove degli
esercizi tipo e domande di teoria dal programma. Rispetta struttura, parti e punteggi ufficiali (es. quiz di
sbarramento, parti con minimo). Per ogni domanda: soluzione completa con i passaggi e criteri di correzione
(come si assegnano i punti). Formule in LaTeX ($...$). In italiano."""

SIM_SCHEMA = {
    "type": "object", "additionalProperties": False, "required": ["titolo", "durata_min", "istruzioni_md", "domande"],
    "properties": {
        "titolo": {"type": "string"},
        "durata_min": {"type": "integer"},
        "istruzioni_md": {"type": "string"},
        "domande": {"type": "array", "items": {
            "type": "object", "additionalProperties": False,
            "required": ["parte", "tipo", "testo_md", "punti", "opzioni", "corretta", "soluzione_md", "criteri_md"],
            "properties": {
                "parte": {"type": "string"},
                "tipo": {"type": "string", "enum": ["multipla", "aperta", "esercizio"]},
                "testo_md": {"type": "string"},
                "punti": {"type": "number"},
                "opzioni": {"type": "array", "items": {"type": "string"}},
                "corretta": {"type": "integer", "description": "indice opzione corretta per 'multipla', altrimenti -1"},
                "soluzione_md": {"type": "string"},
                "criteri_md": {"type": "string"}}}},
    },
}


def generate_sim(course_id: int) -> dict:
    profile = get_profile(course_id)
    if not profile:
        raise ValueError("Prima crea il profilo d'esame del corso.")
    with session() as db:
        course = _course(db, course_id)
        rules = _exam_rules(db, course_id)
        exams = _past_exams(db, course)[:2]  # 2 appelli come riferimento di stile bastano
        exam_content, _ = _exam_docs_content(db, exams, 3)
    slim = {k: profile[k] for k in ("formato", "argomenti", "esercizi_tipo", "teoria_richiesta")}
    content = [{"type": "text", "text": f"Corso: {course['fullname']}\n\n=== Regole d'esame ===\n{rules}\n\n"
                                        f"=== Profilo d'esame ===\n{json.dumps(slim, ensure_ascii=False)}"},
               *exam_content, {"type": "text", "text": "\nCrea la simulazione d'esame."}]
    res = run(SIM_SYSTEM, content, SIM_SCHEMA, model=MODEL)
    with session() as db:
        sid = db.execute("INSERT INTO exam_sims (course_id, title, duration_min, content, created_at) VALUES (?,?,?,?,?)",
                         (course_id, res.data["titolo"], res.data["durata_min"],
                          json.dumps(res.data, ensure_ascii=False), _now())).lastrowid
    return {"id": sid, "utilization": res.utilization}


def list_sims(course_id: int) -> list[dict]:
    with session() as db:
        return [dict(r) for r in db.execute(
            """SELECT s.id, s.title, s.duration_min, s.created_at,
                      (SELECT MAX(grade) FROM exam_attempts a WHERE a.sim_id=s.id) AS best
               FROM exam_sims s WHERE s.course_id=? ORDER BY s.id DESC""", (course_id,))]


def get_sim(sim_id: int, with_solutions: bool = False) -> dict:
    with session() as db:
        row = db.execute("SELECT * FROM exam_sims WHERE id=?", (sim_id,)).fetchone()
        attempts = [dict(r) for r in db.execute(
            "SELECT id, grade, passed, elapsed_min, created_at FROM exam_attempts WHERE sim_id=? ORDER BY id", (sim_id,))]
    if not row:
        raise KeyError(sim_id)
    data = json.loads(row["content"])
    if not with_solutions:
        data["domande"] = [{k: v for k, v in q.items() if k not in ("corretta", "soluzione_md", "criteri_md")}
                           for q in data["domande"]]
    return {"id": row["id"], "course_id": row["course_id"], **data, "attempts": attempts}


GRADE_SYSTEM = """Sei il docente e correggi una prova d'esame scritta, in italiano, con il rigore di un vero esame.
Per ogni domanda assegna i punti secondo i criteri forniti (anche parziali). Le risposte possono essere testo e/o
FOTO dello svolgimento a mano: leggile con attenzione. Poi applica le regole ufficiali del corso (sbarramenti,
minimi per parte, conversione in trentesimi) e calcola il voto finale. Feedback utile: cosa è giusto, dov'è
l'errore, cosa ripassare. Formule in LaTeX ($...$)."""

GRADE_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["valutazioni", "voto_30", "superato", "commento_md", "da_ripassare"],
    "properties": {
        "valutazioni": {"type": "array", "items": {
            "type": "object", "additionalProperties": False, "required": ["indice", "punti", "feedback_md"],
            "properties": {"indice": {"type": "integer"}, "punti": {"type": "number"}, "feedback_md": {"type": "string"}}}},
        "voto_30": {"type": "number"},
        "superato": {"type": "boolean"},
        "commento_md": {"type": "string"},
        "da_ripassare": {"type": "array", "items": {"type": "string"}},
    },
}


def grade_sim(sim_id: int, answers: list[dict], elapsed_min: float | None = None) -> dict:
    """answers[i] = {"testo": str|None, "scelta": int|None, "immagini": [dataURL base64, …]}"""
    sim = get_sim(sim_id, with_solutions=True)
    with session() as db:
        rules = _exam_rules(db, sim["course_id"])
    content: list[dict] = [{"type": "text", "text": f"=== Regole d'esame ufficiali ===\n{rules}\n\n"
                                                    f"=== Prova: {sim['titolo']} ===\n{sim['istruzioni_md']}"}]
    n_img = 0
    for i, q in enumerate(sim["domande"]):
        a = answers[i] if i < len(answers) else {}
        head = (f"\n--- Domanda {i} · {q['parte']} · {q['tipo']} · {q['punti']:g} punti ---\n{q['testo_md']}\n"
                f"Soluzione: {q['soluzione_md']}\nCriteri: {q['criteri_md']}\n")
        if q["tipo"] == "multipla":
            scelta = a.get("scelta")
            ok = scelta is not None and int(scelta) == q["corretta"]
            head += (f"Opzioni: {q['opzioni']}\nRisposta dello studente: "
                     f"{'nessuna' if scelta is None else q['opzioni'][int(scelta)]} → {'CORRETTA' if ok else 'ERRATA'}"
                     " (già verificata: assegna tutti i punti se corretta, 0 altrimenti)")
            content.append({"type": "text", "text": head})
            continue
        head += f"Risposta dello studente (testo): {a.get('testo') or '(nessun testo)'}"
        content.append({"type": "text", "text": head})
        for url in (a.get("immagini") or [])[:4]:
            if n_img >= 16 or not url.startswith("data:image/"):
                continue
            mtype, b64 = url[5:].split(";base64,", 1)
            content.append({"type": "image", "source": {"type": "base64", "media_type": mtype, "data": b64}})
            n_img += 1
    content.append({"type": "text", "text": "\nCorreggi la prova secondo lo schema."})
    res = run(GRADE_SYSTEM, content, GRADE_SCHEMA, model=MODEL)
    g = res.data
    stored = [{k: v for k, v in (answers[i] if i < len(answers) else {}).items() if k != "immagini"}
              | {"n_immagini": len((answers[i] if i < len(answers) else {}).get("immagini") or [])}
              for i in range(len(sim["domande"]))]
    with session() as db:
        aid = db.execute("""INSERT INTO exam_attempts (sim_id, answers, grading, grade, passed, elapsed_min, created_at)
                            VALUES (?,?,?,?,?,?,?)""",
                         (sim_id, json.dumps(stored, ensure_ascii=False), json.dumps(g, ensure_ascii=False),
                          g["voto_30"], int(g["superato"]), elapsed_min, _now())).lastrowid
    sol = [{"soluzione_md": q["soluzione_md"], "corretta": q["corretta"], "punti_max": q["punti"]} for q in sim["domande"]]
    return {"attempt_id": aid, **g, "soluzioni": sol, "utilization": res.utilization}
