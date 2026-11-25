"""Esiti dei provider cloud, registrati come codici senza testo del provider."""
from __future__ import annotations

import sqlite3
from datetime import datetime, timezone

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
