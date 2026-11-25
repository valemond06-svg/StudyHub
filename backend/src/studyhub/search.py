"""Ricerca ibrida: BM25 (FTS5) + similarità semantica (bge-m3), fuse con Reciprocal Rank Fusion."""
from __future__ import annotations

import re
import sqlite3

from .db import session
from .ingest import vectors
from .ingest.embed import EmbeddingError, embed_query
from .study.sources import url_hint

RRF_K = 60
CANDIDATES = 60
STOPWORDS = set("""a ad al alla alle allo agli ai anche che chi ci come con cosa cui da dal dalla dalle dei del della
delle dello degli di dove e ed è gli i il in la le lo ma mi ne nei nel nella nelle non o per perché più quale quali
quando se si sono su sul sulla tra fra un una uno the of and to is""".split())


def _fts_query(q: str) -> str | None:
    words = [w for w in re.findall(r"[\wà-ÿ]+", q.lower()) if w not in STOPWORDS and len(w) > 1]
    if not words:
        return None
    terms = [f'"{w}"' for w in words[:-1]] + [f'"{words[-1]}"*']
    return " OR ".join(terms)


def search(
    q: str, course_ids: list[int] | None = None, limit: int = 20, semantic: bool = True,
    *, include_notes: bool = False,
) -> dict:
    q = q.strip()
    if not q or course_ids == [] or limit <= 0:
        return {"results": [], "semantic": False}
    scores: dict[tuple[str, int], float] = {}
    snippets: dict[int, str] = {}
    notes: dict[int, dict] = {}
    semantic_ok = False
    with session() as db:
        filt, params = "", []
        if course_ids:
            filt = f" AND c.course_id IN ({','.join('?' * len(course_ids))})"
            params = list(course_ids)
        fq = _fts_query(q)
        if fq:
            rows = db.execute(
                f"""SELECT c.id, snippet(chunks_fts, 1, '[[', ']]', ' … ', 18) AS snip
                    FROM chunks_fts JOIN chunks c ON c.id = chunks_fts.rowid
                    WHERE chunks_fts MATCH ?{filt} ORDER BY bm25(chunks_fts, 0.5, 1.0) LIMIT ?""",
                [fq, *params, CANDIDATES]).fetchall()
            for rank, r in enumerate(rows):
                scores["chunk", r["id"]] = 1 / (RRF_K + rank)
                snippets[r["id"]] = r["snip"]
            if include_notes:
                rows = db.execute(
                    f"""SELECT c.id, c.course_id, co.fullname AS course, c.topic_id, c.doc_id,
                               c.lecture_id, c.timestamp_s AS t_start, c.page,
                               t.name AS heading, snippet(notes_fts, 1, '[[', ']]', ' … ', 18) AS snippet
                        FROM notes_fts JOIN notes c ON c.id=notes_fts.rowid
                        JOIN courses co ON co.id=c.course_id
                        LEFT JOIN study_topics t ON t.id=c.topic_id
                        WHERE notes_fts MATCH ?{filt}
                        ORDER BY bm25(notes_fts), c.updated_at DESC, c.id DESC LIMIT ?""",
                    [fq, *params, CANDIDATES],
                ).fetchall()
                for rank, row in enumerate(rows):
                    note = dict(row)
                    note.update(
                        kind="note", type="note", title=note["heading"] or "Nota personale",
                        path=None, t_end=None, note_id=note["id"],
                        url_hint=url_hint(note["lecture_id"], note["t_start"], note["doc_id"], note["page"])
                        or f"/api/notes/{note['id']}",
                    )
                    notes[note["id"]] = note
                    scores["note", note["id"]] = 1 / (RRF_K + rank)
        if semantic:
            try:
                qv = embed_query(q)
                for rank, (cid, _sim) in enumerate(vectors.knn(db, qv, CANDIDATES, course_ids)):
                    key = ("chunk", cid)
                    scores[key] = scores.get(key, 0) + 1 / (RRF_K + rank)
                semantic_ok = True
            except (EmbeddingError, sqlite3.OperationalError):
                # Ollama spento, oppure archivio vettoriale mai creato (nessun documento indicizzato):
                # la ricerca per parole funziona comunque.
                pass
        top = sorted(scores, key=scores.get, reverse=True)[:limit]
        chunks = [ident for kind, ident in top if kind == "chunk"]
        by_id = {}
        if chunks:
            rows = db.execute(
                f"""SELECT c.id, c.kind, c.page, c.t_start, c.t_end, c.heading, c.text, d.id AS doc_id, d.path, d.title,
                           d.lecture_id, co.fullname AS course, co.id AS course_id
                    FROM chunks c JOIN documents d ON d.id=c.doc_id LEFT JOIN courses co ON co.id=c.course_id
                    WHERE c.id IN ({','.join('?' * len(chunks))})""", chunks).fetchall()
            by_id = {r["id"]: dict(r) for r in rows}
    results = []
    for kind, ident in top:
        if kind == "note":
            r = notes[ident]
        else:
            r = by_id.get(ident)
            if r is None:  # L'indice vettoriale può contenere un chunk appena rimosso.
                continue
            text = r.pop("text")
            r["snippet"] = snippets.get(ident) or (text[:260] + ("…" if len(text) > 260 else ""))
            is_lecture = r["lecture_id"] is not None and (r["t_start"] is not None or r["kind"] == "transcript")
            r["type"] = "lecture" if is_lecture else "document"
            r["url_hint"] = (url_hint(r["lecture_id"], r["t_start"], None, None) if is_lecture
                             else url_hint(None, None, r["doc_id"], r["page"]))
        r["score"] = round(scores[kind, ident], 5)
        results.append(r)
    return {"results": results, "semantic": semantic_ok}
