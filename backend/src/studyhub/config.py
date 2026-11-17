"""Percorsi e impostazioni. Tutto è relativo alla cartella università che contiene _StudyHub/."""
from __future__ import annotations

import json
import logging
import os
import secrets
import sys
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

import yaml

APP_DIR = Path(__file__).resolve().parents[3]  # .../02_Università/_StudyHub
CONFIG_FILE = APP_DIR / "config.yaml"
# Cookie, token e profilo del browser restano fuori dal Desktop (sincronizzato con Google Drive).
# Non in AppData\Local: le app MSIX (es. Claude desktop) lo virtualizzano per i processi figli.
LOCAL_DIR = Path(os.environ.get("STUDYHUB_LOCAL_DIR", Path.home() / ".studyhub"))
# Chromium di Playwright installato qui da studyhub.bat: vale anche se si lancia Python direttamente.
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", str(LOCAL_DIR / "ms-playwright"))

log = logging.getLogger(__name__)


def _get_keyring():
    """Restituisce un backend keyring (Windows Credential Manager / Linux Secret Service).
    Fallback a file se keyring non disponibile (log warning)."""
    try:
        import keyring
        return keyring
    except Exception as e:
        log.warning("Keyring non disponibile: %s. Uso fallback file.", e)
        return None


def _keyring_get(service: str, username: str) -> str | None:
    """Legge un segreto da keyring."""
    kr = _get_keyring()
    if kr is None:
        return None
    try:
        return kr.get_password(service, username)
    except Exception as e:
        log.warning("Errore lettura keyring (%s/%s): %s", service, username, e)
        return None


def _keyring_set(service: str, username: str, value: str) -> bool:
    """Scrive un segreto in keyring. Ritorna True se successo."""
    kr = _get_keyring()
    if kr is None:
        return False
    try:
        kr.set_password(service, username, value)
        return True
    except Exception as e:
        log.warning("Errore scrittura keyring (%s/%s): %s", service, username, e)
        return False


def get_local_llm_key() -> str | None:
    """Ottiene la chiave LLM locale con priorità:
    1. Variabile d'ambiente STUDYHUB_LOCAL_LLM_KEY
    2. File ~/.config/brain-llm/api-key (Linux) o %APPDATA%\\brain-llm\\api-key (Windows)
    3. config.yaml (deprecated, log warning)
    """
    # 1. Variabile d'ambiente
    key = os.environ.get("STUDYHUB_LOCAL_LLM_KEY")
    if key:
        return key

    # 2. File di configurazione locale
    if sys.platform == "win32":
        config_file = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming")) / "brain-llm" / "api-key"
    else:
        config_file = Path.home() / ".config" / "brain-llm" / "api-key"

    if config_file.exists():
        try:
            return config_file.read_text(encoding="utf-8").strip()
        except Exception as e:
            log.warning("Errore lettura %s: %s", config_file, e)

    # 3. config.yaml (deprecated)
    if CONFIG_FILE.exists():
        try:
            data = yaml.safe_load(CONFIG_FILE.read_text(encoding="utf-8")) or {}
            key = data.get("local_llm_key")
            if key:
                log.warning("local_llm_key letto da config.yaml (deprecated). Usa STUDYHUB_LOCAL_LLM_KEY o ~/.config/brain-llm/api-key")
                return key
        except Exception:
            pass

    return None


def get_or_create_api_token() -> str:
    """Get or create the API token for authentication.

    Priority:
    1. STUDYHUB_API_TOKEN environment variable
    2. ~/.studyhub/api_token file (generated on first run)
    """
    # Check environment variable first
    env_token = os.environ.get("STUDYHUB_API_TOKEN")
    if env_token:
        return env_token

    # Check/generate token file in LOCAL_DIR
    token_file = LOCAL_DIR / "api_token"
    if token_file.exists():
        return token_file.read_text(encoding="utf-8").strip()

    # Generate new token and save it
    token = secrets.token_urlsafe(32)
    token_file.parent.mkdir(parents=True, exist_ok=True)
    token_file.write_text(token, encoding="utf-8")
    # Set restrictive permissions (owner read/write only)
    try:
        token_file.chmod(0o600)
    except Exception:
        pass  # Windows may not support chmod
    return token


def _current_academic_year() -> str:
    """L'anno accademico cambia a settembre: ottobre 2026 → "2026/27"."""
    today = date.today()
    start = today.year if today.month >= 9 else today.year - 1
    return f"{start}/{(start + 1) % 100:02d}"


@dataclass
class Settings:
    moodle_url: str = "https://moodledidattica.univr.it"
    uni_root: Path = APP_DIR.parent
    current_academic_year: str = field(default_factory=_current_academic_year)
    current_year_of_study: int = 1
    # Corsi di anni precedenti non ancora superati (regex sul nome): restano attivi e prioritari.
    extra_active_courses: list = field(default_factory=list)
    whisper_device: str = "auto"  # auto | cuda | cpu
    # Moodle è un servizio d'ateneo: poche richieste e piccole pause.
    request_delay_s: float = 0.4
    video_policy: str = "leggera"
    extra: dict = field(default_factory=dict)

    @property
    def app_dir(self) -> Path:
        return APP_DIR

    @property
    def db_path(self) -> Path:
        return APP_DIR / "studyhub.db"

    @property
    def secrets_dir(self) -> Path:
        d = LOCAL_DIR / "secrets"
        d.mkdir(parents=True, exist_ok=True)
        return d

    @property
    def browser_profile(self) -> Path:
        return LOCAL_DIR / "browser-profile"

    @property
    def courses_file(self) -> Path:
        return APP_DIR / "corsi.yaml"

    @property
    def api_token(self) -> str:
        """Get the API token for authentication (generated on first run if not set)."""
        return get_or_create_api_token()


def load_settings() -> Settings:
    s = Settings()
    if CONFIG_FILE.exists():
        data = yaml.safe_load(CONFIG_FILE.read_text(encoding="utf-8")) or {}
        for k, v in data.items():
            if hasattr(s, k) and v is not None:
                setattr(s, k, Path(v) if k == "uni_root" else v)
            else:
                s.extra[k] = v
    return s


settings = load_settings()
