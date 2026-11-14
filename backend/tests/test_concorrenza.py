"""P0.3/P0.4: una sola chiamata a Claude alla volta (thread e processi), battito delle unità, coda che riparte da sola."""
from __future__ import annotations

import subprocess
import sys
import textwrap
import threading
import time
from datetime import datetime, timedelta

import pytest

from conftest import inserisci_corso
from studyhub.filelock import LockTimeout, file_lock
from studyhub.db import session


# --- lock su file ------------------------------------------------------------------------

def test_lock_esclusivo_tra_thread(tmp_path):
    path, dentro, massimo = tmp_path / "x.lock", [0], [0]

    def lavora():
        with file_lock(path, "t", poll_s=0.01):
            dentro[0] += 1
            massimo[0] = max(massimo[0], dentro[0])
            time.sleep(0.05)
            dentro[0] -= 1

    ts = [threading.Thread(target=lavora) for _ in range(4)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert massimo[0] == 1


def test_lock_esclusivo_tra_processi_e_timeout(tmp_path):
    path = tmp_path / "x.lock"
    figlio = textwrap.dedent(f"""
        import sys, time
        from pathlib import Path
        from studyhub.filelock import file_lock
        with file_lock(Path(r"{path}"), "figlio"):
            print("preso", flush=True)
            time.sleep(3)
    """)
    p = subprocess.Popen([sys.executable, "-c", figlio], stdout=subprocess.PIPE, text=True)
    try:
        assert p.stdout.readline().strip() == "preso"
        t0 = time.monotonic()
        with pytest.raises(LockTimeout):
            with file_lock(path, "padre", timeout=0.5, poll_s=0.05):
                pass
        assert time.monotonic() - t0 < 2.5
        with file_lock(path, "padre", timeout=10, poll_s=0.05):  # il figlio esce e il lock si libera
            pass
    finally:
        p.kill()
        p.wait()


def test_lock_liberato_se_il_processo_muore(tmp_path):
    path = tmp_path / "x.lock"
    figlio = textwrap.dedent(f"""
        import time
        from pathlib import Path
        from studyhub.filelock import file_lock
        with file_lock(Path(r"{path}"), "figlio"):
            print("preso", flush=True)
            time.sleep(60)
    """)
    p = subprocess.Popen([sys.executable, "-c", figlio], stdout=subprocess.PIPE, text=True)
    assert p.stdout.readline().strip() == "preso"
    p.kill()
    p.wait()
    with file_lock(path, "padre", timeout=5, poll_s=0.05):
        pass


# --- Claude: una chiamata alla volta, budget controllato dentro il lock ---------------------

def test_claude_una_chiamata_alla_volta(monkeypatch, tmp_path):
    from studyhub.ai import claude_runner as cr
    monkeypatch.setattr(cr, "LOCK_FILE", tmp_path / "claude.lock")
    monkeypatch.setattr(cr, "USAGE_FILE", tmp_path / "usage.json")
    dentro, massimo = [0], [0]

    def finta(system, content, schema, model):
        dentro[0] += 1
        massimo[0] = max(massimo[0], dentro[0])
        time.sleep(0.05)
        dentro[0] -= 1
        return "ok"

    monkeypatch.setattr(cr, "_run_locked", finta)
    ts = [threading.Thread(target=cr.run, args=("s", [], {})) for _ in range(3)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert massimo[0] == 1


def test_chi_aspetta_vede_la_finestra_piena(monkeypatch, tmp_path):
    """Il primo processo riempie la finestra: il secondo, entrato nel lock dopo, non lancia la chiamata."""
    from studyhub.ai import claude_runner as cr
    monkeypatch.setattr(cr, "LOCK_FILE", tmp_path / "claude.lock")
    monkeypatch.setattr(cr, "USAGE_FILE", tmp_path / "usage.json")
    chiamate = []

    def finta(system, content, schema, model):
        chiamate.append(1)
        cr._save_usage({"utilization": 0.95, "resets_at": time.time() + 3600})
        return "ok"

    monkeypatch.setattr(cr, "_run_locked", finta)
    assert cr.run("s", [], {}) == "ok"
    with pytest.raises(cr.RateLimited):
        cr.run("s", [], {})
    assert chiamate == [1]
    assert cr.paused_until() is not None


def test_lock_occupato_troppo_a_lungo_diventa_rate_limited(monkeypatch, tmp_path):
    from studyhub.ai import claude_runner as cr
    monkeypatch.setattr(cr, "LOCK_FILE", tmp_path / "claude.lock")
    monkeypatch.setattr(cr, "USAGE_FILE", tmp_path / "usage.json")
    monkeypatch.setattr(cr, "LOCK_WAIT_S", 0.2)
    preso, libera = threading.Event(), threading.Event()

    def tiene():
        with file_lock(cr.LOCK_FILE, "altro"):
            preso.set()
            libera.wait(5)

    t = threading.Thread(target=tiene)
    t.start()
    preso.wait(5)
    try:
        with pytest.raises(cr.RateLimited):
            cr.run("s", [], {})
    finally:
        libera.set()
        t.join()


# --- battito delle unità -----------------------------------------------------------------

def _unita(db):
    db.execute("""INSERT INTO study_units (id, course_id, kind, ref_id, title, status)
                  VALUES (1, 1, 'documento', 1, 'U', 'nuova')""")


def test_battito_tiene_viva_l_unita_lunga(ambiente, db, monkeypatch):
    from studyhub.study import bank
    inserisci_corso(db)
    _unita(db)
    db.commit()
    monkeypatch.setattr(bank, "HEARTBEAT_S", 0.05)
    vecchio = (datetime.now() - timedelta(minutes=30)).isoformat(timespec="seconds")
    visto = {}

    def lenta(uid):
        with session() as d:
            d.execute("UPDATE study_units SET done_at=? WHERE id=1", (vecchio,))
        time.sleep(1.2)  # il battito scrive l'ora con risoluzione al secondo
        visto["liberate"] = bank.release_stale(1)   # un altro processo che guarda: deve restare in corso
        with session() as d:
            d.execute("UPDATE study_units SET status='pronta' WHERE id=1")

    monkeypatch.setattr(bank, "prepare_unit", lenta)
    assert bank.claim(1)
    assert bank.run_claimed(1) is None
    assert visto["liberate"] == 0


def test_senza_battito_l_unita_torna_in_coda_dopo_pochi_minuti(ambiente, db):
    from studyhub.study import bank
    inserisci_corso(db)
    _unita(db)
    db.commit()
    assert bank.claim(1)
    with session() as d:
        d.execute("UPDATE study_units SET done_at=? WHERE id=1",
                  ((datetime.now() - timedelta(minutes=bank.STALE_MINUTES + 1)).isoformat(timespec="seconds"),))
    assert bank.release_stale() == 1


# --- coda AI: pausa con scadenza e worker che non muore ------------------------------------

def test_pausa_scade_e_la_coda_riparte(monkeypatch):
    from studyhub.ai import jobs
    monkeypatch.setattr(jobs, "paused_until", lambda: None)
    jobs.state.update(paused_reason=None, paused_until=None)
    jobs._pause("finestra piena")
    assert jobs.state["paused_reason"] == "finestra piena"
    jobs._resume_if_due()
    assert jobs.state["paused_reason"] == "finestra piena"   # 15 minuti non ancora passati
    jobs.state["paused_until"] = time.time() - 1
    jobs._resume_if_due()
    assert jobs.state["paused_reason"] is None


def test_pausa_fino_al_reset_della_finestra(monkeypatch):
    from studyhub.ai import jobs
    reset = time.time() + 3600
    monkeypatch.setattr(jobs, "paused_until", lambda: reset)
    jobs._pause("x")
    assert jobs.state["paused_until"] == reset
    jobs.state.update(paused_reason=None, paused_until=None)


def test_worker_sopravvive_a_un_errore_del_db(monkeypatch):
    from studyhub.ai import jobs
    giri = []

    def rotto():
        giri.append(1)
        if len(giri) == 1:
            raise RuntimeError("database is locked")
        raise SystemExit  # secondo giro: fermo il test

    jobs.state.update(paused_reason=None, paused_until=None)
    monkeypatch.setattr(jobs, "check_budget", lambda: None)
    monkeypatch.setattr(jobs, "_next_job", rotto)
    monkeypatch.setattr(jobs.time, "sleep", lambda s: None)
    monkeypatch.setattr(jobs._wake, "wait", lambda timeout=None: True)
    with pytest.raises(SystemExit):
        jobs._loop()
    assert len(giri) == 2
