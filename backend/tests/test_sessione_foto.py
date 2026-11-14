"""Correzione da foto nelle sessioni di studio: endpoint, limiti, salvataggio dell'esito come risposta."""
import base64
import io
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from conftest import inserisci_corso
from studyhub.ai import vision
from studyhub.db import session
from studyhub.study import session as sess
from test_session_quiz import _argomento, _domanda, senza_lezioni_in_background  # noqa: F401


def _png(w=300, h=200):
    buf = io.BytesIO()
    Image.new("RGB", (w, h), "white").save(buf, "PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


@pytest.fixture
def client(ambiente):
    from studyhub.api.app import app
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture
def sid(ambiente, db):
    inserisci_corso(db)
    _argomento(db, 1)
    _domanda(db, 1, "esercizio", rubric=["passaggio", "risultato"])
    _domanda(db, 1, "multipla")
    db.commit()
    return sess.start(1, 60)["id"]


def _idx(sid, kind):
    s = sess.get(sid)
    return next(i for i, e in enumerate(s["entries"]) if e["t"] == "domanda" and e["question"]["kind"] == kind)


def _modello(monkeypatch, images_sent=1, punteggio=0.9):
    visto = SimpleNamespace(content=None)

    def falso(system, content, schema, quality="accurato"):
        visto.content = content
        return SimpleNamespace(data={"punteggio": punteggio, "feedback_md": "letto bene", "criteri_ok": [True, False]},
                               images_sent=images_sent, provider="claude", model="m", duration_s=0.1)
    monkeypatch.setattr(sess, "run_json_content", falso)
    return visto


def test_foto_valida_corregge_e_salva_come_risposta(client, sid, monkeypatch):
    visto = _modello(monkeypatch)
    i = _idx(sid, "esercizio")
    r = client.post(f"/api/study/sessions/{sid}/photo", json={"idx": i, "images": [_png()], "confidence": 3, "seconds": 20})
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["score"] == 0.9 and j["graded_by"] == "ai" and j["criteria_ok"] == [True, False]
    assert [b["type"] for b in visto.content] == ["text", "image", "text"]
    with session() as db:
        a = db.execute("SELECT score, graded_by, answer, feedback_md, session_id FROM study_attempts").fetchone()
        due = db.execute("SELECT fsrs FROM study_items WHERE kind='esercizio'").fetchone()[0]
    assert a["score"] == 0.9 and a["graded_by"] == "ai" and "[foto: 1]" in a["answer"] and a["session_id"] == sid
    assert due   # la scheda FSRS è aggiornata: conta per il ripasso
    assert sess.get(sid)["entries"][i]["done"] is True


def test_foto_non_lette_non_salvano_nulla(client, sid, monkeypatch):
    _modello(monkeypatch, images_sent=0)
    r = client.post(f"/api/study/sessions/{sid}/photo", json={"idx": _idx(sid, "esercizio"), "images": [_png()]})
    assert r.status_code == 502
    with session() as db:
        assert db.execute("SELECT COUNT(*) FROM study_attempts").fetchone()[0] == 0


def test_file_troppo_grande_413(client, sid, monkeypatch):
    _modello(monkeypatch)
    grande = "data:image/png;base64," + "A" * (vision.MAX_DECODED_BYTES * 4 // 3 + 100)
    r = client.post(f"/api/study/sessions/{sid}/photo", json={"idx": _idx(sid, "esercizio"), "images": [grande]})
    assert r.status_code == 413


@pytest.mark.parametrize("images", [["data:text/plain;base64,QUJD"], ["http://x/y.png"], [], [_png()] * 5])
def test_tipo_sbagliato_o_numero_errato_400(client, sid, monkeypatch, images):
    _modello(monkeypatch)
    r = client.post(f"/api/study/sessions/{sid}/photo", json={"idx": _idx(sid, "esercizio"), "images": images})
    assert r.status_code == 400


def test_immagine_corrotta_400(client, sid, monkeypatch):
    _modello(monkeypatch)
    r = client.post(f"/api/study/sessions/{sid}/photo",
                    json={"idx": _idx(sid, "esercizio"), "images": ["data:image/png;base64,QUJD"]})
    assert r.status_code == 400


def test_sessione_o_domanda_inesistente(client, sid, monkeypatch):
    _modello(monkeypatch)
    assert client.post("/api/study/sessions/9999/photo", json={"idx": 0, "images": [_png()]}).status_code == 404
    assert client.post(f"/api/study/sessions/{sid}/photo", json={"idx": 99, "images": [_png()]}).status_code == 400
    assert client.post(f"/api/study/sessions/{sid}/photo", json={"idx": -1, "images": [_png()]}).status_code == 400


def test_domanda_a_scelta_rifiutata(client, sid, monkeypatch):
    _modello(monkeypatch)
    r = client.post(f"/api/study/sessions/{sid}/photo", json={"idx": _idx(sid, "multipla"), "images": [_png()]})
    assert r.status_code == 400


def test_non_si_risponde_due_volte(client, sid, monkeypatch):
    _modello(monkeypatch)
    i = _idx(sid, "esercizio")
    assert client.post(f"/api/study/sessions/{sid}/photo", json={"idx": i, "images": [_png()]}).status_code == 200
    assert client.post(f"/api/study/sessions/{sid}/photo", json={"idx": i, "images": [_png()]}).status_code == 400
