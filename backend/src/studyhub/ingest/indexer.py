"""Indicizzazione incrementale di tutto il materiale dei corsi.

Per ogni cartella corso: moodle/, appelli/, libri_e_appunti/, studio_ai/ e le trascrizioni in
lezioni/*/transcript.json. I file con lo stesso contenuto (sha256), es. lo stesso PDF in
moodle/ e in libri_e_appunti/, vengono indicizzati una volta sola.
"""
from __future__ import annotations

import hashlib
import json
import re
import zlib
from datetime import datetime
from pathlib import Path

from rich.console import Console

from ..config import settings
from ..db import session
from ..paths import rel_to_uni, uni_path
from . import vectors
from .chunking import chunk_code, chunk_markdown, chunk_pages, chunk_transcript
from .embed import embed_documents
from .extract import CODE_EXT, SUPPORTED, extract

console = Console()
SOURCE_DIRS = ("moodle", "appelli", "libri_e_appunti", "studio_ai")
SKIP_DIRS = {".git", "build", "dist", "obj", "bin", "__pycache__", "hci_data", "analysis_output", "node_modules", "_tmp"}
SKIP_FILES = {"_corso.json", "INDICE.md"}
MAX_BYTES = 80 * 1024 * 1024


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def register_local_courses() -> None:
    """Cartelle corso senza un corso Moodle (es. 1_Anno/_Superati/Programmazione): righe con id negativo."""
    with session() as db:
        known = {r[0] for r in db.execute("SELECT folder FROM courses WHERE folder IS NOT NULL")}
        for year_dir in sorted(settings.uni_root.glob("[1-5]_Anno")):
            candidates = [d for d in year_dir.iterdir() if d.is_dir() and not d.name.startswith("_")]
            sup = year_dir / "_Superati"
            if sup.is_dir():
                candidates += [d for d in sup.iterdir() if d.is_dir()]
            for d in candidates:
                rel = rel_to_uni(d)
                if rel in known:
                    continue
                cid = -(zlib.crc32(rel.encode()) % 1_000_000_000) - 1
                passed = "_Superati" in d.parts
                db.execute(
                    """INSERT OR IGNORE INTO courses (id, fullname, year_of_study, passed, active, folder)
                       VALUES (?,?,?,?,?,?)""",
                    (cid, d.name.replace("_", " "), int(year_dir.name[0]), int(passed), int(not passed), rel),
                )


def _files(course_dir: Path):
    for sub in SOURCE_DIRS:
        base = course_dir / sub
        if not base.is_dir():
            continue
        for p in base.rglob("*"):
            if (p.is_file() and p.suffix.lower() in SUPPORTED and p.name not in SKIP_FILES
                    and not SKIP_DIRS.intersection(p.relative_to(base).parts[:-1])
                    and not p.name.endswith((".part", ".tmp")) and p.stat().st_size <= MAX_BYTES):
                yield p


def _insert_chunks(db, doc_id: int, course_id: int, kind: str, chunks) -> int:
    db.executemany(
        "INSERT INTO chunks (doc_id, course_id, kind, page, t_start, t_end, heading, text) VALUES (?,?,?,?,?,?,?,?)",
        [(doc_id, course_id, kind, c.page, c.t_start, c.t_end, c.heading, c.text) for c in chunks],
    )
    return len(chunks)


def _drop_doc(db, doc_id: int) -> None:
    ids = [r[0] for r in db.execute("SELECT id FROM chunks WHERE doc_id=?", (doc_id,))]
    vectors.delete(db, ids)
    # I duplicati puntavano a questo documento: si tolgono e al prossimo giro vengono reindicizzati.
    db.execute("DELETE FROM documents WHERE duplicate_of=?", (doc_id,))
    db.execute("DELETE FROM documents WHERE id=?", (doc_id,))


def drop_course_index(course: dict) -> None:
    with session() as db:
        vectors.ensure(db)
        for row in db.execute("SELECT id FROM documents WHERE course_id=? AND duplicate_of IS NULL",
                              (course["id"],)).fetchall():
            _drop_doc(db, row["id"])
        db.execute("DELETE FROM documents WHERE course_id=?", (course["id"],))


def index_course(course: dict) -> dict:
    root = uni_path(course["folder"])
    stats = {"nuovi": 0, "aggiornati": 0, "duplicati": 0, "chunk": 0, "rimossi": 0, "errori": []}
    if not root.is_dir():
        return stats
    with session() as db:
        vectors.ensure(db)
        seen: set[str] = set()

        # Documenti (PDF, md, codice, office)
        for path in _files(root):
            rel = rel_to_uni(path)
            seen.add(rel)
            st = path.stat()
            row = db.execute("SELECT * FROM documents WHERE path=?", (rel,)).fetchone()
            if row and row["mtime"] == st.st_mtime and row["size"] == st.st_size:
                continue
            sha = _sha256(path)
            if row and row["sha256"] == sha:
                db.execute("UPDATE documents SET mtime=? WHERE id=?", (st.st_mtime, row["id"]))
                continue
            if row:
                _drop_doc(db, row["id"])
                stats["aggiornati"] += 1
            else:
                stats["nuovi"] += 1
            original = db.execute("SELECT id FROM documents WHERE sha256=? AND duplicate_of IS NULL AND path<>?",
                                  (sha, rel)).fetchone()
            now = datetime.now().isoformat(timespec="seconds")
            if original:
                db.execute("""INSERT INTO documents (course_id, path, kind, sha256, size, mtime, title, duplicate_of, indexed_at)
                              VALUES (?,?,?,?,?,?,?,?,?)""",
                           (course["id"], rel, path.suffix.lower().lstrip("."), sha, st.st_size, st.st_mtime,
                            path.stem, original[0], now))
                stats["duplicati"] += 1
                continue
            try:
                ex = extract(path)
            except Exception as e:
                stats["errori"].append(f"{rel}: {e}")
                continue
            cur = db.execute("""INSERT INTO documents (course_id, path, kind, sha256, size, mtime, title, n_pages, indexed_at)
                                VALUES (?,?,?,?,?,?,?,?,?)""",
                             (course["id"], rel, ex.kind, sha, st.st_size, st.st_mtime, ex.title, len(ex.pages), now))
            doc_id = cur.lastrowid
            if ex.kind in ("pdf", "pptx"):
                db.executemany("INSERT INTO pages (doc_id, page, chars, is_scan, is_visual) VALUES (?,?,?,?,?)",
                               [(doc_id, p.number, len(p.text), int(p.is_scan), int(p.is_visual)) for p in ex.pages])
                chunks = chunk_pages(ex.pages, path.stem)
            elif ex.kind == "code" or path.suffix.lower() in CODE_EXT:
                chunks = chunk_code(ex.pages[0].text, path.name)
            else:
                chunks = chunk_markdown(ex.pages[0].text, path.stem)
            stats["chunk"] += _insert_chunks(db, doc_id, course["id"], ex.kind, chunks)

        # Trascrizioni delle lezioni
        for lec in db.execute("SELECT * FROM lectures WHERE course_id=?", (course["id"],)).fetchall():
            tpath = uni_path(lec["folder"]) / "transcript.json"
            if not tpath.exists():
                continue
            rel = rel_to_uni(tpath)
            seen.add(rel)
            st = tpath.stat()
            row = db.execute("SELECT * FROM documents WHERE path=?", (rel,)).fetchone()
            if row and row["mtime"] == st.st_mtime:
                continue
            if row:
                _drop_doc(db, row["id"])
                stats["aggiornati"] += 1
            else:
                stats["nuovi"] += 1
            data = json.loads(tpath.read_text(encoding="utf-8"))
            cur = db.execute("""INSERT INTO documents (course_id, path, kind, sha256, size, mtime, title, lecture_id, indexed_at)
                                VALUES (?,?,'transcript',?,?,?,?,?,?)""",
                             (course["id"], rel, f"transcript:{data.get('source', '')}", st.st_size, st.st_mtime, lec["title"], lec["id"],
                              datetime.now().isoformat(timespec="seconds")))
            chunks = chunk_transcript(data.get("segments", []), lec["title"])
            stats["chunk"] += _insert_chunks(db, cur.lastrowid, course["id"], "transcript", chunks)

        # File spariti dal disco
        prefix = course["folder"].rstrip("/") + "/"
        for row in db.execute("SELECT id, path FROM documents WHERE path LIKE ? ESCAPE '\\'",
                              (re.sub(r"([%_\\])", r"\\\1", prefix) + "%",)).fetchall():
            if row["path"] not in seen:
                _drop_doc(db, row["id"])
                stats["rimossi"] += 1
    return stats


def embed_pending(on_progress=None) -> int:
    with session() as db:
        vectors.ensure(db)
        rows = db.execute("SELECT id, course_id, heading, text FROM chunks WHERE embedding IS NULL ORDER BY id").fetchall()
    if not rows:
        return 0
    done = 0
    for i in range(0, len(rows), 960):  # salva a blocchi: un'interruzione non fa perdere tutto
        part = rows[i:i + 960]
        vecs = embed_documents([f"{r['heading']}\n{r['text']}" for r in part],
                               on_progress=lambda n, tot: on_progress and on_progress(done + n, len(rows)))
        with session() as db:
            vectors.store(db, [r["id"] for r in part], [r["course_id"] for r in part], vecs)
        done += len(part)
    return done
