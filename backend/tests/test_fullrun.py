"""P2.4: `fullrun` (elaborazione completa): ordine delle fasi, lock, errori di fase, fase Moodle e registrazioni."""
from __future__ import annotations

import threading

import pytest

from conftest import inserisci_corso
from studyhub import fullrun, notify
from studyhub.filelock import file_lock
from studyhub.ingest.embed import EmbeddingError


@pytest.fixture
def fr(ambiente, monkeypatch):
    """fullrun con stato e lock nel tmp, senza sospensione del PC né toast."""
    monkeypatch.setattr(fullrun, "LOCAL_DIR", ambiente / "local")
    monkeypatch.setattr(fullrun, "STATUS_FILE", ambiente / "local" / "full_run.json")
    monkeypatch.setattr(fullrun, "LOCK_FILE", ambiente / "local" / "full_run.lock")
    monkeypatch.setattr(fullrun, "_keep_awake", lambda on: None)
    toasts = []
    monkeypatch.setattr(notify, "toast", lambda t, b: toasts.append(t))
    (ambiente / "local").mkdir()
    fullrun.state.clear()
    yield toasts
    fullrun.state.clear()


def _fasi(monkeypatch, chiamate, moodle=None, media=None, study=None):
    def f(nome, exc=None):
        def inner(*a):
            chiamate.append(nome)
            if exc:
                raise exc
        return inner

    monkeypatch.setattr(fullrun, "moodle_phase", f("moodle", moodle))
    monkeypatch.setattr(fullrun, "media_track", f("media", media))
    monkeypatch.setattr(fullrun, "study_track", f("studio", study))


def test_ordine_delle_fasi(fr, monkeypatch):
    chiamate = []
    _fasi(monkeypatch, chiamate)
    fullrun.run()
    assert chiamate[:2] == ["moodle", "media"] and sorted(chiamate) == ["media", "moodle", "studio"]
    st = fullrun.status()
    assert st["phase"] == "Finito" and st["finished_at"] and st["alive"] is False
    assert fr == ["StudyHub: elaborazione completa finita"]
    assert not fullrun.is_running()  # il file può restare: conta che non sia bloccato


def test_secondo_fullrun_non_parte(fr, monkeypatch):
    chiamate = []
    _fasi(monkeypatch, chiamate)
    fullrun.LOCK_FILE.parent.mkdir(parents=True, exist_ok=True)
    with file_lock(fullrun.LOCK_FILE, "primo fullrun", timeout=0):  # un altro fullrun sta lavorando
        assert fullrun.is_running()
        fullrun.run()
    assert chiamate == [] and fr == []
    assert not fullrun.is_running()


def test_lock_rilasciato_anche_se_la_fase_studio_esplode(fr, monkeypatch):
    _fasi(monkeypatch, [], study=RuntimeError("bug nello studio"))
    with pytest.raises(RuntimeError, match="bug nello studio"):
        fullrun.run()
    assert not fullrun.is_running()
    # e un nuovo giro può partire
    chiamate = []
    _fasi(monkeypatch, chiamate)
    fullrun.run()
    assert "studio" in chiamate


def test_errore_della_fase_moodle_e_registrato_e_lo_studio_prosegue(fr, monkeypatch):
    chiamate = []
    _fasi(monkeypatch, chiamate, moodle=RuntimeError("Moodle giù"))
    fullrun.run()
    assert "studio" in chiamate
    st = fullrun.status()
    assert "Moodle giù" in st["media"]["error"] and st["phase"] == "Finito"


def test_errore_delle_registrazioni_non_blocca_lo_studio(fr, monkeypatch):
    chiamate = []
    _fasi(monkeypatch, chiamate, media=RuntimeError("Panopto rotto"))
    fullrun.run()
    assert chiamate.count("studio") == 1
    assert "Panopto rotto" in fullrun.status()["media"]["error"]


def test_study_track_attende_la_fine_delle_registrazioni(fr, monkeypatch):
    """Il lavoro di studio termina solo quando le registrazioni sono finite (media_done) e non c'è altro da fare."""
    from studyhub.study import bank
    monkeypatch.setattr(bank, "release_stale", lambda: None)
    monkeypatch.setattr(fullrun, "_claude_busy", lambda: None)
    monkeypatch.setattr(fullrun.time, "sleep", lambda s: None)
    giri = []

    def release():
        giri.append(1)
        if len(giri) == 3:
            done.set()

    monkeypatch.setattr(bank, "release_stale", release)
    done = threading.Event()
    fullrun.study_track(done)
    assert len(giri) == 3


# --- fase Moodle ---------------------------------------------------------------------------------------------

def test_moodle_phase_indicizza_tutti_i_corsi_anche_se_uno_fallisce(fr, db, monkeypatch):
    inserisci_corso(db, 1, "Analisi 2", priority=2)
    inserisci_corso(db, 2, "Fisica", priority=1)
    db.commit()
    monkeypatch.setattr(fullrun, "wait_login", lambda ok, what: object())
    monkeypatch.setattr("studyhub.autosync.run", lambda **kw: {"file": 3, "lezioni": 0, "avvisi": 0, "errori": ["x"] * 12})
    indicizzati = []

    def index_course(c):
        if c["id"] == 1:
            raise RuntimeError("indice rotto")
        indicizzati.append(c["id"])

    monkeypatch.setattr("studyhub.ingest.indexer.index_course", index_course)
    monkeypatch.setattr("studyhub.ingest.indexer.embed_pending", lambda *a, **k: (_ for _ in ()).throw(EmbeddingError("off")))
    fullrun.moodle_phase()  # nessuna eccezione: indice rotto ed Ollama spento non sono fatali
    assert indicizzati == [2]
    assert fullrun.state["moodle"] == {"file": 3, "errori": ["x"] * 10}


def test_moodle_phase_senza_login_esce(fr, monkeypatch):
    monkeypatch.setattr(fullrun, "wait_login", lambda ok, what: None)
    monkeypatch.setattr("studyhub.autosync.run", lambda **kw: pytest.fail("senza login non si scarica"))
    fullrun.moodle_phase()


def test_wait_login_segnala_nell_app_e_riprova(fr, monkeypatch):
    from studyhub.sync.auth import LoginRequired
    esiti = [LoginRequired("no"), "sessione"]

    def get_session(token_only_ok):
        e = esiti.pop(0)
        if isinstance(e, Exception):
            raise e
        return e

    attese = []
    monkeypatch.setattr(fullrun, "get_session", get_session)
    monkeypatch.setattr(fullrun.time, "sleep", attese.append)
    assert fullrun.wait_login(True, "Moodle") == "sessione"
    assert attese == [600] and "Moodle" in fullrun.state["login"]


# --- registrazioni -------------------------------------------------------------------------------------------

def test_media_track_riprova_tre_volte_e_continua(fr, db, monkeypatch):
    inserisci_corso(db, 1, "Analisi 2")
    inserisci_corso(db, 2, "Fisica")
    db.commit()
    import studyhub.media.pipeline as pipeline
    import studyhub.sync.moodle as moodle_mod

    class M:
        def __init__(self, s):
            pass

        def close(self):
            pass

    monkeypatch.setattr(moodle_mod, "Moodle", M)
    ordine = []

    def discover(course):
        if course["id"] == 2:
            raise RuntimeError("rete caduta")  # un corso irraggiungibile non ferma gli altri
        return [{"title": "rotta", "status": "nuova", "date": "2026-01-01"},
                {"title": "buona", "status": "nuova", "date": "2026-02-01"},
                {"title": "gia fatta", "status": "trascritta", "date": "2026-03-01"}]

    def process(lec, course, m, whisper=True):
        ordine.append(lec["title"])
        if lec["title"] == "rotta":
            raise RuntimeError("download fallito")

    monkeypatch.setattr(pipeline, "discover_moodle_videos", discover)
    monkeypatch.setattr(pipeline, "process_moodle_video", process)
    monkeypatch.setattr(fullrun.time, "sleep", lambda s: None)
    logins = []

    def wait_login(ok, what):
        logins.append(what)
        return object() if ok else None  # Panopto: login non fatto

    monkeypatch.setattr(fullrun, "wait_login", wait_login)
    fullrun.media_track()
    assert ordine == ["rotta"] * 3 + ["buona"]           # 3 tentativi, poi si va avanti
    media = fullrun.state["media"]
    assert media["done"] == 1 and media["errors"] == 1 and media["total"] == 2
    assert "saltato" in media["panopto"] and media["current"] is None
    assert logins == ["Video Moodle", "Registrazioni Panopto"]


def test_is_running_vero_mentre_un_fullrun_lavora(fr, monkeypatch):
    """Regressione: su Linux `os.remove` riesce anche su un file aperto, quindi il vecchio controllo diceva sempre
    «non in corso» e un secondo fullrun partiva sopra il primo. Ora conta il lock di sistema."""
    visto = {}

    def studio(done):
        visto["running"] = fullrun.is_running()
        visto["status_alive"] = fullrun.status().get("alive")
        # un secondo fullrun, lanciato mentre il primo lavora, deve uscire senza fare nulla
        fullrun.run()
        visto["file_dopo_secondo"] = fullrun.LOCK_FILE.exists()

    chiamate = []
    monkeypatch.setattr(fullrun, "moodle_phase", lambda: chiamate.append("moodle"))
    monkeypatch.setattr(fullrun, "media_track", lambda: chiamate.append("media"))
    monkeypatch.setattr(fullrun, "study_track", studio)
    fullrun.run()
    assert visto == {"running": True, "status_alive": True, "file_dopo_secondo": True}
    assert chiamate == ["moodle", "media"]  # il secondo run non ha rilanciato le fasi
    assert not fullrun.is_running()
