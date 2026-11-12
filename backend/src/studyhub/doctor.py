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


def check_database() -> tuple[bool, str]:
    """Il file del database si apre, la struttura è integra e alla versione attesa."""
    from .db import MIGRATIONS
    path = settings.db_path
    try:
        with session() as db:  # session() apre e migra: se il file è corrotto fallisce qui
            esito = db.execute("PRAGMA quick_check").fetchone()[0]
            versione = db.execute("PRAGMA user_version").fetchone()[0]
    except Exception as e:
        return False, f"{path.name} non si apre: {e}"
    if esito != "ok":
        return False, f"{path.name} danneggiato ({esito[:120]})"
    if versione != len(MIGRATIONS):
        return False, f"schema alla versione {versione}, attesa {len(MIGRATIONS)}"
    dimensione = path.stat().st_size / 1e6 if path.exists() else 0
    return True, f"{path.name}, schema v{versione}, {dimensione:.1f} MB"


def check_modello_locale() -> tuple[bool, str]:
    """Un server OpenAI locale (laptop Windows, fisso) risponde al controllo di salute."""
    from .ai import llm
    try:
        url = llm.get_local_llm_url()
    except Exception as e:  # il controllo non deve mai far cadere l'app
        return False, f"controllo non riuscito: {e}"
    if url:
        return True, f"{url} (modello «{llm.get_local_llm_model()}»)"
    rifiutati = llm.local_llm_auth_failures()
    if rifiutati:
        return False, ("server raggiunti ma senza chiave valida: " + ", ".join(rifiutati)
                       + ". Imposta STUDYHUB_LOCAL_LLM_KEY (o local_llm_key in config.yaml, o il file "
                       "~/.config/brain-llm/api-key).")
    return False, "nessun server risponde (provati: " + ", ".join(llm.local_llm_candidates()[:4]) + ", …)"


def check_ffmpeg() -> tuple[bool, str]:
    """ffmpeg (binario di imageio-ffmpeg) esiste e parte: serve a registrazioni e slide."""
    try:
        from .media.ff import ffmpeg
        exe = Path(ffmpeg())
    except Exception as e:
        return False, f"binario non trovato: {e}"
    if not exe.exists():
        return False, f"{exe} non esiste"
    return True, exe.name


def check_cartelle_corsi() -> tuple[bool, str]:
    """Ogni corso attivo ha la sua cartella su disco (spostata o cancellata = download e indice rotti)."""
    from .paths import uni_path
    try:
        with session() as db:
            corsi = [dict(r) for r in db.execute(
                "SELECT fullname, folder FROM courses WHERE active=1 AND folder IS NOT NULL")]
    except Exception:
        return True, ""  # il database è già segnalato dal suo controllo
    mancanti = [c["fullname"] for c in corsi if not uni_path(c["folder"]).is_dir()]
    if mancanti:
        return False, f"{len(mancanti)} su {len(corsi)} senza cartella: " + ", ".join(mancanti[:3]) + ("…" if len(mancanti) > 3 else "")
    return True, f"{len(corsi)} cartelle presenti" if corsi else ""


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

    db_ok, db_detail = check_database()
    add("database", db_ok, True, "Database di StudyHub", db_detail,
        fix="Chiudi StudyHub e ripristina studyhub.db da una copia; "
            "se non ce ne sono, rinomina il file: verrà ricreato vuoto e i corsi si risincronizzano.")
    n = 0
    if db_ok:
        with session() as db:
            n = db.execute("SELECT COUNT(*) FROM courses WHERE active=1 AND folder IS NOT NULL").fetchone()[0]
    add("corsi", n, True, "Corsi dell'anno in corso", f"{n} corsi attivi" if n else "",
        fix="Dopo il login premi «Trova i miei corsi»; correggi la classificazione in corsi.yaml se serve.")

    ok, detail = check_cartelle_corsi()
    add("cartelle_corsi", ok, False, "Cartelle dei corsi sul disco", detail,
        fix="Rimetti le cartelle al loro posto (o rilancia «Trova i miei corsi» per ricrearle): senza, download e indice puntano al vuoto.")

    solo_locale = (settings.extra.get("ai_provider") or "").lower() == "local"
    ok, detail = check_modello_locale()
    add("modello_locale", ok, solo_locale, "Modello AI locale (gratis, offline)", detail,
        fix="Sul laptop accendi l'AI locale (comando `ai on`: router su 127.0.0.1:8080); sul fisso controlla che il "
            "server llama.cpp sia attivo (porta 8080/8081). Senza, StudyHub usa Gemini o Claude.")

    ok, detail = check_ffmpeg()
    add("ffmpeg", ok, False, "ffmpeg per registrazioni e slide", detail,
        fix="Reinstalla le dipendenze (uv sync): il binario arriva dal pacchetto imageio-ffmpeg.")

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
