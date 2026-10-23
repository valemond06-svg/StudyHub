"""Ordine didattico degli argomenti di un corso, diviso in capitoli.

La data dei file non basta (appelli di anni prima, slide ricaricate, esempi caricati l'anno scorso):
una chiamata per corso legge programma/diario e l'elenco delle unità e mette gli argomenti nell'ordine
in cui si studiano, raggruppati in capitoli. Gli "argomenti" che non si studiano (struttura del corso,
regole d'esame, bibliografia) vengono nascosti. Si rifà solo quando cambia l'elenco degli argomenti.
"""
from __future__ import annotations

import hashlib

from ..ai.llm import run_json
from ..db import session
from .exam import _syllabus

SYSTEM = """Sei il docente del corso. Ricevi il programma/diario del corso, l'elenco dei materiali con la data
e l'elenco degli ARGOMENTI estratti automaticamente dal materiale. Devi:
1. metterli nell'ORDINE DIDATTICO in cui uno studente deve studiarli (quello del programma e delle lezioni:
   prima le basi, poi ciò che le usa), raggruppati in 3-12 CAPITOLI dal titolo breve;
2. mettere in "esclusi" ciò che non è materia da studiare (organizzazione/struttura del corso, roadmap,
   bibliografia, regole d'esame, informazioni pratiche).
Usa ESATTAMENTE i nomi degli argomenti forniti, ognuno una sola volta. Gli appelli d'esame passati NON
definiscono l'ordine: contano programma e lezioni."""

SCHEMA = {
    "type": "object", "additionalProperties": False, "required": ["capitoli", "esclusi"],
    "properties": {
        "capitoli": {"type": "array", "items": {
            "type": "object", "additionalProperties": False, "required": ["titolo", "argomenti"],
            "properties": {"titolo": {"type": "string"}, "argomenti": {"type": "array", "items": {"type": "string"}}}}},
        "esclusi": {"type": "array", "items": {"type": "string"}},
    },
}


def _key(names: list[str]) -> str:
    return hashlib.sha1("\n".join(sorted(names)).encode()).hexdigest()


def needs_order(course_id: int) -> bool:
    with session() as db:
        names = [r[0] for r in db.execute("SELECT name FROM study_topics WHERE course_id=?", (course_id,))]
        key = db.execute("SELECT topics_order_key FROM courses WHERE id=?", (course_id,)).fetchone()[0]
    return bool(names) and key != _key(names)


def order_course(course_id: int, force: bool = False) -> dict:
    if not force and not needs_order(course_id):
        return {"cached": True}
    with session() as db:
        course = db.execute("SELECT fullname FROM courses WHERE id=?", (course_id,)).fetchone()[0]
        topics = [dict(r) for r in db.execute(
            """SELECT t.id, t.name, t.day, u.title AS unit FROM study_topics t LEFT JOIN study_units u ON u.id=t.unit_id
               WHERE t.course_id=? ORDER BY t.day, t.id""", (course_id,))]
        units = [f"{r[0] or '?'} · {r[1]}" for r in db.execute(
            "SELECT day, title FROM study_units WHERE course_id=? ORDER BY day, id", (course_id,))]
        program = _syllabus(db, course_id)
    text = (f"Corso: {course}\n\n=== Programma / diario del corso ===\n{program or '(non disponibile)'}\n\n"
            f"=== Materiali (data · titolo) ===\n" + "\n".join(units[:250]) +
            "\n\n=== Argomenti da ordinare (data di prima comparsa · nome · materiale) ===\n" +
            "\n".join(f"{t['day']} · {t['name']} · {t['unit']}" for t in topics))
    res = run_json(SYSTEM, text, SCHEMA, quality="accurato")
    by_name = {t["name"].strip().lower(): t for t in topics}
    placed: set[int] = set()
    rows: list[tuple] = []
    pos = 0
    for ch in res.data["capitoli"]:
        for name in ch["argomenti"]:
            t = by_name.get(name.strip().lower())
            if t and t["id"] not in placed:
                pos += 1
                rows.append((pos, ch["titolo"].strip()[:80], 0, t["id"]))
                placed.add(t["id"])
    excluded = {n.strip().lower() for n in res.data["esclusi"]}
    for t in topics:  # quelli che il modello ha dimenticato: in fondo, nell'ordine di data
        if t["id"] in placed:
            continue
        if t["name"].strip().lower() in excluded:
            rows.append((None, None, 1, t["id"]))
        else:
            pos += 1
            rows.append((pos, "Altro", 0, t["id"]))
    with session() as db:
        # hidden=2: capitolo escluso da te (es. una parte già superata): resta escluso anche dopo un nuovo ordinamento
        db.executemany("""UPDATE study_topics SET position=?, chapter=?, hidden=CASE WHEN hidden=2 THEN 2 ELSE ? END
                          WHERE id=?""", rows)
        db.execute("UPDATE courses SET topics_order_key=? WHERE id=?", (_key([t["name"] for t in topics]), course_id))
    return {"cached": False, "chapters": len(res.data["capitoli"]), "hidden": sum(1 for r in rows if r[2])}

