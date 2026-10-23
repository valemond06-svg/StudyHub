"""Quiz su una lezione.

Generazione: 1 chiamata Sonnet partendo dagli APPUNTI AI della lezione (già distillati, quindi pochi
token) invece che dal materiale grezzo. Correzione: crocette e vero/falso in locale (gratis); le
risposte aperte ed esercizi in 1 chiamata Haiku per tutto il tentativo.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime

from ..ai.claude_runner import run
from ..ai.lecture_notes import existing
from ..db import session
from ..paths import uni_path

GEN_MODEL = "sonnet"
GRADE_MODEL = "haiku"

GEN_SYSTEM = """Sei un docente universitario che prepara un quiz di verifica in italiano, nello stile
dell'esame del corso. Basati SOLO sugli appunti forniti. Mescola: domande a scelta multipla (4 opzioni,
una sola corretta, distrattori plausibili che colpiscono errori tipici), vero/falso, domande aperte di
teoria (definizioni, enunciati, dimostrazioni) ed esercizi brevi con soluzione. Formule in LaTeX ($...$).
Per ogni domanda indica il minuto della lezione (secondi) se lo conosci dagli appunti."""

GEN_SCHEMA = {
    "type": "object", "additionalProperties": False, "required": ["titolo", "domande"],
    "properties": {
        "titolo": {"type": "string"},
        "domande": {"type": "array", "items": {
            "type": "object", "additionalProperties": False,
            "required": ["tipo", "testo_md", "opzioni", "corretta", "soluzione_md"],
            "properties": {
                "tipo": {"type": "string", "enum": ["multipla", "vero_falso", "aperta", "esercizio"]},
                "testo_md": {"type": "string"},
                "opzioni": {"type": "array", "items": {"type": "string"},
                            "description": "4 opzioni per 'multipla', vuota per gli altri tipi"},
                "corretta": {"type": "integer",
                             "description": "indice dell'opzione corretta (multipla); 1=vero 0=falso (vero_falso); -1 altrimenti"},
                "soluzione_md": {"type": "string", "description": "spiegazione o risposta modello"},
                "inizio_s": {"type": "number"},
            }}},
    },
}

GRADE_SYSTEM = """Correggi le risposte aperte di uno studente universitario, in italiano, confrontandole con la
risposta modello. Sii giusto ma esigente come all'esame: valuta correttezza, completezza e rigore.
Punteggio da 0 a 1 (anche frazioni, es. 0.5). Il feedback deve dire cosa manca o è sbagliato, in 1-3 frasi."""

GRADE_SCHEMA = {
    "type": "object", "additionalProperties": False, "required": ["valutazioni"],
    "properties": {"valutazioni": {"type": "array", "items": {
        "type": "object", "additionalProperties": False, "required": ["indice", "punteggio", "feedback_md"],
        "properties": {"indice": {"type": "integer"}, "punteggio": {"type": "number"},
                       "feedback_md": {"type": "string"}}}}},
}


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def generate(lecture_id: int, n_questions: int = 10) -> dict:
    out = existing(lecture_id)
    if not out:
        raise ValueError("Prima genera gli appunti AI della lezione.")
    notes = uni_path(out["md_path"]).read_text(encoding="utf-8")
    h = hashlib.sha256(f"quiz-v1|{n_questions}|{notes}".encode()).hexdigest()
    with session() as db:
        row = db.execute("SELECT * FROM quizzes WHERE lecture_id=? AND input_hash=? ORDER BY id DESC LIMIT 1",
                         (lecture_id, h)).fetchone()
        if row:
            return {"id": row["id"], "cached": True}
    content = [{"type": "text", "text": f"=== Appunti della lezione ===\n{notes}\n\n"
                                        f"Prepara un quiz di {n_questions} domande."}]
    res = run(GEN_SYSTEM, content, GEN_SCHEMA, model=GEN_MODEL)
    with session() as db:
        qid = db.execute("INSERT INTO quizzes (course_id, lecture_id, title, questions, input_hash, created_at) "
                         "VALUES (?,?,?,?,?,?)",
                         (out["course_id"], lecture_id, res.data["titolo"],
                          json.dumps(res.data["domande"], ensure_ascii=False), h, _now())).lastrowid
    return {"id": qid, "cached": False, "utilization": res.utilization}


def get(quiz_id: int, with_solutions: bool = False) -> dict:
    with session() as db:
        row = db.execute("SELECT * FROM quizzes WHERE id=?", (quiz_id,)).fetchone()
        attempts = [dict(r) for r in db.execute("SELECT id, score, max_score, created_at FROM quiz_attempts WHERE quiz_id=?",
                                                (quiz_id,))]
    if not row:
        raise KeyError(quiz_id)
    qs = json.loads(row["questions"])
    if not with_solutions:
        qs = [{k: v for k, v in q.items() if k not in ("corretta", "soluzione_md")} for q in qs]
    return {**{k: row[k] for k in ("id", "course_id", "lecture_id", "title", "created_at")}, "questions": qs,
            "attempts": attempts}


def list_for_lecture(lecture_id: int) -> list[dict]:
    with session() as db:
        return [dict(r) for r in db.execute(
            """SELECT q.id, q.title, q.created_at, (SELECT MAX(score*1.0/max_score) FROM quiz_attempts a WHERE a.quiz_id=q.id) AS best
               FROM quizzes q WHERE q.lecture_id=? ORDER BY q.id DESC""", (lecture_id,))]


def submit(quiz_id: int, answers: list) -> dict:
    """answers[i]: indice scelto (multipla), 1/0 (vero_falso), testo (aperta/esercizio), None se saltata."""
    quiz = get(quiz_id, with_solutions=True)
    results, open_items = [], []
    for i, q in enumerate(quiz["questions"]):
        a = answers[i] if i < len(answers) else None
        r = {"indice": i, "risposta": a, "soluzione_md": q["soluzione_md"], "corretta": q.get("corretta")}
        if q["tipo"] in ("multipla", "vero_falso"):
            r["punteggio"] = 1.0 if a is not None and int(a) == q["corretta"] else 0.0
        elif not (a or "").strip():
            r["punteggio"], r["feedback_md"] = 0.0, "Risposta non data."
        else:
            open_items.append((i, q, a))
        results.append(r)
    utilization = None
    if open_items:
        text = "\n\n".join(f"--- Domanda {i} ({q['tipo']}) ---\n{q['testo_md']}\n\nRisposta modello:\n{q['soluzione_md']}"
                           f"\n\nRisposta dello studente:\n{a}" for i, q, a in open_items)
        res = run(GRADE_SYSTEM, [{"type": "text", "text": text}], GRADE_SCHEMA, model=GRADE_MODEL)
        utilization = res.utilization
        by_idx = {v["indice"]: v for v in res.data["valutazioni"]}
        for i, _q, _a in open_items:
            v = by_idx.get(i, {"punteggio": 0, "feedback_md": "Valutazione non disponibile."})
            results[i]["punteggio"] = max(0.0, min(1.0, float(v["punteggio"])))
            results[i]["feedback_md"] = v["feedback_md"]
    score = round(sum(r["punteggio"] for r in results), 2)
    with session() as db:
        aid = db.execute("INSERT INTO quiz_attempts (quiz_id, answers, score, max_score, created_at) VALUES (?,?,?,?,?)",
                         (quiz_id, json.dumps(results, ensure_ascii=False), score, len(results), _now())).lastrowid
    return {"attempt_id": aid, "score": score, "max_score": len(results), "results": results,
            "utilization": utilization}
