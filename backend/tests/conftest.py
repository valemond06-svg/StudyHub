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
    monkeypatch.setattr(Settings, "old_db_path", property(lambda self: tmp_path / "legacy.db"))
    monkeypatch.setattr(settings, "uni_root", uni)
    monkeypatch.setattr(settings, "extra", {})
    for var in ("STUDYHUB_LOCAL_LLM", "STUDYHUB_LLM_KEY", "STUDYHUB_LOCAL_LLM_KEY", "LOCAL_LLM_API_KEY",
                "STUDYHUB_LLM_MODEL"):
        monkeypatch.delenv(var, raising=False)
    # Set a fixed API token for tests
    monkeypatch.setenv("STUDYHUB_API_TOKEN", "test-api-token-12345")
    from studyhub.ai import llm
    llm._auth_failed.clear()
    llm._vision.clear()
    return tmp_path


class AuthenticatedTestClient:
    """TestClient wrapper that adds auth headers to all requests."""

    def __init__(self, test_client, token, csrf_token):
        self._client = test_client
        self._token = token
        self._csrf_token = csrf_token

    def request(self, method, url, *args, **kwargs):
        headers = kwargs.get("headers", {})
        headers["Authorization"] = f"Bearer {self._token}"
        if self._csrf_token and method.upper() in ("POST", "PUT", "DELETE", "PATCH"):
            headers["X-CSRF-Token"] = self._csrf_token
        kwargs["headers"] = headers

        # Also pass the CSRF cookie for validation
        cookies = kwargs.get("cookies", {})
        if self._csrf_token:
            cookies["csrf_token"] = self._csrf_token
        kwargs["cookies"] = cookies

        return self._client.request(method, url, *args, **kwargs)

    def get(self, url, **kwargs):
        return self.request("GET", url, **kwargs)

    def post(self, url, **kwargs):
        return self.request("POST", url, **kwargs)

    def put(self, url, **kwargs):
        return self.request("PUT", url, **kwargs)

    def delete(self, url, **kwargs):
        return self.request("DELETE", url, **kwargs)

    def patch(self, url, **kwargs):
        return self.request("PATCH", url, **kwargs)

    def options(self, url, **kwargs):
        return self.request("OPTIONS", url, **kwargs)

    def head(self, url, **kwargs):
        return self.request("HEAD", url, **kwargs)

    @property
    def cookies(self):
        return self._client.cookies


@pytest.fixture
def client(ambiente, monkeypatch):
    """TestClient with authentication headers pre-configured."""
    import numpy as np
    # Niente Ollama vero: la ricerca semantica riceve un vettore finto
    monkeypatch.setattr("studyhub.search.embed_query", lambda q: np.ones(1024, np.float32) / 32)
    from studyhub.api.app import app
    from fastapi.testclient import TestClient

    # Create a test client
    test_client = TestClient(app, raise_server_exceptions=False)

    # Get CSRF token from cookie after first request
    response = test_client.get("/")
    csrf_token = response.cookies.get("csrf_token")

    return AuthenticatedTestClient(test_client, "test-api-token-12345", csrf_token)


@pytest.fixture
def db(ambiente):
    from studyhub.db import session
    with session() as conn:
        yield conn


def inserisci_corso(conn, cid=1, nome="Analisi 2", **extra):
    campi = {"id": cid, "fullname": nome, "folder": f"corso{cid}", "active": 1, "academic_year": "2026/27", **extra}
    conn.execute(f"INSERT INTO courses ({','.join(campi)}) VALUES ({','.join('?' * len(campi))})", list(campi.values()))
    return cid
