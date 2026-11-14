"""Risposte malformate del modello: errore pulito (ClaudeError) o valore di ripiego, mai KeyError/TypeError."""
import json
from types import SimpleNamespace

import pytest

from conftest import inserisci_corso
from studyhub.ai.claude_runner import ClaudeError
from studyhub.study import lesson, tutor
from studyhub.study import session as sess


def _ai(data):
    return lambda *a, **k: SimpleNamespace(data=data, provider="local", model="m", duration_s=0.1)


IT = {"kind": "aperta", "prompt_md": "D", "answer_md": "R", "rubric": json.dumps(["c1"])}


# --- session._grade_ai ---------------------------------------------------------------

@pytest.mark.parametrize("data", [["punteggio", 1], {"feedback_md": "ok"}, {"punteggio": "boh", "feedback_md": "x"}])
def test_grade_ai_inutilizzabile_solleva_claude_error(monkeypatch, data):
    monkeypatch.setattr(sess, "run_json", _ai(data))
    with pytest.raises(ClaudeError):
        sess._grade_ai(IT, "risposta")


def test_grade_ai_campi_secondari_mancanti_o_di_tipo_sbagliato(monkeypatch):
    monkeypatch.setattr(sess, "run_json", _ai({"punteggio": "0.7", "feedback_md": None, "criteri_ok": "si"}))
    assert sess._grade_ai(IT, "r") == (0.7, "", [])


# --- tutor.ask ----------------------------------------------------------------------

@pytest.fixture
def tutor_finto(ambiente, monkeypatch):
    monkeypatch.setattr(tutor, "thread", lambda tid: {"messages": [], "course_id": None, "mode": "normale", "title": "t"})
    monkeypatch.setattr(tutor, "search", lambda *a, **k: {"results": []})


@pytest.mark.parametrize("data", [[], {"fonti_usate": [1]}, {"risposta_md": 5}, {"risposta_md": "  "}])
def test_tutor_ask_risposta_malformata(tutor_finto, monkeypatch, data):
    monkeypatch.setattr(tutor, "run_json", _ai(data))
    with pytest.raises(ClaudeError):
        tutor.ask(1, "domanda")


def test_tutor_ask_fonti_di_tipo_sbagliato_ignorate(tutor_finto, db, monkeypatch):
    db.execute("INSERT INTO tutor_threads (id, mode, created_at) VALUES (1, 'normale', 'x')")
    db.commit()
    monkeypatch.setattr(tutor, "run_json", _ai({"risposta_md": "ciao", "fonti_usate": "1,2"}))
    out = tutor.ask(1, "domanda")
    assert out["answer"] == "ciao" and out["cited"] == []


# --- lesson.ask ---------------------------------------------------------------------

def _topic(db):
    inserisci_corso(db)
    db.execute("INSERT INTO study_topics (id, course_id, name, weight) VALUES (1, 1, 'T', 2)")
    db.commit()


@pytest.mark.parametrize("data", [["x"], {}, {"risposta_md": ["a"]}])
def test_lesson_ask_risposta_malformata(ambiente, db, monkeypatch, data):
    _topic(db)
    monkeypatch.setattr(lesson, "run_json", _ai(data))
    with pytest.raises(ClaudeError):
        lesson.ask(1, "perché?")


def test_lesson_ask_ok(ambiente, db, monkeypatch):
    _topic(db)
    monkeypatch.setattr(lesson, "run_json", _ai({"risposta_md": "ecco"}))
    assert lesson.ask(1, "perché?") == "ecco"


# --- lesson.generate: verifiche e passi malformati -------------------------------------

def test_generate_verifiche_malformate_non_crashano(ambiente, db, monkeypatch):
    _topic(db)
    passi = [
        "non un dict",
        {"verifica": ["lista"]},
        {"verifica": {"opzioni": ["a", "b"], "corretta": "uno"}},
        {"verifica": {"opzioni": ["a", "b"], "corretta": 5}},
        {"verifica": {"opzioni": ["a", "b"], "corretta": 1}},
    ]
    monkeypatch.setattr(lesson, "run_json", _ai({
        "passi": passi, "sniper_sbarramento": {"opzioni": ["a", "b"], "corretta": "x"},
        "laboratorio_pratico": "testo"}))
    data = lesson.generate(1)
    assert len(data["passi"]) == 4  # il non-dict è scartato
    assert [p["verifica"] is None for p in data["passi"]] == [True, True, True, False]
    assert data["passi"][3]["verifica"]["corretta"] in (0, 1)


def test_generate_risposta_non_dict_solleva(ambiente, db, monkeypatch):
    _topic(db)
    monkeypatch.setattr(lesson, "run_json", _ai(["lista"]))
    with pytest.raises(ClaudeError):
        lesson.generate(1)
