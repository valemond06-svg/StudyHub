"""Quaderno personale e ricerca locale in testo e tag."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from sqlite3 import Connection, Row

from ..db import session
from . import sources


def _public(row: Row) -> dict:
    note = dict(row)
    note["tags"] = json.loads(note["tags"])
    return note


def _get(db: Connection, note_id: int) -> dict:
    row = db.execute("SELECT * FROM notes WHERE id=?", (note_id,)).fetchone()
    if row is None:
        raise LookupError("Nota non trovata")
    return _public(row)


def get(note_id: int) -> dict:
    with session() as db:
        return _get(db, note_id)


def save(values: dict, note_id: int | None = None) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    with session() as db:
        db.execute("BEGIN IMMEDIATE")
        note = _get(db, note_id) if note_id is not None else {}
        if note_id is not None and not values:
            return note
        note.update(values)
        sources.validate(db, note["course_id"], note)
        if not note["body"] or not note["body"].strip():
            raise ValueError("La nota deve avere un testo")
        if "tags" in values and values["tags"] is None:
            raise ValueError("Usa una lista vuota per rimuovere i tag")
        values = dict(values)
        if "tags" in values:
            values["tags"] = json.dumps(values["tags"], ensure_ascii=False)
        values["updated_at"] = now
        if note_id is None:
            values["created_at"] = now
            note_id = db.execute(
                f"INSERT INTO notes ({', '.join(values)}) VALUES ({', '.join('?' for _ in values)})",
                list(values.values()),
            ).lastrowid
        else:
            columns = ", ".join(f"{key}=?" for key in values)
            db.execute(f"UPDATE notes SET {columns} WHERE id=?", [*values.values(), note_id])
        return _get(db, note_id)


def delete(note_id: int) -> None:
    with session() as db:
        if not db.execute("DELETE FROM notes WHERE id=?", (note_id,)).rowcount:
            raise LookupError("Nota non trovata")


def listing(filters: dict, q: str | None, tag: str | None, limit: int, offset: int) -> list[dict]:
    from ..search import _fts_query

    where = [f"n.{key}=?" for key in filters]
    params = list(filters.values())
    source = "notes n"
    if q:
        fq = _fts_query(q)
        if fq is None:
            return []
        source += " JOIN notes_fts ON notes_fts.rowid=n.id"
        where.append("notes_fts MATCH ?")
        params.append(fq)
    if tag is not None:
        where.append("EXISTS (SELECT 1 FROM json_each(n.tags) WHERE value=?)")
        params.append(tag)
    clause = " WHERE " + " AND ".join(where) if where else ""
    with session() as db:
        rows = db.execute(
            f"SELECT n.* FROM {source}{clause} ORDER BY n.updated_at DESC, n.id DESC LIMIT ? OFFSET ?",
            [*params, limit, offset],
        ).fetchall()
    return [_public(row) for row in rows]
