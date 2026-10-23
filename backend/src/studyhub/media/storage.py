"""Archivio media pesanti su Google Drive (5 TB) invece che sul disco C:.

`media_root` in config.yaml (es. "G:/Il mio Drive/StudyHub") rispecchia la struttura della cartella
università: un video di `2_Anno/Corso/lezioni/L08_…/` finisce in `<media_root>/2_Anno/Corso/lezioni/L08_…/`.
Sul PC restano solo i file leggeri che servono al player offline (audio.opus, slide, trascrizione).

Gli spostamenti sono sicuri: copia → verifica della dimensione → solo allora si cancella l'originale.
Mai sovrascrivere: se la destinazione esiste già con un'altra dimensione, il file resta dov'è.
"""
from __future__ import annotations

import json
import shutil
import time
from datetime import datetime
from pathlib import Path

from ..config import settings

VIDEO_EXT = {".mp4", ".m4v", ".mov", ".mkv", ".webm", ".avi"}
HEAVY_AUDIO_EXT = {".wav", ".m4a", ".mp3", ".flac"}
LOG_FILE = settings.app_dir / "media_migration_log.json"


def media_root() -> Path | None:
    """La cartella su Drive, se configurata e raggiungibile (Drive avviato, unità montata)."""
    root = settings.extra.get("media_root")
    if not root:
        return None
    p = Path(root)
    try:
        p.mkdir(parents=True, exist_ok=True)
        return p if p.is_dir() else None
    except OSError:
        return None


def cloud_path(local: Path) -> Path | None:
    root = media_root()
    if root is None:
        return None
    try:
        rel = local.resolve().relative_to(settings.uni_root.resolve())
    except ValueError:
        return None
    return root / rel


def _log(entry: dict) -> None:
    data = json.loads(LOG_FILE.read_text(encoding="utf-8")) if LOG_FILE.exists() else []
    data.append({**entry, "time": datetime.now().isoformat(timespec="seconds")})
    tmp = LOG_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(LOG_FILE)


def _wait_size(path: Path, size: int, timeout_s: float = 60) -> bool:
    """L'unità G: di Drive aggiorna la dimensione dei file con un po' di ritardo dopo la scrittura."""
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        try:
            if path.stat().st_size == size:
                return True
        except OSError:
            pass
        time.sleep(2)
    return False


def safe_copy(src: Path, dest: Path) -> str:
    """Copia src→dest (anche su un altro disco) senza toccare l'originale.
    Ritorna 'copiato' | 'già presente' | 'conflitto'."""
    size = src.stat().st_size
    if dest.exists():
        if _wait_size(dest, size, 10):
            return "già presente"
        _log({"from": str(src), "to": str(dest), "status": "conflitto: destinazione diversa, lasciato"})
        return "conflitto"
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_name(dest.name + ".part")
    shutil.copyfile(src, part)
    if not _wait_size(part, size):
        part.unlink(missing_ok=True)
        raise OSError(f"Copia incompleta di {src.name}")
    part.replace(dest)
    if not _wait_size(dest, size):
        raise OSError(f"Copia non visibile su Drive: {src.name}")
    return "copiato"


def safe_move(src: Path, dest: Path) -> str:
    """Solo per file RISCARICABILI (video temporanei da Moodle/Panopto): copia, verifica, cancella.
    I file tuoi passano da migrate() + finalize(), che cancella solo dopo la conferma del cloud."""
    status = safe_copy(src, dest)
    if status in ("copiato", "già presente"):
        size = src.stat().st_size
        src.unlink()
        _log({"from": str(src), "to": str(dest), "status": "spostato", "bytes": size})
        return "spostato"
    return status


def archive(src: Path) -> Path | None:
    """Mette un file locale nell'archivio su Drive (stesso percorso relativo). None se Drive non c'è."""
    dest = cloud_path(src)
    if dest is None:
        return None
    return dest if safe_move(src, dest) in ("spostato", "già presente") else None


def find_in_course(course_folder: str, name: str) -> Path | None:
    """Cerca un file per nome nella cartella del corso, sul PC e nell'archivio su Drive."""
    local = settings.uni_root / course_folder
    roots = [local]
    cp = cloud_path(local)
    if cp is not None and cp.exists():
        roots.append(cp)
    for r in roots:
        hit = next((p for p in r.rglob(name) if p.is_file()), None)
        if hit:
            return hit
    return None


def heavy_files(min_mb: int = 20) -> list[Path]:
    """Video (e audio grezzi) pesanti nella cartella università, escluso l'audio compresso del player."""
    out = []
    for p in settings.uni_root.rglob("*"):
        if "_StudyHub" in p.parts or not p.is_file():
            continue
        ext = p.suffix.lower()
        if (ext in VIDEO_EXT or ext in HEAVY_AUDIO_EXT) and p.stat().st_size >= min_mb * 1024 * 1024:
            out.append(p)
    return sorted(out)


def migrate(dry_run: bool = True, min_mb: int = 20) -> dict:
    """Copia su Drive i file pesanti, SENZA cancellare gli originali (vedi finalize)."""
    root = media_root()
    files = heavy_files(min_mb)
    total = sum(f.stat().st_size for f in files)
    plan = [{"from": str(f), "to": str(cloud_path(f)) if root else None, "mb": round(f.stat().st_size / 1e6)} for f in files]
    if dry_run or root is None:
        return {"media_root": str(root) if root else None, "files": len(files), "gb": round(total / 1e9, 2),
                "plan": plan, "done": False}
    copied = errors = 0
    for f in files:
        try:
            dest = cloud_path(f)
            status = safe_copy(f, dest)
            _log({"from": str(f), "to": str(dest), "status": status, "bytes": f.stat().st_size})
            copied += status in ("copiato", "già presente")
        except OSError as e:
            errors += 1
            _log({"from": str(f), "status": f"errore: {e}"})
    return {"media_root": str(root), "files": len(files), "copied": copied, "errors": errors, "done": True}


VERIFIED_FILE = settings.app_dir / "cloud_verified.json"


def finalize() -> dict:
    """Cancella gli originali SOLO dei file confermati nel cloud (nome + dimensione) in cloud_verified.json.
    Quel file si aggiorna con una verifica sull'API di Google Drive (es. chiedendo a Claude con il connettore
    Drive), perché l'unità G: da sola non garantisce che il caricamento sia finito."""
    verified = json.loads(VERIFIED_FILE.read_text(encoding="utf-8"))["files"] if VERIFIED_FILE.exists() else {}
    log = json.loads(LOG_FILE.read_text(encoding="utf-8")) if LOG_FILE.exists() else []
    removed = freed = 0
    for e in log:
        if e.get("status") not in ("copiato", "già presente", "spostato"):
            continue
        src = Path(e["from"])
        if src.exists() and verified.get(src.name) == src.stat().st_size:
            freed += src.stat().st_size
            src.unlink()
            removed += 1
            _log({"from": str(src), "status": "originale rimosso dopo verifica nel cloud"})
    return {"removed": removed, "freed_gb": round(freed / 1e9, 2)}
