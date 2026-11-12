import json
from datetime import datetime, timedelta

import pytest

from conftest import inserisci_corso
from studyhub.db import session
from studyhub.study import bank


def _unita(db, uid=1, cid=1, day="2026-10-01"):
    db.execute("INSERT INTO study_units (id, course_id, kind, ref_id, title, day) VALUES (?,?, 'lezione', 1, 'U', ?)",
               (uid, cid, day))
    return {"id": uid, "day": day}


def _dom(tipo="richiamo", testo="Definisci X.", argomento="Limiti", opzioni=None, corretta=-1, **kw):
    base = {"argomento": argomento, "tipo": tipo, "difficolta": 2, "testo_md": testo, "opzioni": opzioni or [],
            "corretta": corretta, "risposta_md": "r", "criteri": []}
    base.update(kw)
    return base


def _dati(*domande, argomenti=("Limiti",)):
    return {"argomenti": [{"nome": a, "peso": "alto", "scheda_md": "s"} for a in argomenti], "domande": list(domande)}


def _righe(db):
    return [dict(r) for r in db.execute("SELECT * FROM study_items ORDER BY id")]


# --- _store: domande a risposta multipla -------------------------------------------

def test_multipla_viene_salvata_con_indice_corretto_dopo_il_rimescolamento(ambiente, db):
    """Difetto reale: il ramo 'multipla' finiva con `continue` e scartava TUTTE le crocette."""
    inserisci_corso(db)
    u = _unita(db)
    db.commit()
    opz = ["uno", "due", "tre", "quattro"]
    for i, giusta in enumerate(opz):
        data = _dati(_dom("multipla", f"Domanda {i}?", opzioni=list(opz), corretta=i))
        bank._store(u, 1, data, {})
        with session() as d:
            r = dict(d.execute("SELECT * FROM study_items WHERE prompt_md=?", (f"Domanda {i}?",)).fetchone())
        salvate = json.loads(r["options"])
        assert sorted(salvate) == sorted(opz)           # nessuna opzione persa o duplicata
        assert salvate[r["correct"]] == giusta          # l'indice punta ancora alla risposta giusta


def test_il_rimescolamento_cambia_davvero_l_ordine(ambiente, db, monkeypatch):
    inserisci_corso(db)
    u = _unita(db)
    db.commit()
    monkeypatch.setattr("random.shuffle", lambda lst: lst.reverse())
    bank._store(u, 1, _dati(_dom("multipla", opzioni=["a", "b", "c", "d"], corretta=0)), {})
    with session() as d:
        r = dict(d.execute("SELECT * FROM study_items").fetchone())
    assert json.loads(r["options"]) == ["d", "c", "b", "a"] and r["correct"] == 3


def test_multipla_con_indice_fuori_range_o_poche_opzioni_scartata(ambiente, db):
    inserisci_corso(db)
    u = _unita(db)
    db.commit()
    n = bank._store(u, 1, _dati(
        _dom("multipla", "a?", opzioni=["x", "y"], corretta=2),
        _dom("multipla", "b?", opzioni=["x", "y"], corretta=-1),
        _dom("multipla", "c?", opzioni=["solo"], corretta=0),
    ), {})
    assert n == 0


def test_vero_falso_richiede_0_o_1(ambiente, db):
    inserisci_corso(db)
    u = _unita(db)
    db.commit()
    n = bank._store(u, 1, _dati(_dom("vero_falso", "v?", corretta=1), _dom("vero_falso", "f?", corretta=0),
                                _dom("vero_falso", "x?", corretta=-1), _dom("vero_falso", "y?", corretta=2)), {})
    assert n == 2


def test_tipo_sconosciuto_e_difficolta_fuori_scala(ambiente, db):
    inserisci_corso(db)
    u = _unita(db)
    db.commit()
    n = bank._store(u, 1, _dati(_dom("indovinello", "z?"), _dom("richiamo", "ok?", difficolta=9)), {})
    assert n == 1
    with session() as d:
        assert d.execute("SELECT difficulty FROM study_items").fetchone()[0] == 3
    # `difficolta` null (modello locale distratto) non deve far cadere tutto
    bank._store(u, 1, _dati(_dom("richiamo", "nuovo?", difficolta=None)), {})
    with session() as d:
        assert d.execute("SELECT difficulty FROM study_items WHERE prompt_md='nuovo?'").fetchone()[0] == 2


def test_argomento_sconosciuto_va_al_primo_argomento(ambiente, db):
    inserisci_corso(db)
    u = _unita(db)
    db.commit()
    bank._store(u, 1, _dati(_dom("richiamo", argomento="Inventato"), argomenti=("A", "B")), {})
    with session() as d:
        topic = d.execute("SELECT t.name FROM study_items i JOIN study_topics t ON t.id=i.topic_id").fetchone()[0]
    assert topic == "A"


def test_ristore_non_duplica_e_riattiva_le_domande(ambiente, db):
    inserisci_corso(db)
    u = _unita(db)
    db.commit()
    dati = _dati(_dom("richiamo", "stessa?"))
    assert bank._store(u, 1, dati, {}) == 1
    with session() as d:  # ci rispondo: ha uno storico, quindi non verrà cancellata
        d.execute("INSERT INTO study_attempts (item_id, score, created_at) VALUES (1, 1, 'x')")
    assert bank._store(u, 1, dati, {}) == 0           # non è "nuova"...
    with session() as d:
        righe = _righe(d)
    assert len(righe) == 1 and righe[0]["suspended"] == 0   # ...ma resta attiva


def test_rigenerazione_cancella_mai_usate_e_sospende_quelle_con_storico(ambiente, db):
    inserisci_corso(db)
    u = _unita(db)
    db.commit()
    bank._store(u, 1, _dati(_dom("richiamo", "vecchia mai usata?"), _dom("richiamo", "vecchia usata?")), {})
    with session() as d:
        usata = d.execute("SELECT id FROM study_items WHERE prompt_md='vecchia usata?'").fetchone()[0]
        d.execute("INSERT INTO study_attempts (item_id, score, created_at) VALUES (?, 1, 'x')", (usata,))
    bank._store(u, 1, _dati(_dom("richiamo", "nuova?")), {})
    with session() as d:
        stato = {r["prompt_md"]: r["suspended"] for r in d.execute("SELECT prompt_md, suspended FROM study_items")}
    assert stato == {"vecchia usata?": 1, "nuova?": 0}


def test_argomento_gia_esistente_retrodatato_se_visto_prima(ambiente, db):
    inserisci_corso(db)
    db.execute("INSERT INTO study_units (id, course_id, kind, ref_id, day) VALUES (1,1,'lezione',1,'2026-10-20')")
    db.execute("INSERT INTO study_units (id, course_id, kind, ref_id, day) VALUES (2,1,'lezione',2,'2026-10-05')")
    db.commit()
    bank._store({"id": 1, "day": "2026-10-20"}, 1, _dati(), {})
    bank._store({"id": 2, "day": "2026-10-05"}, 1, _dati(), {})
    with session() as d:
        t = dict(d.execute("SELECT * FROM study_topics").fetchone())
    assert t["day"] == "2026-10-05" and t["unit_id"] == 2


def test_pesi_degli_argomenti(ambiente, db):
    inserisci_corso(db)
    u = _unita(db)
    db.commit()
    dati = {"argomenti": [{"nome": "A", "peso": "alto"}, {"nome": "B", "peso": "basso"}, {"nome": "C", "peso": "boh"}],
            "domande": []}
    bank._store(u, 1, dati, {})
    with session() as d:
        pesi = {r["name"]: r["weight"] for r in d.execute("SELECT name, weight FROM study_topics")}
    assert pesi == {"A": 3, "B": 1, "C": 2}


# --- suddivisione e confronto --------------------------------------------------------

def test_doc_parts_rispetta_limiti_di_caratteri_e_pagine():
    assert bank._doc_parts([100] * 5) == [(1, 5)]
    assert bank._doc_parts([20_000, 20_000, 20_000]) == [(1, 1), (2, 2), (3, 3)]
    assert bank._doc_parts([10] * 65) == [(1, 30), (31, 60), (61, 65)]
    assert bank._doc_parts([50_000, 10]) == [(1, 1), (2, 2)]
    parts = bank._doc_parts([7_000] * 10)
    assert parts[0][0] == 1 and parts[-1][1] == 10
    assert all(b >= a for a, b in parts) and all(parts[i][1] + 1 == parts[i + 1][0] for i in range(len(parts) - 1))


def test_similarita_jaccard():
    assert bank._similar(frozenset("abcd"), frozenset("abcd")) == 1.0
    assert bank._similar(frozenset("ab"), frozenset("cd")) == 0.0
    assert bank._similar(frozenset(), frozenset("a")) == 0.0
    assert bank._similar(frozenset("abc"), frozenset("abd")) == pytest.approx(0.5)


def test_corso_finito_solo_se_anno_accademico_diverso(ambiente):
    from studyhub.config import settings
    assert not bank.course_finished({"academic_year": settings.current_academic_year})
    assert not bank.course_finished({"academic_year": None})
    assert bank.course_finished({"academic_year": "2019/20"})


def test_doc_day_da_nome_file_poi_moodle_poi_mtime(ambiente, db):
    assert bank._doc_day(db, {"path": "x/20251009-slide.pdf", "mtime": None}) == "2025-10-09"
    assert bank._doc_day(db, {"path": "x/slide_2025_13_45.pdf", "mtime": None}) == "9999-12-31"  # data impossibile
    assert bank._doc_day(db, {"path": "x/slide.pdf", "mtime": None}) == "9999-12-31"
    inserisci_corso(db)
    db.execute("INSERT INTO files (course_id, source_url, path, timemodified) VALUES (1, 'u', 'x/m.pdf', 1700000000)")
    assert bank._doc_day(db, {"path": "x/m.pdf", "mtime": None}) == "2023-11-14"


# --- presa in carico delle unità -----------------------------------------------------

def test_claim_una_sola_volta_e_release_stale(ambiente, db):
    inserisci_corso(db)
    _unita(db)
    db.commit()
    assert bank.claim(1) is True
    assert bank.claim(1) is False  # già in corso: nessun doppio lavoro
    with session() as d:
        d.execute("UPDATE study_units SET done_at=? WHERE id=1",
                  ((datetime.now() - timedelta(minutes=5)).isoformat(timespec="seconds"),))
    assert bank.release_stale(40) == 0                # presa in carico da poco: resta in corso
    with session() as d:
        d.execute("UPDATE study_units SET done_at=? WHERE id=1",
                  ((datetime.now() - timedelta(minutes=90)).isoformat(timespec="seconds"),))
    assert bank.release_stale(40) == 1
    assert bank.claim(1) is True


def test_run_claimed_rate_limit_rimette_in_coda_ed_errore_segna_errore(ambiente, db, monkeypatch):
    from studyhub.ai.claude_runner import RateLimited
    inserisci_corso(db)
    _unita(db)
    db.commit()

    def limite(uid):
        raise RateLimited("quota finita")
    monkeypatch.setattr(bank, "prepare_unit", limite)
    bank.claim(1)
    assert bank.run_claimed(1) == "quota finita"
    with session() as d:
        assert d.execute("SELECT status FROM study_units WHERE id=1").fetchone()[0] == "nuova"

    def rotto(uid):
        raise RuntimeError("boom")
    monkeypatch.setattr(bank, "prepare_unit", rotto)
    bank.claim(1)
    assert bank.run_claimed(1) is None
    with session() as d:
        r = d.execute("SELECT status, message FROM study_units WHERE id=1").fetchone()
    assert (r["status"], r["message"]) == ("errore", "boom")
