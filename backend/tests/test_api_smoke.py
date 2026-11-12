"""Ogni GET con id inesistente su un database vuoto deve rispondere 404/200, mai 500."""
import pytest
from fastapi.testclient import TestClient

GET = [
    "/api/courses", "/api/courses/999", "/api/courses/999/lectures", "/api/courses/999/notes-index",
    "/api/lectures/999", "/api/lectures/999/notes", "/api/lectures/999/quizzes", "/api/lectures/999/topics",
    "/api/storage", "/api/search?q=ciao", "/api/docs/999", "/api/docs/999/file", "/api/docs/999/page/1.png",
    "/api/ai/status", "/api/flashcards/due", "/api/flashcards/anki.tsv", "/api/tutor/threads",
    "/api/tutor/threads/999", "/api/quizzes/999", "/api/plan", "/api/courses/999/exam", "/api/sims/999",
    "/api/feed", "/api/study", "/api/study/999", "/api/study/999/scan", "/api/study/sessions/999",
    "/api/study/999/chapters/excluded", "/api/study/topics/999", "/api/study/topics/999/lesson?prepare=false",
    "/api/courses/999/archetype", "/api/courses/999/moodle-strategy", "/api/study/topics/999/artifact",
    "/api/study/topics/999/script.m", "/api/lectures/999/notes.pdf", "/api/courses/999/dispensa.pdf",
    "/api/notifications", "/api/fullrun",
]


@pytest.fixture
def client(ambiente, monkeypatch):
    import numpy as np
    # Niente Ollama vero: la ricerca semantica riceve un vettore finto (cosi' si prova anche l'archivio vettoriale)
    monkeypatch.setattr("studyhub.search.embed_query", lambda q: np.ones(1024, np.float32) / 32)
    from studyhub.api.app import app
    return TestClient(app, raise_server_exceptions=False)


@pytest.mark.parametrize("url", GET)
def test_get_senza_dati_non_da_500(client, url):
    r = client.get(url)
    assert r.status_code < 500, f"{url} -> {r.status_code}: {r.text[:200]}"


POST = [
    ("/api/tutor/threads/999/ask", {"question": "x"}),
    ("/api/quizzes/999/submit", {"answers": []}),
    ("/api/exams", {"course_id": 999, "date": "2026-12-01"}),
    ("/api/sims/999/submit", {"answers": []}),
    ("/api/study/999/prepare", None),
    ("/api/study/sessions/999/answer", {"idx": 0, "choice": 1}),
    ("/api/study/sessions/999/reveal/0", None),
    ("/api/study/sessions/999/finish", None),
    ("/api/study/topics/999/ask", {"question": "x"}),
]


@pytest.mark.parametrize("url,body", POST)
def test_post_su_id_inesistente_e_404_non_500(client, url, body):
    r = client.post(url, json=body) if body is not None else client.post(url)
    assert r.status_code == 404, f"{url} -> {r.status_code}: {r.text[:200]}"


def test_esame_non_viene_creato_per_un_corso_inesistente(client):
    client.post("/api/exams", json={"course_id": 999, "date": "2026-12-01"})
    from studyhub.db import session
    with session() as d:
        assert d.execute("SELECT COUNT(*) FROM exams").fetchone()[0] == 0


def test_indice_domanda_fuori_range_o_negativo_e_400(client, ambiente):
    from conftest import inserisci_corso
    from studyhub.db import session
    with session() as d:
        inserisci_corso(d)
        d.execute("INSERT INTO study_sessions (id, course_id, started_at, queue) VALUES (1, 1, 'x', ?)",
                  ('{"entries": [{"t": "domanda", "item": 1}], "snapshot": {}}',))
    for idx in (5, -1):
        assert client.post(f"/api/study/sessions/1/reveal/{idx}").status_code == 400
        assert client.post("/api/study/sessions/1/answer", json={"idx": idx, "choice": 0}).status_code == 400
