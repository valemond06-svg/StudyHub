"""Lock esclusivo tra processi e tra thread, su un file in ~/.studyhub.

Il lock del sistema operativo si libera da solo se il processo muore (niente PID da controllare).
Su Linux `lockf` vale per processo: due thread dello stesso processo lo prenderebbero entrambi, quindi
c'è anche un threading.Lock per file.
"""
from __future__ import annotations

import os
import threading
import time
from contextlib import contextmanager
from pathlib import Path

if os.name == "nt":
    import msvcrt

    def _try_lock(fd: int) -> None:
        os.lseek(fd, 0, os.SEEK_SET)
        msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)

    def _unlock(fd: int) -> None:
        os.lseek(fd, 0, os.SEEK_SET)
        msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
else:  # Linux/macOS: lock esclusivo non bloccante sul primo byte
    import fcntl

    def _try_lock(fd: int) -> None:
        fcntl.lockf(fd, fcntl.LOCK_EX | fcntl.LOCK_NB, 1, 0)

    def _unlock(fd: int) -> None:
        fcntl.lockf(fd, fcntl.LOCK_UN, 1, 0)


class LockTimeout(TimeoutError):
    pass


_thread_locks: dict[str, threading.Lock] = {}
_guard = threading.Lock()


def _thread_lock(path: Path) -> threading.Lock:
    key = str(path.resolve())
    with _guard:
        return _thread_locks.setdefault(key, threading.Lock())


def holder(path: Path) -> str:
    """Chi tiene (o ha tenuto per ultimo) il lock: solo informativo."""
    try:
        return path.read_bytes()[1:201].decode(errors="replace").strip("\x00 ")
    except OSError:
        return ""


@contextmanager
def file_lock(path: Path, owner: str, timeout: float | None = None, poll_s: float = 2.0):
    """Attende il lock al massimo `timeout` secondi (None = senza limite), poi LockTimeout."""
    deadline = None if timeout is None else time.monotonic() + timeout
    tl = _thread_lock(path)
    if not tl.acquire(timeout=-1 if deadline is None else max(0.0, deadline - time.monotonic())):
        raise LockTimeout(f"lock {path.name} occupato da {holder(path) or 'un altro thread'}")
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(path, os.O_RDWR | os.O_CREAT)
        try:
            while True:
                try:
                    _try_lock(fd)
                    break
                except OSError:
                    if deadline is not None and time.monotonic() >= deadline:
                        raise LockTimeout(f"lock {path.name} occupato da {holder(path) or 'un altro processo'}")
                    time.sleep(poll_s)
            try:
                os.lseek(fd, 1, os.SEEK_SET)
                os.write(fd, owner.encode()[:200].ljust(200))
            except OSError:
                pass  # su Windows il byte 0 bloccato non impedisce di scrivere dal byte 1; se fallisce è solo informativo
            try:
                yield
            finally:
                _unlock(fd)
        finally:
            os.close(fd)
    finally:
        tl.release()
