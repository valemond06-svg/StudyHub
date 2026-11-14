"""Lock GPU tra processi: con 4 GB di VRAM Whisper e Ollama non devono mai girare insieme."""
from __future__ import annotations

from contextlib import contextmanager

from ..config import LOCAL_DIR
from ..filelock import LockTimeout, file_lock  # noqa: F401  (LockTimeout riesportato per chi aspetta la GPU)

LOCK_FILE = LOCAL_DIR / "gpu.lock"


@contextmanager
def gpu_lock(owner: str, poll_s: float = 2.0, timeout: float | None = None):
    with file_lock(LOCK_FILE, owner, timeout=timeout, poll_s=poll_s):
        yield
