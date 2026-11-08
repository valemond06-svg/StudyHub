"""Lock GPU tra processi: con 4 GB di VRAM Whisper e Ollama non devono mai girare insieme."""
from __future__ import annotations

import os
import time
from contextlib import contextmanager

from ..config import LOCAL_DIR

LOCK_FILE = LOCAL_DIR / "gpu.lock"

if os.name == "nt":
    import msvcrt

    def _try_lock(fd: int) -> None:
        msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)

    def _unlock(fd: int) -> None:
        os.lseek(fd, 0, os.SEEK_SET)
        msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
else:  # Linux/macOS: stesso lock esclusivo non bloccante sul primo byte
    import fcntl

    def _try_lock(fd: int) -> None:
        fcntl.lockf(fd, fcntl.LOCK_EX | fcntl.LOCK_NB, 1, 0)

    def _unlock(fd: int) -> None:
        fcntl.lockf(fd, fcntl.LOCK_UN, 1, 0)


@contextmanager
def gpu_lock(owner: str, poll_s: float = 2.0):
    LOCK_FILE.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(LOCK_FILE, os.O_RDWR | os.O_CREAT)
    try:
        while True:
            try:
                _try_lock(fd)
                break
            except OSError:
                time.sleep(poll_s)  # un altro job GPU è in corso
        os.lseek(fd, 1, os.SEEK_SET)
        os.write(fd, owner.encode()[:200])
        try:
            yield
        finally:
            _unlock(fd)
    finally:
        os.close(fd)
