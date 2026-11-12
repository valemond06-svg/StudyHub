import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fsrs import Rating

from conftest import inserisci_corso
from studyhub.db import session
from studyhub.study import quiz as quizmod
from studyhub.study import session as sess
from studyhub.study.flashcards import _iso


@pytest.fixture(autouse=True)
def senza_lezioni_in_background(monkeypatch):
    """`start()` accoda le lezioni con thread e chiamate AI: nei test non deve partire nulla."""
    monkeypatch.setattr("studyhub.study.lesson.request", lambda ids: None)


def _argomento(db, tid, nome=None, position=None, cid=1):
    db.execute("INSERT INTO study_topics (id, course_id, name, weight, position) VALUES (?,?,?,2,?)",
               (tid, cid, nome or f"T{tid}", position if position is not None else tid))


def _domanda(db, tid, kind="multipla", correct=1, difficulty=2, rubric=None, due=None, fsrs=None, cid=1):
    if not db.execute("SELECT 1 FROM study_units WHERE id=1").fetchone():
        db.execute("INSERT INTO study_units (id, course_id, kind, ref_id) VALUES (1, ?, 'lezione', 1)", (cid,))
    return db.execute(
        """INSERT INTO study_items (course_id, unit_id, topic_id, kind, difficulty, prompt_md, options, correct, answer_md,
                                    rubric, fsrs, due) VALUES (?,1,?,?,?,?,?,?,?,?,?,?)""",
        (cid, tid, kind, difficulty, f"D{tid}-{kind}", json.dumps(["a", "b", "c"]) if kind == "multipla" else None,
         correct, "risposta", json.dumps(rubric or []), fsrs, due)).lastrowid


def _risposta_ai(punteggio=1.0, criteri=None):
    def falso(system, text, schema, quality="accurato"):
        return SimpleNamespace(data={"punteggio": punteggio, "feedback_md": "ok", "criteri_ok": criteri or []},
                               provider="local", model="m", duration_s=0.1)
    return falso


# --- build_queue -----------------------------------------------------------------------

def test_coda_vuota_senza_domande_e_start_lo_dice(ambiente, db):
    inserisci_corso(db)
    db.commit()
    assert sess.build_queue(1, 30) == ([], {})
    with pytest.raises(ValueError, match="Nessuna domanda"):
        sess.start(1, 30)


def test_argomenti_nuovi_in_ordine_didattico_con_scheda_prima_delle_domande(ambiente, db):
    inserisci_corso(db)
    _argomento(db, 1, position=2)
    _argomento(db, 2, position=1)  # nel corso viene PRIMA, anche se ha id più alto
    for tid in (1, 2):
        _domanda(db, tid, "richiamo")
        _domanda(db, tid, "aperta")
    db.commit()
    coda, _ = sess.build_queue(1, 60)
    schede = [e["topic"] for e in coda if e["t"] == "scheda"]
    assert schede == [2, 1]
    assert coda[0] == {"t": "scheda", "topic": 2}
    assert coda[1]["t"] == "domanda"


def test_lezione_gia_completata_salta_la_scheda(ambiente, db):
    inserisci_corso(db)
    _argomento(db, 1)
    _domanda(db, 1, "richiamo")
    db.execute("INSERT INTO study_lessons (topic_id, status, completed_at) VALUES (1, 'pronta', 'x')")
    db.commit()
    coda, _ = sess.build_queue(1, 30)
    assert all(e["t"] == "domanda" for e in coda) and coda


def test_non_si_supera_il_budget_di_tempo_e_nessuna_domanda_e_ripetuta(ambiente, db):
    inserisci_corso(db)
    for tid in range(1, 7):
        _argomento(db, tid)
        for kind in ("richiamo", "multipla", "vero_falso", "aperta", "esercizio"):
            _domanda(db, tid, kind, correct=1 if kind != "richiamo" else None)
    db.commit()
    coda, _ = sess.build_queue(1, 20)
    secondi = sum(sess.SCHEDA_S if e["t"] == "scheda" else
                  sess.SECONDS[next(r["kind"] for r in _leggi(e["item"]))] for e in coda if not e.get("boss"))
    assert secondi <= 20 * 60
    items = [e["item"] for e in coda if e["t"] == "domanda"]
    assert len(items) == len(set(items))


def _leggi(item_id):
    with session() as d:
        return [dict(r) for r in d.execute("SELECT kind FROM study_items WHERE id=?", (item_id,))]


def test_domande_scadute_entrano_prima_di_quelle_nuove(ambiente, db):
    inserisci_corso(db)
    _argomento(db, 1)
    scaduta = _domanda(db, 1, "richiamo", due=_iso(datetime.now(timezone.utc) - timedelta(days=2)),
                       fsrs=_carta_json())
    db.execute("INSERT INTO study_attempts (item_id, score, created_at) VALUES (?, 1, '2026-11-01T10:00:00')", (scaduta,))
    _domanda(db, 1, "vero_falso", correct=1)
    db.commit()
    coda, _ = sess.build_queue(1, 30)
    assert coda[0] == {"t": "domanda", "item": scaduta}


def _carta_json():
    from fsrs import Card
    return Card().to_json()


def test_focus_su_un_solo_argomento(ambiente, db):
    inserisci_corso(db)
    _argomento(db, 1)
    _argomento(db, 2)
    _domanda(db, 1, "richiamo")
    d2 = _domanda(db, 2, "richiamo")
    db.commit()
    coda, snap = sess.build_queue(1, 30, focus_topic=2)
    assert {e["item"] for e in coda if e["t"] == "domanda"} == {d2}
    assert set(snap) == {"2"}


def test_start_clampa_i_minuti_e_salva_la_sessione(ambiente, db):
    inserisci_corso(db)
    _argomento(db, 1)
    _domanda(db, 1, "richiamo")
    db.commit()
    s = sess.start(1, minutes=1)
    assert s["minutes"] == 10
    assert any(e["t"] == "domanda" for e in s["entries"])
    # la domanda esposta non contiene la soluzione
    q = next(e["question"] for e in s["entries"] if e["t"] == "domanda")
    assert "answer_md" not in q and "correct" not in q


# --- answer / reveal / finish -----------------------------------------------------------

def _sessione_con(db, **kw):
    inserisci_corso(db)
    _argomento(db, 1)
    item = _domanda(db, 1, **kw)
    db.commit()
    s = sess.start(1, 30)
    idx = next(i for i, e in enumerate(s["entries"]) if e["t"] == "domanda")
    return s["id"], idx, item


def test_risposta_giusta_a_multipla(ambiente, db):
    sid, idx, item = _sessione_con(db, kind="multipla", correct=1)
    r = sess.answer(sid, idx, {"choice": 1, "confidence": 3, "seconds": 5})
    assert r["score"] == 1.0 and r["graded_by"] == "auto" and r["retry"] is False
    assert r["xp"] == round(10 * 0.75 * 2 * 1.0) + 3  # peso*difficoltà*score + bonus calibrazione
    with session() as d:
        assert d.execute("SELECT due FROM study_items WHERE id=?", (item,)).fetchone()[0] == r["next_due"]
        a = d.execute("SELECT score, confidence, answer FROM study_attempts").fetchone()
    assert (a["score"], a["confidence"], a["answer"]) == (1.0, 3, "1")


def test_risposta_sbagliata_torna_in_fondo_una_volta_sola(ambiente, db):
    sid, idx, _ = _sessione_con(db, kind="multipla", correct=1)
    r = sess.answer(sid, idx, {"choice": 0})
    assert r["score"] == 0.0 and r["retry"] is True
    coda = sess.get(sid)["entries"]
    assert coda[-1].get("retry") is True
    r2 = sess.answer(sid, len(coda) - 1, {"choice": 0})
    assert r2["retry"] is False                       # il recupero non si ripete all'infinito
    assert len(sess.get(sid)["entries"]) == len(coda)


def test_non_si_puo_rispondere_due_volte(ambiente, db):
    sid, idx, _ = _sessione_con(db, kind="multipla", correct=1)
    sess.answer(sid, idx, {"choice": 1})
    with pytest.raises(ValueError, match="già stata corretta"):
        sess.answer(sid, idx, {"choice": 1})


def test_risposta_non_data_a_multipla_vale_zero(ambiente, db):
    sid, idx, _ = _sessione_con(db, kind="multipla", correct=0)
    assert sess.answer(sid, idx, {})["score"] == 0.0
    # scelta 0 è un'opzione valida (non va confusa con "nessuna scelta")
    sid2, idx2, _ = _sessione_con_altro_corso(db)
    assert sess.answer(sid2, idx2, {"choice": 0})["score"] == 1.0


def _sessione_con_altro_corso(db):
    inserisci_corso(db, 2, "Fisica")
    db.execute("INSERT INTO study_topics (id, course_id, name, weight, position) VALUES (20, 2, 'F', 2, 1)")
    db.execute("INSERT INTO study_units (id, course_id, kind, ref_id) VALUES (2, 2, 'lezione', 2)")
    item = db.execute("""INSERT INTO study_items (course_id, unit_id, topic_id, kind, prompt_md, options, correct, answer_md)
                         VALUES (2, 2, 20, 'multipla', 'q', '["a","b"]', 0, 'r')""").lastrowid
    db.commit()
    s = sess.start(2, 30)
    return s["id"], next(i for i, e in enumerate(s["entries"]) if e["t"] == "domanda"), item


def test_risposta_scritta_corretta_dall_ai_e_clampata(ambiente, db, monkeypatch):
    sid, idx, _ = _sessione_con(db, kind="aperta", correct=None, rubric=["c1", "c2"])
    monkeypatch.setattr(sess, "run_json", _risposta_ai(7.5, [True, False]))  # il modello sbaglia scala
    r = sess.answer(sid, idx, {"text": "una risposta"})
    assert r["score"] == 1.0 and r["graded_by"] == "ai" and r["criteria_ok"] == [True, False]


def test_autovalutazione_non_supera_il_tetto(ambiente, db):
    sid, idx, _ = _sessione_con(db, kind="aperta", correct=None, rubric=["c1", "c2", "c3", "c4"])
    r = sess.answer(sid, idx, {"self_criteria": [True, True, True, True]})
    assert r["score"] == sess.SELF_CAP and r["graded_by"] == "io"
    sid2, idx2, _ = _sessione_con_altro_corso_aperta(db)
    assert sess.answer(sid2, idx2, {"self_criteria": [True, False]})["score"] == 0.5


def _sessione_con_altro_corso_aperta(db):
    inserisci_corso(db, 3, "Chimica")
    db.execute("INSERT INTO study_topics (id, course_id, name, weight, position) VALUES (30, 3, 'C', 2, 1)")
    db.execute("INSERT INTO study_units (id, course_id, kind, ref_id) VALUES (3, 3, 'lezione', 3)")
    db.execute("""INSERT INTO study_items (course_id, unit_id, topic_id, kind, prompt_md, answer_md, rubric)
                  VALUES (3, 3, 30, 'aperta', 'q', 'r', '["x","y"]')""")
    db.commit()
    s = sess.start(3, 30)
    return s["id"], next(i for i, e in enumerate(s["entries"]) if e["t"] == "domanda"), None


def test_rating_fsrs_dal_punteggio_e_dalla_confidenza():
    assert sess._rating(0.2, 3) == Rating.Again
    assert sess._rating(0.7, None) == Rating.Hard
    assert sess._rating(0.9, 1) == Rating.Hard      # giusta ma tirata a indovinare
    assert sess._rating(0.9, 3) == Rating.Good
    assert sess._rating(0.5, None) == Rating.Hard


def test_reveal_segna_la_domanda_e_mostra_soluzione(ambiente, db):
    sid, idx, _ = _sessione_con(db, kind="aperta", correct=None, rubric=["x"])
    r = sess.reveal(sid, idx)
    assert r["answer_md"] == "risposta" and r["rubric"] == ["x"]
    assert sess.get(sid)["entries"][idx]["revealed"] is True


def test_reveal_su_una_scheda_e_un_errore(ambiente, db):
    inserisci_corso(db)
    _argomento(db, 1)
    _domanda(db, 1, "richiamo")
    db.commit()
    s = sess.start(1, 30)
    idx_scheda = next(i for i, e in enumerate(s["entries"]) if e["t"] == "scheda")
    with pytest.raises(ValueError):
        sess.reveal(s["id"], idx_scheda)


def test_sessione_inesistente(ambiente):
    with pytest.raises(KeyError):
        sess.get(999)


def test_finish_riassume_sbagliate_e_chiude(ambiente, db):
    sid, idx, item = _sessione_con(db, kind="multipla", correct=1)
    sess.answer(sid, idx, {"choice": 0})
    f = sess.finish(sid)
    assert f["answered"] == 1 and f["correct"] == 0
    assert [w["id"] for w in f["wrong"]] == [item]
    with session() as d:
        assert d.execute("SELECT ended_at FROM study_sessions WHERE id=?", (sid,)).fetchone()[0] is not None


# --- quiz ------------------------------------------------------------------------------

def _appunti(db, ambiente, lid=1, cid=1, testo="# Appunti"):
    from studyhub.config import settings
    (settings.uni_root / "n.md").write_text(testo, encoding="utf-8")
    db.execute("INSERT INTO ai_outputs (kind, target_id, course_id, input_hash, md_path) VALUES "
               "('lecture_notes', ?, ?, 'h', 'n.md')", (lid, cid))
    db.commit()


QUIZ = {"titolo": "Quiz", "domande": [
    {"tipo": "multipla", "testo_md": "m", "opzioni": ["a", "b"], "corretta": 0, "soluzione_md": "s"},
    {"tipo": "vero_falso", "testo_md": "vf", "opzioni": [], "corretta": 1, "soluzione_md": "s"},
    {"tipo": "aperta", "testo_md": "o", "opzioni": [], "corretta": -1, "soluzione_md": "modello"},
]}


def test_quiz_senza_appunti_e_rifiutato(ambiente):
    with pytest.raises(ValueError, match="appunti"):
        quizmod.generate(1)


def test_quiz_generato_una_volta_e_poi_in_cache(ambiente, db, monkeypatch):
    inserisci_corso(db)
    _appunti(db, ambiente)
    chiamate = []

    def falso(system, text, schema, quality="accurato"):
        chiamate.append(1)
        return SimpleNamespace(data=QUIZ, provider="local", model="m", duration_s=0)
    monkeypatch.setattr(quizmod, "run_json", falso)
    a = quizmod.generate(1)
    b = quizmod.generate(1)
    assert a["cached"] is False and b["cached"] is True and a["id"] == b["id"] and len(chiamate) == 1
    # appunti cambiati -> quiz nuovo
    (ambiente / "uni" / "n.md").write_text("# Altro", encoding="utf-8")
    assert quizmod.generate(1)["cached"] is False


def test_get_quiz_nasconde_le_soluzioni(ambiente, db, monkeypatch):
    inserisci_corso(db)
    _appunti(db, ambiente)
    monkeypatch.setattr(quizmod, "run_json", lambda *a, **k: SimpleNamespace(data=QUIZ, provider="l", model="m", duration_s=0))
    qid = quizmod.generate(1)["id"]
    pubblico = quizmod.get(qid)
    assert all("corretta" not in q and "soluzione_md" not in q for q in pubblico["questions"])
    assert all("corretta" in q for q in quizmod.get(qid, with_solutions=True)["questions"])
    with pytest.raises(KeyError):
        quizmod.get(999)


def test_submit_corregge_crocette_in_locale_e_aperte_con_ai(ambiente, db, monkeypatch):
    inserisci_corso(db)
    _appunti(db, ambiente)
    monkeypatch.setattr(quizmod, "run_json", lambda *a, **k: SimpleNamespace(data=QUIZ, provider="l", model="m", duration_s=0))
    qid = quizmod.generate(1)["id"]
    visto = {}

    def correttore(system, text, schema, quality="accurato"):
        visto["testo"] = text
        return SimpleNamespace(data={"valutazioni": [{"indice": 2, "punteggio": 0.5, "feedback_md": "manca"}]},
                               provider="l", model="m", duration_s=0)
    monkeypatch.setattr(quizmod, "run_json", correttore)
    r = quizmod.submit(qid, [0, 0, "risposta aperta"])   # multipla giusta, vero/falso sbagliato
    assert [x["punteggio"] for x in r["results"]] == [1.0, 0.0, 0.5]
    assert r["score"] == 1.5 and r["max_score"] == 3
    assert "Domanda 2" in visto["testo"] and "modello" in visto["testo"]


def test_submit_senza_risposte_aperte_non_chiama_ai_e_salta_le_vuote(ambiente, db, monkeypatch):
    inserisci_corso(db)
    _appunti(db, ambiente)
    monkeypatch.setattr(quizmod, "run_json", lambda *a, **k: SimpleNamespace(data=QUIZ, provider="l", model="m", duration_s=0))
    qid = quizmod.generate(1)["id"]

    def vietato(*a, **k):
        raise AssertionError("nessuna chiamata AI attesa")
    monkeypatch.setattr(quizmod, "run_json", vietato)
    r = quizmod.submit(qid, [None, 1, "   "])           # saltata, giusta, aperta vuota
    assert [x["punteggio"] for x in r["results"]] == [0.0, 1.0, 0.0]
    assert r["results"][2]["feedback_md"] == "Risposta non data."
    assert quizmod.submit(qid, [])["score"] == 0.0         # liste di risposte più corte del quiz


def test_submit_punteggio_ai_fuori_scala_e_valutazione_mancante(ambiente, db, monkeypatch):
    inserisci_corso(db)
    _appunti(db, ambiente)
    monkeypatch.setattr(quizmod, "run_json", lambda *a, **k: SimpleNamespace(data=QUIZ, provider="l", model="m", duration_s=0))
    qid = quizmod.generate(1)["id"]
    monkeypatch.setattr(quizmod, "run_json", lambda *a, **k: SimpleNamespace(
        data={"valutazioni": [{"indice": 2, "punteggio": 9, "feedback_md": "f"}]}, provider="l", model="m", duration_s=0))
    assert quizmod.submit(qid, [None, None, "x"])["results"][2]["punteggio"] == 1.0
    # il modello locale dimentica la valutazione: la domanda vale 0, non fa crollare l'invio
    monkeypatch.setattr(quizmod, "run_json", lambda *a, **k: SimpleNamespace(data={"valutazioni": []}, provider="l", model="m", duration_s=0))
    assert quizmod.submit(qid, [None, None, "x"])["results"][2]["punteggio"] == 0.0


def test_list_for_lecture_riporta_il_miglior_punteggio(ambiente, db, monkeypatch):
    inserisci_corso(db)
    _appunti(db, ambiente)
    monkeypatch.setattr(quizmod, "run_json", lambda *a, **k: SimpleNamespace(data=QUIZ, provider="l", model="m", duration_s=0))
    qid = quizmod.generate(1)["id"]
    assert quizmod.list_for_lecture(1)[0]["best"] is None
    quizmod.submit(qid, [0, 1, None])   # 2/3
    quizmod.submit(qid, [None, None, None])  # 0/3
    assert quizmod.list_for_lecture(1)[0]["best"] == pytest.approx(2 / 3)
