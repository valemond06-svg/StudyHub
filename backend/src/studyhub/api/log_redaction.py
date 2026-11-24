"""Redazione dei dati sensibili prima che raggiungano gli handler del server."""
from __future__ import annotations

import logging
import re
import traceback

REDACTED = "***"
_SECRET_NAMES = r"(?:[\w-]*[-_])?(?:api[-_ ]?key|token)|wstoken"
_SECRET_FIELD = re.compile(rf"^(?:{_SECRET_NAMES})$", re.I)
_BEARER = re.compile(r"(\bbearer[ \t]+)[\w.~+/\-=]+", re.I)
_SECRET_VALUE = re.compile(
    rf"""(\b(?:{_SECRET_NAMES})\b["']?\s*[:=]\s*)"""
    r"""(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,"';&}\]]+)""",
    re.I,
)
_KEY_PREFIX = re.compile(r"\b(?:sk-[\w-]{10,}|AIza[\w-]{20,}|gh[pousr]_[\w]{20,})\b")
_TRANSCRIPT_NAMES = r"transcript(?:ion)?(?:[-_]text)?|trascrizion[ei]"
_TRANSCRIPT_FIELD = re.compile(rf"^(?:{_TRANSCRIPT_NAMES})$", re.I)
_TRANSCRIPT_VALUE = re.compile(
    rf"""(\b(?:{_TRANSCRIPT_NAMES})\b["']?\s*[:=]\s*)"""
    r"""("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|.+)""",
    re.I | re.S,
)


def _redact(text: str) -> str:
    def transcript(match: re.Match) -> str:
        value = match[2]
        length = len(value[1:-1]) if value.startswith(("'", '"')) and value[-1] == value[0] else len(value)
        return match[1] + (REDACTED if length > 100 else value)

    text = _TRANSCRIPT_VALUE.sub(transcript, text)
    text = _BEARER.sub(r"\g<1>" + REDACTED, text)
    text = _SECRET_VALUE.sub(r"\g<1>" + REDACTED, text)
    return _KEY_PREFIX.sub(REDACTED, text)


class RedactingFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.msg = _redact(record.getMessage())
        record.args = ()
        if record.exc_info and not record.exc_text:
            record.exc_text = "".join(traceback.format_exception(*record.exc_info)).rstrip()
        if record.exc_text:
            record.exc_text = _redact(record.exc_text)
        if record.stack_info:
            record.stack_info = _redact(record.stack_info)
        for name, value in vars(record).items():
            if _SECRET_FIELD.fullmatch(name) or (
                _TRANSCRIPT_FIELD.fullmatch(name) and isinstance(value, str) and len(value) > 100
            ):
                setattr(record, name, REDACTED)
        return True


_FILTER = RedactingFilter()


def install_log_redaction() -> None:
    """Installa il filtro anche sugli handler dedicati di Uvicorn."""
    handlers = {*logging.getLogger().handlers, logging.lastResort}
    for logger in list(logging.getLogger().manager.loggerDict.values()):
        if isinstance(logger, logging.Logger):
            handlers.update(logger.handlers)
    for handler in handlers:
        if handler is not None:
            handler.addFilter(_FILTER)
