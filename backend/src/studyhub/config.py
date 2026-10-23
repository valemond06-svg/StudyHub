"""Percorsi e impostazioni. Tutto è relativo alla cartella università che contiene _StudyHub/."""
from __future__ import annotations

import os
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
