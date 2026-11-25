import logging

import pytest
from fastapi.testclient import TestClient

from studyhub.ai import jobs
from studyhub.api import app as api

ORIGIN = "http://127.0.0.1:8765"


@pytest.fixture
def browser(ambiente, monkeypatch):
    dist = ambiente / "dist"
    static = ambiente / "legacy"
    static.mkdir()
    (static / "index.html").write_text("<h1>Legacy __UI_VERSION__</h1>", encoding="utf-8")
    monkeypatch.setattr(api, "STATIC", static)
    monkeypatch.setattr(jobs, "start_if_needed", lambda: None)
    monkeypatch.setenv("STUDYHUB_UI_DIST", str(dist))
    api._warn_missing_ui.cache_clear()
    with TestClient(api.app, base_url=ORIGIN) as client:
        yield client, dist


def test_react_dist_serves_assets_files_and_spa_routes(browser):
    client, dist = browser
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<div id='react-root'></div>", encoding="utf-8")
    (dist / "assets" / "app-123.js").write_text("console.log('react')", encoding="utf-8")
    (dist / "manifest.webmanifest").write_text("{}", encoding="utf-8")

    for path in ("/", "/index.html", "/studio/1", "/corsi/1", "/studio/1.0"):
        response = client.get(path)
        assert response.status_code == 200
        assert response.text == "<div id='react-root'></div>"
        assert response.headers["cache-control"] == "no-cache"

    asset = client.get("/assets/app-123.js")
    assert asset.status_code == 200 and asset.text == "console.log('react')"
    assert asset.headers["cache-control"] == "public, max-age=31536000, immutable"
    assert client.get("/manifest.webmanifest").text == "{}"
    for path in ("/assets/missing.js", "/api", "/api/missing", "/media/missing", "/video/missing"):
        assert client.get(path).status_code == 404

    legacy = client.get("/legacy")
    assert legacy.status_code == 200 and "<h1>Legacy " in legacy.text and "__UI_VERSION__" not in legacy.text
    assert legacy.headers["cache-control"] == "no-cache"


def test_missing_dist_logs_and_serves_legacy_on_root(browser, caplog):
    client, dist = browser
    assert not dist.exists()
    with caplog.at_level(logging.WARNING, logger=api.__name__):
        root = client.get("/")
    assert root.status_code == 200 and root.text == client.get("/legacy").text
    assert root.headers["cache-control"] == "no-cache"
    assert "Build React assente" in caplog.text


def test_root_uses_dist_and_legacy_uses_shipped_html(client, ambiente, monkeypatch):
    dist = ambiente / "react-dist"
    dist.mkdir()
    react = '<div id="root"></div><script type="module" src="/assets/app.js"></script>'
    (dist / "index.html").write_text(react, encoding="utf-8")
    monkeypatch.setenv("STUDYHUB_UI_DIST", str(dist))

    root = client.get("/")
    legacy = client.get("/legacy")
    assert root.status_code == legacy.status_code == 200
    assert root.text == react
    assert legacy.text == (api.STATIC / "index.html").read_text(encoding="utf-8").replace("__UI_VERSION__", api._ui_version())
    assert client.head("/legacy").headers["content-length"] == legacy.headers["content-length"]


def test_react_deep_link_bootstraps_same_origin_api_and_csrf(browser):
    client, dist = browser
    dist.mkdir()
    (dist / "index.html").write_text("<div id='react-root'></div>", encoding="utf-8")

    page = client.get("/studio/1")
    assert page.status_code == 200
    assert "HttpOnly" in next(value for value in page.headers.get_list("set-cookie") if value.startswith("api_token="))
    csrf = client.cookies["csrf_token"]
    assert client.get("/api/csrf").json() == {"csrf_token": csrf}
    assert client.get("/api/courses").json() == []
    assert client.post("/api/notifications/read").status_code == 403

    mutation = client.post("/api/notifications/read", headers={"Origin": ORIGIN, "X-CSRF-Token": csrf})
    assert mutation.status_code == 200 and mutation.json() == {"ok": True}
    assert mutation.headers["access-control-allow-origin"] == ORIGIN
    assert mutation.headers["access-control-allow-credentials"] == "true"

    preflight = client.options("/api/notifications/read", headers={
        "Origin": ORIGIN, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "X-CSRF-Token",
    })
    assert preflight.status_code == 200
    assert "x-csrf-token" in preflight.headers["access-control-allow-headers"].lower()
