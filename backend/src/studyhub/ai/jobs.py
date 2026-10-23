"""Coda AI on-demand dentro il server: un solo worker, una lezione alla volta.

Niente parte da sola: i job li crea solo un tuo click (o un comando). Se la finestra
di Claude Pro è quasi piena, la coda si mette in pausa invece di insistere.
"""
from __future__ import annotations

import threading
from datetime import datetime

from ..db import session
from .claude_runner import ClaudeError, RateLimited, check_budget, last_usage

_lock = threading.Lock()
_wake = threading.Event()
_worker: threading.Thread | None = None
state = {"current": None, "paused_reason": None}


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def enqueue(lecture_ids: list[int]) -> list[int]:
    ids = []
    with session() as db:
        for lid in lecture_ids:
            if db.execute("SELECT 1 FROM ai_jobs WHERE kind='lecture_notes' AND target_id=? AND status IN ('in_coda','in_corso')",
                          (lid,)).fetchone():
                continue
            ids.append(db.execute("INSERT INTO ai_jobs (kind, target_id, created_at) VALUES ('lecture_notes', ?, ?)",
                                  (lid, _now())).lastrowid)
    state["paused_reason"] = None
    _ensure_worker()
    _wake.set()
    return ids


def cancel_queued() -> int:
    with session() as db:
        return db.execute("UPDATE ai_jobs SET status='annullato', finished_at=? WHERE status='in_coda'", (_now(),)).rowcount


def status() -> dict:
    with session() as db:
        jobs = [dict(r) for r in db.execute(
            """SELECT j.*, l.title FROM ai_jobs j LEFT JOIN lectures l ON l.id=j.target_id
               WHERE j.status IN ('in_coda','in_corso') OR j.finished_at > datetime('now','-1 hour','localtime')
               ORDER BY j.id DESC LIMIT 30""")]
    return {"jobs": jobs, "paused_reason": state["paused_reason"], "usage": last_usage()}


def _next_job() -> dict | None:
    with session() as db:
        row = db.execute("SELECT * FROM ai_jobs WHERE status='in_coda' ORDER BY id LIMIT 1").fetchone()
        if row:
            db.execute("UPDATE ai_jobs SET status='in_corso', started_at=? WHERE id=?", (_now(), row["id"]))
        return dict(row) if row else None


def _finish(job_id: int, status_: str, message: str | None = None) -> None:
    with session() as db:
        db.execute("UPDATE ai_jobs SET status=?, message=?, finished_at=? WHERE id=?", (status_, message, _now(), job_id))


def _loop() -> None:
    from ..ingest.indexer import embed_pending, index_course
    from .lecture_notes import process
    while True:
        _wake.wait(timeout=30)
        _wake.clear()
        while state["paused_reason"] is None:
            try:
                check_budget()
            except RateLimited as e:
                state["paused_reason"] = str(e)
                break
            job = _next_job()
            if not job:
                break
            state["current"] = job["id"]
            try:
                res = process(job["target_id"])
                _finish(job["id"], "fatto", "già elaborata" if res.get("cached") else res.get("md_path"))
                with session() as db:
                    course = dict(db.execute("SELECT c.* FROM courses c JOIN lectures l ON l.course_id=c.id WHERE l.id=?",
                                             (job["target_id"],)).fetchone())
                index_course(course)
                try:
                    embed_pending()
                except Exception:
                    pass  # Ollama spento: gli appunti restano cercabili per parole chiave
            except RateLimited as e:
                _finish(job["id"], "in_coda", str(e))  # torna in coda: riprenderà quando riattivi
                with session() as db:
                    db.execute("UPDATE ai_jobs SET status='in_coda', finished_at=NULL WHERE id=?", (job["id"],))
                state["paused_reason"] = str(e)
            except (ClaudeError, Exception) as e:
                _finish(job["id"], "errore", str(e)[:500])
            finally:
                state["current"] = None


def _ensure_worker() -> None:
    global _worker
    with _lock:
        if _worker is None or not _worker.is_alive():
            # I job rimasti "in_corso" da un server chiuso a metà tornano in coda.
            with session() as db:
                db.execute("UPDATE ai_jobs SET status='in_coda' WHERE status='in_corso'")
            _worker = threading.Thread(target=_loop, name="ai-worker", daemon=True)
            _worker.start()
