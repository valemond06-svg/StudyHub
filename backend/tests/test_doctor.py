import sqlite3

from conftest import inserisci_corso
from studyhub import doctor
from studyhub.ai import llm


def test_database_sano(ambiente):
    ok, detail = doctor.check_database()
    assert ok and "schema v" in detail


def test_database_corrotto_segnalato_senza_eccezioni(ambiente):
    (ambiente / "test.db").write_bytes(b"questo non e' un database sqlite" * 50)
    ok, detail = doctor.check_database()
    assert not ok and "test.db" in detail


def test_database_con_schema_indietro_e_segnalato(ambiente):
    # un DB fermo alla versione 2: session() lo migra, quindi dopo il controllo e' aggiornato...
    from studyhub import db as dbmod
    conn = sqlite3.connect(ambiente / "test.db")
    for sql in dbmod.MIGRATIONS[:2]:
        conn.executescript(sql)
    conn.execute("PRAGMA user_version = 2")
    conn.commit()
    conn.close()
    ok, _ = doctor.check_database()
    assert ok  # ...e il controllo non lo lascia indietro


def test_cartelle_dei_corsi(ambiente, db):
    from studyhub.config import settings
    inserisci_corso(db, 1, "Algebra", folder="1_Anno/Algebra")
    inserisci_corso(db, 2, "Fisica", folder="1_Anno/Fisica")
    inserisci_corso(db, 3, "Archivio", folder="x", active=0)   # non attivo: ignorato
    db.commit()
    (settings.uni_root / "1_Anno" / "Algebra").mkdir(parents=True)
    ok, detail = doctor.check_cartelle_corsi()
    assert not ok and "1 su 2" in detail and "Fisica" in detail
    (settings.uni_root / "1_Anno" / "Fisica").mkdir()
    ok, detail = doctor.check_cartelle_corsi()
    assert ok and "2 cartelle" in detail


def test_modello_locale_dice_quale_server_risponde(monkeypatch, ambiente):
    monkeypatch.setattr(llm, "get_local_llm_url", lambda exclude=(): "http://127.0.0.1:8080")
    ok, detail = doctor.check_modello_locale()
    assert ok and "127.0.0.1:8080" in detail and "local" in detail


def test_modello_locale_assente_elenca_i_candidati_provati(monkeypatch, ambiente):
    monkeypatch.setattr(llm, "get_local_llm_url", lambda exclude=(): None)
    ok, detail = doctor.check_modello_locale()
    assert not ok and "127.0.0.1:8080" in detail and "10.10.10.1" in detail


def test_modello_locale_non_fa_mai_cadere_il_controllo(monkeypatch, ambiente):
    def boom(exclude=()):
        raise RuntimeError("rete in tilt")
    monkeypatch.setattr(llm, "get_local_llm_url", boom)
    ok, detail = doctor.check_modello_locale()
    assert not ok and "rete in tilt" in detail


def test_ffmpeg_presente_e_assente(monkeypatch):
    ok, _ = doctor.check_ffmpeg()
    assert ok   # il binario di imageio-ffmpeg e' una dipendenza del progetto
    from studyhub.media import ff
    monkeypatch.setattr(ff, "ffmpeg", lambda: "C:/non/esiste/ffmpeg.exe")
    ok, detail = doctor.check_ffmpeg()
    assert not ok and "non esiste" in detail


def _neutralizza_il_resto(monkeypatch):
    monkeypatch.setattr(doctor, "_ollama_models", lambda: None)
    monkeypatch.setattr(doctor, "_claude", lambda: None)
    monkeypatch.setattr(llm, "get_local_llm_url", lambda exclude=(): None)


def test_checks_include_i_nuovi_controlli_con_i_campi_attesi(ambiente, monkeypatch):
    _neutralizza_il_resto(monkeypatch)
    out = doctor.checks()
    ids = [c["id"] for c in out]
    for atteso in ("database", "corsi", "cartelle_corsi", "modello_locale", "ffmpeg", "gemini", "claude"):
        assert atteso in ids
    assert ids.index("database") < ids.index("corsi")        # prima il DB: se e' rotto il resto non ha senso
    assert all(set(c) == {"id", "ok", "required", "label", "detail", "fix"} for c in out)   # la UI se li aspetta
    locale = next(c for c in out if c["id"] == "modello_locale")
    assert locale["ok"] is False and locale["required"] is False and locale["fix"]


def test_modello_locale_obbligatorio_solo_se_e_l_unico_provider(ambiente, monkeypatch):
    from studyhub.config import settings
    _neutralizza_il_resto(monkeypatch)
    settings.extra["ai_provider"] = "local"
    assert next(c for c in doctor.checks() if c["id"] == "modello_locale")["required"] is True
    assert doctor.ready() is False


def test_checks_con_database_rotto_non_cade_e_non_e_pronto(ambiente, monkeypatch):
    _neutralizza_il_resto(monkeypatch)
    (ambiente / "test.db").write_bytes(b"spazzatura" * 100)
    out = doctor.checks()
    db = next(c for c in out if c["id"] == "database")
    assert db["ok"] is False and db["required"] and db["fix"]
    assert next(c for c in out if c["id"] == "corsi")["ok"] is False
    assert doctor.ready() is False


def test_endpoint_api_setup_espone_i_nuovi_controlli(ambiente, monkeypatch):
    from fastapi.testclient import TestClient
    from studyhub.api.app import app
    _neutralizza_il_resto(monkeypatch)
    r = TestClient(app).get("/api/setup")
    assert r.status_code == 200
    corpo = r.json()
    assert {"database", "modello_locale", "ffmpeg"} <= {c["id"] for c in corpo["checks"]}
    assert corpo["ready"] is False   # login/corsi mancanti in un ambiente vuoto
