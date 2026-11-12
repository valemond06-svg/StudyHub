import pytest

from conftest import inserisci_corso
from studyhub.ai import jobs
from studyhub.ai.claude_runner import ClaudeError, RateLimited
from studyhub.db import session


@pytest.fixture
def job(ambiente, db):
    inserisci_corso(db)
    db.execute("INSERT INTO lectures (id, course_id, title, folder) VALUES (1, 1, 'L', 'l1')")
    db.execute("INSERT INTO ai_jobs (id, kind, target_id, status) VALUES (1, 'lecture_notes', 1, 'in_corso')")
    db.commit()
    jobs.state.update(current=None, paused_reason=None)
    return {"id": 1, "target_id": 1}


def _stato():
    with session() as d:
        r = d.execute("SELECT status, message FROM ai_jobs WHERE id=1").fetchone()
    return r["status"], r["message"]


def _patch(monkeypatch, process, index=lambda c: None, embed=lambda: None):
    monkeypatch.setattr("studyhub.ai.lecture_notes.process", process)
    monkeypatch.setattr("studyhub.ingest.indexer.index_course", index)
    monkeypatch.setattr("studyhub.ingest.indexer.embed_pending", embed)


def test_job_riuscito_e_indicizzato(job, monkeypatch):
    _patch(monkeypatch, lambda lid: {"md_path": "a.md"})
    jobs._process_job(job)
    assert _stato() == ("fatto", "a.md") and jobs.state["current"] is None


def test_indicizzazione_fallita_non_cancella_il_successo(job, monkeypatch):
    """Difetto reale: l'eccezione di index_course finiva nell'except generale e il job con appunti pronti
    veniva riscritto come 'errore'."""
    def boom(course):
        raise RuntimeError("indice rotto")
    _patch(monkeypatch, lambda lid: {"md_path": "a.md"}, index=boom)
    jobs._process_job(job)
    stato, msg = _stato()
    assert stato == "fatto" and "a.md" in msg and "indicizzazione non riuscita: indice rotto" in msg


def test_embedding_spento_e_ignorato(job, monkeypatch):
    def boom():
        raise ConnectionError("ollama spento")
    _patch(monkeypatch, lambda lid: {"md_path": "a.md"}, embed=boom)
    jobs._process_job(job)
    assert _stato() == ("fatto", "a.md")


def test_appunti_non_riusciti_restano_errore_e_non_si_indicizza(job, monkeypatch):
    chiamate = []

    def fallisce(lid):
        raise ClaudeError("modello giù")
    _patch(monkeypatch, fallisce, index=lambda c: chiamate.append(c))
    jobs._process_job(job)
    assert _stato() == ("errore", "modello giù") and chiamate == []


def test_rate_limit_rimette_in_coda_e_mette_in_pausa(job, monkeypatch):
    def limite(lid):
        raise RateLimited("finestra piena")
    _patch(monkeypatch, limite)
    jobs._process_job(job)
    assert _stato()[0] == "in_coda" and jobs.state["paused_reason"] == "finestra piena"
    jobs.state["paused_reason"] = None


def test_job_gia_elaborato_dalla_cache(job, monkeypatch):
    _patch(monkeypatch, lambda lid: {"cached": True})
    jobs._process_job(job)
    assert _stato() == ("fatto", "già elaborata")
