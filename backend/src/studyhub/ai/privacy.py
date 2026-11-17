"""Privacy filter per StudyHub: decide se un contenuto può andare a provider ESTERNI (Gemini, Claude).

Il provider LOCALE (Qwen 35B su PC fisso via cavo diretto 10.10.10.1) è SEMPRE consentito:
- Zero costi, 100% offline, privacy totale, dati non lasciano la LAN.

Provider ESTERNI (Gemini via Antigravity, Claude Pro):
- Usati solo per contenuti NON sensibili (deny-by-default per dati sensibili).
- Il filtro blocca se il testo contiene dati personali/universitari identificabili.

Configurazione:
- STUDYHUB_PRIVACY_MODE=strict|permissive|local_only (default: strict)
  - strict: blocca provider esterni per qualsiasi contenuto sensibile
  - permissive: solo warning, permette fallback
  - local_only: usa SOLO provider locale, mai esterni
"""
from __future__ import annotations

import contextlib
import contextvars
import logging
import os
import re
from dataclasses import dataclass
from enum import Enum
from typing import Optional, Set

log = logging.getLogger(__name__)


class PrivacyMode(str, Enum):
    STRICT = "strict"        # Blocca provider esterni per contenuto sensibile
    PERMISSIVE = "permissive"  # Warning ma permette fallback
    LOCAL_ONLY = "local_only"  # Solo provider locale


@dataclass
class PrivacyDecision:
    allowed: bool
    provider: str          # "local", "gemini", "claude"
    reason: str
    sensitivity: str       # "none", "low", "medium", "high"


# Context per job corrente (annidabile)
_ctx = contextvars.ContextVar("studyhub_privacy", default=None)


# Pattern per dati sensibili in contesto universitario/studente
_STUDENT_ID = re.compile(r"\b\d{6,7}\b")  # Matricola UniVR (6-7 cifre)
_EMAIL = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b")
_CF = re.compile(r"\b[A-Z]{6}\d{2}[A-EHLMPRST]\d{2}[A-Z]\d{3}[A-Z]\b", re.I)  # Codice fiscale
_IBAN = re.compile(r"\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30}\b")
_CARD = re.compile(r"(?<!\d)(?:\d[ -]?){13,19}(?!\d)")
_KEYWORDS_FINANCIAL = re.compile(r"estratto\s+conto|seed\s+phrase|frase\s+di\s+recupero|chiave\s+privata|private\s+key|iban|carta\s+di\s+credito", re.I)
_KEYWORDS_PERSONAL = re.compile(r"\b(nome|cognome|data\s+di\s+nascita|indirizzo|telefono|cellulare)\b", re.I)
_UNIVERSITY_KEYWORDS = re.compile(r"\b(univr|università|verona|esame|appello|voto|credito|cfu|laurea|tesi|tirocinio)\b", re.I)


def _luhn(digits: str) -> bool:
    total, alt = 0, False
    for ch in reversed(digits):
        d = int(ch)
        if alt:
            d = d * 2 - 9 if d > 4 else d * 2
        total += d
        alt = not alt
    return total % 10 == 0


def _iban_ok(raw: str) -> bool:
    s = raw.replace(" ", "").upper()
    if not 15 <= len(s) <= 34:
        return False
    num = "".join(str(int(c, 36)) for c in s[4:] + s[:4])
    return int(num) % 97 == 1


def analyze_sensitivity(text: str) -> tuple[str, list[str]]:
    """Analizza la sensibilità del testo.

    Returns:
        (level, reasons): level in {"none", "low", "medium", "high"}
    """
    if not text or not text.strip():
        return "none", []

    reasons = []
    text_lower = text.lower()

    # High: dati finanziari, credenziali, identificativi univoci validati
    for m in _IBAN.finditer(text):
        if _iban_ok(m.group(0)):
            reasons.append("IBAN valido")
            return "high", reasons

    for m in _CARD.finditer(text):
        digits = re.sub(r"\D", "", m.group(0))
        if 13 <= len(digits) <= 19 and len(set(digits)) > 1 and _luhn(digits):
            reasons.append("Numero carta valido (Luhn)")
            return "high", reasons

    if _CF.search(text):
        reasons.append("Codice fiscale")
        return "high", reasons

    if _KEYWORDS_FINANCIAL.search(text_lower):
        reasons.append("Parole chiave finanziarie/credenziali")
        return "high", reasons

    # Medium: identificativi studenteschi, email, dati personali
    if _STUDENT_ID.search(text):
        # Potrebbe essere matricola - verifica contesto
        reasons.append("Possibile matricola studente")

    if _EMAIL.search(text):
        reasons.append("Email")

    if _KEYWORDS_PERSONAL.search(text_lower):
        reasons.append("Dati anagrafici")

    # Low: contenuti didattici universitari generici
    if _UNIVERSITY_KEYWORDS.search(text_lower):
        if not reasons:
            reasons.append("Contenuto didattico universitario")
        return "low" if not reasons else "medium", reasons

    if reasons:
        return "medium", reasons

    return "none", []


def get_privacy_mode() -> PrivacyMode:
    mode_str = os.environ.get("STUDYHUB_PRIVACY_MODE", "strict").lower()
    try:
        return PrivacyMode(mode_str)
    except ValueError:
        log.warning("STUDYHUB_PRIVACY_MODE non valido: %s, uso 'strict'", mode_str)
        return PrivacyMode.STRICT


@contextlib.contextmanager
def scope(kind: Optional[str] = None, private: bool = False):
    """Contesto privacy per un job. Annidabile: restrizioni si accumulano."""
    outer = _ctx.get() or {"kinds": set(), "private": False}
    cur = {
        "kinds": set(outer.get("kinds", set())) | ({kind} if kind else set()),
        "private": outer.get("private", False) or private
    }
    token = _ctx.set(cur)
    try:
        yield cur
    finally:
        _ctx.reset(token)


def current_scope() -> dict:
    return _ctx.get() or {"kinds": set(), "private": False}


# Job kinds che implicano dati sensibili
PRIVATE_KINDS = frozenset({
    "exam_answers",       # Risposte esami
    "personal_notes",     # Appunti personali
    "transcript",         # Trascrizioni lezioni (possono contenere nomi)
    "grade_report",       # Report voti
    "personal_data",      # Dati anagrafici espliciti
})


def check_external_allowed(
    provider: str,
    text: str,
    kind: Optional[str] = None,
    private: bool = False
) -> PrivacyDecision:
    """Verifica se un provider ESTERNO può essere usato per questo contenuto.

    Il provider LOCALE è SEMPRE consentito (non passa da questa funzione).

    Args:
        provider: "gemini" | "claude" (provider esterni)
        text: Contenuto da inviare
        kind: Tipo di job (es. "exam_answers", "transcript")
        private: Forza private=True

    Returns:
        PrivacyDecision con allowed=True/False
    """
    mode = get_privacy_mode()

    # Modalità local_only: mai provider esterni
    if mode == PrivacyMode.LOCAL_ONLY:
        return PrivacyDecision(
            allowed=False,
            provider=provider,
            reason=f"Modalità LOCAL_ONLY: provider esterni disabilitati",
            sensitivity="high"
        )

    # Contesto job corrente
    ctx = current_scope()
    is_private_job = private or ctx["private"] or (kind and kind in PRIVATE_KINDS) or (ctx["kinds"] & PRIVATE_KINDS)

    if is_private_job:
        return PrivacyDecision(
            allowed=False,
            provider=provider,
            reason=f"Job privato (kind={kind}, ctx_kinds={ctx['kinds']}, private={private})",
            sensitivity="high"
        )

    # Analisi sensibilità contenuto
    sensitivity, reasons = analyze_sensitivity(text)

    if sensitivity == "high":
        return PrivacyDecision(
            allowed=False,
            provider=provider,
            reason=f"Dati sensibili rilevati: {', '.join(reasons)}",
            sensitivity="high"
        )

    if sensitivity == "medium" and mode == PrivacyMode.STRICT:
        return PrivacyDecision(
            allowed=False,
            provider=provider,
            reason=f"Contenuto sensibilità media (strict): {', '.join(reasons)}",
            sensitivity="medium"
        )

    if sensitivity == "medium" and mode == PrivacyMode.PERMISSIVE:
        log.warning("Privacy PERMISSIVE: provider esterno %s permesso nonostante sensibilità media: %s",
                    provider, ", ".join(reasons))
        return PrivacyDecision(
            allowed=True,
            provider=provider,
            reason=f"Permissive: {', '.join(reasons)}",
            sensitivity="medium"
        )

    # sensitivity == "low" o "none" -> permesso
    return PrivacyDecision(
        allowed=True,
        provider=provider,
        reason=f"Contenuto non sensibile ({sensitivity})",
        sensitivity=sensitivity
    )


def log_provider_selection(provider: str, decision: PrivacyDecision, text_preview: str = "") -> None:
    """Log della selezione provider SENZA contenuti privati."""
    preview = text_preview[:100].replace("\n", " ") if text_preview else ""
    log.info(
        "Provider selection: provider=%s allowed=%s sensitivity=%s reason=%s preview=%s",
        provider, decision.allowed, decision.sensitivity, decision.reason, preview
    )


if __name__ == "__main__":
    # Test rapidi
    import sys
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

    test_cases = [
        ("Cos'è la derivata?", "none"),
        ("La mia matricola è 1234567", "medium"),
        ("Email: mario.rossi@studenti.univr.it", "medium"),
        ("CF: RSSMRA80A01H501U", "high"),
        ("IBAN: IT60X0542811101000000123456", "high"),
        ("Estratto conto bancario", "high"),
        ("L'esame di Analisi 2 è difficile", "medium"),
    ]

    for text, expected in test_cases:
        sens, reasons = analyze_sensitivity(text)
        status = "OK" if sens == expected else "FAIL"
        print(f"{status} [{sens}] {text} -> {reasons}")

    print("\n--- Test check_external_allowed ---")
    for text in ["Cos'è la derivata?", "Matricola 1234567", "CF: RSSMRA80A01H501U"]:
        dec = check_external_allowed("gemini", text)
        print(f"  [{'OK' if dec.allowed else 'BLOCK'}] {text[:40]}... -> {dec.reason}")