"""Pannello «Coda AI e turno di notte»: endpoint leggero e file notte_ultimo.json."""
from __future__ import annotations

import datetime as dt
import json
import time
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient

from studyhub import config, notte, turno
from studyhub.ai import claude_runner, health, llm
from studyhub.db import session

from conftest import inserisci_corso


@pytest.fixture
def locale(ambiente, monkeypatch):
    d = ambiente / "local"
    d.mkdir()
    monkeypatch.setattr(config, "LOCAL_DIR", d)
    monkeypatch.setattr(turno, "LEGACY_LOCK", ambiente / "legacy.lock")
    monkeypatch.setattr(turno, "NOTTE_LOCK", ambiente / "notte.lock")
    monkeypatch.setattr(claude_runner, "USAGE_FILE", d / "usage.json")
    return d


@pytest.fixture
def client(ambiente, locale, monkeypatch):
    """Use the authenticated client fixture from conftest with isolated LOCAL_DIR."""
    from conftest import AuthenticatedTestClient
    from studyhub.api.app import app

    def vietato(*a, **k):
        raise AssertionError("il pannello non deve chiamare LLM o Claude")

    for mod, nomi in ((llm, ("chat", "complete", "generate")), (claude_runner, ("run", "ask", "call_claude"))):
        for n in nomi:
            if hasattr(mod, n):
                monkeypatch.setattr(mod, n, vietato)
    import urllib.request
    monkeypatch.setattr(urllib.request, "urlopen", vietato)

    test_client = TestClient(app, raise_server_exceptions=False)
    response = test_client.get("/")
    csrf_token = response.cookies.get("csrf_token")

    return AuthenticatedTestClient(test_client, "test-api-token-12345", csrf_token)


def _job(db, kind, tid, status, msg=None, fin=None):
    db.execute("INSERT INTO ai_jobs (kind, target_id, status, message, finished_at, created_at) VALUES (?,?,?,?,?,?)",
               (kind, tid, status, msg, fin, "2026-11-14T10:00:00"))


def test_vuoto(client):
    r = client.get("/api/ai/pannello")
    assert r.status_code == 200
    d = r.json()
    assert d["coda"]["per_stato"] == {} and d["coda"]["ultimi_errori"] == []
    assert d["notte"] == {"in_corso": False, "ultimo": None}
    assert d["finestra"]["uso_pct"] is None and d["finestra"]["soglia_pct"] == 70
    assert d["finestra"]["claude_backlog"] is False


def test_provider_e_pannello_usano_esiti_reali_e_modello_in_cache(client, monkeypatch):
    host = "http://modello.test:8080"
    monkeypatch.setenv("STUDYHUB_LOCAL_LLM", host + "/v1/")
    monkeypatch.setenv("STUDYHUB_LLM_MODEL", "studio")
    monkeypatch.setattr(llm, "_server_models", {})
    monkeypatch.setattr(llm, "LOCAL_CANDIDATES", ())
    monkeypatch.setattr(llm, "_cache", {"url": None, "at": 0, "ttl": 0, "candidates": ()})
    probe = Mock(return_value=True)
    monkeypatch.setattr(llm, "_probe", probe)
    metadata = Mock(return_value={"data": [{"id": "altro"}, {"id": "ModelloStudio", "aliases": ["studio"]}]})
    monkeypatch.setattr(llm, "_get_json", metadata)
    monkeypatch.setattr(llm, "_agy_exe", lambda: "agy")
    monkeypatch.setattr(claude_runner, "_claude_exe", lambda: "claude")
    initial = client.get("/api/ai/providers").json()
    assert set(initial) == {"local", "gemini", "claude"}
    assert initial["local"]["url"] == host and initial["local"]["model"] == "ModelloStudio"
    assert initial["local"]["healthy"] is True
    assert initial["gemini"]["available"] is None and initial["gemini"]["status"] == "unverified"

    health.record("gemini", "quota_exceeded")
    health.record("claude", "available")
    states = client.get("/api/ai/providers").json()
    assert states["gemini"]["status"] == "quota_exceeded" and states["gemini"]["healthy"] is False
    assert states["gemini"]["checked_at"]
    assert states["claude"]["status"] == "available" and states["claude"]["healthy"] is True
    panel = client.get("/api/ai/pannello").json()
    assert panel["providers"] == states
    assert panel["cluster"]["model"] == "ModelloStudio" and panel["cluster"]["url"] == host
    probe.assert_called_once_with(host)
    metadata.assert_called_once_with(host, "/v1/models", llm.HEALTH_TIMEOUT_S)

    health.record("gemini", "available")
    monkeypatch.setattr(claude_runner, "last_usage", lambda: {"utilization": 0.99, "resets_at": time.time() + 300})
    states = client.get("/api/ai/providers").json()
    assert states["gemini"]["status"] == "available"
    assert states["claude"]["status"] == "quota_exceeded"
    assert states["claude"]["retry_at"] == states["claude"]["resets_at"]


def test_modello_locale_da_props_e_offline_senza_url_di_ripiego(client, monkeypatch):
    monkeypatch.setattr(llm, "_server_models", {})
    host = "http://props.test:8080"
    metadata = Mock(side_effect=[None, {"model_path": "C:/modelli/ModelloLocale.gguf"}])
    monkeypatch.setattr(llm, "_get_json", metadata)
    assert llm.server_model(host) == "ModelloLocale.gguf"
    assert llm.server_model(host) == "ModelloLocale.gguf"
    assert [call.args[1] for call in metadata.call_args_list] == ["/v1/models", "/props"]

    monkeypatch.setattr(llm, "get_local_llm_url", lambda: None)
    monkeypatch.setattr(llm, "_agy_exe", lambda: None)
    panel = client.get("/api/ai/pannello").json()
    assert panel["cluster"]["status"] == "offline" and panel["cluster"]["healthy"] is False
    assert panel["cluster"]["url"] is None and panel["cluster"]["model"] is None
    assert panel["providers"]["gemini"]["status"] == "not_configured"
    monkeypatch.setenv("STUDYHUB_LOCAL_LLM", "http://sintetico:mascherato@props.test:8080")
    state = client.get("/api/ai/providers").json()["local"]
    assert state["url"] == host and state["model"] is None and state["status"] == "unreachable"


def test_conteggi_errori_troncati(client):
    with session() as db:
        inserisci_corso(db)
        for i in (1, 2, 3):
            db.execute("INSERT INTO lectures (id, course_id, title, date, number, folder, status) VALUES (?,?,?,?,?,?,?)",
                       (i, 1, f"Lez {i}", "2026-10-01", i, f"c/{i}", "trascritta" if i < 3 else "media_ok"))
        _job(db, "lecture_notes", 1, "in_coda")
        _job(db, "lecture_notes", 2, "in_corso")
        for n in range(7):
            _job(db, "lecture_notes", 1, "errore", "x" * 500, f"2026-11-14 0{n}:00:00")
        db.execute("INSERT INTO study_units (course_id, kind, ref_id, title, status) VALUES (1,'lezione',1,'u1','nuova')")
        db.execute("INSERT INTO study_units (course_id, kind, ref_id, title, status) VALUES (1,'documento',5,'u2','nuova')")
    d = client.get("/api/ai/pannello").json()
    assert d["coda"]["per_stato"] == {"in_coda": 1, "in_corso": 1, "errore": 7}
    assert d["coda"]["per_tipo"] == {"lecture_notes": 2}
    assert len(d["coda"]["ultimi_errori"]) == 5
    assert all(len(e["messaggio"]) == 200 for e in d["coda"]["ultimi_errori"])
    assert d["coda"]["ultimi_errori"][0]["titolo"] == "Lez 1"
    assert d["coda"]["in_corso"][0]["titolo"] == "Lez 2"
    assert d["arretrati"]["da_trascrivere"] == 1
    assert d["arretrati"]["unita_nuove"] == 1 and d["arretrati"]["unita_lezione_attesa_sonnet"] == 1


def test_finestra_e_pausa(client, locale, monkeypatch):
    monkeypatch.setattr(config.settings, "extra", {"claude_backlog": True})
    (locale / "usage.json").write_text(json.dumps({"utilization": 0.82, "resets_at": time.time() + 3600}))
    f = client.get("/api/ai/pannello").json()["finestra"]
    assert f["uso_pct"] == 82 and f["soglia_pct"] == 70 and f["arretrati_in_pausa"] is True
    assert f["reset_alle"] and f["claude_backlog"] is True
    (locale / "usage.json").write_text(json.dumps({"utilization": 0.3, "resets_at": time.time() + 3600}))
    assert client.get("/api/ai/pannello").json()["finestra"]["arretrati_in_pausa"] is False


def test_notte_in_corso_e_ultimo(client, locale, monkeypatch):
    (locale / "notte_ultimo.json").write_text(json.dumps({"esito": "ok", "trascritte": 2}))
    monkeypatch.setattr(turno, "notte_attiva", lambda: True)
    n = client.get("/api/ai/pannello").json()["notte"]
    assert n == {"in_corso": True, "ultimo": {"esito": "ok", "trascritte": 2}}
    (locale / "notte_ultimo.json").write_text("{rotto")
    assert client.get("/api/ai/pannello").json()["notte"]["ultimo"] is None


def _ora(monkeypatch):
    t = dt.datetime(2026, 11, 14, 23, 0, 0)
    monkeypatch.setattr(notte, "_now", lambda: t)
    return t


def test_scrive_ultimo_esito_ok(locale, monkeypatch):
    t = _ora(monkeypatch)
    e = notte.Esito(trascritte=2, fatte=3, errori=1, saltate=4)
    notte._scrivi_ultimo(t - dt.timedelta(minutes=90), e, True)
    d = json.loads((locale / "notte_ultimo.json").read_text(encoding="utf-8"))
    assert d["esito"] == "ok" and d["trascritte"] == 2 and d["unita_fatte"] == 3 and d["errori"] == 1
    assert d["saltate"] == 4 and d["durata_min"] == 90 and d["inizio"] < d["fine"]
    assert not list(locale.glob("*.tmp"))


def test_turno_scrive_file_llm_giu_e_ok(ambiente, locale, monkeypatch):
    _ora(monkeypatch)
    lim = dt.datetime(2026, 11, 15, 4, 0)
    monkeypatch.setattr(notte, "llm_risponde", lambda u: False)
    assert notte._turno(lim, lim, 0, 1) == 1
    assert json.loads((locale / "notte_ultimo.json").read_text())["esito"] == "llm_giu"
    monkeypatch.setattr(notte, "llm_risponde", lambda u: True)
    for n in ("fase1", "fase2", "fase3", "_riprendi"):
        monkeypatch.setattr(notte, n, lambda *a, **k: None)
    assert notte._turno(lim, lim, 0, 1) == 0
    assert json.loads((locale / "notte_ultimo.json").read_text())["esito"] == "ok"


def test_errore_di_scrittura_non_fa_fallire(locale, monkeypatch):
    t = _ora(monkeypatch)
    monkeypatch.setattr(config, "LOCAL_DIR", locale / "file.txt" / "sotto")
    (locale / "file.txt").write_text("x")
    notte._scrivi_ultimo(t, notte.Esito(), True)  # non solleva
