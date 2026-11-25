import json
from datetime import date, datetime, timedelta, timezone
from threading import Event
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient

from conftest import inserisci_corso
from studyhub.ai import jobs
from studyhub.ai.claude_runner import ClaudeError
from studyhub.api import app as api
from studyhub.db import session
from studyhub.study import lesson, planner
from studyhub.study import session as study_session


def _insert_session(db, entries, course=1, started_at=None):
    started_at = started_at or datetime.now().isoformat(timespec="seconds")
    return db.execute("INSERT INTO study_sessions (course_id, started_at, queue) VALUES (?, ?, ?)",
                      (course, started_at, json.dumps({"entries": entries}))).lastrowid


@pytest.fixture
def session_data(db):
    inserisci_corso(db)
    db.execute("INSERT INTO study_topics (id, course_id, name) VALUES (1, 1, 'Laplace')")
    db.execute("INSERT INTO study_topics (id, course_id, name) VALUES (2, 1, 'Fourier')")
    db.execute("INSERT INTO study_units (id, course_id, kind, ref_id) VALUES (1, 1, 'documento', 1)")
    db.execute("""INSERT INTO study_items (id, course_id, unit_id, topic_id, kind, difficulty, prompt_md, answer_md)
                  VALUES (1, 1, 1, 1, 'aperta', 2, 'Domanda', 'Soluzione')""")
    sid = _insert_session(db, [{"t": "scheda", "topic": 1}, {"t": "scheda", "topic": 2}, {"t": "domanda", "item": 1}])
    db.commit()
    return sid, f"/api/study/sessions/{sid}"


def test_sessione_aperta_recupera_ultima_per_corso_e_consente_abbandono(client, db, session_data):
    sid, url = session_data
    other = inserisci_corso(db, cid=2)
    newest = _insert_session(db, [], started_at="2099-01-01T12:00:00")
    _insert_session(db, [], course=other, started_at="2099-01-02T12:00:00")
    db.commit()

    path = "/api/study/1/sessions/open"
    assert client.get(path).json()["id"] == newest
    assert client.post(f"/api/study/sessions/{newest}/abandon").json()["status"] == "abbandonata"
    assert client.get(path).json()["id"] == sid
    abandoned = client.post(f"{url}/abandon").json()
    assert abandoned["status"] == abandoned["phase"] == "abbandonata"
    assert abandoned["ended_at"] and abandoned["resume_index"] is None
    assert client.post(f"{url}/abandon").json() == abandoned
    assert client.post(f"{url}/finish").status_code == 409
    assert client.get(path).status_code == 404


def test_scheda_letta_e_completamento_senza_lezione_generata(client, db, session_data, monkeypatch):
    _, url = session_data
    assert client.get(url).json()["resume_index"] == 0
    assert client.post(f"{url}/seen/2").status_code == 400
    for _ in range(2):
        assert client.post(f"{url}/seen/0").json() == {"ok": True, "done": True}
    assert client.get(url).json()["resume_index"] == 1

    monkeypatch.setattr(lesson, "_now", lambda: "2026-11-25T12:00:00")
    path = "/api/study/topics/2/lesson"
    assert client.post(path + "/done").status_code == 200
    monkeypatch.setattr(lesson, "_now", lambda: "2026-11-25T12:10:00")
    assert client.post(path + "/done").status_code == 200
    doc = client.get(path).json()
    assert doc["status"] == "da preparare" and doc["completed_at"] == "2026-11-25T12:00:00"
    assert client.get(url).json()["resume_index"] == 2
    assert client.post(url + "/finish").json()["answered"] == 0
    assert client.post(url + "/abandon").json()["status"] == "completata"


def test_sessione_con_domanda_sostituita_si_puo_recuperare_e_abbandonare(client, db, session_data):
    _, url = session_data
    db.execute("DELETE FROM study_items WHERE id=1")
    db.commit()
    assert client.post(url + "/seen/0").status_code == 200
    assert client.post(url + "/seen/1").status_code == 200
    response = client.get("/api/study/1/sessions/open").json()
    assert response["entries"][2]["unavailable"] is True
    assert response["resume_index"] is None
    assert client.post(url + "/reveal/2").status_code == 400
    assert client.post(url + "/abandon").json()["status"] == "abbandonata"


@pytest.mark.parametrize("seconds_at_reveal", [None, 40.0])
def test_reveal_persiste_confidenza_e_separa_tempi(client, db, session_data, monkeypatch, seconds_at_reveal):
    _, url = session_data
    at = datetime(2026, 11, 25, 12, tzinfo=timezone.utc)
    clock = Mock(side_effect=[at, at + timedelta(seconds=10)])
    monkeypatch.setattr(study_session, "_utc_now", clock)
    assert client.post(url + "/seen/0").status_code == 200
    assert client.post(url + "/seen/1").status_code == 200
    body = {"confidence": 2, "seconds": seconds_at_reveal}
    assert client.post(url + "/reveal/2", json={"confidence": 4}).status_code == 422
    reveal = client.post(url + "/reveal/2", json=body).json()
    repeated = client.post(url + "/reveal/2", json={"confidence": 3, "seconds": 49}).json()
    assert repeated == reveal and reveal["confidence"] == 2
    restored = client.get(url).json()
    assert restored["phase"] == "rivelata"
    assert restored["entries"][2]["confidence"] == 2
    assert datetime.fromisoformat(restored["entries"][2]["revealed_at"]) == at
    answer = {"idx": 2, "confidence": 1, "self_score": 0.5, "seconds": 50}
    result = client.post(url + "/answer", json=answer).json()
    assert (result["seconds"], result["review_seconds"]) == (40, 10)
    attempt = db.execute("SELECT confidence, seconds, review_seconds FROM study_attempts WHERE id=?",
                         (result["attempt_id"],)).fetchone()
    assert tuple(attempt) == (2, 40, 10)


def test_correzione_ai_errore_in_italiano_e_tentativo_ripetibile(client, db, session_data, monkeypatch):
    _, url = session_data
    grade = Mock(side_effect=ClaudeError("Connection refused"))
    monkeypatch.setattr(study_session, "run_json", grade)
    assert client.post(url + "/reveal/2").status_code == 200
    answer = {"idx": 2, "text": "Tentativo", "seconds": 12}
    error = client.post(url + "/answer", json=answer)
    assert error.status_code == 502
    assert error.json()["detail"].startswith("La correzione AI non è disponibile.")
    assert db.execute("SELECT COUNT(*) FROM study_attempts").fetchone()[0] == 0
    grade.side_effect = None
    grade.return_value.data = {"punteggio": 1}
    result = client.post(url + "/answer", json=answer).json()
    assert (result["seconds"], result["review_seconds"]) == (12, None)


def test_scadenza_all_avvio_e_periodica_conserva_tentativi(ambiente, db, session_data, monkeypatch):
    sid, _ = session_data
    clock = [datetime.combine(date.today(), datetime.min.time()).astimezone() + timedelta(hours=23)]
    monkeypatch.setattr(study_session, "_utc_now", lambda: clock[0].astimezone(timezone.utc))
    monkeypatch.setattr(jobs, "start_if_needed", lambda: None)
    monkeypatch.setattr(api, "SESSION_CLEANUP_INTERVAL", 0.02)
    result = study_session.answer(sid, 2, {"self_score": 0.2})
    old = (clock[0] - timedelta(hours=12, seconds=1)).replace(tzinfo=None).isoformat()
    edge = (clock[0] - timedelta(hours=12)).replace(tzinfo=None).isoformat()
    db.execute("UPDATE study_sessions SET started_at=? WHERE id=?", (old, sid))
    next_sid = _insert_session(db, [], started_at=edge)
    finished_sid = _insert_session(db, [], started_at=old)
    db.commit()
    study_session.finish(finished_sid)

    expired = Event()
    original = study_session.abandon_expired

    def cleanup():
        closed = original()
        if study_session.get(next_sid)["status"] == "abbandonata":
            expired.set()
        return closed

    monkeypatch.setattr(study_session, "abandon_expired", cleanup)
    with TestClient(api.app):
        resumed = study_session.get(sid)
        assert resumed["status"] == "abbandonata" and resumed["ended_at"]
        assert resumed["errors"][0]["attempt_id"] == result["attempt_id"]
        assert study_session.get(next_sid)["status"] == "aperta"
        assert study_session.get(finished_sid)["status"] == "completata"
        clock[0] += timedelta(seconds=1)
        assert expired.wait(5)
    with session() as conn:
        assert conn.execute("SELECT session_id FROM study_attempts WHERE id=?", (result["attempt_id"],)).fetchone()[0] == sid
    assert planner.today_plan()["week_progress"]["tasks_completed"] == 1
