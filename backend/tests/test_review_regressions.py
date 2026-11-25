import json
import os
import shutil
import sqlite3
import subprocess
import sys
from contextlib import closing
from pathlib import Path
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient

from conftest import inserisci_corso
from studyhub import backup, config, db
from studyhub.ai import lecture_notes, llm
from studyhub.ai.claude_runner import ClaudeError
from studyhub.api.app import app
from studyhub.study import exam, tutor
from test_foto_correzione import _png, _sim, corso  # noqa: F401


def _committed_wal(path):
    conn = sqlite3.connect(path)
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA wal_autocheckpoint = 0")
    conn.execute("CREATE TABLE wal_example (value TEXT)")
    conn.commit()
    conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    conn.execute("INSERT INTO wal_example VALUES ('committed')")
    conn.commit()
    assert path.with_name(path.name + "-wal").stat().st_size > 0
    return conn


def test_connect_copies_legacy_wal_once_and_keeps_original(tmp_path, monkeypatch):
    old_dir = tmp_path / "old"
    old_dir.mkdir()
    old_path = old_dir / "studyhub.db"
    monkeypatch.setattr(config, "APP_DIR", old_dir)
    monkeypatch.setattr(config, "LOCAL_DIR", tmp_path / "new")
    with closing(_committed_wal(old_path)) as old:
        with db.session() as conn:
            assert conn.execute("SELECT value FROM wal_example").fetchone()[0] == "committed"
            conn.execute("UPDATE wal_example SET value = 'updated'")
        with db.session() as conn:
            assert conn.execute("SELECT value FROM wal_example").fetchone()[0] == "updated"
        assert old.execute("SELECT value FROM wal_example").fetchone()[0] == "committed"
    assert old_path.is_file()


def test_connect_creates_local_directory_without_legacy_db(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "APP_DIR", tmp_path / "old")
    monkeypatch.setattr(config, "LOCAL_DIR", tmp_path / "new")
    with db.session() as conn:
        assert conn.execute("PRAGMA user_version").fetchone()[0] == len(db.MIGRATIONS)
    assert config.settings.db_path.is_file()


@pytest.mark.parametrize("before_priority", [False, True], ids=["main", "older"])
def test_upgrade_reconciles_active_jobs_before_creating_unique_index(ambiente, before_priority):
    with closing(sqlite3.connect(config.settings.db_path)) as conn:
        migrations = db.MIGRATIONS[:]
        priority_index = next(i for i, sql in enumerate(migrations) if "ADD COLUMN priority" in sql)
        if before_priority:
            migrations = migrations[:priority_index]
        else:
            retry_index = next(i for i, sql in enumerate(migrations) if "ADD COLUMN next_retry_at" in sql)
            migrations = migrations[:retry_index + 1]
        for sql in migrations:
            conn.executescript(sql)
        conn.execute("DROP INDEX IF EXISTS idx_ai_jobs_unique")
        conn.execute(f"PRAGMA user_version = {len(migrations)}")
        conn.executemany(
            "INSERT INTO ai_jobs(id, kind, target_id, status) VALUES (?, ?, 1, ?)",
            [(1, "lecture_notes", "in_coda"), (2, "lecture_notes", "in_corso"),
             (3, "lecture_notes", "fatto"), (4, "ocr", "in_coda")],
        )
        if not before_priority:
            conn.execute("UPDATE ai_jobs SET priority = 10 WHERE id = 2")
        conn.commit()
    for _ in range(2):
        with db.session() as conn:
            rows = conn.execute("SELECT id, status, priority FROM ai_jobs ORDER BY id").fetchall()
            assert [tuple(row) for row in rows] == [
                (1, "annullato", 100), (2, "in_corso", 100), (3, "fatto", 100), (4, "in_coda", 100),
            ]
            with pytest.raises(sqlite3.IntegrityError):
                conn.execute("INSERT INTO ai_jobs(kind, target_id) VALUES ('lecture_notes', 1)")


def test_backup_passes_a_standalone_wal_snapshot_to_restic(ambiente, monkeypatch):
    path = config.settings.db_path
    monkeypatch.setattr(backup, "LOCAL_DIR", ambiente)
    monkeypatch.setattr(backup, "init_repo", Mock())
    paths = []

    def run(args, repo):
        if args[0] == "backup":
            snapshot = Path(args[1])
            assert snapshot != path
            paths.append(snapshot)
            copied = ambiente / "restored.db"
            shutil.copyfile(snapshot, copied)
            with closing(sqlite3.connect(copied)) as restored:
                assert restored.execute("SELECT value FROM wal_example").fetchone()[0] == "committed"
        return subprocess.CompletedProcess(args, 0, stdout="", stderr="")

    monkeypatch.setattr(backup, "_run", run)
    with closing(_committed_wal(path)):
        assert backup.backup(["local", "vps"])["local"]["ok"]
        assert len(paths) == 2 and paths[0] == paths[1]
        assert not paths[0].exists()
        monkeypatch.setattr(backup, "_run", Mock(side_effect=subprocess.TimeoutExpired("restic", 1)))
        with pytest.raises(subprocess.TimeoutExpired):
            backup.backup(["local"])
        assert not paths[0].exists()


def test_csrf_bootstrap_emits_one_cookie_and_enables_cookie_only_mutation(ambiente):
    with TestClient(app) as browser:
        response = browser.get("/api/csrf")
        token = response.json()["csrf_token"]
        cookies = [value for value in response.headers.get_list("set-cookie") if value.startswith("csrf_token=")]
        assert len(cookies) == 1
        assert browser.cookies["csrf_token"] == token
        assert browser.post("/api/ai/cancel", headers={"X-CSRF-Token": token}).status_code == 200
        again = browser.get("/api/csrf")
        assert again.json()["csrf_token"] == token
        assert not again.headers.get_list("set-cookie")


def test_static_ui_sends_csrf_header_on_post_and_delete(ambiente, monkeypatch):
    node = shutil.which("node")
    if node is None:
        pytest.skip("Node.js richiesto per eseguire il JavaScript servito da FastAPI")
    monkeypatch.setattr("studyhub.api.app._lecture", Mock())
    monkeypatch.setattr("studyhub.ai.jobs.enqueue", Mock(return_value=[1]))
    monkeypatch.setattr("studyhub.study.session.start", Mock(return_value={"id": 1}))
    monkeypatch.setattr(exam, "delete_exam", Mock())
    with TestClient(app) as browser:
        html = browser.get("/legacy").text
        helpers = html[html.index("const getJ ="):html.index("function find(arr")]
        delete_handlers = [line.strip() for line in html.splitlines()
                           if 'addEventListener("click"' in line and '$("exDel")?' in line
                           or 'querySelectorAll("[data-del]")' in line]
        assert len(delete_handlers) == 2
        program = f"""
const document = {{ cookie: "csrf_token={browser.cookies['csrf_token']}" }};
const requests = [];
const handlers = [];
const $ = () => ({{dataset: {{ex: 4}}, addEventListener: (_, fn) => handlers.push(fn)}});
const body = {{querySelectorAll: () => [{{dataset: {{del: 5}}, set onclick(fn) {{ handlers.push(fn); }}}}]}};
const cid = 1, loadStudyCourse = () => {{}}, loadToday = () => {{}};
async function fetch(url, options) {{
  requests.push([url, options]);
  return {{ok: true, json: async () => ({{}})}};
}}
{helpers}
{chr(10).join(delete_handlers)}
(async () => {{
  await postJ("/api/lectures/1/notes");
  await postJ("/api/study/1/sessions", {{minutes: 15}});
  for (const handler of handlers) await handler();
  console.log(JSON.stringify(requests));
}})().catch(error => {{ console.error(error); process.exitCode = 1; }});
"""
        result = subprocess.run([node], input=program, capture_output=True, text=True, check=True, timeout=15)
        requests = json.loads(result.stdout)
        assert len(requests) == 4
        for url, options in requests:
            response = browser.request(options["method"], url, headers=options["headers"],
                                       content=options.get("body"))
            assert response.status_code == 200, (url, response.text)


@pytest.mark.parametrize("request_body", [{}, {"json": {"count": 1}}], ids=["no-body", "with-body"])
def test_simulation_endpoint_calls_the_single_simulation_generator(client, monkeypatch, request_body):
    def generate(course_id):
        return {"course_id": course_id, "id": 14}

    monkeypatch.setattr(exam, "generate_sim", generate)
    response = client.post("/api/courses/3/exam/sims", **request_body)
    assert response.status_code == 200
    assert response.json() == {"course_id": 3, "id": 14}


def test_tutor_course_filter_applies_before_thread_limit(client, db):
    inserisci_corso(db, 1)
    inserisci_corso(db, 2)
    db.commit()
    wanted = tutor.new_thread(1)
    for _ in range(30):
        tutor.new_thread(2)
    response = client.get("/api/tutor/threads?course_id=1")
    assert response.status_code == 200
    assert [thread["id"] for thread in response.json()] == [wanted]
    assert len(client.get("/api/tutor/threads").json()) == 30


@pytest.mark.parametrize("mode", ["local_only", "strict"])
def test_lecture_notes_privacy_blocks_external_transcript(ambiente, monkeypatch, mode):
    monkeypatch.setenv("STUDYHUB_PRIVACY_MODE", mode)
    monkeypatch.setattr(lecture_notes, "build_input", lambda _: (
        {}, [{"type": "text", "text": "Spiegazione delle derivate."}], [], "hash",
    ))
    monkeypatch.setattr(llm, "provider_order", lambda: ["claude"])
    external = Mock(side_effect=AssertionError("trascrizione inviata a Claude"))
    monkeypatch.setattr(llm, "claude_run", external)
    monkeypatch.setattr(lecture_notes, "run", external, raising=False)
    # Con l'esterno vietato dalla privacy si ripiega sul locale: qui è giù, quindi la chiamata fallisce
    # e (soprattutto) nessuna trascrizione parte verso Claude.
    local = Mock(side_effect=ClaudeError("locale non raggiungibile"))
    monkeypatch.setattr(llm, "_local", local)
    with pytest.raises(ClaudeError, match="locale non raggiungibile"):
        lecture_notes.process(1)
    local.assert_called_once()
    external.assert_not_called()


def test_local_only_lecture_notes_can_save_and_reuse_generated_notes(db, monkeypatch):
    inserisci_corso(db)
    db.commit()
    monkeypatch.setenv("STUDYHUB_PRIVACY_MODE", "local_only")
    image_data = _png(30, 30).split(",", 1)[1]
    monkeypatch.setattr(lecture_notes, "build_input", lambda _: (
        {"course_id": 1, "folder": "corso1/lezione1", "title": "Derivate", "date": None},
        [{"type": "text", "text": "Spiegazione delle derivate."},
         {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": image_data}}],
        [],
        "hash",
    ))
    monkeypatch.setattr(llm, "provider_order", lambda: ["local", "claude"])
    data = {key: [] for key in lecture_notes.SCHEMA["properties"]}
    data.update(titolo="Derivate", riassunto="Regola della catena.")
    local = Mock(return_value=llm.LLMResult(
        data, "local", "model", 1.0, images_sent=1, usage={"prompt_tokens": 42, "completion_tokens": 12},
    ))
    monkeypatch.setattr(llm, "_local", local)
    external = Mock(side_effect=AssertionError("trascrizione inviata a Claude"))
    monkeypatch.setattr(llm, "claude_run", external)
    monkeypatch.setattr(lecture_notes, "run", external, raising=False)

    result = lecture_notes.process(1)

    assert result["model"] == "model" and result["input_tokens"] == 42
    assert "Regola della catena." in (config.settings.uni_root / result["md_path"]).read_text(encoding="utf-8")
    image = local.call_args.kwargs["content"][1]
    assert image["type"] == "image" and image["media_type"] == "image/jpeg" and image["data"]
    assert lecture_notes.process(1)["cached"] is True
    local.assert_called_once()
    external.assert_not_called()


@pytest.mark.parametrize("photo", [False, True], ids=["text", "image"])
def test_exam_answers_cannot_fall_back_to_external_providers(corso, monkeypatch, photo):
    sim_id = _sim(corso, monkeypatch)
    monkeypatch.setattr(exam, "_exam_rules", lambda *_: "Usa le formule.")
    monkeypatch.setenv("STUDYHUB_PRIVACY_MODE", "strict")
    monkeypatch.setattr(llm, "provider_order", lambda: ["local", "gemini", "claude"])
    monkeypatch.setattr(llm, "_local", Mock(side_effect=llm.NoVision("locale non disponibile")))
    claude = Mock(side_effect=AssertionError("consegna inviata a Claude"))
    gemini = Mock(side_effect=AssertionError("consegna inviata a Gemini"))
    monkeypatch.setattr(llm, "claude_run", claude)
    monkeypatch.setattr(llm.subprocess, "run", gemini)
    monkeypatch.setattr(llm, "_agy_exe", lambda: "agy")
    answers = [{}, {"testo": "x + y", "immagini": [_png(30, 30)] if photo else []}]
    with pytest.raises(ClaudeError, match="exam_answers"):
        exam.grade_sim(sim_id, answers)
    claude.assert_not_called()
    gemini.assert_not_called()


@pytest.mark.skipif(os.name != "nt", reason="Il launcher batch richiede Windows")
@pytest.mark.parametrize(("args", "expected"), [([], ["serve"]), (["doctor", "--help"], ["doctor", "--help"])])
def test_batch_launcher_on_clean_clone(tmp_path, args, expected):
    launcher = Path(__file__).resolve().parents[2] / "studyhub.bat"
    shutil.copyfile(launcher, tmp_path / "studyhub.bat")
    stub = tmp_path / "backend" / "studyhub"
    stub.mkdir(parents=True)
    (stub / "__init__.py").touch()
    (stub / "cli.py").write_text("import json, sys\nprint(json.dumps(sys.argv[1:]))\n", encoding="utf-8")
    env = {**os.environ, "PYTHONPATH": str(stub.parent),
           "UV_PROJECT_ENVIRONMENT": str(Path(sys.executable).resolve().parent.parent)}
    result = subprocess.run(["cmd.exe", "/d", "/c", r".\studyhub.bat", *args], cwd=tmp_path,
                            env=env, capture_output=True, text=True, timeout=15)
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout) == expected
