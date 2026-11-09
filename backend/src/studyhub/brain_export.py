"""Copia per il Second Brain: dal 2026-11-09 StudyHub gira su Windows e il Brain su Linux.

Il Brain (agente @uni, quiz vocali, novità Moodle) legge in sola lettura `studyhub.db` e, per i corsi correnti,
`moodle/_avvisi.md` e i PDF di calendario/orario. Qui li copiamo su Drive in `<media_root>/_brain/`, con la stessa
struttura della cartella università: `_brain/_StudyHub/studyhub.db`, `_brain/<corso>/moodle/...`.
Il nodo Linux li scarica con rclone (timer `brain-studyhub-pull`)."""
from __future__ import annotations

import hashlib
import re
import shutil
import sqlite3
import tempfile
from pathlib import Path

from .config import settings
from .media.storage import media_root
from .paths import uni_path

CAL = re.compile(r"calendari|orario|programma.*lezion", re.I)


def _sha(p: Path) -> str | None:
    if not p.exists():
        return None
    h = hashlib.sha256()
    with p.open("rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def _copy_if_changed(src: Path, dst: Path) -> bool:
    if dst.exists() and dst.stat().st_size == src.stat().st_size and _sha(dst) == _sha(src):
        return False
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)
    return True


def export() -> dict:
    root = media_root()
    if root is None:
        return {"ok": False, "motivo": "Drive non raggiungibile"}
    out = root / "_brain"
    copied = 0
    # DB: copia coerente con l'API di backup di SQLite, poi su Drive solo se è cambiato
    with tempfile.TemporaryDirectory() as tmp:
        snap = Path(tmp) / "studyhub.db"
        src = sqlite3.connect(f"file:{settings.db_path}?mode=ro", uri=True, timeout=30)
        dst = sqlite3.connect(snap)
        with dst:
            src.backup(dst)
        src.close()
        dst.close()
        copied += _copy_if_changed(snap, out / "_StudyHub" / "studyhub.db")
    # Avvisi e calendari dei corsi correnti
    con = sqlite3.connect(f"file:{settings.db_path}?mode=ro", uri=True, timeout=30)
    try:
        folders = [r[0] for r in con.execute("SELECT folder FROM courses WHERE stage='corrente' AND folder IS NOT NULL")]
    finally:
        con.close()
    for folder in folders:
        mdir = uni_path(folder) / "moodle"
        if not mdir.exists():
            continue
        files = [mdir / "_avvisi.md"] + [p for p in mdir.rglob("*.pdf")
                                         if CAL.search(p.name) and "_forum_allegati" not in p.parts]
        for f in files:
            if f.exists():
                copied += _copy_if_changed(f, out / folder / "moodle" / f.relative_to(mdir))
    return {"ok": True, "copiati": copied, "corsi": len(folders), "dest": str(out)}
