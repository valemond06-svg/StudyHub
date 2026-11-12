import json
from datetime import date, datetime, timedelta, timezone

import pytest
from fsrs import Card, Rating

from conftest import inserisci_corso
from studyhub.db import session
from studyhub.study import mastery as ms
from studyhub.study.flashcards import _iso, scheduler


def _carta_ripassata(giorni_fa=0, rating=Rating.Good):
    """Carta con una revisione fatta `giorni_fa` giorni fa."""
    t = datetime.now(timezone.utc) - timedelta(days=giorni_fa)
    card, _ = scheduler.review_card(Card(), rating, review_datetime=t)
    return card


def _item(db, tid, kind="richiamo", card=None, topic_weight=2, cid=1, suspended=0):
    if not db.execute("SELECT 1 FROM study_topics WHERE id=?", (tid,)).fetchone():
        db.execute("INSERT INTO study_topics (id, course_id, name, weight) VALUES (?,?,?,?)",
                   (tid, cid, f"T{tid}", topic_weight))
    if not db.execute("SELECT 1 FROM study_units WHERE id=1").fetchone():
        db.execute("INSERT INTO study_units (id, course_id, kind, ref_id) VALUES (1, ?, 'lezione', 1)", (cid,))
    return db.execute(
        """INSERT INTO study_items (course_id, unit_id, topic_id, kind, prompt_md, answer_md, fsrs, due, suspended)
           VALUES (?,1,?,?,'d','r',?,?,?)""",
        (cid, tid, kind, card.to_json() if card else None, _iso(card.due) if card else None, suspended)).lastrowid


def _tentativo(db, item, score, giorno="2026-11-10", conf=None):
    db.execute("INSERT INTO study_attempts (item_id, score, confidence, created_at) VALUES (?,?,?,?)",
               (item, score, conf, f"{giorno}T10:00:00"))


def test_level_soglie():
    assert ms.level(0.95) == (4, "Pronto")
    assert ms.level(0.9) == (4, "Pronto")
    assert ms.level(0.75)[1] == "Solido"
    assert ms.level(0.5)[1] == "In crescita"
    assert ms.level(0.2)[1] == "Fragile"
    assert ms.level(0.0)[1] == "Da iniziare"
    assert ms.level(0.99, attempted=False) == (0, "Mai provato")


def test_domanda_mai_provata_vale_zero():
    assert ms.item_mastery({"fsrs": None, "quality": 1.0}, datetime.now(timezone.utc)) == 0.0


def test_padronanza_cala_col_tempo_e_scala_con_la_qualita():
    card = _carta_ripassata(0)
    subito = ms.item_mastery({"fsrs": card.to_json(), "quality": 1.0}, datetime.now(timezone.utc))
    tra_un_anno = ms.item_mastery({"fsrs": card.to_json(), "quality": 1.0},
                                  datetime.now(timezone.utc) + timedelta(days=365))
    meta = ms.item_mastery({"fsrs": card.to_json(), "quality": 0.5}, datetime.now(timezone.utc))
    assert subito > 0.95
    assert tra_un_anno < subito * 0.7
    assert meta == pytest.approx(subito * 0.5)


def test_media_pesata_per_tipo_di_domanda_incluse_le_mai_provate():
    now = datetime.now(timezone.utc)
    card = _carta_ripassata(0).to_json()
    items = [
        {"topic_id": 1, "kind": "esercizio", "fsrs": card, "quality": 1.0, "attempts": 1},   # peso 2, ~1
        {"topic_id": 1, "kind": "vero_falso", "fsrs": None, "quality": 0.0, "attempts": 0},  # peso 0.5, 0
    ]
    r = ms.topic_mastery(items, now)[1]
    assert r["n"] == 2 and r["tried"] == 1
    assert r["m"] == pytest.approx(2.0 * ms.item_mastery(items[0], now) / 2.5)
    assert r["m"] < 0.85  # la domanda mai provata abbassa l'argomento


def test_item_states_qualita_media_mobile_e_filtri(ambiente, db):
    inserisci_corso(db)
    a = _item(db, 1, card=_carta_ripassata(0))
    _item(db, 1, suspended=1)                      # sospesa: fuori
    nascosto = _item(db, 2)                        # argomento nascosto: fuori
    db.execute("UPDATE study_topics SET hidden=1 WHERE id=2")
    _tentativo(db, a, 0.0, "2026-11-08")
    _tentativo(db, a, 1.0, "2026-11-09")           # q = 0.6*1 + 0.4*0 = 0.6
    _tentativo(db, a, 0.8, "2026-11-09")           # q = 0.6*0.8 + 0.4*0.6 = 0.72
    db.commit()
    stati = ms.item_states(db, 1)
    assert [s["id"] for s in stati] == [a]
    s = stati[0]
    assert s["quality"] == pytest.approx(0.72)
    assert s["attempts"] == 3 and s["last_score"] == 0.8
    assert s["good_days"] == 1  # due risposte >=0.7 ma nello stesso giorno


def test_streak_richiede_dieci_risposte_al_giorno(ambiente, db):
    inserisci_corso(db)
    i = _item(db, 1)
    oggi, ieri, altroieri = (date.today() - timedelta(days=n) for n in (0, 1, 2))
    for giorno, n in ((oggi, 10), (ieri, 10), (altroieri, 9)):  # altroieri: 9 sono poche
        for _ in range(n):
            _tentativo(db, i, 1.0, giorno.isoformat())
    db.commit()
    assert ms._streak(db) == 2


def test_streak_oggi_non_ancora_fatto_non_azzera(ambiente, db):
    inserisci_corso(db)
    i = _item(db, 1)
    for n in (1, 2):
        for _ in range(10):
            _tentativo(db, i, 1.0, (date.today() - timedelta(days=n)).isoformat())
    db.commit()
    assert ms._streak(db) == 2


def test_streak_vuota(ambiente, db):
    assert ms._streak(db) == 0


def test_stima_voto_onesta():
    assert ms.estimated_grade(0.9, 0.3) is None          # copertura insufficiente: nessuna promessa
    assert ms.estimated_grade(0.5, 0.9) == "sotto il 18"
    assert ms.estimated_grade(0.55, 0.9) == "18/30"
    assert ms.estimated_grade(0.95, 0.9) == "30/30"
    assert ms.estimated_grade(1.0, 0.9) == "30/30"       # mai oltre 30


def test_verdetto_casi():
    vuoto = ms.verdict([], 0, 0, None)
    assert vuoto["title"].startswith("Ancora niente")
    t = [{"id": 1, "name": "X", "weight": 3, "level": 4, "level_name": "Pronto", "tried": 1, "m": 0.95}]
    assert ms.verdict(t, 0.9, 0.9, None)["tone"] == "ok"
    gap = [{"id": 1, "name": "X", "weight": 3, "level": 1, "level_name": "Fragile", "tried": 1, "m": 0.2}]
    v = ms.verdict(gap, 0.9, 0.9, None)
    assert v["tone"] == "info" and v["gaps"][0]["name"] == "X"  # prontezza alta ma lacuna pesante: non "ok"
    assert ms.verdict(gap, 0.3, 0.1, None)["title"] == "Non sai ancora dove sei"
    assert ms.verdict(gap, 0.3, 0.8, {"date": "2026-12-01"})["title"] == "Non sei pronto"


def test_overview_corso_senza_domande(ambiente, db):
    inserisci_corso(db)
    db.commit()
    o = ms.overview(1)
    assert o["n_items"] == 0 and o["ready_now"] == 0.0 and o["grade_estimate"] is None
    assert o["verdict"]["tone"] == "info"


def test_overview_proietta_alla_data_dell_appello(ambiente, db):
    inserisci_corso(db)
    i = _item(db, 1, card=_carta_ripassata(0))
    _tentativo(db, i, 1.0, date.today().isoformat())
    scadenza = (date.today() + timedelta(days=200)).isoformat()
    db.execute("INSERT INTO exams (course_id, date) VALUES (1, ?)", (scadenza,))
    db.commit()
    o = ms.overview(1)
    assert o["exam"]["days_left"] == 200
    assert o["horizon"] == scadenza
    assert o["ready_exam"] < o["ready_now"]       # il tempo fa dimenticare
    assert o["coverage"] == 1.0
    assert o["topics"][0]["tried"] == 1


def test_overview_esami_passati_o_finiti_ignorati(ambiente, db):
    inserisci_corso(db)
    db.execute("INSERT INTO exams (course_id, date) VALUES (1, ?)", ((date.today() - timedelta(days=3)).isoformat(),))
    db.execute("INSERT INTO exams (course_id, date, done) VALUES (1, ?, 1)", ((date.today() + timedelta(days=3)).isoformat(),))
    db.commit()
    assert ms.overview(1)["exam"] is None
