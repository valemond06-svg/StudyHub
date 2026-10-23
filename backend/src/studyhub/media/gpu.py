"""Lock GPU tra processi: con 4 GB di VRAM Whisper e Ollama non devono mai girare insieme."""
from __future__ import annotations

import msvcrt
import os
import time
from contextlib import contextmanager

from ..config import LOCAL_DIR

LOCK_FILE = LOCAL_DIR / "gpu.lock"


@contextmanager
def gpu_lock(owner: str, poll_s: float = 2.0):
    LOCK_FILE.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(LOCK_FILE, os.O_RDWR | os.O_CREAT)
    try:
        while True:
            try:
                msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
                break
            except OSError:
                time.sleep(poll_s)  # un altro job GPU è in corso
        os.lseek(fd, 1, os.SEEK_SET)
        os.write(fd, owner.encode()[:200])
        try:
            yield
        finally:
            os.lseek(fd, 0, os.SEEK_SET)
            msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
    finally:
        os.close(fd)
