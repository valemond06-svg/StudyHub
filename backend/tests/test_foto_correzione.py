"""Foto dello svolgimento nella correzione dei compiti: ridimensionamento, invio, avvisi onesti."""
import base64
import io
import json
from types import SimpleNamespace

import pytest
from PIL import Image

from studyhub.ai import vision
from studyhub.study import exam
from test_exam import SIM, _falso, corso  # noqa: F401


def _png(w=3000, h=2000, modo="RGB", colore="white"):
    buf = io.BytesIO()
    Image.new(modo, (w, h), colore).save(buf, "PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


# --- vision.py -------------------------------------------------------------------------------

def test_ridimensiona_a_1600_e_ricodifica_jpeg():
    b = vision.prepare_image(_png(3000, 2000))
    im = Image.open(io.BytesIO(base64.b64decode(b["data"])))
    assert b["media_type"] == "image/jpeg" and im.format == "JPEG"
    assert max(im.size) == 1600 and im.size == (1600, 1067)


def test_non_ingrandisce_le_foto_piccole():
    im = Image.open(io.BytesIO(base64.b64decode(vision.prepare_image(_png(400, 300))["data"])))
    assert im.size == (400, 300)


def test_png_trasparente_diventa_su_fondo_bianco():
    b = vision.prepare_image(_png(50, 50, "RGBA", (0, 0, 0, 0)))
    im = Image.open(io.BytesIO(base64.b64decode(b["data"])))
    assert min(im.getpixel((25, 25))) > 240   # bianco, non nero


@pytest.mark.parametrize("brutto", ["", None, 5, "http://x/y.png", "data:text/plain;base64,QUJD",
                                    "data:image/png;base64,", "data:image/png;base64,QUJD", "data:image/png,abc"])
def test_input_non_valido_scartato_senza_eccezioni(brutto):
    assert vision.prepare_image(brutto) is None


def test_limite_numero_immagini():
    pronte, scartate = vision.prepare_images([_png(100, 100)] * 9 + ["rotta"], limit=6)
    assert len(pronte) == 6 and scartate == 4


# --- grade_sim -------------------------------------------------------------------------------

def _correttore(images_sent):
    def run(system, content, schema, quality="accurato"):
        run.content = content
        return SimpleNamespace(data={"valutazioni": [], "voto_30": 20, "superato": True, "commento_md": "Bene.",
                                     "da_ripassare": []}, provider="local", model="m", duration_s=0,
                               images_sent=images_sent)
    return run


def _sim(corso, monkeypatch):
    monkeypatch.setattr(exam, "run_json", _falso(SIM))
    return exam.generate_sim(corso)["id"]


def test_le_foto_ridimensionate_arrivano_al_modello_dopo_il_testo_della_domanda(corso, monkeypatch):
    sid = _sim(corso, monkeypatch)
    c = _correttore(images_sent=2)
    monkeypatch.setattr(exam, "run_json_content", c)
    r = exam.grade_sim(sid, [{"scelta": 1}, {"testo": "ho scritto", "immagini": [_png(), _png(800, 600)]}])
    tipi = [b["type"] for b in c.content]
    assert tipi == ["text", "text", "text", "image", "image", "text"]   # intro, crocetta, testo, 2 foto, chiusura
    assert "leggibili: 2" in c.content[2]["text"]
    assert r["foto"] == {"allegate": 2, "lette": 2, "avviso": None}
    assert "NON" not in r["commento_md"]


def test_nessuna_vista_avviso_chiaro_nel_commento_e_nel_risultato(corso, monkeypatch):
    sid = _sim(corso, monkeypatch)
    monkeypatch.setattr(exam, "run_json_content", _correttore(images_sent=0))
    r = exam.grade_sim(sid, [{"scelta": 1}, {"testo": "", "immagini": [_png(), _png()]}])
    assert r["foto"]["lette"] == 0 and r["foto"]["allegate"] == 2
    assert "NON sono state lette" in r["foto"]["avviso"]
    assert r["commento_md"].startswith("**⚠ Le 2 foto") and "Bene." in r["commento_md"]
    with __import__("studyhub.db", fromlist=["session"]).session() as d:   # l'avviso resta anche nello storico
        assert "NON sono state lette" in d.execute("SELECT grading FROM exam_attempts").fetchone()[0]


def test_foto_non_valide_e_oltre_il_limite_vengono_contate_come_non_lette(corso, monkeypatch):
    sid = _sim(corso, monkeypatch)
    c = _correttore(images_sent=1)
    monkeypatch.setattr(exam, "run_json_content", c)
    r = exam.grade_sim(sid, [{}, {"immagini": [_png(100, 100), "rotta", "data:image/png;base64,QUJD"]}])
    assert sum(1 for b in c.content if b["type"] == "image") == 1
    assert r["foto"] == {"allegate": 3, "lette": 1, "avviso": r["foto"]["avviso"]}
    assert "Lette 1 foto su 3" in r["foto"]["avviso"]


def test_senza_foto_nessun_avviso(corso, monkeypatch):
    sid = _sim(corso, monkeypatch)
    monkeypatch.setattr(exam, "run_json_content", _correttore(images_sent=0))
    r = exam.grade_sim(sid, [{"scelta": 1}, {"testo": "solo testo"}])
    assert r["foto"] == {"allegate": 0, "lette": 0, "avviso": None} and r["commento_md"] == "Bene."


def test_tetto_di_foto_totali_per_correzione(corso, monkeypatch):
    sid = _sim(corso, monkeypatch)
    # SIM ha una sola domanda aperta: a 4 foto per risposta il tetto per risposta (4) vale prima di quello totale (6)
    c = _correttore(images_sent=4)
    monkeypatch.setattr(exam, "run_json_content", c)
    r = exam.grade_sim(sid, [{}, {"immagini": [_png(100, 100)] * 9}])
    assert sum(1 for b in c.content if b["type"] == "image") == exam.MAX_PHOTOS_PER_ANSWER == 4
    assert r["foto"]["allegate"] == 4
