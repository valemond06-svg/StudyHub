import json
from datetime import date, timedelta
from types import SimpleNamespace

import pytest

from conftest import inserisci_corso
from studyhub.db import session
from studyhub.study import exam

SIM = {"titolo": "Simulazione 1", "durata_min": 90, "istruzioni_md": "Leggi bene.", "domande": [
    {"parte": "A", "tipo": "multipla", "testo_md": "q1", "punti": 2, "opzioni": ["x", "y", "z"], "corretta": 1,
     "soluzione_md": "y", "criteri_md": "-"},
    {"parte": "B", "tipo": "esercizio", "testo_md": "q2", "punti": 10, "opzioni": [], "corretta": -1,
     "soluzione_md": "passi", "criteri_md": "3 punti per impostazione"},
]}


def _falso(data):
    def run(system, text, schema, quality="accurato"):
        run.visto = text
        return SimpleNamespace(data=json.loads(json.dumps(data)), provider="local", model="m", duration_s=0)
    return run


@pytest.fixture
def corso(ambiente, db):
    from studyhub.config import settings
    inserisci_corso(db, 1, "Analisi 2", folder="1_Anno/Analisi")
    db.commit()
    cartella = settings.uni_root / "1_Anno" / "Analisi" / "studio_ai"
    cartella.mkdir(parents=True)
    (cartella / "profilo_esame.json").write_text(json.dumps(
        {"formato": {}, "argomenti": [], "esercizi_tipo": [], "teoria_richiesta": [], "sintesi_md": "s"}), encoding="utf-8")
    return 1


def test_appelli_aggiunti_ordinati_e_con_giorni_mancanti(ambiente, db):
    inserisci_corso(db)
    db.commit()
    tra10, tra3 = (date.today() + timedelta(days=n) for n in (10, 3))
    exam.add_exam(1, tra10.isoformat())
    eid = exam.add_exam(1, tra3.isoformat(), "orale", "aula 4")
    exam.add_exam(1, (date.today() - timedelta(days=1)).isoformat())   # già passato
    u = exam.upcoming_exams()
    assert [e["days_left"] for e in u] == [3, 10]
    assert u[0]["kind"] == "orale" and u[0]["course"] == "Analisi 2"
    exam.delete_exam(eid)
    assert [e["days_left"] for e in exam.upcoming_exams()] == [10]


def test_data_appello_non_valida_rifiutata(ambiente, db):
    inserisci_corso(db)
    db.commit()
    for brutta in ("12/11/2026", "2026-13-01", "boh"):
        with pytest.raises(ValueError):
            exam.add_exam(1, brutta)


def test_simulazione_richiede_il_profilo(ambiente, db):
    inserisci_corso(db)
    db.commit()
    with pytest.raises(ValueError, match="profilo"):
        exam.generate_sim(1)


def test_simulazione_salvata_e_senza_soluzioni_per_lo_studente(corso, monkeypatch):
    monkeypatch.setattr(exam, "run_json", _falso(SIM))
    sid = exam.generate_sim(corso)["id"]
    pubblica = exam.get_sim(sid)
    assert all(not ({"corretta", "soluzione_md", "criteri_md"} & set(q)) for q in pubblica["domande"])
    assert pubblica["titolo"] == "Simulazione 1" and pubblica["attempts"] == []
    assert exam.get_sim(sid, with_solutions=True)["domande"][0]["corretta"] == 1
    assert [s["id"] for s in exam.list_sims(corso)] == [sid] and exam.list_sims(corso)[0]["best"] is None
    with pytest.raises(KeyError):
        exam.get_sim(999)


def test_correzione_registra_tentativo_e_non_salva_le_foto(corso, monkeypatch):
    monkeypatch.setattr(exam, "run_json", _falso(SIM))
    sid = exam.generate_sim(corso)["id"]
    correttore = _falso({"valutazioni": [{"indice": 1, "punti": 6, "feedback_md": "ok"}], "voto_30": 24.0,
                         "superato": True, "commento_md": "bene", "da_ripassare": []})
    monkeypatch.setattr(exam, "run_json", correttore)
    r = exam.grade_sim(sid, [{"scelta": 1}, {"testo": "risposta", "immagini": ["data:image/png;base64,AAAA"] * 2}], 55.0)
    assert r["voto_30"] == 24.0 and [s["punti_max"] for s in r["soluzioni"]] == [2, 10]
    assert "CORRETTA" in correttore.visto and "ERRATA" not in correttore.visto
    with session() as d:
        a = d.execute("SELECT answers, grade, passed, elapsed_min FROM exam_attempts").fetchone()
    salvate = json.loads(a["answers"])
    assert "immagini" not in salvate[1] and salvate[1]["n_immagini"] == 2   # il database non si gonfia di base64
    assert (a["grade"], a["passed"], a["elapsed_min"]) == (24.0, 1, 55.0)
    assert exam.list_sims(corso)[0]["best"] == 24.0


def test_correzione_crocetta_sbagliata_e_risposte_mancanti(corso, monkeypatch):
    monkeypatch.setattr(exam, "run_json", _falso(SIM))
    sid = exam.generate_sim(corso)["id"]
    correttore = _falso({"valutazioni": [], "voto_30": 0, "superato": False, "commento_md": "", "da_ripassare": []})
    monkeypatch.setattr(exam, "run_json", correttore)
    exam.grade_sim(sid, [{"scelta": 0}])          # sbagliata; l'esercizio non è stato consegnato (lista più corta)
    assert "ERRATA" in correttore.visto and "(nessun testo)" in correttore.visto
    exam.grade_sim(sid, [{"scelta": None}, {}])   # crocetta saltata
    assert "nessuna" in correttore.visto


def test_valutazioni_come_stringa_json_vengono_decodificate(corso, monkeypatch):
    monkeypatch.setattr(exam, "run_json", _falso(SIM))
    sid = exam.generate_sim(corso)["id"]
    monkeypatch.setattr(exam, "run_json", _falso({"valutazioni": '[{"indice": 0, "punti": 2, "feedback_md": "f"}]',
                                                  "voto_30": 18, "superato": True, "commento_md": "", "da_ripassare": []}))
    r = exam.grade_sim(sid, [{"scelta": 1}, {}])
    assert r["valutazioni"][0]["punti"] == 2
