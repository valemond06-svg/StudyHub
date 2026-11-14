"""P2.4: trascrizione (`transcribe_ready` con Whisper finto) e pipeline delle lezioni (Panopto/Moodle) senza rete né ffmpeg."""
from __future__ import annotations

import json
import subprocess
import sys
from contextlib import contextmanager
from datetime import datetime, timedelta

import pytest

from conftest import inserisci_corso
from studyhub.db import session
from studyhub.media import pipeline
from studyhub.media import transcribe as tr
from studyhub.paths import uni_path
from studyhub.study import riprese


@contextmanager
def _nolock():
    yield


@pytest.fixture
def corso(ambiente, db):
    inserisci_corso(db)
    db.commit()
    with session() as d:
        return dict(d.execute("SELECT * FROM courses WHERE id=1").fetchone())


def _lezione(lid=1, status="media_ok", con_audio=True, **extra):
    folder = f"corso1/lezioni/L{lid}"
    campi = {"id": lid, "course_id": 1, "title": f"Lezione {lid}", "date": "2026-10-01", "folder": folder,
             "status": status, **extra}
    with session() as d:
        d.execute(f"INSERT INTO lectures ({','.join(campi)}) VALUES ({','.join('?' * len(campi))})", list(campi.values()))
    ldir = uni_path(folder)
    ldir.mkdir(parents=True, exist_ok=True)
    if con_audio:
        (ldir / "audio.opus").write_bytes(b"opus")
    return {**campi}, ldir


def _riga(lid=1):
    with session() as d:
        return dict(d.execute("SELECT * FROM lectures WHERE id=?", (lid,)).fetchone())


def _whisper_finto(monkeypatch, codice: str) -> list:
    """Sostituisce il sottoprocesso Whisper con un `python -c` finto; niente GPU, niente lock vero, niente ffmpeg."""
    orig = subprocess.Popen
    comandi: list = []

    def popen(cmd, **kw):
        comandi.append(cmd)
        return orig([sys.executable, "-c", codice, *cmd[3:]], **kw)

    monkeypatch.setattr(tr.subprocess, "Popen", popen)
    monkeypatch.setattr(tr, "device", lambda: "cpu")
    monkeypatch.setattr(tr, "gpu_lock", lambda *a, **k: _nolock())
    monkeypatch.setattr(pipeline.ff, "probe", lambda p: {"duration": 120.0, "has_audio": True})
    return comandi


CODICE_OK = (
    "import sys, json\n"
    "out = sys.argv[2]\n"
    "print('PROGRESS 0.5', flush=True)\n"
    "json.dump({'source': 'whisper', 'model': 'finto', 'device': 'cpu', 'language': 'it', 'duration': 120.0,"
    " 'elapsed_s': 1.0, 'segments': [{'start': 0, 'end': 2, 'text': 'ciao'}]}, open(out, 'w'))\n"
)


def test_transcribe_ready_successo(corso, monkeypatch):
    lec, ldir = _lezione()
    comandi = _whisper_finto(monkeypatch, CODICE_OK)
    res = pipeline.transcribe_ready(lec, corso)
    assert res["source"] == "whisper" and res["segments"][0]["text"] == "ciao"
    on_disk = json.loads((ldir / "transcript.json").read_text(encoding="utf-8"))
    assert on_disk["source"] == "whisper"
    r = _riga()
    assert r["status"] == "trascritta" and r["transcript_source"] == "whisper" and r["error"] is None
    assert r["attempts"] == 0 and r["next_retry_at"] is None
    assert "--prompt" in comandi[0] and "Analisi 2" in comandi[0][comandi[0].index("--prompt") + 1]  # glossario del corso


def test_transcribe_ready_successo_azzera_i_tentativi(corso, monkeypatch):
    lec, _ = _lezione(attempts=2, next_retry_at="2030-01-01T00:00:00")
    _whisper_finto(monkeypatch, CODICE_OK)
    pipeline.transcribe_ready(lec, corso)
    r = _riga()
    assert r["attempts"] == 0 and r["next_retry_at"] is None


def test_transcribe_ready_audio_mancante(corso, monkeypatch):
    lec, ldir = _lezione(con_audio=False)
    comandi = _whisper_finto(monkeypatch, CODICE_OK)
    with pytest.raises(FileNotFoundError, match="audio mancante"):
        pipeline.transcribe_ready(lec, corso)
    assert comandi == [] and not (ldir / "transcript.json").exists()  # Whisper non parte nemmeno
    assert _riga()["status"] == "media_ok"


def test_transcribe_ready_whisper_fallisce(corso, monkeypatch):
    """Il sottoprocesso muore: l'errore sale a chi chiama, la lezione resta `media_ok` (la ritenta il turno successivo),
    nessun transcript a metà."""
    lec, ldir = _lezione()
    _whisper_finto(monkeypatch, "import sys\nsys.stderr.write('CUDA out of memory')\nsys.exit(3)")
    with pytest.raises(RuntimeError, match="CUDA out of memory"):
        pipeline.transcribe_ready(lec, corso)
    assert not (ldir / "transcript.json").exists()
    r = _riga()
    assert r["status"] == "media_ok" and r["transcript_source"] is None


def test_transcribe_ready_timeout(corso, monkeypatch):
    lec, ldir = _lezione()
    _whisper_finto(monkeypatch, "import time\nprint('PROGRESS 0.1', flush=True)\ntime.sleep(60)")
    monkeypatch.setattr(tr, "IDLE_TIMEOUT_S", 1)
    with pytest.raises(RuntimeError, match="nessun avanzamento"):
        pipeline.transcribe_ready(lec, corso)
    assert _riga()["status"] == "media_ok" and not (ldir / "transcript.json").exists()


# --- pipeline: scoperta e stato delle lezioni -----------------------------------------------------------------

class S:
    def __init__(self, id, title):
        self.id, self.title, self.viewer_url = id, title, f"https://panopto.test/Viewer.aspx?id={id}"


def test_discover_crea_lezioni_nuove_e_non_duplica(corso, monkeypatch):
    sessioni = [S("a" * 36, "Lezione 3 - 05.03.2026"), S("b" * 36, "2025/2026 - ALG - GRIGIO"), S("c" * 36, "2025/2026 - ALG - GRIGIO")]
    monkeypatch.setattr(pipeline, "list_course_sessions", lambda sess, cid: sessioni)
    lez = pipeline.discover(object(), corso)
    assert len(lez) == 3 and {l["status"] for l in lez} == {"nuova"}
    by_title = [l for l in lez if l["number"] == 3][0]
    assert by_title["date"] == "2026-03-05" and by_title["panopto_id"] == "a" * 36 and "L03_" in by_title["folder"]
    cartelle = {l["folder"] for l in lez}
    assert len(cartelle) == 3  # i titoli uguali restano in cartelle diverse (suffisso con l'id Panopto)
    lez2 = pipeline.discover(object(), corso)  # seconda passata: nessun duplicato, stato invariato
    assert len(lez2) == 3
    with session() as d:
        d.execute("UPDATE lectures SET status='trascritta' WHERE panopto_id=?", ("a" * 36,))
    assert [l["status"] for l in pipeline.discover(object(), corso) if l["number"] == 3] == ["trascritta"]


def test_discover_moodle_videos_crea_lezioni_dalle_sorgenti(corso):
    with session() as d:
        d.execute("INSERT INTO media_sources (course_id, kind, url, title) VALUES (1,'moodle_video','https://m/x/l1.mp4','Lezione 1 2026.03.05')")
        d.execute("INSERT INTO media_sources (course_id, kind, url, title) VALUES (1,'panopto_link','https://p/x','Link')")
    lez = pipeline.discover_moodle_videos(corso)
    assert len(lez) == 1
    assert lez[0]["status"] == "nuova" and lez[0]["source"] == "moodle" and lez[0]["date"] == "2026-03-05"
    assert lez[0]["number"] == 1 and lez[0]["media_url"] == "https://m/x/l1.mp4"
    assert len(pipeline.discover_moodle_videos(corso)) == 1  # idempotente


def test_srt_to_segments_e_titoli():
    srt = "1\n00:00:01,500 --> 00:00:03,000\nBuongiorno\n\n2\n00:01:00,000 --> 00:01:02,250\nsecondo [Auto-generated transcript. Edits may have been applied for clarity.]\n\nrotto\n"
    segs = pipeline._srt_to_segments(srt)
    assert segs == [{"start": 1.5, "end": 3.0, "text": "Buongiorno"}, {"start": 60.0, "end": 62.25, "text": "secondo"}]
    assert pipeline._parse_title("Lez. 12 del 19.03.2026") == (12, "2026-03-19")
    assert pipeline._parse_title("2026.03.05 Analisi") == (None, "2026-03-05")


# --- process_lecture / process_moodle_video con ffmpeg e Panopto finti ---------------------------------------

class PanoptoFinto:
    def __init__(self, sottotitoli="1\n00:00:00,000 --> 00:00:02,000\nciao a tutti\n"):
        self.sottotitoli = sottotitoli

    def delivery_info(self, s):
        return {"Delivery": {"SessionName": s.title, "Duration": 60, "AvailableLanguages": [21],
                             "Streams": [{"Tag": "DV", "StreamUrl": "https://p/camera.m3u8"},
                                         {"Tag": "SCREEN", "StreamUrl": "https://p/screen.m3u8"}]}}

    @staticmethod
    def streams(info):
        from studyhub.media.panopto import Panopto
        return Panopto.streams(info)

    def captions(self, s, langs=None):
        return self.sottotitoli


@pytest.fixture
def media_finti(monkeypatch):
    chiamate = {"whisper": 0}

    def scrivi(path_arg_index):
        def f(*a, **k):
            a[path_arg_index].parent.mkdir(parents=True, exist_ok=True)
            a[path_arg_index].write_text("x")
        return f

    monkeypatch.setattr(pipeline.ff, "download", lambda url, dest: (dest.parent.mkdir(parents=True, exist_ok=True), dest.write_bytes(b"mp4"), dest)[2])
    monkeypatch.setattr(pipeline, "extract_audio", scrivi(1))
    monkeypatch.setattr(pipeline, "detect_silences", scrivi(1))
    monkeypatch.setattr(pipeline.ff, "probe", lambda p: {"duration": 60.0, "has_audio": True})

    def slides(src, d):
        (d).mkdir(parents=True, exist_ok=True)
        (d.parent / "slides.json").write_text("[]")
        return [1, 2, 3]

    monkeypatch.setattr(pipeline, "extract_slides", slides)

    def whisper(audio, out, **k):
        chiamate["whisper"] += 1
        out.write_text(json.dumps({"source": "whisper", "segments": [{"start": 0, "end": 1, "text": "w"}]}))
        return {"elapsed_s": 1.0, "segments": [1]}

    monkeypatch.setattr(pipeline, "transcribe", whisper)
    return chiamate


def test_process_lecture_panopto_con_whisper(corso, media_finti):
    lec, ldir = _lezione(status="nuova", con_audio=False, panopto_id="p" * 36, viewer_url="https://p/Viewer.aspx?id=x")
    pipeline.process_lecture(lec, corso, PanoptoFinto(), whisper=True)
    r = _riga()
    assert r["status"] == "trascritta" and r["transcript_source"] == "whisper" and r["has_audio"] == 1 and r["n_slides"] == 3
    assert r["error"] is None and r["attempts"] == 0
    assert media_finti["whisper"] == 1
    assert json.loads((ldir / "transcript.json").read_text(encoding="utf-8"))["source"] == "whisper"
    assert (ldir / "audio.opus").exists() and (ldir / "silences.json").exists()
    assert not (ldir / "_tmp").exists() and not list(ldir.rglob("*.mp4"))  # policy leggera: nessun video resta


def test_process_lecture_senza_whisper_usa_i_sottotitoli_panopto(corso, media_finti):
    lec, ldir = _lezione(status="nuova", con_audio=False, panopto_id="p" * 36, viewer_url="https://p/Viewer.aspx?id=x")
    pipeline.process_lecture(lec, corso, PanoptoFinto(), whisper=False)
    r = _riga()
    assert r["status"] == "media_ok" and r["transcript_source"] == "panopto" and media_finti["whisper"] == 0
    assert json.loads((ldir / "transcript.json").read_text(encoding="utf-8"))["segments"][0]["text"] == "ciao a tutti"


def test_process_lecture_errore_imposta_stato_e_backoff(corso, media_finti, monkeypatch):
    lec, ldir = _lezione(status="nuova", con_audio=False, panopto_id="p" * 36, viewer_url="https://p/Viewer.aspx?id=x")

    def boom(src, dest):
        raise RuntimeError("ffmpeg: disco pieno")

    monkeypatch.setattr(pipeline, "extract_audio", boom)
    with pytest.raises(RuntimeError, match="disco pieno"):
        pipeline.process_lecture(lec, corso, PanoptoFinto(), whisper=True)
    r = _riga()
    assert r["status"] == "errore" and "disco pieno" in r["error"]
    assert r["attempts"] == 1 and r["next_retry_at"]
    assert datetime.fromisoformat(r["next_retry_at"]) > datetime.now() + timedelta(minutes=50)  # 1° fallimento: +1 h
    assert not (ldir / "_tmp").exists()
    # dopo il backoff la ripresa rimette la lezione in coda ("nuova": manca l'audio)
    with session() as d:
        d.execute("UPDATE lectures SET next_retry_at=? WHERE id=1", ((datetime.now() - timedelta(minutes=1)).isoformat(timespec="seconds"),))
    assert riprese.riprendi(unita=False, log=lambda m: None)["lezioni"] == 1
    assert _riga()["status"] == "nuova"


def test_process_lecture_flusso_mancante(corso, media_finti):
    lec, _ = _lezione(status="nuova", con_audio=False, panopto_id="p" * 36, viewer_url="https://p/Viewer.aspx?id=x")

    class SoloScreen(PanoptoFinto):
        def delivery_info(self, s):
            return {"Delivery": {"Streams": [{"Tag": "SCREEN", "StreamUrl": "https://p/screen.m3u8"}]}}

    with pytest.raises(RuntimeError, match="Flusso 'camera'"):
        pipeline.process_lecture(lec, corso, SoloScreen(), whisper=False)
    assert _riga()["status"] == "errore"


class MoodleScarica:
    def __init__(self):
        self.url = []

    def download(self, url, dest):
        self.url.append(url)
        dest.write_bytes(b"mp4")


def test_process_moodle_video_scarica_estrae_e_cancella_il_video(corso, media_finti):
    lec, ldir = _lezione(status="nuova", con_audio=False, source="moodle", media_url="https://m/x/l1.mp4")
    m = MoodleScarica()
    pipeline.process_moodle_video(lec, corso, m, whisper=True)
    assert m.url == ["https://m/x/l1.mp4"]
    r = _riga()
    assert r["status"] == "trascritta" and r["transcript_source"] == "whisper" and r["n_slides"] == 3
    assert not list(ldir.rglob("*.mp4")) and not (ldir / "_tmp").exists()


def test_process_moodle_video_riprende_senza_riscaricare(corso, media_finti):
    """Audio e slide già su disco (giro interrotto prima di Whisper): niente nuovo download, si trascrive soltanto."""
    lec, ldir = _lezione(status="errore", source="moodle", media_url="https://m/x/l1.mp4")
    (ldir / "silences.json").write_text("[]")
    (ldir / "slides.json").write_text("[]")
    m = MoodleScarica()
    pipeline.process_moodle_video(lec, corso, m, whisper=True)
    assert m.url == [] and _riga()["status"] == "trascritta" and media_finti["whisper"] == 1


def test_process_moodle_video_errore_di_download(corso, media_finti):
    lec, _ = _lezione(status="nuova", con_audio=False, source="moodle", media_url="https://m/x/l1.mp4")

    class Rotto:
        def download(self, url, dest):
            raise RuntimeError("connessione chiusa")

    with pytest.raises(RuntimeError, match="connessione chiusa"):
        pipeline.process_moodle_video(lec, corso, Rotto(), whisper=True)
    r = _riga()
    assert r["status"] == "errore" and r["attempts"] == 1 and r["next_retry_at"]
