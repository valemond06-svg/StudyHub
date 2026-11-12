from datetime import date, timedelta

from conftest import inserisci_corso
from studyhub.db import session
from studyhub.study import planner


def _lezione(db, lid, cid=1, status="trascritta", n=1):
    db.execute("INSERT INTO lectures (id, course_id, title, number, folder, status) VALUES (?,?,?,?,?,?)",
               (lid, cid, f"Lezione {lid}", n, f"l{lid}", status))


def _appunti(db, lid, cid=1):
    db.execute("INSERT INTO ai_outputs (kind, target_id, course_id, input_hash) VALUES ('lecture_notes', ?, ?, 'h')", (lid, cid))


def _appello(db, cid, giorni):
    db.execute("INSERT INTO exams (course_id, date) VALUES (?, ?)", (cid, (date.today() + timedelta(days=giorni)).isoformat()))


def test_piano_vuoto(ambiente):
    p = planner.today_plan()
    assert p["tasks"] == [] and p["courses"] == [] and p["today"] == date.today().isoformat()


def test_corsi_senza_cartella_o_non_attivi_ignorati(ambiente, db):
    inserisci_corso(db, 1, folder=None)
    inserisci_corso(db, 2, "Fisica", active=0)
    db.commit()
    assert planner.today_plan()["courses"] == []


def test_lezione_trascritta_senza_appunti_propone_appunti(ambiente, db):
    inserisci_corso(db)
    _lezione(db, 1)
    _lezione(db, 2, status="nuova", n=2)  # non pronta: nessun compito
    db.commit()
    tasks = planner.today_plan()["tasks"]
    assert [(t["kind"], t["lecture_id"]) for t in tasks] == [("notes", 1)]


def test_con_appunti_si_passa_al_quiz_e_poi_non_piu(ambiente, db):
    inserisci_corso(db)
    _lezione(db, 1)
    _appunti(db, 1)
    db.commit()
    assert [t["kind"] for t in planner.today_plan()["tasks"]] == ["quiz"]
    db.execute("INSERT INTO quizzes (id, course_id, lecture_id, questions) VALUES (1, 1, 1, '[]')")
    db.execute("INSERT INTO quiz_attempts (quiz_id, answers) VALUES (1, '[]')")
    db.commit()
    assert planner.today_plan()["tasks"] == []


def test_quiz_non_tentato_non_conta_come_fatto(ambiente, db):
    inserisci_corso(db)
    _lezione(db, 1)
    _appunti(db, 1)
    db.execute("INSERT INTO quizzes (id, course_id, lecture_id, questions) VALUES (1, 1, 1, '[]')")
    db.commit()
    assert [t["kind"] for t in planner.today_plan()["tasks"]] == ["quiz"]


def test_appello_vicino_proponi_profilo_prima_della_simulazione(ambiente, db):
    inserisci_corso(db)
    _appello(db, 1, 10)
    db.commit()
    p = planner.today_plan()
    assert [t["kind"] for t in p["tasks"]] == ["profile"]
    assert p["courses"][0]["days_left"] == 10


def test_appello_vicino_con_profilo_propone_simulazione(ambiente, db):
    from studyhub.config import settings
    inserisci_corso(db)
    _appello(db, 1, 10)
    db.commit()
    prof = settings.uni_root / "corso1" / "studio_ai"
    prof.mkdir(parents=True)
    (prof / "profilo_esame.json").write_text("{}", encoding="utf-8")
    t = planner.today_plan()["tasks"]
    assert [x["kind"] for x in t] == ["sim"]


def test_appello_lontano_non_genera_profilo(ambiente, db):
    inserisci_corso(db)
    _appello(db, 1, 60)
    db.commit()
    assert planner.today_plan()["tasks"] == []


def test_limite_giornaliero_di_attivita_ai_e_flashcard_sempre_in_cima(ambiente, db):
    from studyhub.study import flashcards
    for cid in range(1, 6):
        inserisci_corso(db, cid, f"Corso {cid}")
        _lezione(db, cid * 10, cid)
    db.execute("INSERT INTO flashcards (course_id, front, back, fsrs, due) VALUES (1, 'f', 'b', '{}', '2000-01-01T00:00:00+00:00')")
    db.commit()
    tasks = planner.today_plan()["tasks"]
    assert tasks[0]["kind"] == "flashcard" and "1 flashcard" in tasks[0]["title"]
    assert sum(1 for t in tasks if t.get("ai")) == planner.MAX_AI_TASKS_PER_DAY


def test_corso_con_appello_piu_vicino_ha_precedenza(ambiente, db):
    inserisci_corso(db, 1, "Lontano")
    inserisci_corso(db, 2, "Vicino")
    _lezione(db, 1, 1)
    _lezione(db, 2, 2)
    _appello(db, 1, 25)
    _appello(db, 2, 3)
    db.commit()
    p = planner.today_plan()
    assert p["tasks"][0]["course_id"] == 2
    assert p["courses"][0]["course"] == "Vicino"


def test_due_appelli_stesso_corso_conta_il_primo(ambiente, db):
    inserisci_corso(db)
    _appello(db, 1, 40)
    _appello(db, 1, 5)
    db.commit()
    assert planner.today_plan()["courses"][0]["days_left"] == 5
