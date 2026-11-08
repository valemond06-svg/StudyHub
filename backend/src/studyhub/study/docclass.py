"""Che cos'è ogni documento: calendario, appello, soluzione, esiti, slide, appunti...

Solo regole su percorso e prima pagina: nessuna chiamata AI, gira a ogni sync. Il profilo d'esame prende gli appelli
da qui, ovunque stiano nel Moodle, e non più soltanto dalla cartella appelli/.
"""
from __future__ import annotations

import re
from datetime import datetime

from ..db import session

CATEGORIES = ("avvisi", "forum", "sezione", "calendario", "regole_esame", "programma", "esiti", "soluzione", "appello",
              "formulario", "appunti", "esercizi", "slide", "trascrizione", "codice", "altro_corso", "materiale")
OTHER_COURSE = re.compile(r"/\d+_analisi i_|/\d+_analisi i |appelli bonafini", re.I)
RULES = (
    ("esiti", r"\besiti\b|risultati"),
    ("calendario", r"calendario|\borario\b"),
    ("regole_esame", r"regole.{0,3}d.?esame|modalit.{1,3}.{0,12}esame|modalit.{1,3} di verifica|promemoria|course.info|-admin\b|grading policy"),
    ("programma", r"syllabus|programma|diario delle lezioni|tavola dei contenuti|bibliografia|propedeutic"),
    ("formulario", r"formulario"),
    ("esercizi", r"quesiti|esercizi con soluzione|esercizi su|ulteriori esercizi"),
    ("soluzione",r"soluzion|chiave|svolt|correzion"),
    ("appello", r"appell|\besame\b|esami\b|prova del|temi d.?esame|compito|simulazione|/20\d\d_\d\d_\d\d_[ab]\b"),
    ("appunti", r"appunti|lezione_amm|/lezioni/|lezione[ _-]?\d"),
    ("esercizi", r"eserc|homework|\bhw\d|\bhm\d|tutorato|/lab|\blab[ _]?\d|\bl\d\d-"),
    ("slide", r"slide|\bcap\.? ?\d|lecture|lezione|^\d\d - "),
)
DATES = (
    (re.compile(r"(20\d\d)[_.-](\d\d)[_.-](\d\d)"), (1, 2, 3)),
    (re.compile(r"(?<!\d)(20\d\d)(\d\d)(\d\d)(?!\d)"), (1, 2, 3)),
    (re.compile(r"(?<!\d)(\d\d?)[.\-/](\d\d?)[.\-/](20\d\d)"), (3, 2, 1)),
)


def exam_date(text: str) -> str | None:
    for rx, order in DATES:
        m = rx.search(text)
        if m:
            y, mo, d = (int(m.group(i)) for i in order)
            try:
                return datetime(y, mo, d).date().isoformat()
            except ValueError:
                continue
    return None


def classify(path: str, kind: str, first_text: str = "") -> str:
    low = path.lower().replace("\\", "/")
    name = low.rsplit("/", 1)[-1]
    if kind == "transcript":
        return "trascrizione"
    if kind == "code" or name.endswith((".m", ".py", ".c", ".h", ".sh", ".dat", ".lib", ".asc")):
        return "codice"
    if name == "_avvisi.md":
        return "avvisi"
    if name.startswith("_forum"):
        return "forum"
    if name == "_sezione.md":
        return "sezione"
    if OTHER_COURSE.search(low):
        return "altro_corso"
    # Prima il nome del file, poi la cartella: «Soluzione esame» dentro «Temi d'esame» è una soluzione.
    for hay in (name, low, (first_text or "")[:400].lower()):
        for category, rule in RULES:
            if re.search(rule, hay, re.I):
                return category
    return "materiale"


def tag_all() -> dict:
    """Ricalcola i tag di tutti i documenti (veloce e idempotente)."""
    counts: dict[str, int] = {}
    now = datetime.now().isoformat(timespec="seconds")
    with session() as db:
        rows = db.execute(
            """SELECT d.id, d.path, d.kind,
                      (SELECT text FROM chunks c WHERE c.doc_id=d.id ORDER BY c.page, c.id LIMIT 1) AS first_text
               FROM documents d""").fetchall()
        for r in rows:
            cat = classify(r["path"], r["kind"], r["first_text"] or "")
            when = exam_date(r["path"]) if cat in ("appello", "soluzione", "esiti") else None
            db.execute("INSERT INTO doc_tags (doc_id, category, exam_date, updated_at) VALUES (?,?,?,?) "
                       "ON CONFLICT(doc_id) DO UPDATE SET category=excluded.category, exam_date=excluded.exam_date, "
                       "updated_at=excluded.updated_at", (r["id"], cat, when, now))
            counts[cat] = counts.get(cat, 0) + 1
    return counts
