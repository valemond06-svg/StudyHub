"""Esiti registrati dei provider cloud e controlli leggeri del server locale."""
from __future__ import annotations

import sqlite3
import time
from datetime import datetime, timezone
from urllib.parse import urlsplit, urlunsplit

from ..db import session

MESSAGES = {
    "subscription_rejected": "Abbonamento rifiutato o pagamento in sospeso.",
    "quota_exceeded": "Quota o limite di utilizzo raggiunto.",
    "login_required": "Autenticazione richiesta o rifiutata.",
    "unreachable": "Il servizio non risponde.",
    "error": "Il provider ha restituito un errore.",
    "not_configured": "CLI del provider non disponibile.",
    "unverified": "In attesa di un esito dal provider.",
}


def classify(message: str, *, limited: bool = False) -> str:
    message = message.casefold()
    if any(word in message for word in (
        "subscription", "past due", "billing", "payment", "credit balance", "abbonamento", "pagamento",
    )):
        return "subscription_rejected"
    if limited or any(word in message for word in ("quota", "429", "rate limit", "resource_exhausted")):
        return "quota_exceeded"
    if any(word in message for word in (
        "unauthorized", "not authenticated", "not logged", "login", "sign in", "401", "403",
    )):
        return "login_required"
    if any(word in message for word in ("timeout", "tempo massimo", "connection", "network", "unreachable")):
        return "unreachable"
    return "error"


def record(provider: str, status: str) -> None:
    checked_at = datetime.now(timezone.utc).isoformat()
    try:
        with session() as db:
            db.execute("PRAGMA busy_timeout=250")
            db.execute(
                """INSERT INTO provider_health(provider, status, checked_at) VALUES (?, ?, ?)
                   ON CONFLICT(provider) DO UPDATE SET status=excluded.status, checked_at=excluded.checked_at
                   WHERE excluded.checked_at >= provider_health.checked_at""",
                (provider, status, checked_at),
            )
    except (OSError, sqlite3.Error):
        # Un problema di diagnostica non cambia l'esito della generazione.
        pass


def observed_providers(db) -> dict:
    return {row["provider"]: dict(row) for row in db.execute("SELECT * FROM provider_health")}


def provider_state(code: str, checked_at: str | None = None, retry_at: float | None = None) -> dict:
    return {
        "available": None if code == "unverified" else code == "available",
        "status": code, "error": MESSAGES.get(code), "checked_at": checked_at, "retry_at": retry_at,
    }


def _timestamp(value) -> str | None:
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value).isoformat()
        except ValueError:
            pass
    return None


def cloud_status(name: str, observed: dict, errors=(), *, usage: dict | None = None) -> dict:
    from . import claude_runner, llm

    if name == "gemini":
        installed = llm._agy_exe() is not None
    else:
        try:
            installed = bool(claude_runner._claude_exe())
        except claude_runner.ClaudeError:
            installed = False
    if not installed:
        return provider_state("not_configured")

    status = observed.get("status")
    code = status if status == "available" or status in MESSAGES else "unverified"
    checked_at = _timestamp(observed.get("checked_at"))
    if not observed:
        for error in errors:
            messages = [piece for piece in error["message"].split(" · ") if name in piece.casefold()]
            if messages:
                candidate = classify(messages[-1])
                if candidate != "error":
                    code, checked_at = candidate, _timestamp(error["finished_at"])
                    break
    if name == "claude":
        usage = usage or {}
        reset = usage.get("resets_at")
        utilization = usage.get("utilization")
        blocked = usage.get("status") == "rejected" or (
            type(utilization) in (int, float) and utilization >= claude_runner.STOP_AT_UTILIZATION)
        if code not in {"subscription_rejected", "login_required"} and blocked and type(reset) in (int, float):
            now = time.time()
            if now < reset <= 253402300799:
                return provider_state("quota_exceeded", checked_at, reset)
            if code == "quota_exceeded" and reset <= now:
                return provider_state("unverified", checked_at)
    return provider_state(code, checked_at)


def claude_usage() -> dict:
    from .claude_runner import last_usage

    usage = last_usage()
    return usage if isinstance(usage, dict) else {}


def _public_url(url: str | None) -> str | None:
    if not url:
        return None
    try:
        parts = urlsplit(url)
        if parts.scheme in {"http", "https"} and parts.hostname:
            return urlunsplit((parts.scheme, parts.netloc.rsplit("@", 1)[-1], parts.path, "", ""))
    except ValueError:
        pass
    return None


def local_status() -> dict:
    from . import llm

    url = llm.get_local_llm_url()
    code = "available" if url else "login_required" if llm.local_llm_auth_failures() else "unreachable"
    return {**provider_state(code), "healthy": url is not None,
            "url": _public_url(url or llm.configured_local_llm_url()),
            "model": llm.server_model(url) if url else None}


def providers() -> dict:
    with session() as db:
        observed = observed_providers(db)
    usage = claude_usage()
    states = {"local": local_status()}
    for name in ("gemini", "claude"):
        state = cloud_status(name, observed.get(name, {}), usage=usage)
        states[name] = {**state, "healthy": state["available"], "url": None}
    states["claude"].update(utilization=usage.get("utilization"), resets_at=usage.get("resets_at"))
    return states
