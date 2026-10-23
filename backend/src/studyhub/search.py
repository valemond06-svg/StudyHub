"""Ricerca ibrida: BM25 (FTS5) + similarità semantica (bge-m3), fuse con Reciprocal Rank Fusion."""
from __future__ import annotations

import re

from .db import session
from .ingest import vectors
from .ingest.embed import EmbeddingError, embed_query

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


def search(q: str, course_ids: list[int] | None = None, limit: int = 20, semantic: bool = True) -> dict:
    q = q.strip()
    if not q:
        return {"results": [], "semantic": False}
    scores: dict[int, float] = {}
    snippets: dict[int, str] = {}
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
                scores[r["id"]] = scores.get(r["id"], 0) + 1 / (RRF_K + rank)
                snippets[r["id"]] = r["snip"]
        if semantic:
            try:
                qv = embed_query(q)
                for rank, (cid, _sim) in enumerate(vectors.knn(db, qv, CANDIDATES, course_ids)):
                    scores[cid] = scores.get(cid, 0) + 1 / (RRF_K + rank)
                semantic_ok = True
            except EmbeddingError:
                pass
        top = sorted(scores, key=scores.get, reverse=True)[:limit]
        if not top:
            return {"results": [], "semantic": semantic_ok}
        rows = db.execute(
            f"""SELECT c.id, c.kind, c.page, c.t_start, c.t_end, c.heading, c.text, d.id AS doc_id, d.path, d.title,
                       d.lecture_id, co.fullname AS course, co.id AS course_id
                FROM chunks c JOIN documents d ON d.id = c.doc_id LEFT JOIN courses co ON co.id = c.course_id
                WHERE c.id IN ({','.join('?' * len(top))})""", top).fetchall()
    by_id = {r["id"]: dict(r) for r in rows}
    results = []
    for cid in top:
        r = by_id[cid]
        text = r.pop("text")
        r["snippet"] = snippets.get(cid) or (text[:260] + ("…" if len(text) > 260 else ""))
        r["score"] = round(scores[cid], 5)
        results.append(r)
    return {"results": results, "semantic": semantic_ok}
