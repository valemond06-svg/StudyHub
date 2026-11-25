"""Diagnostica per la UI con un insieme chiuso di stati e messaggi."""
from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from . import backup
from .ai import claude_runner, health, llm
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


def _provider(code: str, checked_at: str | None = None, retry_at: float | None = None) -> dict:
    return {
        "available": None if code == "unverified" else code == "available",
        "status": code, "error": health.MESSAGES.get(code), "checked_at": checked_at, "retry_at": retry_at,
    }


def _local() -> dict:
    if llm.local_llm_healthy():
        code = "available"
    else:
        code = "login_required" if llm.local_llm_auth_failures() else "unreachable"
    return _provider(code, datetime.now(timezone.utc).isoformat())


def _cloud(name: str, observed: dict, errors: list[dict]) -> dict:
    if name == "gemini":
        installed = llm._agy_exe() is not None
    else:
        try:
            installed = bool(claude_runner._claude_exe())
        except claude_runner.ClaudeError:
            installed = False
    if not installed:
        return _provider("not_configured")

    status = observed.get("status")
    code = status if status == "available" or status in health.MESSAGES else "unverified"
    checked_at = _timestamp(observed.get("checked_at"))
    if not observed:
        for error in errors:
            messages = [piece for piece in error["message"].split(" · ") if name in piece.casefold()]
            if messages:
                candidate = health.classify(messages[-1])
                if candidate != "error":
                    code, checked_at = candidate, _timestamp(error["finished_at"])
                    break
    if name == "claude":
        usage = claude_runner.last_usage()
        usage = usage if isinstance(usage, dict) else {}
        reset = usage.get("resets_at")
        utilization = usage.get("utilization")
        blocked = usage.get("status") == "rejected" or (
            type(utilization) in (int, float) and utilization >= claude_runner.STOP_AT_UTILIZATION)
        if code not in {"subscription_rejected", "login_required"} and blocked and type(reset) in (int, float):
            if time.time() < reset <= 253402300799:
                return _provider("quota_exceeded", checked_at, reset)
            if code == "quota_exceeded" and reset <= time.time():
                return _provider("unverified", checked_at)
    return _provider(code, checked_at)


def status() -> dict:
    with session() as db:
        health_by_provider = {row["provider"]: dict(row) for row in db.execute("SELECT * FROM provider_health")}
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
        providers.update({name: _cloud(name, health_by_provider.get(name, {}), errors) for name in ("gemini", "claude")})
        logins = {"moodle": {"status": moodle.result()}, "panopto": {"status": pan.result()}}
        storage = restic.result()
    sync = dict(last_sync) if last_sync else {"finished_at": previous_sync}
    sync["finished_at"] = _timestamp(sync["finished_at"])
    return {
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "providers": providers, "login": logins,
        "last_sync": sync if sync["finished_at"] else None, "restic": storage,
    }
