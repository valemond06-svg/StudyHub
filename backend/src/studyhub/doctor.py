"""Controllo dell'installazione: cosa c'è, cosa manca e come sistemarlo.

Lo usano `studyhub doctor` e il primo avvio dell'app (Studia mostra i passi mancanti).
Nessun controllo fa chiamate AI o login: solo file, eseguibili e porte locali.
"""
from __future__ import annotations

import shutil
from pathlib import Path

import httpx

from .config import LOCAL_DIR, settings
from .db import session


def _claude() -> str | None:
    exe = shutil.which("claude")
    if exe:
        return exe
    p = Path.home() / ".local" / "bin" / "claude.exe"  # installer nativo di Claude Code
    return str(p) if p.exists() else None


def _ollama_models() -> list[str] | None:
    try:
        r = httpx.get("http://127.0.0.1:11434/api/tags", timeout=1.5)
        return [m["name"] for m in r.json().get("models", [])]
    except Exception:
        return None


def checks() -> list[dict]:
    """[{id, ok, required, label, detail, fix}] nell'ordine in cui conviene sistemarli."""
    from .ai.llm import _agy_exe
    from .sync.auth import SESSION_FILE, TOKEN_FILE

    out = []

    def add(id_, ok, required, label, detail="", fix=""):
        out.append({"id": id_, "ok": bool(ok), "required": required, "label": label, "detail": detail,
                    "fix": "" if ok else fix})

    chromium = any((LOCAL_DIR / "ms-playwright").glob("chromium-*"))
    add("chromium", chromium, True, "Browser per il login UniVR",
        fix="Esegui installa.ps1 (installa Chromium di Playwright).")

    root = settings.uni_root
    add("cartella", root.is_dir(), True, "Cartella dei corsi", str(root),
        fix=f"Crea la cartella {root} o correggi uni_root in config.yaml.")

    logged = SESSION_FILE.exists() or TOKEN_FILE.exists()
    add("login", logged, True, "Login a Moodle UniVR",
        fix="Premi «Accedi a Moodle» (o doppio clic su accedi_moodle.bat) e fai il login d'ateneo.")

    with session() as db:
        n = db.execute("SELECT COUNT(*) FROM courses WHERE active=1 AND folder IS NOT NULL").fetchone()[0]
    add("corsi", n, True, "Corsi dell'anno in corso", f"{n} corsi attivi" if n else "",
        fix="Dopo il login premi «Trova i miei corsi»; correggi la classificazione in corsi.yaml se serve.")

    agy = _agy_exe()
    claude = _claude()
    add("gemini", agy, False, "Gemini (Antigravity, comando agy)", agy or "",
        fix="Installa Antigravity e la sua CLI `agy`, poi esegui `agy` una volta per il login Google. "
            "Senza, StudyHub usa solo Claude (finisce prima la finestra di 5 ore).")
    add("claude", claude, not agy, "Claude Code (comando claude)", claude or "",
        fix="Installa Claude Code (irm https://claude.ai/install.ps1 | iex) ed esegui `claude` una volta per il login Pro.")

    models = _ollama_models()
    has_bge = models is not None and any(m.startswith("bge-m3") for m in models)
    add("ollama", has_bge, False, "Ricerca per significato (Ollama + bge-m3)",
        "Ollama non risponde" if models is None else ("modello pronto" if has_bge else "manca il modello bge-m3"),
        fix="Installa Ollama (winget install Ollama.Ollama) ed esegui `ollama pull bge-m3`. "
            "Senza, la ricerca funziona solo per parole.")

    from .media.transcribe import device
    dev = device()
    add("gpu", dev == "cuda", False, "Trascrizione con GPU NVIDIA",
        "GPU NVIDIA" if dev == "cuda" else "nessuna GPU NVIDIA: Whisper gira su CPU (molto più lento)",
        fix="Normale su PC senza scheda NVIDIA: le registrazioni si trascrivono lo stesso, ma più lentamente.")
    return out


def ready() -> bool:
    return all(c["ok"] for c in checks() if c["required"])
