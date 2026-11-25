"""Diagnostica per la UI con un insieme chiuso di stati e messaggi."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from . import backup
from .ai import health, llm
from .db import session
from .media import panopto
from .sync import auth


def _timestamp(value) -> str | None:
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value).isoformat()
        except ValueError:
            pass
    return None


def _local() -> dict:
    if llm.local_llm_healthy():
        code = "available"
    else:
        code = "login_required" if llm.local_llm_auth_failures() else "unreachable"
    return health.provider_state(code, datetime.now(timezone.utc).isoformat())


def status() -> dict:
    with session() as db:
        health_by_provider = health.observed_providers(db)
        errors = [dict(row) for row in db.execute(
            """SELECT message, finished_at FROM ai_jobs WHERE status='errore' AND message IS NOT NULL
               ORDER BY id DESC LIMIT 30""")]
        last_sync = db.execute(
            """SELECT finished_at, course_id, new_files, updated_files,
                      CASE WHEN json_valid(errors) THEN json_array_length(errors) END AS error_count
               FROM sync_runs WHERE finished_at IS NOT NULL ORDER BY finished_at DESC, id DESC LIMIT 1""",
        ).fetchone()
        previous_sync = None if last_sync else db.execute("SELECT MAX(last_sync) FROM courses").fetchone()[0]
        delivery = db.execute(
            "SELECT panopto_id FROM lectures WHERE panopto_id IS NOT NULL ORDER BY date DESC, id DESC LIMIT 1",
        ).fetchone()
    with ThreadPoolExecutor(max_workers=4) as pool:
        local = pool.submit(_local)
        moodle = pool.submit(auth.login_status)
        pan = pool.submit(panopto.login_status, delivery[0] if delivery else None)
        restic = pool.submit(backup.repository_space)
        providers = {"local": local.result()}
        usage = health.claude_usage()
        providers.update({name: health.cloud_status(name, health_by_provider.get(name, {}), errors, usage=usage)
                          for name in ("gemini", "claude")})
        logins = {"moodle": {"status": moodle.result()}, "panopto": {"status": pan.result()}}
        storage = restic.result()
    sync = dict(last_sync) if last_sync else {"finished_at": previous_sync}
    sync["finished_at"] = _timestamp(sync["finished_at"])
    return {
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "providers": providers, "login": logins,
        "last_sync": sync if sync["finished_at"] else None, "restic": storage,
    }
