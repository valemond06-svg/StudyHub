import datetime as dt
import json
import logging
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from studyhub import autosync, brain_events, notte

TOKEN = "tok-segretissimo-123"


class _Srv:
    def __init__(self, status=200):
        self.status = status
        self.got = []
        outer = self

        class H(BaseHTTPRequestHandler):
            def do_POST(self):
                body = self.rfile.read(int(self.headers["Content-Length"]))
                outer.got.append((dict(self.headers), json.loads(body)))
                self.send_response(outer.status)
                self.send_header("Content-Length", "0")
                self.end_headers()

            def log_message(self, *a):
                pass

        self.httpd = HTTPServer(("127.0.0.1", 0), H)
        self.url = f"http://127.0.0.1:{self.httpd.server_port}/event"
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def stop(self):
        self.httpd.shutdown()
        self.httpd.server_close()


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setattr(brain_events.config, "LOCAL_DIR", tmp_path)
    monkeypatch.setattr(brain_events.config.settings, "extra", {})
    for k in ("BRAIN_EVENT_URL", "BRAIN_EVENT_TOKEN", "BRAIN_EVENT_FALLBACK_URL"):
        monkeypatch.delenv(k, raising=False)
    return tmp_path


def _cfg(monkeypatch, url, fallback=None):
    monkeypatch.setenv("BRAIN_EVENT_URL", url)
    monkeypatch.setenv("BRAIN_EVENT_TOKEN", TOKEN)
    if fallback:
        monkeypatch.setenv("BRAIN_EVENT_FALLBACK_URL", fallback)


def _coda(env):
    return env / "brain_events_pending.jsonl"


def test_invio_ok(env, monkeypatch):
    s = _Srv()
    try:
        _cfg(monkeypatch, s.url)
        assert brain_events.send("studyhub.sync", {"file": 2}, level="warn", id="x1") is True
    finally:
        s.stop()
    h, body = s.got[0]
    assert h["X-Brain-Token"] == TOKEN and h["Content-Type"] == "application/json"
    assert body == {"type": "studyhub.sync", "level": "warn", "data": {"file": 2}, "id": "x1"}


def test_senza_token_niente_rete(env, monkeypatch):
    monkeypatch.setenv("BRAIN_EVENT_URL", "http://127.0.0.1:1/x")
    monkeypatch.setattr(brain_events.urllib.request, "urlopen", lambda *a, **k: pytest.fail("rete"))
    assert brain_events.send("t") is False
    assert not _coda(env).exists()


def test_401_non_accodato(env, monkeypatch):
    s = _Srv(401)
    try:
        _cfg(monkeypatch, s.url)
        assert brain_events.send("t") is False
    finally:
        s.stop()
    assert not _coda(env).exists()


def test_server_giu_accoda_poi_svuota(env, monkeypatch):
    s = _Srv()
    url = s.url
    s.stop()
    _cfg(monkeypatch, url)
    assert brain_events.send("a", {"n": 1}) is False
    assert brain_events.send("b", {"n": 2}) is False
    q = _coda(env).read_text(encoding="utf-8")
    assert len(q.splitlines()) == 2 and TOKEN not in q
    s2 = _Srv()
    try:
        _cfg(monkeypatch, s2.url)
        assert brain_events.send("c") is True
    finally:
        s2.stop()
    assert [b["type"] for _, b in s2.got] == ["a", "b", "c"]
    assert not _coda(env).exists()


def test_fallback_url(env, monkeypatch):
    s = _Srv()
    try:
        _cfg(monkeypatch, "http://127.0.0.1:1/x", fallback=s.url)
        assert brain_events.send("t") is True
    finally:
        s.stop()
    assert len(s.got) == 1


def test_tetto_200(env, monkeypatch):
    _cfg(monkeypatch, "http://127.0.0.1:1/x")
    monkeypatch.setattr(brain_events, "_post", lambda *a: "riprova")
    for i in range(205):
        brain_events.send("t", {"i": i})
    righe = _coda(env).read_text(encoding="utf-8").splitlines()
    assert len(righe) == 200
    assert json.loads(righe[0])["data"]["i"] == 5


def test_file_env(env, tmp_path):
    s = _Srv()
    f = tmp_path / "s.env"
    f.write_text('# commento\n\nBRAIN_EVENT_URL="%s"\nBRAIN_EVENT_TOKEN=\'%s\'\n' % (s.url, TOKEN), encoding="utf-8")
    brain_events.config.settings.extra["brain_event_env"] = str(f)
    try:
        assert brain_events.send("t") is True
    finally:
        s.stop()
    assert s.got[0][0]["X-Brain-Token"] == TOKEN


def test_spento(env, monkeypatch):
    _cfg(monkeypatch, "http://127.0.0.1:1/x")
    brain_events.config.settings.extra["brain_events"] = False
    monkeypatch.setattr(brain_events.urllib.request, "urlopen", lambda *a, **k: pytest.fail("rete"))
    assert brain_events.send("t") is False


def test_token_mai_nei_log(env, monkeypatch, caplog, capsys):
    caplog.set_level(logging.DEBUG)
    _cfg(monkeypatch, "http://127.0.0.1:1/x")
    brain_events.send("t")
    out = capsys.readouterr()
    assert TOKEN not in caplog.text + out.out + out.err
    assert TOKEN not in _coda(env).read_text(encoding="utf-8")


def test_notte_evento(monkeypatch):
    got = []
    monkeypatch.setattr(brain_events, "send", lambda *a, **k: got.append((a, k)))
    inizio = dt.datetime.now() - dt.timedelta(minutes=5)
    notte._evento(inizio, notte.Esito(trascritte=1, fatte=2, errori=1, saltate=3), True)
    notte._evento(inizio, notte.Esito(), False)
    (a, k), (a2, k2) = got
    assert a[0] == "studyhub.notte" and k["level"] == "warn" and k["id"] == f"studyhub-notte-{inizio:%Y%m%d}"
    assert a[1] == {"trascritte": 1, "unita_fatte": 2, "errori": 1, "saltate": 3, "durata_min": 5, "esito": "ok"}
    assert k2["level"] == "error" and a2[1]["esito"] == "llm_giu"
    monkeypatch.setattr(brain_events, "send", lambda *a, **k: 1 / 0)
    notte._evento(inizio, notte.Esito(), True)  # non solleva


def test_autosync_evento(monkeypatch):
    got = []
    monkeypatch.setattr(brain_events, "send", lambda *a, **k: got.append((a, k)))
    autosync._evento_sync({"file": 1, "lezioni": 2, "avvisi": 0, "errori": ["a", "b", "c", "d"]}, False)
    autosync._evento_sync({"file": 0, "lezioni": 0, "avvisi": 0, "errori": ["Login necessario"]}, True)
    autosync._evento_sync({"file": 0, "lezioni": 0, "avvisi": 0, "errori": []}, False)
    (a, k), (a2, k2), (_, k3) = got
    assert a[0] == "studyhub.sync" and k["level"] == "warn"
    assert a[1] == {"file": 1, "lezioni": 2, "avvisi": 0, "errori": 4, "errori_esempi": ["a", "b", "c"]}
    assert k2["level"] == "error" and a2[1]["login_necessario"] is True
    assert k3["level"] == "info"
    monkeypatch.setattr(brain_events, "send", lambda *a, **k: 1 / 0)
    autosync._evento_sync({"file": 0, "lezioni": 0, "avvisi": 0, "errori": []}, False)
