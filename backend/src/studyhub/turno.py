"""Turno di notte: chi lo sta facendo girare adesso.

Durante il turno il 35B locale lavora con 1 slot e la RAM è al limite: niente embedding (Ollama bge-m3)
né altri lavori pesanti da parte del server. Il turno nativo (`studyhub notte`) tiene `NOTTE_LOCK`
con `file_lock`; il vecchio `~/brain-riordino/notte-bin/notte.sh` scrive il suo PID in `LEGACY_LOCK`.
"""
from __future__ import annotations

import os
from pathlib import Path

from .config import LOCAL_DIR
from .filelock import LockTimeout, file_lock

NOTTE_LOCK = LOCAL_DIR / "notte.lock"
LEGACY_LOCK = Path.home() / "brain-riordino" / "notte.lock"


def _pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    if os.name == "nt":  # os.kill su Windows terminerebbe il processo: si guarda solo se esiste
        import ctypes
        h = ctypes.windll.kernel32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
        if not h:
            return False
        ctypes.windll.kernel32.CloseHandle(h)
        return True
    return Path(f"/proc/{pid}").exists() or _kill0(pid)


def _kill0(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except PermissionError:
        return True
    except OSError:
        return False


def _legacy_active() -> bool:
    try:
        return _pid_alive(int(LEGACY_LOCK.read_text().strip() or 0))
    except (OSError, ValueError):
        return False


def notte_attiva() -> bool:
    """True se un turno di notte (nativo o vecchio script) è in corso su questa macchina."""
    if _legacy_active():
        return True
    if not NOTTE_LOCK.exists():
        return False
    try:
        with file_lock(NOTTE_LOCK, f"controllo pid {os.getpid()}", timeout=0):
            return False
    except LockTimeout:
        return True
