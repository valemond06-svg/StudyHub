"""Persistenza e contratti di Pomodoro, piano, ripasso e diagnostica."""
from __future__ import annotations

import json
import shutil
import sqlite3
from contextlib import closing
from datetime import date, datetime, time, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import Mock

import httpx
import pytest
from fsrs import Card

from conftest import inserisci_corso
from studyhub import backup
from studyhub.ai import claude_runner, health, llm
from studyhub.db import MIGRATIONS, session
from studyhub.media import panopto
from studyhub.study import flashcards, focus
from studyhub.sync import auth


def test_migrazione_incrementale_conserva_fsrs_e_indicizza_note(ambiente):
    old_version = 15
    original = Card().to_json()
    with closing(sqlite3.connect(ambiente / "test.db")) as db:
        for sql in MIGRATIONS[:old_version]:
            db.executescript(sql)
        db.execute(f"PRAGMA user_version={old_version}")
        inserisci_corso(db)
        db.execute("INSERT INTO flashcards(id, course_id, front, back, fsrs, due) VALUES (1, 1, 'D', 'R', ?, ?)",
                   (original, "2026-11-25T00:00:00+00:00"))
        db.execute("INSERT INTO reviews(card_id, rating, reviewed_at) VALUES (1, 3, '2026-11-24')")
        db.executemany("INSERT INTO study_sessions(course_id, started_at, ended_at, queue) VALUES (1, ?, ?, ?)", [
            ("2026-11-24T09:00:00", "2026-11-24T09:25:00", '{"entries": []}'),
            ("2026-11-24T11:00:00", None, '{"entries": []}'),
        ])
        db.commit()

    with session() as db:
        assert db.execute("PRAGMA user_version").fetchone()[0] == len(MIGRATIONS)
        assert tuple(db.execute("SELECT fsrs, doc_id, page, attempt_id FROM flashcards WHERE id=1").fetchone()) == (
            original, None, None, None,
        )
        assert db.execute("SELECT rating FROM reviews WHERE card_id=1").fetchone()[0] == 3
        assert [row[0] for row in db.execute("SELECT status FROM study_sessions ORDER BY id")] == ["completata", "aperta"]
        assert not db.execute("PRAGMA foreign_key_check").fetchall()
        db.execute("""INSERT INTO notes(course_id, body, created_at, updated_at)
                      VALUES (1, 'Integrali', '2026-11-25', '2026-11-25')""")
        db.execute("""INSERT INTO focus_sessions(course_id, started_at, planned_seconds, ends_at, kind)
                      VALUES (1, '2026-11-25T00:00:00+00:00', 60, '2026-11-25T00:01:00+00:00', 'focus')""")
        db.execute("INSERT INTO availability VALUES (1, '[1,1,1,1,1,0,0]', '[]')")
    with session() as db:
        assert db.execute("SELECT COUNT(*) FROM notes_fts WHERE notes_fts MATCH 'integrali'").fetchone()[0] == 1
        assert db.execute("SELECT COUNT(*) FROM focus_sessions").fetchone()[0] == 1
        assert db.execute("SELECT id FROM availability").fetchone()[0] == 1


def test_focus_usa_orologio_server_e_stop_idempotente(client, db, monkeypatch):
    inserisci_corso(db)
    inserisci_corso(db, 2)
    db.commit()
    day = date(2026, 11, 25)
    started = datetime.combine(day, time(23, 59, 30)).astimezone(timezone.utc)
    clock = [started]
    monkeypatch.setattr(focus, "_now", lambda: clock[0])
    body = {"course_id": 1, "task": "Esercizi sui residui", "planned_seconds": 90, "kind": "focus"}
    assert client.post("/api/focus/start", json={**body, "started_at": "2000-01-01"}).status_code == 422
    response = client.post("/api/focus/start", json=body)
    assert response.status_code == 201
    active = response.json()
    assert active["started_at"] == started.isoformat() and active["actual_seconds"] == 0
    assert client.post("/api/focus/start", json={**body, "course_id": 2}).status_code == 409
    clock[0] += timedelta(seconds=45)
    assert client.get("/api/focus").json()["sessions"][0]["actual_seconds"] == 45
    path = f"/api/focus/{active['id']}/stop"
    stopped = client.post(path).json()
    assert stopped["actual_seconds"] == 45 and stopped["status"] == "stopped"
    clock[0] += timedelta(hours=1)
    assert client.post(path).json() == stopped
    next_day = day + timedelta(days=1)
    assert client.get("/api/focus/summary", params={"day": day, "course_id": 1}).json()["focus_seconds"] == 30
    assert client.get("/api/focus/summary", params={"day": next_day, "course_id": 1}).json()["focus_seconds"] == 15
    assert client.get("/api/focus", params={"day": next_day, "course_id": 2}).json()["sessions"] == []
    assert client.get("/api/focus", params={"day": next_day, "course_id": 1}).json()["sessions"] == [stopped]


def test_focus_pausa_scaduta_libera_il_timer(client, db, monkeypatch):
    inserisci_corso(db)
    db.commit()
    now = datetime.now(timezone.utc).replace(microsecond=0)
    clock = [now]
    monkeypatch.setattr(focus, "_now", lambda: clock[0])
    payload = {"course_id": 1, "planned_seconds": 60, "kind": "pausa"}
    first = client.post("/api/focus/start", json=payload).json()
    clock[0] += timedelta(minutes=20)
    summary = client.get("/api/focus/summary", params={"day": now.astimezone().date()}).json()
    expected = min(60, int((datetime.combine(now.astimezone().date() + timedelta(days=1), time.min)
                           .astimezone(timezone.utc) - now).total_seconds()))
    assert summary["break_seconds"] == expected
    second = client.post("/api/focus/start", json=payload)
    assert second.status_code == 201 and second.json()["id"] != first["id"]
    old = client.post(f"/api/focus/{first['id']}/stop").json()
    assert old["stopped_at"] == first["ends_at"] and old["actual_seconds"] == 60


def test_piano_usa_disponibilita_appelli_e_padronanza(client, db):
    today = date.today()
    exam_day = today + timedelta(days=6)
    inserisci_corso(db, 1)
    inserisci_corso(db, 2, nome="Fisica")
    db.executemany(
        "INSERT INTO study_topics(id, course_id, name, weight, hidden) VALUES (?, 1, ?, ?, ?)",
        [(1, "Residui", 3, 0), (2, "Trasformate", 2, 0), (3, "Escluso", 3, 1)],
    )
    db.execute("INSERT INTO study_units(id, course_id, kind, ref_id) VALUES (1, 1, 'documento', 1)")
    reviewed = datetime.combine(today, time.min).astimezone(timezone.utc)
    fsrs = Card(stability=1000.0, difficulty=2.0, last_review=reviewed, due=reviewed)
    db.execute(
        """INSERT INTO study_items(id, course_id, unit_id, topic_id, kind, prompt_md, answer_md, fsrs, due)
           VALUES (2, 1, 1, 2, 'esercizio', 'D', 'R', ?, ?)""", (fsrs.to_json(), reviewed.isoformat()),
    )
    db.execute("INSERT INTO study_attempts(item_id, score, created_at) VALUES (2, 1, ?)", (reviewed.isoformat(),))
    db.executemany(
        "INSERT INTO exams (id, course_id, date, kind, done) VALUES (?, ?, ?, ?, ?)",
        [(1, 1, exam_day.isoformat(), "scritto", 0), (2, 2, exam_day.isoformat(), "orale", 0),
         (3, 2, today.isoformat(), "scritto", 1)],
    )
    db.commit()
    unavailable = today + timedelta(days=2)
    settings = {"hours_by_weekday": [2] * 7, "days_off": [unavailable.isoformat()]}
    assert client.put("/api/settings/availability", json=settings).status_code == 200
    assert client.get("/api/settings/availability").json() == settings
    assert client.put("/api/settings/availability", json={"hours_by_weekday": [2] * 6}).status_code == 422
    params = {"start": today.isoformat()}
    plan = client.get("/api/plan/week", params=params).json()
    assert plan == client.get("/api/plan/week", params=params).json()
    assert [exam["id"] for exam in plan["exams"]] == [1, 2]
    assert len(plan["days"]) == 7 and plan["days"][2]["available_minutes"] == 0
    blocks = [block for day in plan["days"] for block in day["blocks"]]
    assert {block["kind"] for block in blocks} == {"theory", "exercises", "simulation", "fsrs"}
    assert all(b["day"] < exam_day.isoformat() for b in blocks)
    assert {b["topic_id"] for b in blocks if b["topic_id"] is not None} == {1}
    assert all(day["planned_minutes"] <= day["available_minutes"] for day in plan["days"])
    assert {b["course_id"]: b["minutes"] for b in blocks if b["kind"] == "simulation"} == {1: 60, 2: 30}


def test_piano_ricalcola_slittamento_e_carenza_di_slot(client, db):
    today = date.today()
    inserisci_corso(db)
    db.execute("INSERT INTO exams(id, course_id, date) VALUES (1, 1, ?)", ((today + timedelta(days=6)).isoformat(),))
    db.commit()
    client.put("/api/settings/availability", json={"hours_by_weekday": [2] * 7})
    week = client.get("/api/plan/week").json()
    theory = next(block for day in week["days"] for block in day["blocks"] if block["kind"] == "theory")
    current_day = theory["day"]
    changed = client.post("/api/plan/recompute", json={"missed_day": current_day}).json()
    assert changed == client.get("/api/plan/week", params={"missed_day": current_day}).json()
    assert changed["changes"][0]["block_id"] == theory["id"]
    assert changed["changes"][0]["to_day"] > current_day
    assert next(row for row in changed["days"] if row["day"] == current_day)["blocks"] == []
    fsrs = next(block for day in week["days"] for block in day["blocks"] if block["kind"] == "fsrs")
    changed = client.post("/api/plan/recompute", json={"missed_day": fsrs["day"]}).json()
    assert changed["changes"][0]["to_day"] is None
    assert changed["changes"][0]["reason"] == "no_slot_before_exam"
    assert fsrs["id"] in {row["id"] for row in changed["unscheduled"]}


def test_review_today_stima_e_distribuisce_arretrato_e_carte_nuove(client, db):
    now = datetime.now(timezone.utc).replace(microsecond=0)
    old = now - timedelta(days=4)
    inserisci_corso(db)
    inserisci_corso(db, 2)
    cards = [(1, 1, now, 0), (2, 1, old, 0), (3, 1, old, 0), (4, 1, old, 0), (5, 1, old, 0),
             (6, 1, old, 0), (7, 1, old, 1), (8, 2, old, 0), (9, 1, now + timedelta(days=4), 0)]
    db.executemany(
        "INSERT INTO flashcards(id, course_id, front, back, fsrs, due, suspended) VALUES (?, ?, 'D', 'R', '{}', ?, ?)",
        [(ident, cid, flashcards._iso(due), suspended) for ident, cid, due, suspended in cards],
    )
    db.executemany(
        "INSERT INTO reviews (card_id, rating, reviewed_at) VALUES (?, 3, ?)",
        [(ident, flashcards._iso(old)) for ident in (1, 2, 3, 7, 8, 9)],
    )
    db.commit()
    review = client.get("/api/review/today", params={"course_id": 1, "daily_backlog": 1, "daily_new": 2}).json()
    assert (review["due_count"], review["new_count"], review["overdue_count"], review["estimated_minutes"]) == (6, 3, 5, 2)
    assert [(card["id"], card["review_bucket"]) for card in review["cards"]] == [
        (1, "scheduled"), (2, "backlog"), (3, "backlog"), (4, "new"), (5, "new"), (6, "new"),
    ]
    assert review["proposal"] == {
        "scheduled_today": 1, "backlog_today": 1, "new_today": 2, "estimated_minutes": 2,
        "remaining_backlog": 1, "remaining_new": 1, "remaining_days": 1,
    }


def test_system_status_distingue_errori_reali_e_non_espone_segreti(client, db, monkeypatch, ambiente):
    marker = "SYNTHETIC-SECRET-DO-NOT-RETURN"
    delivery_id = "db55cb86-cd19-4a03-80c5-1dbaf5a228d2"
    inserisci_corso(db)
    db.execute("INSERT INTO lectures(course_id, title, folder, panopto_id) VALUES (1, 'L', 'video', ?)", (delivery_id,))
    db.execute("""INSERT INTO sync_runs (course_id, finished_at, new_files, updated_files, errors)
                  VALUES (1, '2026-11-25T12:00:00', 3, 2, ?)""", (json.dumps([marker]),))
    db.execute("""INSERT INTO ai_jobs (kind, target_id, status, message, finished_at)
                  VALUES ('lecture_notes', 1, 'errore', ?, '2026-11-25T12:00:00')""",
               ("Claude Code subscription rejected: payment past due " + marker,))
    db.commit()
    health.record("gemini", health.classify("Gemini: 429 quota; token=" + marker))

    monkeypatch.setattr(llm, "local_llm_healthy", lambda: ["http://user:" + marker + "@localhost"])
    monkeypatch.setattr(llm, "_agy_exe", lambda: marker)
    monkeypatch.setattr(claude_runner, "_claude_exe", lambda: marker)
    monkeypatch.setattr(claude_runner, "last_usage", lambda: {"status": "rejected", "resets_at": 2_000_000_000})
    monkeypatch.setattr(auth, "_load_session", lambda: {"cookies": {"MoodleSession": marker}})
    check_web = Mock(return_value=False)
    check_token = Mock(return_value=True)
    monkeypatch.setattr(auth, "_session_valid", check_web)
    monkeypatch.setattr(auth, "_load_token", lambda: marker)
    monkeypatch.setattr(auth, "_token_probe", check_token)
    monkeypatch.setattr(panopto, "_keyring_get", lambda *_: json.dumps({".ASPXAUTH": marker}))
    check_panopto = Mock(return_value=httpx.Response(200, json={"LoginRedirect": marker},
                                                   request=httpx.Request("POST", "https://example.test")))
    monkeypatch.setattr(panopto.Panopto, "_delivery_request", check_panopto)
    repo = ambiente / "repo"
    repo.mkdir()
    (repo / "config").touch()
    password = ambiente / "test-password"
    password.touch()
    monkeypatch.setattr(backup, "REPOS", {"local": str(repo)})
    monkeypatch.setattr(backup, "PASS_FILE", password)
    monkeypatch.setattr(shutil, "disk_usage", lambda _: SimpleNamespace(free=900, total=1000))
    run_restic = Mock(return_value=SimpleNamespace(returncode=0, stdout='{"total_size": 77}', stderr=marker))
    monkeypatch.setattr(backup, "_run", run_restic)

    response = client.get("/api/system/status")
    assert response.status_code == 200
    assert marker not in response.text and response.headers["Cache-Control"] == "no-store"
    result = response.json()
    assert {name: data["status"] for name, data in result["providers"].items()} == {
        "local": "available", "gemini": "quota_exceeded", "claude": "subscription_rejected",
    }
    assert result["login"] == {"moodle": {"status": "token_only"}, "panopto": {"status": "expired"}}
    assert result["last_sync"] == {
        "course_id": 1, "finished_at": "2026-11-25T12:00:00", "new_files": 3, "updated_files": 2, "error_count": 1,
    }
    assert result["restic"] == {"status": "available", "repository_bytes": 77, "free_bytes": 900, "capacity_bytes": 1000}
    check_web.assert_called_once()
    check_token.assert_called_once_with(marker, 3)
    check_panopto.assert_called_once_with(delivery_id, refresh=False, timeout=3, follow_redirects=False)
    run_restic.assert_called_once_with(["--no-lock", "stats", "--mode", "raw-data", "--json"],
                                     str(repo), 4, create_password=False)


def test_diagnostica_cloud_registra_errore_e_ripresa_di_gemini(client, monkeypatch):
    monkeypatch.setattr(llm, "_agy_exe", lambda: "agy")
    monkeypatch.setattr(llm, "local_llm_healthy", lambda: [])
    monkeypatch.setattr(auth, "login_status", lambda: "missing")
    monkeypatch.setattr(panopto, "login_status", lambda _: "missing")
    monkeypatch.setattr(backup, "repository_space", lambda: {"status": "not_configured"})
    monkeypatch.setattr(claude_runner, "last_usage", lambda: {})
    gemini = Mock(side_effect=[claude_runner.RateLimited("quota"), SimpleNamespace(data={})])
    monkeypatch.setattr(llm, "_gemini_request", gemini)
    def get_gemini():
        return client.get("/api/system/status").json()["providers"]["gemini"]

    assert get_gemini()["status"] == "unverified"
    with pytest.raises(claude_runner.RateLimited):
        llm._gemini("Rispondi in JSON", "Esempio", {}, "veloce")
    assert get_gemini()["status"] == "quota_exceeded"
    llm._gemini("Rispondi in JSON", "Esempio", {}, "veloce")
    assert get_gemini()["status"] == "available"
