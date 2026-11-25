import logging

import pytest
from fastapi.testclient import TestClient

from studyhub.ai import jobs
from studyhub.api import app as api

ORIGIN = "http://127.0.0.1:8765"


@pytest.fixture
def browser(ambiente, monkeypatch):
    dist = ambiente / "dist"
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

    for path in ("/", "/index.html", "/studio/1", "/corsi/1", "/studio/1.0", "/legacy", "/documento/4"):
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


def test_missing_dist_explains_how_to_install(browser, caplog):
    client, dist = browser
    assert not dist.exists()
    with caplog.at_level(logging.WARNING, logger=api.__name__):
        root = client.get("/")
    assert root.status_code == 503
    assert "installa.ps1" in root.text and "<h1>" in root.text
    assert root.headers["cache-control"] == "no-cache"
    assert "Build React assente" in caplog.text
    assert client.get("/corsi/3").status_code == 503
    for path in ("/assets/app.js", "/api/missing", "/favicon.ico"):
        assert client.get(path).status_code == 404


def test_legacy_ui_is_retired(client, ambiente, monkeypatch):
    assert not (api.STATIC / "index.html").exists()
    dist = ambiente / "react-dist"
    dist.mkdir()
    react = '<div id="root"></div><script type="module" src="/assets/app.js"></script>'
    (dist / "index.html").write_text(react, encoding="utf-8")
    monkeypatch.setenv("STUDYHUB_UI_DIST", str(dist))

    assert client.get("/").text == react
    assert client.get("/legacy").text == react  # una rotta React qualsiasi: la vecchia UI non c'è più
    assert client.get("/api/version").json() == {"ui": str(int((dist / "index.html").stat().st_mtime))}


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
