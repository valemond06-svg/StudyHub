"""P1.1: arretrati degli appunti solo con Sonnet, in coda da soli e distribuiti nelle finestre Pro; LaTeX del 35B."""
from __future__ import annotations

import json
import time

import pytest

from studyhub.ai import jobs, llm


def _corso(db, cid, stage, passed=0):
    db.execute("INSERT INTO courses (id, fullname, stage, passed, folder) VALUES (?,?,?,?,?)",
               (cid, f"Corso {cid}", stage, passed, f"c{cid}"))


def _lezione(db, lid, cid, date, status="trascritta"):
    db.execute("INSERT INTO lectures (id, course_id, title, date, folder, status) VALUES (?,?,?,?,?,?)",
               (lid, cid, f"L{lid}", date, f"c{cid}/l{lid}", status))


@pytest.fixture
def corsi(db):
    _corso(db, 1, "corrente")
    _corso(db, 2, "arretrato")
    _corso(db, 3, "archivio")
    _corso(db, 4, "corrente", passed=1)
    _lezione(db, 10, 1, "2026-10-01")
    _lezione(db, 11, 1, "2026-11-10")
    _lezione(db, 12, 1, "2026-11-12", status="media_ok")      # non ancora trascritta: aspetta
    _lezione(db, 20, 2, "2026-03-01")
    _lezione(db, 30, 3, "2025-11-01")                         # archivio: esclusa
    _lezione(db, 40, 4, "2026-11-01")                         # corso superato: esclusa
    _lezione(db, 13, 1, "2026-11-11")
    db.execute("INSERT INTO ai_outputs (kind, target_id, course_id, input_hash, json_path, md_path) "
               "VALUES ('lecture_notes', 13, 1, 'h', 'x.json', 'x.md')")  # ha già gli appunti
    db.commit()
    return db


def test_candidati_in_ordine_di_corso_e_recenza(corsi):
    assert jobs.backlog_candidates() == [(11, 30), (10, 30), (20, 20)]


def test_enqueue_backlog_non_duplica_e_il_click_scavalca(corsi, monkeypatch):
    monkeypatch.setattr(jobs, "_ensure_worker", lambda: None)
    assert len(jobs.enqueue_backlog()) == 3
    assert jobs.enqueue_backlog() == []                     # già in coda
    assert jobs.enqueue([20]) == []                         # già in coda: alza solo la priorità
    prio = dict(corsi.execute("SELECT target_id, priority FROM ai_jobs").fetchall())
    assert prio == {11: 30, 10: 30, 20: jobs.MANUAL_PRIORITY}
    assert jobs._next_job()["target_id"] == 20               # il click passa davanti
    assert jobs._next_job()["target_id"] == 11               # poi la più recente del corso corrente
    assert jobs._next_job(allow_backlog=False) is None       # finestra oltre la soglia: niente arretrati


def test_errori_ripetuti_escono_dalla_coda(corsi):
    for _ in range(jobs.BACKLOG_MAX_ERRORS):
        corsi.execute("INSERT INTO ai_jobs (kind, target_id, status, finished_at) "
                      "VALUES ('lecture_notes', 20, 'errore', datetime('now','-2 days','localtime'))")
    corsi.execute("INSERT INTO ai_jobs (kind, target_id, status, finished_at) "
                  "VALUES ('lecture_notes', 10, 'errore', datetime('now','localtime'))")
    corsi.commit()
    # 20: tre errori, non torna più; 10: errore di oggi, riprova domani
    assert jobs.backlog_candidates() == [(11, 30)]


def test_soglia_della_finestra_per_gli_arretrati(monkeypatch, ambiente):
    reset = time.time() + 3600
    monkeypatch.setattr(jobs, "last_usage", lambda: {"utilization": 0.75, "resets_at": reset})
    assert jobs._backlog_allowed() is False and "75%" in jobs.state["backlog_wait"]
    monkeypatch.setitem(jobs.settings.extra, "claude_backlog_stop_at", 0.8)
    assert jobs._backlog_allowed() is True
    monkeypatch.setattr(jobs, "last_usage", lambda: {"utilization": 0.95, "resets_at": time.time() - 1})
    assert jobs._backlog_allowed() is True                   # finestra già resettata
    monkeypatch.setattr(jobs, "last_usage", lambda: {})
    assert jobs._backlog_allowed() is True                   # nessun dato: la prima chiamata lo misura


def test_backlog_spento_di_default(ambiente):
    assert jobs.backlog_enabled() is False


def test_embedding_saltati_durante_il_turno_di_notte(corsi, monkeypatch):
    import studyhub.ai.lecture_notes as ln
    import studyhub.ingest.indexer as ix
    import studyhub.turno as turno
    chiamate = []
    monkeypatch.setattr(ln, "process", lambda lid: {"md_path": "x.md", "cached": False})
    monkeypatch.setattr(ix, "index_course", lambda c: None)
    monkeypatch.setattr(ix, "embed_pending", lambda: chiamate.append(1))
    monkeypatch.setattr(turno, "notte_attiva", lambda: True)
    jid = corsi.execute("INSERT INTO ai_jobs (kind, target_id) VALUES ('lecture_notes', 10)").lastrowid
    corsi.commit()
    jobs._process_job({"id": jid, "target_id": 10})
    assert chiamate == []
    monkeypatch.setattr(turno, "notte_attiva", lambda: False)
    jobs._process_job({"id": jid, "target_id": 10})
    assert chiamate == [1]


def test_notte_attiva_col_lock_nativo(monkeypatch, tmp_path):
    import threading
    import studyhub.turno as turno
    from studyhub.filelock import file_lock
    monkeypatch.setattr(turno, "NOTTE_LOCK", tmp_path / "notte.lock")
    monkeypatch.setattr(turno, "LEGACY_LOCK", tmp_path / "vecchio.lock")
    assert turno.notte_attiva() is False
    preso, fine = threading.Event(), threading.Event()

    def tieni():
        with file_lock(turno.NOTTE_LOCK, "notte"):
            preso.set()
            fine.wait(5)

    t = threading.Thread(target=tieni)
    t.start()
    preso.wait(5)
    try:
        assert turno.notte_attiva() is True
    finally:
        fine.set()
        t.join()
    assert turno.notte_attiva() is False


def test_notte_attiva_col_vecchio_pid(monkeypatch, tmp_path):
    import os
    import studyhub.turno as turno
    monkeypatch.setattr(turno, "NOTTE_LOCK", tmp_path / "notte.lock")
    monkeypatch.setattr(turno, "LEGACY_LOCK", tmp_path / "vecchio.lock")
    turno.LEGACY_LOCK.write_text(str(os.getpid()))
    assert turno.notte_attiva() is True
    turno.LEGACY_LOCK.write_text("999999999")
    assert turno.notte_attiva() is False


# --- LaTeX del 35B: \t, \r, \f, \b non devono diventare caratteri di controllo -----------------

@pytest.mark.parametrize("latex", [r"\triangle ABC", r"a \rightarrow b", r"\frac{1}{x}", r"\beta",
                                   r"\theta", r"\text{max}", r"\sum_i", r"\cdot", r"\alpha", r"\nabla f",
                                   r"x \neq 0", r"\underline{x}", r"\vec v"])
def test_latex_con_un_solo_backslash(latex):
    raw = '{"testo": "Formula $' + latex + '$ fine"}'
    assert llm._extract_json(raw)["testo"] == f"Formula ${latex}$ fine"


def test_escape_json_veri_restano():
    # un TAB vero seguito da una lettera diventerebbe "\t": compromesso accettato, nel testo di studio non capita
    raw = json.dumps({"t": "riga1\nriga2\t 3 col \"q\" \\triangle è a/b \\\\ fine"})
    assert llm._extract_json(raw) == json.loads(raw)


def test_a_capo_prima_di_una_parola_resta_a_capo():
    assert llm._extract_json('{"t": "uno\\nella\\nnotare"}')["t"] == "uno\nella\nnotare"
