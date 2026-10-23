"""Lezione interattiva di un argomento: il modo principale per IMPARARE (le domande servono a verificarsi).

Una chiamata (Gemini, Claude di riserva) legge il materiale dove l'argomento compare (appunti delle
lezioni, quindi anche quello che è stato detto a voce nei video, e pagine dei PDF) e lo trasforma in:
  - perché serve (aggancio con l'esame e con quello che sai già);
  - 3-7 passi brevi, ognuno con una spiegazione semplice, un'intuizione/analogia e una mini-verifica
    da fare subito (scelta multipla o vero/falso, con spiegazione della risposta);
  - un esempio svolto "a indovinare il passo dopo";
  - errori tipici e un riassunto da sapere a memoria.
Le lezioni si preparano in anticipo per i prossimi argomenti del corso (in ordine), così sono pronte
quando studi. In ogni passo puoi chiedere "spiegamelo in un altro modo" o fare una domanda libera.
"""
from __future__ import annotations

import json
import queue
import threading
from datetime import datetime

from ..ai.llm import run_json
from ..db import session
from .bank import _unit_text

MAX_SOURCE_CHARS = 45_000

SYSTEM = """Sei il miglior tutor universitario possibile per uno studente di Ingegneria che si annoia facilmente
ma deve preparare l'esame SUL SERIO. Insegna UN argomento partendo dal materiale del corso (appunti delle
lezioni, trascrizioni, slide, dispense, esercitazioni): lo studente non deve aver bisogno di rivedere i video.

Come insegnare:
- Parti dal perché: a cosa serve, dove si usa, perché è all'esame. Poi dall'intuizione, poi il formalismo.
- Passi brevi (60-140 parole ciascuno), uno per idea, in ordine logico. Linguaggio semplice e diretto
  (dai del tu), ma rigoroso: definizioni ed enunciati esatti, come li vuole il docente.
- "intuizione_md": un'immagine mentale, un'analogia o un caso concreto che fa "scattare" l'idea.
- Ogni passo ha una mini-verifica IMMEDIATA sul passo stesso (non banale, non a trabocchetto) con la spiegazione
  del perché la risposta è quella.
- L'esempio svolto deve essere nello stile dell'esame: dividi la soluzione in passi; per ogni passo scrivi la
  domanda che lo studente dovrebbe farsi ("cosa faresti ora?") e la risposta.
- Formule in LaTeX con $...$ e $$...$$. In italiano.
- Basati sul materiale fornito; se aggiungi un chiarimento che non c'è, scrivi "(integrazione)".
- Se nel materiale c'è il minuto della lezione (▶ mm:ss) indica nei passi "inizio_s" in secondi."""

SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["titolo", "perche_md", "prerequisiti", "passi", "esempio", "errori_tipici", "riassunto_md"],
    "properties": {
        "titolo": {"type": "string"},
        "perche_md": {"type": "string", "description": "2-4 frasi: a cosa serve e perché conta all'esame"},
        "prerequisiti": {"type": "array", "items": {"type": "string"}},
        "passi": {"type": "array", "items": {
            "type": "object", "additionalProperties": False,
            "required": ["titolo", "spiegazione_md", "intuizione_md", "verifica"],
            "properties": {
                "titolo": {"type": "string"},
                "spiegazione_md": {"type": "string"},
                "intuizione_md": {"type": "string"},
                "inizio_s": {"type": "number"},
                "verifica": {"type": "object", "additionalProperties": False,
                             "required": ["testo_md", "opzioni", "corretta", "spiegazione_md"],
                             "properties": {"testo_md": {"type": "string"},
                                            "opzioni": {"type": "array", "items": {"type": "string"}},
                                            "corretta": {"type": "integer", "description": "indice dell'opzione giusta"},
                                            "spiegazione_md": {"type": "string"}}}}}},
        "esempio": {"type": "object", "additionalProperties": False, "required": ["testo_md", "passi", "risultato_md"],
                    "properties": {"testo_md": {"type": "string"},
                                   "passi": {"type": "array", "items": {
                                       "type": "object", "additionalProperties": False,
                                       "required": ["domanda_md", "risposta_md"],
                                       "properties": {"domanda_md": {"type": "string"},
                                                      "risposta_md": {"type": "string"}}}},
                                   "risultato_md": {"type": "string"}}},
        "errori_tipici": {"type": "array", "items": {
            "type": "object", "additionalProperties": False, "required": ["errore", "correzione"],
            "properties": {"errore": {"type": "string"}, "correzione": {"type": "string"}}}},
        "riassunto_md": {"type": "string", "description": "elenco puntato: cosa sapere a memoria"},
    },
}

ASK_SYSTEM = """Sei un tutor universitario paziente. Lo studente sta studiando un argomento e ti chiede qualcosa.
Rispondi in italiano, con il tu, in modo semplice e concreto (max 200 parole), con un esempio se aiuta.
Formule in LaTeX ($...$). Basati sul contesto fornito; se serve aggiungere qualcosa che non c'è, dillo."""
ASK_SCHEMA = {"type": "object", "additionalProperties": False, "required": ["risposta_md"],
              "properties": {"risposta_md": {"type": "string"}}}


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _sources(db, topic_id: int) -> tuple[dict, str]:
    """Il materiale dove compare l'argomento, a partire dalla prima unità (in ordine di data)."""
    t = dict(db.execute("SELECT * FROM study_topics WHERE id=?", (topic_id,)).fetchone())
    units = [dict(r) for r in db.execute(
        """SELECT DISTINCT u.* FROM study_units u JOIN study_items i ON i.unit_id=u.id
           WHERE i.topic_id=? ORDER BY u.day, u.id""", (topic_id,))]
    texts, total = [], 0
    for u in units:
        try:
            text = _unit_text(db, u)[0]
        except Exception:
            continue
        texts.append(text[:MAX_SOURCE_CHARS - total])
        total += len(texts[-1])
        if total >= MAX_SOURCE_CHARS:
            break
    return t, "\n\n".join(texts)


def generate(topic_id: int) -> dict:
    with session() as db:
        t, material = _sources(db, topic_id)
        course = db.execute("SELECT fullname FROM courses WHERE id=?", (t["course_id"],)).fetchone()[0]
        siblings = [r[0] for r in db.execute(
            """SELECT name FROM study_topics WHERE course_id=? AND id!=? AND hidden=0
               ORDER BY COALESCE(position, 1000000), day, id""", (t["course_id"], topic_id))]
    prompt = (f"Corso: {course}\nARGOMENTO DA INSEGNARE: {t['name']}\n\nScheda di partenza:\n{t['summary_md'] or ''}\n\n"
              f"Altri argomenti del corso (NON spiegarli qui, al massimo richiamali):\n"
              + "\n".join(f"- {s}" for s in siblings[:80])
              + f"\n\n=== Materiale del corso ===\n{material}\n\nScrivi la lezione interattiva su «{t['name']}».")
    res = run_json(SYSTEM, prompt, SCHEMA, quality="accurato")
    data = res.data
    for p in data.get("passi", []):  # verifiche malformate: meglio un passo senza verifica che una sbagliata
        v = p.get("verifica") or {}
        if not (len(v.get("opzioni") or []) >= 2 and 0 <= int(v.get("corretta", -1)) < len(v["opzioni"])):
            p["verifica"] = None
    with session() as db:
        db.execute("""UPDATE study_lessons SET data=?, status='pronta', provider=?, message=NULL, created_at=?
                      WHERE topic_id=?""", (json.dumps(data, ensure_ascii=False), res.model, _now(), topic_id))
    return data


# --- Coda di preparazione (un worker nel server, 2 lezioni alla volta) ---------------

_q: "queue.Queue[int]" = queue.Queue()
_workers: list[threading.Thread] = []
_wlock = threading.Lock()


def _worker() -> None:
    while True:
        tid = _q.get()
        with session() as db:
            ok = db.execute("UPDATE study_lessons SET status='in_corso' WHERE topic_id=? AND status='in_coda'",
                            (tid,)).rowcount
        if ok:
            try:
                generate(tid)
            except Exception as e:
                with session() as db:
                    db.execute("UPDATE study_lessons SET status='errore', message=? WHERE topic_id=?", (str(e)[:300], tid))
        _q.task_done()


def request(topic_ids: list[int]) -> None:
    """Mette in coda le lezioni mancanti (o finite in errore) di questi argomenti."""
    with _wlock:
        if not _workers:
            with session() as db:  # lezioni rimaste a metà da un server chiuso
                db.execute("UPDATE study_lessons SET status='in_coda' WHERE status='in_corso'")
                pending = [r[0] for r in db.execute("SELECT topic_id FROM study_lessons WHERE status='in_coda'")]
            for _ in range(2):
                th = threading.Thread(target=_worker, name="lezioni", daemon=True)
                th.start()
                _workers.append(th)
            for tid in pending:
                _q.put(tid)
    with session() as db:
        for tid in topic_ids:
            row = db.execute("SELECT status FROM study_lessons WHERE topic_id=?", (tid,)).fetchone()
            if row and row[0] in ("pronta", "in_coda", "in_corso"):
                continue
            db.execute("""INSERT INTO study_lessons (topic_id, status) VALUES (?, 'in_coda')
                          ON CONFLICT(topic_id) DO UPDATE SET status='in_coda', message=NULL""", (tid,))
            _q.put(tid)


def prefetch(course_id: int, n: int = 4) -> list[int]:
    """Prepara le lezioni dei prossimi argomenti da studiare (i primi non ancora completati, in ordine)."""
    with session() as db:
        ids = [r[0] for r in db.execute(
            """SELECT t.id FROM study_topics t LEFT JOIN study_lessons l ON l.topic_id=t.id
               WHERE t.course_id=? AND t.hidden=0 AND l.completed_at IS NULL
               ORDER BY COALESCE(t.position, 1000000), t.day, t.id LIMIT ?""", (course_id, n))]
    request(ids)
    return ids


def get(topic_id: int) -> dict:
    with session() as db:
        row = db.execute("SELECT * FROM study_lessons WHERE topic_id=?", (topic_id,)).fetchone()
        t = db.execute("SELECT id, course_id, name, weight, summary_md, lecture_id, t_start, doc_id, page "
                       "FROM study_topics WHERE id=?", (topic_id,)).fetchone()
        lec = db.execute("SELECT title FROM lectures WHERE id=?", (t["lecture_id"],)).fetchone() if t and t["lecture_id"] else None
    if not t:
        raise KeyError(topic_id)
    out = {"topic": {**dict(t), "lecture": lec[0] if lec else None}, "status": row["status"] if row else None,
           "message": row["message"] if row else None, "completed_at": row["completed_at"] if row else None}
    if row and row["status"] == "pronta":
        out["lesson"] = json.loads(row["data"])
    return out


def complete(topic_id: int) -> None:
    with session() as db:
        db.execute("UPDATE study_lessons SET completed_at=COALESCE(completed_at, ?) WHERE topic_id=?", (_now(), topic_id))


def ask(topic_id: int, question: str, context: str = "", mode: str = "domanda") -> str:
    """Domanda libera o "spiegamelo in un altro modo" sul passo che stai leggendo (chiamata veloce)."""
    with session() as db:
        t = dict(db.execute("SELECT name, summary_md FROM study_topics WHERE id=?", (topic_id,)).fetchone())
    if mode == "altro_modo":
        question = ("Non ho capito bene questo passo. Rispiegamelo in modo diverso e più semplice: parti da un esempio "
                    "concreto con numeri, poi generalizza.")
    text = (f"Argomento: {t['name']}\nScheda:\n{t['summary_md'] or ''}\n\nPasso che lo studente sta leggendo:\n{context}\n\n"
            f"Domanda dello studente: {question}")
    return run_json(ASK_SYSTEM, text, ASK_SCHEMA, quality="veloce").data["risposta_md"]
