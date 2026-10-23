"""Archivio vettoriale: sqlite-vec se l'estensione si carica, altrimenti similarità coseno
in NumPy sui BLOB float16 della tabella chunks (che vengono sempre salvati)."""
from __future__ import annotations

import sqlite3

import numpy as np

from .. import db as dbmod
from .embed import DIM


def ensure(conn: sqlite3.Connection) -> None:
    if dbmod.VEC_AVAILABLE:
        conn.execute(f"""CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(
            chunk_id INTEGER PRIMARY KEY, course_id INTEGER PARTITION KEY,
            embedding float[{DIM}] distance_metric=cosine)""")


def store(conn: sqlite3.Connection, ids: list[int], course_ids: list[int], vecs: np.ndarray) -> None:
    conn.executemany("UPDATE chunks SET embedding=? WHERE id=?",
                     [(v.astype(np.float16).tobytes(), i) for i, v in zip(ids, vecs)])
    if dbmod.VEC_AVAILABLE:
        conn.executemany("INSERT OR REPLACE INTO vec_chunks(chunk_id, course_id, embedding) VALUES (?,?,?)",
                         [(i, c or 0, v.astype(np.float32).tobytes()) for i, c, v in zip(ids, course_ids, vecs)])


def delete(conn: sqlite3.Connection, ids: list[int]) -> None:
    if dbmod.VEC_AVAILABLE and ids:
        conn.executemany("DELETE FROM vec_chunks WHERE chunk_id=?", [(i,) for i in ids])


def knn(conn: sqlite3.Connection, query: np.ndarray, k: int, course_ids: list[int] | None) -> list[tuple[int, float]]:
    """[(chunk_id, similarità coseno)] in ordine decrescente."""
    if dbmod.VEC_AVAILABLE:
        q = query.astype(np.float32).tobytes()
        if course_ids and len(course_ids) == 1:
            rows = conn.execute("SELECT chunk_id, distance FROM vec_chunks WHERE embedding MATCH ? AND k = ? "
                                "AND course_id = ?", (q, k, course_ids[0])).fetchall()
        else:
            rows = conn.execute("SELECT chunk_id, distance FROM vec_chunks WHERE embedding MATCH ? AND k = ?",
                                (q, k * 4 if course_ids else k)).fetchall()
            if course_ids:
                allowed = {r[0] for r in conn.execute(
                    f"SELECT id FROM chunks WHERE course_id IN ({','.join('?' * len(course_ids))})", course_ids)}
                rows = [r for r in rows if r[0] in allowed][:k]
        return [(r[0], 1.0 - r[1]) for r in rows]
    # Fallback NumPy.
    sql = "SELECT id, embedding FROM chunks WHERE embedding IS NOT NULL"
    params: list = []
    if course_ids:
        sql += f" AND course_id IN ({','.join('?' * len(course_ids))})"
        params = list(course_ids)
    rows = conn.execute(sql, params).fetchall()
    if not rows:
        return []
    ids = np.array([r[0] for r in rows])
    mat = np.frombuffer(b"".join(r[1] for r in rows), np.float16).reshape(len(rows), DIM).astype(np.float32)
    sims = mat @ query.astype(np.float32)
    top = np.argsort(-sims)[:k]
    return [(int(ids[i]), float(sims[i])) for i in top]
