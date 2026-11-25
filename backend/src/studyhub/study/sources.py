"""Riferimenti a materiale di studio appartenente allo stesso corso."""
from __future__ import annotations

from math import isfinite
from sqlite3 import Connection

_TABLES = {
    "lecture_id": ("lectures", "Lezione"),
    "topic_id": ("study_topics", "Argomento"),
    "doc_id": ("documents", "Documento"),
}


def validate(db: Connection, course_id: int, source: dict) -> None:
    if not db.execute("SELECT 1 FROM courses WHERE id=?", (course_id,)).fetchone():
        raise LookupError("Corso non trovato")
    for field, (table, label) in _TABLES.items():
        ident = source.get(field)
        if ident is not None and not db.execute(
            f"SELECT 1 FROM {table} WHERE id=? AND course_id=?", (ident, course_id)
        ).fetchone():
            raise ValueError(f"{label}: fonte non trovata nel corso")


def url_hint(
    lecture_id: int | None, timestamp_s: float | None,
    doc_id: int | None, page: int | None,
) -> str | None:
    if not isinstance(timestamp_s, (int, float)) or not isfinite(timestamp_s) or timestamp_s < 0:
        timestamp_s = None
    if not isinstance(page, int) or page < 1:
        page = None
    if lecture_id is not None and (timestamp_s is not None or doc_id is None):
        url = f"/api/lectures/{lecture_id}"
        return f"{url}?t={timestamp_s:g}" if timestamp_s is not None else url
    if doc_id is not None:
        url = f"/api/docs/{doc_id}/file"
        return f"{url}#page={page}" if page is not None else url
    return None
