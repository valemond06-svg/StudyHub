import json
from datetime import datetime, timedelta, timezone

import pytest
from fsrs import Card

from conftest import inserisci_corso
from studyhub.db import session
from studyhub.study import flashcards as fc


def _scrivi_appunti(ambiente, flashcard, lecture_id=10, course_id=1, nome="appunti.json"):
    from studyhub.config import settings
    p = settings.uni_root / nome
    p.write_text(json.dumps({"flashcard": flashcard}), encoding="utf-8")
    with session() as db:
        db.execute("INSERT INTO ai_outputs (kind, target_id, course_id, input_hash, json_path) VALUES "
                   "('lecture_notes', ?, ?, 'h', ?)", (lecture_id, course_id, nome))


def _nuova_carta(db, front="Cos'è un autovalore?", due=None):
    card = Card()
    due = due or fc._iso(card.due)
    return db.execute("INSERT INTO flashcards (course_id, front, back, fsrs, due) VALUES (1, ?, 'r', ?, ?)",
                      (front, card.to_json(), due)).lastrowid


def test_iso_e_sempre_utc_al_secondo():
    dt = datetime(2026, 11, 12, 10, 30, 15, 999999, tzinfo=timezone(timedelta(hours=1)))
    assert fc._iso(dt) == "2026-11-12T09:30:15+00:00"


def test_chiave_ignora_maiuscole_e_spazi_ma_non_la_lezione():
    assert fc._key(1, " Ciao ") == fc._key(1, "ciao")
    assert fc._key(1, "ciao") != fc._key(2, "ciao")


def test_importa_senza_doppioni(ambiente, db):
    inserisci_corso(db)
    db.commit()
    _scrivi_appunti(ambiente, [{"fronte": "A?", "retro": "a", "inizio_s": 12.5}, {"fronte": "B?", "retro": "b"}])
    assert fc.import_from_notes() == 2
    assert fc.import_from_notes() == 0  # reimportando non si duplica
    assert fc.import_from_notes(course_id=1) == 0
    with session() as d:
        r = d.execute("SELECT t_start, origin, due FROM flashcards WHERE front='A?'").fetchone()
    assert r["t_start"] == 12.5 and r["origin"] == "ai"
    assert r["due"] <= fc._now_iso()  # una carta nuova è subito da ripassare


def test_import_usa_solo_la_versione_piu_recente_degli_appunti(ambiente, db):
    inserisci_corso(db)
    db.commit()
    _scrivi_appunti(ambiente, [{"fronte": "VECCHIA", "retro": "x"}], nome="v1.json")
    _scrivi_appunti(ambiente, [{"fronte": "NUOVA", "retro": "y"}], nome="v2.json")
    assert fc.import_from_notes() == 1
    with session() as d:
        assert [r[0] for r in d.execute("SELECT front FROM flashcards")] == ["NUOVA"]


def test_import_salta_file_mancanti(ambiente, db):
    inserisci_corso(db)
    db.execute("INSERT INTO ai_outputs (kind, target_id, course_id, input_hash, json_path) VALUES "
               "('lecture_notes', 1, 1, 'h', 'non_esiste.json')")
    db.commit()
    assert fc.import_from_notes() == 0


def test_due_cards_esclude_sospese_futuro_e_altri_corsi(ambiente, db):
    inserisci_corso(db, 1)
    inserisci_corso(db, 2, "Fisica")
    passato = fc._iso(datetime.now(timezone.utc) - timedelta(days=1))
    futuro = fc._iso(datetime.now(timezone.utc) + timedelta(days=3))
    ok = _nuova_carta(db, "scaduta", passato)
    _nuova_carta(db, "futura", futuro)
    sosp = _nuova_carta(db, "sospesa", passato)
    db.execute("UPDATE flashcards SET suspended=1 WHERE id=?", (sosp,))
    altro = _nuova_carta(db, "altro corso", passato)
    db.execute("UPDATE flashcards SET course_id=2 WHERE id=?", (altro,))
    db.commit()
    ids = [c["id"] for c in fc.due_cards()]
    assert sorted(ids) == sorted([ok, altro])
    assert [c["id"] for c in fc.due_cards(course_id=1)] == [ok]
    assert all("fsrs" not in c for c in fc.due_cards())  # lo stato interno non esce
    assert len(fc.due_cards(limit=1)) == 1


def test_stats_conta_correttamente_con_e_senza_corso(ambiente, db):
    inserisci_corso(db, 1)
    inserisci_corso(db, 2, "Fisica")
    futuro = fc._iso(datetime.now(timezone.utc) + timedelta(days=3))
    _nuova_carta(db, "a")
    b = _nuova_carta(db, "b", futuro)
    db.execute("UPDATE flashcards SET course_id=2 WHERE id=?", (b,))
    db.commit()
    assert fc.stats() == {"totale": 2, "da_ripassare": 1, "ripassate_oggi": 0}
    assert fc.stats(course_id=1)["da_ripassare"] == 1
    assert fc.stats(course_id=2) == {"totale": 1, "da_ripassare": 0, "ripassate_oggi": 0}


def test_review_sposta_la_scadenza_e_registra_il_voto(ambiente, db):
    inserisci_corso(db)
    cid = _nuova_carta(db)
    db.commit()
    prima = fc._now_iso()
    esito = fc.review(cid, 3)
    assert esito["due"] > prima  # dopo "Good" la carta non è più scaduta
    with session() as d:
        assert d.execute("SELECT due FROM flashcards WHERE id=?", (cid,)).fetchone()[0] == esito["due"]
        rev = d.execute("SELECT rating FROM reviews WHERE card_id=?", (cid,)).fetchall()
    assert [r[0] for r in rev] == [3]
    assert fc.stats()["ripassate_oggi"] == 1


def test_review_again_torna_prima_di_easy(ambiente, db):
    inserisci_corso(db)
    a, b = _nuova_carta(db, "a"), _nuova_carta(db, "b")
    db.commit()
    assert fc.review(a, 1)["due"] < fc.review(b, 4)["due"]


def test_review_carta_inesistente(ambiente):
    with pytest.raises(KeyError):
        fc.review(999, 3)


def test_review_voto_non_valido_non_scrive_nulla(ambiente, db):
    inserisci_corso(db)
    cid = _nuova_carta(db)
    db.commit()
    with pytest.raises(KeyError):
        fc.review(cid, 9)
    with session() as d:
        assert d.execute("SELECT COUNT(*) FROM reviews").fetchone()[0] == 0


def test_anki_tsv_formato_e_tag(ambiente, db):
    inserisci_corso(db, 1, "Algebra Lineare (2026)")
    db.execute("INSERT INTO flashcards (course_id, front, back, fsrs, due) VALUES (1, 'riga1\nriga2', 'r', '{}', 'x')")
    db.commit()
    righe = fc.anki_tsv().splitlines()
    assert righe[:3] == ["#separator:tab", "#html:true", "#tags column:3"]
    assert righe[3] == "riga1<br>riga2\tr\tAlgebra_Lineare__2026_"
