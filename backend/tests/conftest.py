"""Fixture comuni: ogni test lavora su un database SQLite e una cartella università temporanei.

Mai rete vera, mai il database dell'utente: `settings.db_path` e `settings.uni_root` puntano a tmp_path.
"""
from __future__ import annotations

import os
import tempfile

# Prima di importare studyhub: la cartella dei segreti/profili non deve essere quella vera.
os.environ.setdefault("STUDYHUB_LOCAL_DIR", tempfile.mkdtemp(prefix="studyhub-test-local-"))

import pytest

from studyhub.config import Settings, settings


@pytest.fixture
def ambiente(tmp_path, monkeypatch):
    """Database vuoto + cartella università temporanea. Restituisce tmp_path."""
    db_file = tmp_path / "test.db"
    uni = tmp_path / "uni"
    uni.mkdir()
    monkeypatch.setattr(Settings, "db_path", property(lambda self: db_file))
    monkeypatch.setattr(settings, "uni_root", uni)
    monkeypatch.setattr(settings, "extra", {})
    for var in ("STUDYHUB_LOCAL_LLM", "STUDYHUB_LLM_KEY"):
        monkeypatch.delenv(var, raising=False)
    return tmp_path


@pytest.fixture
def db(ambiente):
    from studyhub.db import session
    with session() as conn:
        yield conn


def inserisci_corso(conn, cid=1, nome="Analisi 2", **extra):
    campi = {"id": cid, "fullname": nome, "folder": f"corso{cid}", "active": 1, "academic_year": "2026/27", **extra}
    conn.execute(f"INSERT INTO courses ({','.join(campi)}) VALUES ({','.join('?' * len(campi))})", list(campi.values()))
    return cid
