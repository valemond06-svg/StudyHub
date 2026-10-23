"""Nomi di file/cartelle sicuri per Windows e struttura delle cartelle dei corsi."""
from __future__ import annotations

import re
import unicodedata
from pathlib import Path

from .config import settings

COURSE_SUBDIRS = ("moodle", "lezioni", "appelli", "libri_e_appunti", "studio_ai")
_INVALID = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
_RESERVED = {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)), *(f"LPT{i}" for i in range(1, 10))}


def safe_name(name: str, max_len: int = 80) -> str:
    name = unicodedata.normalize("NFC", name or "").strip()
    name = _INVALID.sub("_", name)
    name = re.sub(r"\s+", " ", name).strip(" .")
    if not name:
        name = "senza_nome"
    if name.split(".")[0].upper() in _RESERVED:
        name = "_" + name
    if len(name) > max_len:
        stem, dot, ext = name.rpartition(".")
        if dot and len(ext) <= 8:
            name = stem[: max_len - len(ext) - 1].rstrip(" .") + "." + ext
        else:
            name = name[:max_len].rstrip(" .")
    return name


def folder_name(title: str) -> str:
    """'Metodi statistici per l'ingegneria' -> 'Metodi_Statistici_Per_L_Ingegneria'."""
    title = re.sub(r"[\[(].*?[\])]", "", title)  # toglie [codici] e (anni)
    words = re.findall(r"[A-Za-zÀ-ÿ0-9]+", title)
    small = {"e", "di", "del", "della", "per", "a", "da", "in", "con", "il", "la", "lo", "l"}
    out = [w if w.isupper() and len(w) > 1 else (w.lower() if w.lower() in small and i else w.capitalize())
           for i, w in enumerate(words)]
    return safe_name("_".join(out), 60) or "Corso"


def uni_path(rel: str | Path) -> Path:
    return settings.uni_root / rel


def rel_to_uni(p: Path) -> str:
    return p.resolve().relative_to(settings.uni_root.resolve()).as_posix()


def ensure_course_dirs(course_folder: Path) -> None:
    for sub in COURSE_SUBDIRS:
        (course_folder / sub).mkdir(parents=True, exist_ok=True)
