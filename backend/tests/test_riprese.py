"""P1.3: ripresa automatica di lezioni in errore e unità vuote/in errore, con backoff. Niente rete né modelli."""
from __future__ import annotations

from datetime import datetime, timedelta

import pytest

from conftest import inserisci_corso
from studyhub import autosync, turno
from studyhub.ai.llm import LLMResult
from studyhub.db import session
from studyhub.paths import uni_path
from studyhub.study import bank, riprese

PASSATO = (datetime.now() - timedelta(minutes=5)).isoformat(timespec="seconds")
FUTURO = (datetime.now() + timedelta(hours=2)).isoformat(timespec="seconds")


def _muto(m):
    return None


@pytest.fixture
def corso(ambiente, db):
    inserisci_corso(db)
    db.commit()


def _lezione(lid=1, status="errore", attempts=0, retry=None, file=()):
    folder = f"corso1/lezioni/L{lid}"
    with session() as db:
        db.execute("INSERT INTO lectures (id, course_id, title, date, folder, status, error, attempts, next_retry_at) "
                   "VALUES (?,?,?,?,?,?,?,?,?)",
                   (lid, 1, f"Lezione {lid}", "2026-10-01", folder, status, "boom", attempts, retry))
    d = uni_path(folder)
    d.mkdir(parents=True, exist_ok=True)
    for f in file:
        (d / f).write_text("{}", encoding="utf-8")


def _unita(uid=1, status="vuota", kind="lezione", ref=1, attempts=0, retry=None):
    with session() as db:
        db.execute("INSERT INTO study_units (id, course_id, kind, ref_id, title, day, status, source_hash, attempts, "
                   "next_retry_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
                   (uid, 1, kind, ref, "U", "2026-10-01", status, "vecchio", attempts, retry))


def _appunti(lid=1):
    md = uni_path(f"corso1/lezioni/L{lid}/appunti.md")
    md.parent.mkdir(parents=True, exist_ok=True)
    md.write_text("# Appunti\nLimiti e continuita.", encoding="utf-8")
    with session() as db:
        db.execute("INSERT INTO ai_outputs (kind, target_id, course_id, input_hash, md_path) VALUES "
                   "('lecture_notes', ?, 1, 'h', ?)", (lid, f"corso1/lezioni/L{lid}/appunti.md"))


def _riga(tab, rid=1):
    with session() as db:
        return dict(db.execute(f"SELECT * FROM {tab} WHERE id=?", (rid,)).fetchone())


# --- backoff e massimo ---------------------------------------------------------------------------------------

def test_backoff_1_6_24_ore_poi_nessuna_ripresa():
    t = datetime(2026, 11, 14, 12, 0, 0)
    ore = [riprese.prossimo_tentativo(n, "lectures", t) for n in (1, 2, 3, 4, 9)]
    assert ore == ["2026-11-14T13:00:00", "2026-11-14T18:00:00", "2026-11-15T12:00:00", None, None]


def test_segna_fallita_incrementa_e_oltre_il_massimo_lascia_null(corso):
    _unita(status="errore")
    visti = []
    for _ in range(4):
        riprese.segna_fallita("study_units", 1)
        r = _riga("study_units")
        visti.append((r["attempts"], r["next_retry_at"] is not None))
    assert visti == [(1, True), (2, True), (3, True), (4, False)]
    assert _riga("study_units")["status"] == "errore"  # stato com'è: serve la mano dell'utente


def test_oltre_il_massimo_non_viene_ripresa(corso):
    _lezione(attempts=riprese.MAX_ATTEMPTS_LEZIONI + 1, retry=None)
    _unita(status="errore", kind="documento", attempts=riprese.MAX_ATTEMPTS_UNITA + 1)
    assert riprese.riprendi(log=_muto) == {"lezioni": 0, "unita": 0, "unita_senza_appunti": 0}
    assert _riga("lectures")["status"] == "errore" and _riga("study_units")["status"] == "errore"


def test_backoff_non_scaduto_non_riprende_scaduto_si(corso):
    _lezione(1, attempts=1, retry=FUTURO)
    _lezione(2, attempts=1, retry=PASSATO)
    riprese.riprendi(log=_muto)
    assert _riga("lectures", 1)["status"] == "errore"
    assert _riga("lectures", 2)["status"] != "errore"


# --- righe vecchie -------------------------------------------------------------------------------------------

def test_righe_vecchie_riprese_al_primo_giro_una_volta_sola(corso):
    _lezione(attempts=0, retry=None)
    _unita(status="vuota", kind="documento", attempts=0, retry=None)
    r = riprese.riprendi(log=_muto)
    assert r["lezioni"] == 1 and r["unita"] == 1
    assert _riga("lectures")["status"] == "nuova" and _riga("study_units")["status"] == "nuova"
    # se falliscono di nuovo non sono piu "vecchie": hanno un backoff
    with session() as db:
        db.execute("UPDATE lectures SET status='errore' WHERE id=1")
    riprese.segna_fallita("lectures", 1)
    assert riprese.riprendi(log=_muto)["lezioni"] == 0


# --- lezioni: stato di ripartenza ----------------------------------------------------------------------------

def test_lezione_senza_media_torna_nuova_e_azzera_error(corso):
    _lezione()
    riprese.riprendi(log=_muto)
    r = _riga("lectures")
    assert r["status"] == "nuova" and r["error"] is None and r["next_retry_at"] is None


def test_lezione_con_media_su_disco_torna_media_ok_per_la_trascrizione(corso):
    _lezione(file=("audio.opus", "silences.json", "slides.json"))
    riprese.riprendi(log=_muto)
    assert _riga("lectures")["status"] == "media_ok"
    from studyhub import notte
    assert [lec["id"] for lec, _ in notte.lezioni_da_trascrivere()] == [1]  # la fase 1 della notte la vede


def test_lezione_con_audio_ma_senza_slide_torna_nuova(corso):
    _lezione(file=("audio.opus", "silences.json"))
    riprese.riprendi(log=_muto)
    assert _riga("lectures")["status"] == "nuova"


def test_lezione_gia_trascritta_con_whisper_torna_trascritta(corso):
    _lezione(file=("audio.opus", "silences.json", "slides.json"))
    (uni_path("corso1/lezioni/L1") / "transcript.json").write_text('{"source": "whisper", "segments": []}',
                                                                  encoding="utf-8")
    riprese.riprendi(log=_muto)
    assert _riga("lectures")["status"] == "trascritta"


def test_pipeline_errore_e_successo_aggiornano_i_contatori(corso):
    from studyhub.media import pipeline
    _lezione(status="nuova")
    pipeline._update(1, status="errore", error="x")
    riprese.segna_fallita("lectures", 1)
    r = _riga("lectures")
    assert r["attempts"] == 1 and r["next_retry_at"]
    pipeline._update(1, status="media_ok", error=None)
    r = _riga("lectures")
    assert r["attempts"] == 0 and r["next_retry_at"] is None


# --- unita ---------------------------------------------------------------------------------------------------

def _risposta(n):
    dom = [{"argomento": "Limiti", "tipo": "richiamo", "difficolta": 2, "testo_md": f"Domanda {i}?", "opzioni": [],
            "corretta": None, "risposta_md": "r", "criteri": []} for i in range(n)]
    return LLMResult(data={"argomenti": [{"nome": "Limiti", "peso": "alto", "scheda_md": "s"}], "domande": dom},
                     provider="local", model="m", duration_s=0.1)


def test_unita_vuota_viene_rigenerata_davvero_e_il_successo_azzera(corso, monkeypatch):
    _lezione(status="trascritta")
    _appunti()
    _unita(status="nuova")
    chiamate = []
    risposte = iter([_risposta(0), _risposta(2)])
    monkeypatch.setattr(bank, "run_json", lambda *a, **k: chiamate.append(1) or next(risposte))

    assert bank.prepare_unit(1)["items"] == 0
    r = _riga("study_units")
    assert r["status"] == "vuota" and r["attempts"] == 1 and r["next_retry_at"]

    with session() as db:
        db.execute("UPDATE study_units SET next_retry_at=? WHERE id=1", (PASSATO,))
    assert riprese.riprendi(log=_muto)["unita"] == 1
    r = _riga("study_units")
    assert r["status"] == "nuova" and r["source_hash"] is None and r["next_retry_at"] is None

    out = bank.prepare_unit(1)
    assert out["cached"] is False and out["items"] == 2 and len(chiamate) == 2  # richiamato, non in cache
    r = _riga("study_units")
    assert r["status"] == "pronta" and r["attempts"] == 0 and r["next_retry_at"] is None


def test_unita_in_errore_da_run_claimed_conta_il_tentativo(corso, monkeypatch):
    _unita(status="in_corso", kind="documento")

    def rotto(uid):
        raise RuntimeError("modello giu")

    monkeypatch.setattr(bank, "prepare_unit", rotto)
    bank._run_claimed(1)
    r = _riga("study_units")
    assert r["status"] == "errore" and r["attempts"] == 1 and r["next_retry_at"]


def test_unita_di_lezione_senza_appunti_non_ripresa(corso):
    _lezione(status="trascritta")
    _unita(1, status="vuota", kind="lezione", ref=1)   # nessun appunto: aspetta Sonnet
    _unita(2, status="errore", kind="documento", ref=9)
    r = riprese.riprendi(log=_muto)
    assert r["unita"] == 1 and r["unita_senza_appunti"] == 1
    assert _riga("study_units", 1)["status"] == "vuota" and _riga("study_units", 2)["status"] == "nuova"
    _appunti()  # arrivano gli appunti: ora e riprendibile
    assert riprese.riprendi(log=_muto)["unita"] == 1


# --- eccezioni -----------------------------------------------------------------------------------------------

def _rotto(**kw):
    raise RuntimeError("db rotto")


def test_eccezione_in_riprendi_non_ferma_autosync(ambiente, monkeypatch):
    class Raggiunto(Exception):
        pass

    def dopo(*a, **k):
        raise Raggiunto

    import studyhub.fullrun as fullrun
    monkeypatch.setattr(riprese, "riprendi", _rotto)
    monkeypatch.setattr(fullrun, "is_running", lambda: False)
    monkeypatch.setattr(turno, "notte_attiva", lambda: False)
    monkeypatch.setattr(autosync, "apply_catalog", dopo)  # primo passo dopo riprendi
    with pytest.raises(Raggiunto):
        autosync.run(toast=False)


def test_eccezione_in_riprendi_non_ferma_il_turno_di_notte(ambiente, monkeypatch, capsys):
    monkeypatch.setattr(riprese, "riprendi", _rotto)
    from studyhub import notte
    notte._riprendi(lezioni=True, unita=False)
    assert "ripresa automatica fallita" in capsys.readouterr().out
