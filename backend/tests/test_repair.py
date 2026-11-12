import json

from typer.testing import CliRunner

from conftest import inserisci_corso
from studyhub.cli import app
from studyhub.db import session
from studyhub.study import bank, repair


def _unita(db, uid, status="pronta", kinds=(), cid=1):
    db.execute("INSERT INTO study_units (id, course_id, kind, ref_id, title, day, status, source_hash) "
               "VALUES (?,?, 'lezione', ?, ?, '2026-11-01', ?, 'HASH')", (uid, cid, uid, f"U{uid}", status))
    if not db.execute("SELECT 1 FROM study_topics WHERE id=1").fetchone():
        db.execute("INSERT INTO study_topics (id, course_id, name) VALUES (1, ?, 'T')", (cid,))
    for n, k in enumerate(kinds):
        db.execute("INSERT INTO study_items (course_id, unit_id, topic_id, kind, prompt_md, answer_md, suspended) "
                   "VALUES (?,?,1,?,?,'r',?)", (cid, uid, k, f"q{uid}-{n}", 1 if k == "multipla" and n == 99 else 0))


def _scenario(db):
    inserisci_corso(db)
    _unita(db, 1, kinds=("richiamo", "aperta"))          # da riparare
    _unita(db, 2, kinds=("richiamo", "multipla"))        # a posto
    _unita(db, 3, kinds=())                              # pronta ma vuota: da riparare
    _unita(db, 4, status="nuova", kinds=("richiamo",))   # non pronta: non si tocca
    db.commit()


def test_elenca_solo_le_pronte_senza_nessuna_multipla(ambiente, db):
    _scenario(db)
    assert [u["id"] for u in repair.units_without_multiple_choice(db)] == [1, 3]


def test_una_multipla_sospesa_conta_come_presente(ambiente, db):
    inserisci_corso(db)
    _unita(db, 1, kinds=("multipla",))
    db.execute("UPDATE study_items SET suspended=1")
    db.commit()
    assert repair.units_without_multiple_choice(db) == []


def test_cli_di_default_non_modifica_nulla(ambiente, db):
    _scenario(db)
    r = CliRunner().invoke(app, ["ripara-crocette"])
    assert r.exit_code == 0 and "2 unità pronte" in r.output and "Nessuna modifica" in r.output
    with session() as d:
        assert {x["status"] for x in d.execute("SELECT status FROM study_units")} == {"pronta", "nuova"}
        assert d.execute("SELECT COUNT(*) FROM study_units WHERE source_hash IS NULL").fetchone()[0] == 0
    assert not list(ambiente.glob("*.bak-*"))


def test_cli_applica_fa_il_backup_e_rimette_in_coda(ambiente, db):
    _scenario(db)
    r = CliRunner().invoke(app, ["ripara-crocette", "--applica"])
    assert r.exit_code == 0 and "2 unità rimesse in coda" in r.output
    bak = list(ambiente.glob("test.db.bak-*"))
    assert len(bak) == 1
    with session() as d:
        st = {x["id"]: (x["status"], x["source_hash"]) for x in d.execute("SELECT id, status, source_hash FROM study_units")}
    assert st == {1: ("nuova", None), 2: ("pronta", "HASH"), 3: ("nuova", None), 4: ("nuova", "HASH")}
    import sqlite3
    c = sqlite3.connect(bak[0])   # il backup ha lo stato PRIMA della modifica
    assert c.execute("SELECT status FROM study_units WHERE id=1").fetchone()[0] == "pronta"
    c.close()



def test_dopo_la_riparazione_la_rigenerazione_porta_le_crocette_e_conserva_lo_storico(ambiente, db, monkeypatch):
    """Giro completo: unità pronta senza crocette -> requeue -> prepare_unit rigenera (hash azzerato) -> ci sono le multiple,
    e la domanda con storico resta."""
    inserisci_corso(db)
    _unita(db, 1, kinds=("richiamo",))
    db.execute("INSERT INTO study_attempts (item_id, score, created_at) VALUES (1, 1, 'x')")
    db.commit()
    repair.requeue([1])
    dati = {"argomenti": [{"nome": "T", "peso": "alto", "scheda_md": "s"}],
            "domande": [{"argomento": "T", "tipo": "multipla", "difficolta": 2, "testo_md": "m?", "opzioni": ["a", "b", "c"],
                         "corretta": 1, "risposta_md": "r", "criteri": []}]}
    bank._store({"id": 1, "day": "2026-11-01"}, 1, dati, {})
    with session() as d:
        kinds = {r["kind"]: r["suspended"] for r in d.execute("SELECT kind, suspended FROM study_items")}
    assert kinds == {"richiamo": 1, "multipla": 0}   # storico sospeso (non perso), crocetta nuova attiva
    assert bank.claim(1) is True                      # e l'unità è di nuovo prendibile dal lavoro di preparazione
