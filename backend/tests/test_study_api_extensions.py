"""Contratti API per setup, lezioni, quaderno e flashcard."""
from __future__ import annotations

import json
from importlib import import_module
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient

from conftest import inserisci_corso
from studyhub import doctor, fullrun, search
from studyhub.study import lesson, quiz
from studyhub.sync import auth, catalog, moodle

api = import_module("studyhub.api.app")


def test_setup_limita_per_endpoint_e_risponde_429_con_retry_after(ambiente, monkeypatch):
    clock = [100.0]
    monkeypatch.setattr(api, "monotonic", lambda: clock[0])
    monkeypatch.setattr(api, "_setup_rate_limit", {})
    monkeypatch.setattr(api, "_login_proc", None)
    popen = Mock(return_value=SimpleNamespace(poll=lambda: None))
    monkeypatch.setattr(api.subprocess, "Popen", popen)
    monkeypatch.setattr(doctor, "checks", lambda: [])
    monkeypatch.setattr(fullrun, "is_running", lambda: True)
    monkeypatch.setattr(auth, "get_session", lambda **kwargs: object())
    monkeypatch.setattr(moodle, "Moodle", lambda _: SimpleNamespace(close=lambda: None))
    monkeypatch.setattr(catalog, "refresh_catalog", lambda _: [{"attivo": True}])
    raw = TestClient(api.app, raise_server_exceptions=False)
    headers = {"Authorization": "Bearer test-api-token-12345", "Origin": "http://127.0.0.1:5173"}
    login = "/api/setup/login"
    assert raw.post(login).status_code == 401
    assert raw.post(login, headers=headers).status_code == 200
    assert raw.post("/api/setup/courses", headers=headers).json() == {"courses": 1, "active": 1}
    assert raw.post("/api/setup/fullrun", headers=headers).status_code == 200
    limited = raw.post(login, headers={**headers, "X-Forwarded-For": "192.0.2.7"})
    assert limited.status_code == 429
    assert limited.headers["Retry-After"] == "60"
    assert "Retry-After" in limited.headers["Access-Control-Expose-Headers"]
    assert "detail" in limited.json()
    assert raw.get("/api/setup", headers=headers).status_code == 200
    clock[0] += 59.2
    assert raw.post(login, headers=headers).headers["Retry-After"] == "1"
    clock[0] += 0.8
    assert raw.post(login, headers=headers).status_code == 200
    popen.assert_called_once()


def test_lezione_richiede_auth_e_csrf_per_le_scritture(ambiente, db, monkeypatch):
    inserisci_corso(db)
    db.execute("INSERT INTO study_topics (id, course_id, name) VALUES (1, 1, 'Laplace')")
    db.commit()
    enqueue = Mock()
    complete = Mock()
    monkeypatch.setattr(lesson, "request", enqueue)
    monkeypatch.setattr(lesson, "complete", complete)
    raw = TestClient(api.app)
    path = "/api/study/topics/1/lesson"
    assert raw.get(path).status_code == 401
    assert raw.post(path + "/done").status_code == 401
    csrf = raw.get("/api/csrf").json()["csrf_token"]
    assert raw.get(path).status_code == 403
    assert raw.get(path, headers={"Sec-Fetch-Site": "cross-site"}).status_code == 403
    assert raw.get(path, params={"prepare": "false"}).status_code == 200
    assert raw.post(path + "/done").status_code == 403
    enqueue.assert_not_called()
    complete.assert_not_called()
    assert raw.get(path, headers={"Sec-Fetch-Site": "same-origin"}).status_code == 200
    enqueue.assert_called_once_with([1])
    assert raw.post(path + "/done", headers={"X-CSRF-Token": csrf}).json() == {"ok": True}
    complete.assert_called_once_with(1)


@pytest.mark.parametrize(("query", "body", "count"), [
    ("", None, 10), ("?n=7", None, 7), ("", {"n": 13}, 13),
    ("?n=2", {"n": 15}, 4), ("", {"n": 99}, 20),
])
def test_quiz_n_da_query_o_json(client, monkeypatch, query, body, count):
    generate = Mock(return_value={"ok": True})
    monkeypatch.setattr(quiz, "generate", generate)
    assert client.post("/api/lectures/17/quiz" + query, json=body).status_code == 200
    generate.assert_called_once_with(17, count)


@pytest.fixture
def sources(db):
    inserisci_corso(db, 1, nome="Algebra", year_of_study=2)
    inserisci_corso(db, 2, nome="Fisica", year_of_study=3)
    db.execute("INSERT INTO lectures (id, course_id, title, folder) VALUES (10, 1, 'Laplace', 'video')")
    db.execute("INSERT INTO study_topics (id, course_id, name) VALUES (20, 1, 'Laplace')")
    db.executemany(
        "INSERT INTO documents (id, course_id, path, kind, sha256, title, lecture_id) VALUES (?, 1, ?, ?, ?, ?, ?)",
        [(30, "trascrizione.txt", "transcript", "h1", "Trascrizione", 10),
         (31, "dispensa.pdf", "pdf", "h2", "Dispensa", None)],
    )
    db.commit()


def test_ricerca_restituisce_tipo_e_link_precisi(client, db, sources, monkeypatch):
    monkeypatch.setattr(search.vectors, "knn", lambda *args: [])
    db.executemany(
        """INSERT INTO chunks (id, course_id, doc_id, kind, page, t_start, text)
           VALUES (?, 1, ?, ?, ?, ?, ?)""",
        [(1, 30, "transcript", None, 125.5, "Trasformata di Laplace"),
         (2, 31, "pdf", 7, None, "Proprietà di Laplace")],
    )
    db.commit()
    results = client.get("/api/search", params={"q": "laplace", "year": 2}).json()["results"]
    assert {r["type"]: r["url_hint"] for r in results} == {
        "lecture": "/api/lectures/10?t=125.5", "document": "/api/docs/31/file#page=7",
    }
    assert all(r["kind"] and r["snippet"] for r in results)
    assert client.get("/api/search", params={"q": "laplace", "year": 99}).json()["results"] == []


def test_note_crud_ricerca_e_indice_si_aggiornano(client, sources, monkeypatch):
    monkeypatch.setattr(search.vectors, "knn", lambda *args: [])
    body = {"course_id": 1, "lecture_id": 10, "topic_id": 20, "timestamp_s": 0,
            "body": "Regola di Laplace: $sF(s)-f(0)$", "tags": ["Trasformate", "esame"]}
    invalid = client.post("/api/notes", json={**body, "course_id": 2})
    assert invalid.status_code == 400
    response = client.post("/api/notes", json=body)
    assert response.status_code == 201
    note = response.json()
    path = f"/api/notes/{note['id']}"
    assert client.get(path).json()["body"] == body["body"]
    filters = {"course_id": 1, "lecture_id": 10, "topic_id": 20, "q": "laplac", "tag": "esame"}
    assert client.get("/api/notes", params=filters).json()["notes"] == [note]
    assert client.get("/api/notes", params={**filters, "course_id": 2}).json()["notes"] == []
    assert client.get("/api/notes", params={**filters, "tag": "esam"}).json()["notes"] == []
    result = client.get("/api/search", params={"q": "trasformate"}).json()["results"][0]
    assert result["type"] == "note" and result["note_id"] == note["id"]
    assert result["url_hint"] == "/api/lectures/10?t=0"
    assert search.search("trasformate", semantic=False)["results"] == []
    edited = client.patch(path, json={
        "body": "Residui", "tags": [], "lecture_id": None, "timestamp_s": None, "doc_id": 31, "page": 7,
    }).json()
    assert edited["created_at"] == note["created_at"] and edited["updated_at"] >= note["updated_at"]
    assert edited["tags"] == []
    assert client.get("/api/search", params={"q": "trasformate"}).json()["results"] == []
    results = client.get("/api/search", params={"q": "residui"}).json()["results"]
    assert [row["url_hint"] for row in results] == ["/api/docs/31/file#page=7"]
    assert client.delete(path).status_code == 204
    assert client.get(path).status_code == 404
    assert client.get("/api/search", params={"q": "residui"}).json()["results"] == []


def test_flashcard_manuale_crud_sospensione_e_fsrs(client, db, sources):
    body = {"course_id": 1, "front": "Quanto vale la trasformata?", "back": "$1/s$", "doc_id": 31, "page": 7}
    assert client.post("/api/flashcards", json={**body, "course_id": 2}).status_code == 400
    response = client.post("/api/flashcards", json=body)
    assert response.status_code == 201
    card = response.json()
    card_id = card["id"]
    path = f"/api/flashcards/{card_id}"
    assert card["origin"] == "manuale" and card["url_hint"] == "/api/docs/31/file#page=7"
    assert client.get(path).json() == card
    assert client.get("/api/flashcards", params={"origin": "manuale"}).json()["cards"] == [card]
    assert [row["id"] for row in client.get("/api/flashcards/due").json()["cards"]] == [card_id]
    assert client.patch(path, json={"suspended": True}).json()["suspended"] is True
    assert client.get("/api/flashcards/due").json()["cards"] == []
    assert client.post(path + "/review", json={"rating": 3}).status_code == 409
    assert client.patch(path, json={"suspended": False}).json()["suspended"] is False
    review = client.post(path + "/review", json={"rating": 3})
    assert review.status_code == 200
    before = db.execute("SELECT fsrs FROM flashcards WHERE id=?", (card_id,)).fetchone()[0]
    updated = client.patch(path, json={"back": "Modificata", "doc_id": None, "page": None,
                                       "lecture_id": 10, "t_start": 120}).json()
    assert updated["due"] == review.json()["due"] and updated["url_hint"] == "/api/lectures/10?t=120"
    assert db.execute("SELECT fsrs FROM flashcards WHERE id=?", (card_id,)).fetchone()[0] == before
    db.execute("UPDATE flashcards SET t_start='tempo sconosciuto' WHERE id=?", (card_id,))
    db.commit()
    assert client.get(path).json()["url_hint"] == "/api/lectures/10"
    assert client.delete(path).status_code == 204
    assert db.execute("SELECT COUNT(*) FROM reviews WHERE card_id=?", (card_id,)).fetchone()[0] == 0
    assert client.get(path).status_code == 404


def test_flashcard_da_errore_usa_esito_salvato_e_fonte(client, db, sources):
    db.execute("INSERT INTO study_units(id, course_id, kind, ref_id) VALUES (1, 1, 'documento', 31)")
    db.execute(
        """INSERT INTO study_items(id, course_id, unit_id, topic_id, kind, prompt_md, correct, answer_md, doc_id, page)
           VALUES (1, 1, 1, 20, 'vero_falso', 'È vero?', 1, 'Sì', 31, 7)""",
    )
    queue = {"entries": [{"t": "domanda", "item": 1}]}
    db.execute("INSERT INTO study_sessions (id, course_id, started_at, queue) VALUES (8, 1, ?, ?)",
               ("2026-11-25", json.dumps(queue)))
    db.commit()
    path = "/api/study/sessions/8"
    wrong = client.post(path + "/answer", json={"idx": 0, "choice": 0}).json()
    correct = client.post(path + "/answer", json={"idx": 1, "choice": 1}).json()
    errors = client.get(path).json()["errors"]
    attempt_id = wrong["attempt_id"]
    assert [row["attempt_id"] for row in errors] == [attempt_id]
    create = "/api/flashcards/from-error"
    assert client.post(create, json={"attempt_id": correct["attempt_id"]}).status_code == 400
    assert client.post(create, json={"attempt_id": 900}).status_code == 404
    card = client.post(create, json={"attempt_id": attempt_id}).json()
    assert card["origin"] == "errore" and card["front"] == "È vero?" and card["back"] == "Sì"
    assert card["url_hint"] == "/api/docs/31/file#page=7"
    assert client.post(create, json={"attempt_id": attempt_id}).json()["id"] == card["id"]
    assert client.get("/api/flashcards/due").json()["cards"][0]["id"] == card["id"]
    db.execute("UPDATE study_items SET page=0 WHERE id=1")
    legacy_attempt = db.execute(
        "INSERT INTO study_attempts(item_id, session_id, score, created_at) VALUES (1, 8, 0, '2026-11-24')",
    ).lastrowid
    db.commit()
    assert client.post(create, json={"attempt_id": legacy_attempt}).json()["url_hint"] == "/api/docs/31/file"
