import importlib
import io
import logging

import pytest
from fastapi.testclient import TestClient

from studyhub.ai import jobs

api_app = importlib.import_module("studyhub.api.app")


@pytest.mark.parametrize("startup_fails", [False, True])
def test_lifespan_starts_worker_and_keeps_server_available(monkeypatch, caplog, startup_fails):
    starts = []

    def start():
        starts.append(True)
        if startup_fails:
            raise RuntimeError("worker non disponibile")

    monkeypatch.setattr(jobs, "start_if_needed", start)
    with caplog.at_level(logging.ERROR, logger=api_app.__name__), TestClient(api_app.app) as client:
        assert starts == [True]
        assert client.get("/openapi.json").status_code == 200

    assert starts == [True]
    assert ("coda AI: avvio non riuscito" in caplog.text) is startup_fails


@pytest.mark.parametrize(("url", "payload"), [
    ("/api/study/1/sessions", {"minutes": 45, "focus_topic": 7}),
    ("/api/study/1/chapters", {"chapter": "Algebra", "exclude": False}),
    ("/api/study/topics/1/ask", {"question": "Come?", "context": "Esempio", "mode": "domanda"}),
])
def test_request_models_return_422_for_unknown_fields(client, url, payload):
    response = client.post(url, json={**payload, "unexpected": True})

    assert response.status_code == 422
    detail, = response.json()["detail"]
    assert detail["loc"] == ["body", "unexpected"]
    assert detail["type"] == "extra_forbidden"


@pytest.mark.parametrize("origin", [
    "http://localhost:5173", "http://127.0.0.1:5173",
    "http://localhost:8765", "http://127.0.0.1:8765",
])
def test_allowed_origins_accept_credentials_and_csrf(origin):
    client = TestClient(api_app.app)
    response = client.options("/api/study/1/sessions", headers={
        "Origin": origin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "X-CSRF-Token",
    })

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin
    assert response.headers["access-control-allow-credentials"] == "true"
    assert "x-csrf-token" in response.headers["access-control-allow-headers"].lower()


def test_disallowed_origin_has_no_cors_headers():
    client = TestClient(api_app.app)
    headers = {"Origin": "https://example.invalid"}
    actual = client.get("/openapi.json", headers=headers)
    preflight = client.options("/api/study/1/sessions", headers={
        **headers, "Access-Control-Request-Method": "POST",
    })

    assert actual.status_code == 200
    assert preflight.status_code == 400
    for response in (actual, preflight):
        assert not any(name.startswith("access-control-") for name in response.headers)


def test_startup_installs_redaction_on_dedicated_handler(monkeypatch):
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(logging.Formatter("%(message)s | %(api_token)s"))
    logger = logging.getLogger("uvicorn.sprint3-test")
    monkeypatch.setattr(logger, "propagate", False)
    monkeypatch.setattr(jobs, "start_if_needed", lambda: None)
    logger.addHandler(handler)
    short = "s" * 100
    long = "r" * 101

    try:
        with TestClient(api_app.app):
            extra = {"api_token": "fake-structured-token"}
            logger.warning("api_key=%s Authorization: Bearer %s", "fake-api-key", "fake.bearer", extra=extra)
            logger.warning('{"token": "fake-dict-token", "transcript": "%s", "status": "ok"}', long, extra=extra)
            logger.warning("trascrizione: %s", short, extra=extra)
            try:
                raise ValueError("wstoken=fake-exception-token")
            except ValueError:
                logger.exception("Errore di test", extra=extra)
    finally:
        logger.removeHandler(handler)

    output = stream.getvalue()
    assert "api_key=*** Authorization: Bearer *** | ***" in output
    assert '"transcript": ***, "status": "ok"' in output
    assert f"trascrizione: {short}" in output
    assert "ValueError: wstoken=***" in output
    assert "fake-" not in output and "fake.bearer" not in output and long not in output
