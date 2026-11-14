"""Turno di notte nativo (`studyhub notte --solo-locale`): fasi in sequenza, lock, limiti. Niente rete né modelli."""
from __future__ import annotations

import datetime as dt

import pytest

from studyhub import autosync, notte, turno
from studyhub.db import session
from studyhub.filelock import file_lock
from studyhub.paths import uni_path
from studyhub.study import bank

from conftest import inserisci_corso


class Orologio:
    def __init__(self, ora: dt.datetime):
        self.t = ora

    def __call__(self) -> dt.datetime:
        return self.t

    def avanza(self, **kw) -> None:
        self.t += dt.timedelta(**kw)


@pytest.fixture
def turno_finto(ambiente, monkeypatch):
    """Tutto ciò che è pesante è sostituito da funzioni che registrano gli eventi."""
    eventi: list = []
    clock = Orologio(dt.datetime(2026, 11, 14, 23, 0, 0))
    monkeypatch.setattr(notte, "_now", clock)
    monkeypatch.setattr(turno, "LEGACY_LOCK", ambiente / "legacy.lock")
    monkeypatch.setattr(notte, "llm_risponde", lambda url: True)
    monkeypatch.setattr(notte, "trascrivi", lambda lec, c: eventi.append(("trascrivi", lec["id"])))
    monkeypatch.setattr(notte, "indicizza", lambda c: eventi.append(("indicizza", c["id"])))
    monkeypatch.setattr(notte, "embedding", lambda stop: eventi.append(("embedding",)) or 0)
    monkeypatch.setattr(notte, "scarica_ollama", lambda: eventi.append(("ollama",)) or ["bge-m3"])
    monkeypatch.setattr(notte, "rilascia_whisper", lambda: eventi.append(("whisper",)) or "ok")
    monkeypatch.setattr(bank, "sync_units", lambda cid: {})

    def run_claimed(uid):
        eventi.append(("unita", uid, turno.notte_attiva()))
        clock.avanza(hours=1)

    monkeypatch.setattr(bank, "run_claimed", run_claimed)
    with session() as db:
        inserisci_corso(db)
    return eventi, clock


def _lezione(lid: int, status: str = "media_ok", con_audio: bool = True) -> None:
    folder = f"corso1/lezioni/L{lid:02d}"
    with session() as db:
        db.execute("INSERT INTO lectures (id, course_id, title, date, number, folder, status) VALUES (?,?,?,?,?,?,?)",
                   (lid, 1, f"Lezione {lid}", f"2026-10-{lid:02d}", lid, folder, status))
    if con_audio:
        d = uni_path(folder)
        d.mkdir(parents=True, exist_ok=True)
        (d / "audio.opus").write_bytes(b"x")


def _unita(uid: int, kind: str, ref: int, day: str) -> None:
    with session() as db:
        db.execute("INSERT INTO study_units (id, course_id, kind, ref_id, title, day, status) VALUES (?,?,?,?,?,?, 'nuova')",
                   (uid, 1, kind, ref, f"u{uid}", day))


def _appunti(lid: int) -> None:
    with session() as db:
        db.execute("INSERT INTO ai_outputs (kind, target_id, course_id, input_hash) VALUES ('lecture_notes', ?, 1, 'h')", (lid,))


def _ids(eventi, nome):
    return [e[1] for e in eventi if e[0] == nome]


def test_fasi_in_sequenza(turno_finto):
    eventi, _ = turno_finto
    _lezione(1)
    _unita(1, "documento", 10, "2026-10-01")
    assert notte.run(solo_locale=True) == 0
    nomi = [e[0] for e in eventi]
    assert nomi == ["trascrivi", "indicizza", "embedding", "ollama", "whisper", "unita"]


def test_senza_solo_locale_rifiuta(turno_finto, capsys):
    eventi, _ = turno_finto
    assert notte.run(solo_locale=False) != 0
    assert "solo la modalità locale" in capsys.readouterr().err
    assert eventi == []


def test_cli_senza_solo_locale(turno_finto):
    from typer.testing import CliRunner

    from studyhub.cli import app
    r = CliRunner().invoke(app, ["notte"])
    assert r.exit_code != 0
    r = CliRunner().invoke(app, ["notte", "--solo-locale", "--max-unita", "1"])
    assert r.exit_code == 0


def test_secondo_turno_esce_subito(turno_finto, capsys):
    eventi, _ = turno_finto
    with file_lock(turno.NOTTE_LOCK, "altro turno", timeout=0):
        assert notte.run(solo_locale=True) == 0
    assert "già in corso" in capsys.readouterr().out
    assert eventi == []


def test_notte_attiva_durante_il_turno(turno_finto):
    eventi, _ = turno_finto
    _unita(1, "documento", 10, "2026-10-01")
    assert not turno.notte_attiva()
    assert notte.run(solo_locale=True) == 0
    assert eventi[-1] == ("unita", 1, True)
    assert not turno.notte_attiva()


def test_lezioni_senza_appunti_saltate(turno_finto, capsys):
    eventi, _ = turno_finto
    _unita(1, "lezione", 1, "2026-10-01")   # senza appunti: salta
    _unita(2, "lezione", 2, "2026-10-02")   # con appunti: va
    _unita(3, "documento", 10, "2026-10-03")
    _appunti(2)
    assert notte.run(solo_locale=True) == 0
    assert _ids(eventi, "unita") == [2, 3]
    assert "saltate (servono appunti Claude) 1" in capsys.readouterr().out
    with session() as db:
        assert db.execute("SELECT status FROM study_units WHERE id=1").fetchone()[0] == "nuova"


def test_stop_a_max_unita(turno_finto):
    eventi, _ = turno_finto
    for i in range(1, 6):
        _unita(i, "documento", 10 + i, f"2026-10-0{i}")
    assert notte.run(solo_locale=True, max_unita=2) == 0
    assert _ids(eventi, "unita") == [1, 2]


def test_stop_all_ora_limite(turno_finto):
    eventi, clock = turno_finto
    for i in range(1, 7):
        _unita(i, "documento", 10 + i, f"2026-10-0{i}")
    # inizio 23:00, ogni unità dura 1 ora (orologio finto): alle 01:30 si ferma, dopo 23, 00, 01
    assert notte.run(solo_locale=True, fino="01:30") == 0
    assert _ids(eventi, "unita") == [1, 2, 3]


def test_errore_di_unita_non_ferma_il_turno(turno_finto, monkeypatch):
    eventi, _ = turno_finto
    _unita(1, "documento", 11, "2026-10-01")
    _unita(2, "documento", 12, "2026-10-02")
    visti = []

    def run_claimed(uid):
        visti.append(uid)
        if uid == 1:
            raise RuntimeError("boom")

    monkeypatch.setattr(bank, "run_claimed", run_claimed)
    assert notte.run(solo_locale=True) == 0
    assert visti == [1, 2]


def test_llm_irraggiungibile(turno_finto, monkeypatch):
    eventi, _ = turno_finto
    monkeypatch.setattr(notte, "llm_risponde", lambda url: False)
    _lezione(1)
    _unita(1, "documento", 10, "2026-10-01")
    assert notte.run(solo_locale=True) == 1
    assert eventi == []


def test_trascrizioni_limitate_e_errore_non_ferma(turno_finto, monkeypatch):
    eventi, _ = turno_finto
    for i in (1, 2, 3, 4):
        _lezione(i)
    _lezione(5, con_audio=False)          # senza audio: ignorata
    _lezione(6, status="trascritta")      # già fatta: ignorata

    def trascrivi(lec, c):
        eventi.append(("trascrivi", lec["id"]))
        if lec["id"] == 4:
            raise RuntimeError("whisper rotto")

    monkeypatch.setattr(notte, "trascrivi", trascrivi)
    assert notte.run(solo_locale=True, max_trascrizioni=2) == 0
    assert _ids(eventi, "trascrivi") == [4, 3]       # prima le più recenti; l'errore (4) conta ma non ferma
    assert _ids(eventi, "indicizza") == [1]          # il corso con la lezione 3 trascritta


def test_fase_gpu_rispetta_l_ora(turno_finto, monkeypatch):
    eventi, clock = turno_finto
    for i in (1, 2, 3):
        _lezione(i)

    def trascrivi(lec, c):
        eventi.append(("trascrivi", lec["id"]))
        clock.avanza(minutes=50)

    monkeypatch.setattr(notte, "trascrivi", trascrivi)
    # 23:00 → fine fase GPU 00:30: la seconda parte alle 23:50, finisce alle 00:40: la terza non parte
    assert notte.run(solo_locale=True, fine_fase_gpu="00:30", max_trascrizioni=9) == 0
    assert _ids(eventi, "trascrivi") == [3, 2]
    assert ("embedding",) in eventi


def test_embedding_errore_non_fatale(turno_finto, monkeypatch):
    eventi, _ = turno_finto
    from studyhub.ingest.embed import EmbeddingError

    def embedding(stop):
        raise EmbeddingError("Ollama spento")

    monkeypatch.setattr(notte, "embedding", embedding)
    _unita(1, "documento", 10, "2026-10-01")
    assert notte.run(solo_locale=True) == 0
    assert _ids(eventi, "unita") == [1]


def test_autosync_salta_durante_il_turno(ambiente, monkeypatch, capsys):
    monkeypatch.setattr(turno, "LEGACY_LOCK", ambiente / "legacy.lock")

    def boom():
        raise AssertionError("auto-sync non doveva partire")

    monkeypatch.setattr(autosync, "apply_catalog", boom)
    with file_lock(turno.NOTTE_LOCK, "turno", timeout=0):
        s = autosync.run()
    assert s == {"file": 0, "lezioni": 0, "avvisi": 0, "errori": []}
    assert "turno di notte in corso" in capsys.readouterr().out.lower()


def test_conta_lavoro_in_attesa(turno_finto):
    eventi, _ = turno_finto
    _lezione(1)
    _lezione(2, con_audio=False)  # senza audio: non trascrivibile
    _unita(1, "documento", 10, "2026-10-01")
    _unita(2, "lezione", 1, "2026-10-02")  # senza appunti: la fa Sonnet, non conta
    _unita(3, "lezione", 3, "2026-10-03")
    _appunti(3)
    assert notte.conta() == {"trascrizioni": 1, "unita": 2}
    assert eventi == []  # niente trascrizioni né LLM


def test_conta_vuoto_da_cli(turno_finto):
    import json

    from typer.testing import CliRunner

    from studyhub.cli import app
    r = CliRunner().invoke(app, ["notte", "--conta"])
    assert r.exit_code == 0, r.output
    assert json.loads(r.output.strip().splitlines()[-1]) == {"trascrizioni": 0, "unita": 0}
