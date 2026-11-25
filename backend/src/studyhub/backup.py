"""Backup restic per StudyHub: database, appunti, media essenziali.

Repo locale (D:\\Backup\\restic-studyhub) + VPS (sftp).
Password gestita tramite keyring/fallback file in ~/.studyhub/secrets/restic.pass.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import secrets as pysecrets
from contextlib import contextmanager, nullcontext
from pathlib import Path
from typing import Dict, Any, List

from .config import LOCAL_DIR, settings
from .db import snapshot_database
from .filelock import file_lock

# restic binary
RESTIC = shutil.which("restic") or r"C:\Tools\restic\restic.exe"
# rclone for gdrive (optional)
RCLONE = shutil.which("rclone") or r"C:\Tools\rclone\rclone.exe"

# Password file in LOCAL_DIR/secrets
PASS_FILE = LOCAL_DIR / "secrets" / "restic.pass"

# Repository paths
REPOS = {
    "local": r"D:\Backup\restic-studyhub",
    "vps": "sftp:bot@194.164.172.248:/home/bot/restic-studyhub",
    # gdrive optional via rclone
    "gdrive": "rclone:gdrive:StudyHub/restic",
}

_SNAPSHOT_DIR = ".restic-snapshot"


def backup_paths() -> List[str]:
    """Percorsi dei media e della cache da includere nel backup."""
    paths = []
    # Appunti e output AI (in uni_root)
    # Nota: uni_root è su Google Drive, ma gli appunti generati localmente vanno backuppati
    # Includiamo solo la cartella _StudyHub/media se esiste
    media_root = Path(settings.media_root) if hasattr(settings, 'media_root') else None
    if media_root and media_root.exists():
        paths.append(str(media_root))
    # Cache locale (transcriptions, OCR, ecc.)
    if LOCAL_DIR.exists():
        # Solo cache e OCR, non venv, node_modules, ecc.
        for sub in ["ocr", "cache"]:
            p = LOCAL_DIR / sub
            if p.exists():
                paths.append(str(p))
    return [p for p in paths if Path(p).exists()]


EXCLUDES = [
    "node_modules", ".next", "dist", ".venv", "venv", "__pycache__", ".turbo",
    "*.log", "*.lock", "target", ".cache", ".git", "*.db-shm", "*.db-wal"
]


def _get_env(create_password: bool = True) -> Dict[str, str]:
    """Environment per restic con password da file."""
    if create_password and not PASS_FILE.exists():
        PASS_FILE.parent.mkdir(parents=True, exist_ok=True)
        PASS_FILE.write_text(pysecrets.token_urlsafe(32), encoding="utf-8")
        try:
            PASS_FILE.chmod(0o600)
        except Exception:
            pass

    path = os.environ.get("PATH", "")
    rdir = str(Path(RCLONE).parent) if RCLONE else ""
    return {
        **os.environ,
        "RESTIC_PASSWORD_FILE": str(PASS_FILE),
        "PATH": path if rdir in path else f"{rdir}{os.pathsep}{path}" if rdir else path,
    }


def _repo(name: str) -> str:
    return REPOS[name]


def _run(args: List[str], repo: str, timeout: int = 7200, *, create_password: bool = True) -> subprocess.CompletedProcess:
    """Esegue restic con retry su errori di rete per repo remoti."""
    extra = []
    if repo.startswith("sftp:"):
        extra = ["-o", "sftp.args=-o ServerAliveInterval=30 -o ServerAliveCountMax=10 -o BatchMode=yes"]
    return subprocess.run(
        [RESTIC, *extra, "-r", repo, *args],
        env=_get_env(create_password),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)
    )


def init_repo(name: str) -> str:
    """Inizializza il repo se non esiste."""
    repo = _repo(name)
    r = _run(["cat", "config"], repo, 120)
    if r.returncode == 0:
        return "exists"
    r = _run(["init"], repo, 300)
    return "created" if r.returncode == 0 else f"error: {r.stderr[-300:]}"


def _sanitize_error(err: str) -> str:
    """Rimuove informazioni sensibili dall'errore."""
    if not err:
        return ""
    s = re.sub(r"\b(sftp|rclone|rest|s3):\S+", "<repo>", err)
    s = re.sub(r"\b[\w.-]+@[\w.-]+", "<host>", s)
    s = re.sub(r"\b(?:\d{1,3}\.){3}\d{1,3}\b", "<ip>", s)
    s = re.sub(r"(?:\b[A-Za-z]:)?[\\/][^\s:\"']+", "<path>", s)
    return " ".join(s.split())[:200]


@contextmanager
def _db_snapshot(db_path: Path):
    # Restic raggruppa gli snapshot per percorso: usa lo stesso nome a ogni esecuzione.
    staging = settings.db_path.parent / _SNAPSHOT_DIR
    snapshot = staging / settings.db_path.name
    with file_lock(staging / "backup.lock", "backup Restic"):
        try:
            snapshot.unlink(missing_ok=True)
            snapshot_database(db_path, snapshot)
            yield snapshot
        finally:
            snapshot.unlink(missing_ok=True)


def backup(targets: List[str] = None) -> Dict[str, Dict[str, Any]]:
    """Esegue backup sui target specificati (default: local, vps)."""
    if targets is None:
        targets = ["local", "vps"]
        # Aggiungi gdrive se rclone configurato
        try:
            out = subprocess.run(
                [RCLONE, "listremotes"], capture_output=True, text=True, timeout=30,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)
            )
            if "gdrive:" in out.stdout:
                targets.append("gdrive")
        except Exception:
            pass

    paths = backup_paths()
    db_path = settings.db_path
    if not db_path.is_file():
        db_path = settings.old_db_path
    has_db = db_path.is_file()
    if not has_db and not paths:
        return {"error": {"ok": False, "code": -1, "summary": "", "err": "No paths to backup"}}

    with (_db_snapshot(db_path) if has_db else nullcontext()) as snapshot:
        if snapshot is not None:
            paths.insert(0, str(snapshot))
        return _backup_targets(targets, paths)


def _backup_targets(targets: List[str], paths: List[str]) -> Dict[str, Dict[str, Any]]:
    excl = sum((["--exclude", e] for e in EXCLUDES), [])
    out = {}

    for name in targets:
        repo = _repo(name)
        init_repo(name)
        # Backup con snapshot coerente (JSON per parsing)
        r = _run(["backup", *paths, *excl, "--tag", "studyhub", "--json", "-q"], repo)
        ok = r.returncode in (0, 3)  # 3 = alcuni file non leggibili
        # Estrai summary dall'output JSON
        summary = ""
        for line in reversed(r.stdout.splitlines()):
            if '"summary"' in line:
                summary = line[:500]
                break

        # Forget/prune con retention
        _run(["forget", "--prune", "--keep-daily", "14", "--keep-weekly", "8", "--keep-monthly", "12"], repo)

        out[name] = {
            "ok": ok,
            "code": r.returncode,
            "summary": summary,
            "err": _sanitize_error(r.stderr[-300:])
        }

    return out


def check_integrity(targets: List[str] = None) -> Dict[str, Dict[str, Any]]:
    """Verifica integrità del repository (restic check)."""
    if targets is None:
        targets = ["local", "vps"]

    out = {}
    for name in targets:
        repo = _repo(name)
        r = _run(["check", "--read-data"], repo, 14400)  # 4h max per check --read-data
        ok = r.returncode == 0
        out[name] = {
            "ok": ok,
            "code": r.returncode,
            "summary": "check ok" if ok else r.stdout[-500:],
            "err": _sanitize_error(r.stderr[-300:])
        }
    return out


def list_snapshots(targets: List[str] = None) -> Dict[str, str]:
    """Lista snapshot per repo."""
    if targets is None:
        targets = ["local", "vps"]

    out = {}
    for name in targets:
        repo = _repo(name)
        r = _run(["snapshots", "--compact"], repo, 300)
        out[name] = r.stdout if r.returncode == 0 else f"error: {r.stderr[-300:]}"
    return out


def repository_space() -> dict:
    """Spazio del repository locale senza inizializzarlo o acquisire lock di restic."""
    path = Path(_repo("local"))
    result = {"status": "not_configured", "repository_bytes": None, "free_bytes": None, "capacity_bytes": None}
    try:
        if not (path / "config").is_file():
            return result
        disk = shutil.disk_usage(path)
        result.update(status="unavailable", free_bytes=disk.free, capacity_bytes=disk.total)
        if not PASS_FILE.is_file():
            return result
        stats = _run(["--no-lock", "stats", "--mode", "raw-data", "--json"], str(path), 4, create_password=False)
        if stats.returncode == 0:
            size = json.loads(stats.stdout)["total_size"]
            if type(size) is int and size >= 0:
                result.update(status="available", repository_bytes=size)
    except (OSError, subprocess.TimeoutExpired, ValueError, KeyError, TypeError):
        result["status"] = "unavailable"
    return result


def restore_latest(target_repo: str, restore_dir: Path, target_paths: List[str] = None) -> Dict[str, Any]:
    """Ripristina l'ultimo snapshot in una directory temporanea per test."""
    repo = _repo(target_repo)
    restore_dir = Path(restore_dir)
    restore_dir.mkdir(parents=True, exist_ok=True)

    args = ["restore", "latest", "--target", str(restore_dir)]
    if target_paths:
        args.extend(target_paths)
    r = _run(args, repo, 3600)
    ok = r.returncode == 0
    return {
        "ok": ok,
        "code": r.returncode,
        "restore_dir": str(restore_dir),
        "err": _sanitize_error(r.stderr[-300:]) if not ok else ""
    }


def verify_restore(db_path: Path) -> Dict[str, Any]:
    """Verifica che un database ripristinato sia coerente."""
    if not db_path.exists():
        return {"ok": False, "error": "Database not found"}

    import sqlite3
    try:
        with sqlite3.connect(db_path) as conn:
            conn.execute("PRAGMA integrity_check")
            ver = conn.execute("PRAGMA user_version").fetchone()[0]
            tables = conn.execute("SELECT count(*) FROM sqlite_master WHERE type='table'").fetchone()[0]
            courses = conn.execute("SELECT count(*) FROM courses").fetchone()[0]
            return {
                "ok": True,
                "version": ver,
                "tables": tables,
                "courses": courses,
                "integrity": "ok"
            }
    except Exception as e:
        return {"ok": False, "error": str(e)}


if __name__ == "__main__":
    import sys
    cmd = sys.argv[1] if len(sys.argv) > 1 else "backup"

    if cmd == "backup":
        result = backup()
        print("Backup result:", result)
    elif cmd == "check":
        result = check_integrity()
        print("Check result:", result)
    elif cmd == "snapshots":
        result = list_snapshots()
        for k, v in result.items():
            print(f"=== {k} ===\n{v}")
    elif cmd == "test-restore":
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            result = restore_latest("local", Path(tmp))
            print("Restore result:", result)
            if result["ok"]:
                restored = list(Path(tmp).rglob(settings.db_path.name))
                db_file = next((p for p in restored if p.parent.name == _SNAPSHOT_DIR),
                               next(iter(restored), None))
                if db_file is not None:
                    verify = verify_restore(db_file)
                    print("Verify result:", verify)
    else:
        print(f"Unknown command: {cmd}")
