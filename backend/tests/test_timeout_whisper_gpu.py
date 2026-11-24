"""P0.5: Whisper non si blocca su stderr piena, ha timeout totale e di inattività; la GPU occupata è un errore chiaro."""
import subprocess
import sys
import time
from contextlib import contextmanager

import pytest

from studyhub.media import transcribe as tr


@contextmanager
def _nolock():
    yield


def _finto(monkeypatch, codice: str) -> list:
    """Sostituisce il comando di Whisper con un sottoprocesso Python finto; restituisce i processi avviati."""
    orig = subprocess.Popen
    procs: list = []

    def popen(cmd, **kw):
        procs.append(orig([sys.executable, "-c", codice], **kw))
        return procs[-1]

    monkeypatch.setattr(tr.subprocess, "Popen", popen)
    monkeypatch.setattr(tr, "device", lambda: "cpu")
    monkeypatch.setattr(tr, "gpu_lock", lambda *a, **k: _nolock())
    return procs


def test_stderr_enorme_non_blocca(monkeypatch, tmp_path):
    out = tmp_path / "t.json"
    codice = (
        "import sys, json\n"
        "for _ in range(2000): sys.stderr.write('e' * 1000 + '\\n')\n"
        "print('PROGRESS 0.5', flush=True)\n"
        f"open({str(out)!r}, 'w').write(json.dumps({{'segments': [], 'elapsed_s': 0}}))\n"
    )
    _finto(monkeypatch, codice)
    visti = []
    t0 = time.monotonic()
    res = tr.transcribe(tmp_path / "a.wav", out, on_progress=visti.append, timeout_s=60)
    assert time.monotonic() - t0 < 30
    assert res["segments"] == [] and visti == [0.5]


def test_errore_riporta_coda_stderr(monkeypatch, tmp_path):
    _finto(monkeypatch, "import sys\n[sys.stderr.write(f'riga{i}\\n') for i in range(5000)]\nsys.exit(3)")
    with pytest.raises(RuntimeError, match="riga4999"):
        tr.transcribe(tmp_path / "a.wav", tmp_path / "o.json", timeout_s=60)


def test_timeout_totale_uccide_il_figlio(monkeypatch, tmp_path):
    procs = _finto(monkeypatch, "import time\nwhile True:\n    print('PROGRESS 0.1', flush=True); time.sleep(0.05)")
    with pytest.raises(RuntimeError, match="timeout totale"):
        tr.transcribe(tmp_path / "a.wav", tmp_path / "o.json", timeout_s=1)
    assert len(procs) == 1 and procs[0].poll() is not None   # niente ripiego su CPU, figlio morto


def test_timeout_inattivita_uccide_il_figlio(monkeypatch, tmp_path):
    procs = _finto(monkeypatch, "import time\nprint('PROGRESS 0.1', flush=True)\ntime.sleep(60)")
    with pytest.raises(RuntimeError, match="nessun avanzamento"):
        tr.transcribe(tmp_path / "a.wav", tmp_path / "o.json", timeout_s=60, idle_timeout_s=1)
    assert procs[0].poll() is not None


def test_timeout_default_dalla_durata():
    assert tr.total_timeout(None) == 4 * 3600
    assert tr.total_timeout(100) == 1800
    assert tr.total_timeout(3600) == 3 * 3600


def test_attesa_lock_gpu_allineata_al_timeout_massimo():
    assert tr.GPU_LOCK_TIMEOUT_S == tr.MAX_TIMEOUT_S == tr.total_timeout(None) == 4 * 3600
    assert tr.total_timeout(10 * 3600) == tr.MAX_TIMEOUT_S


def test_trascrizione_notturna_usa_la_stessa_attesa_gpu(ambiente, monkeypatch):
    from studyhub import notte
    from studyhub.media import pipeline

    folder = ambiente / "uni" / "lezione"
    folder.mkdir()
    (folder / "audio.opus").touch()
    monkeypatch.setattr(pipeline.ff, "probe", lambda _: {"duration": 10 * 3600})
    monkeypatch.setattr(pipeline, "_glossary", lambda _: None)
    monkeypatch.setattr(pipeline, "_update", lambda *a, **k: None)
    monkeypatch.setattr(pipeline.riprese, "segna_fallita", lambda *a, **k: None)
    wait = []

    @contextmanager
    def lock(owner, *, timeout):
        wait.append(timeout)
        raise tr.LockTimeout("lock occupato da Whisper")
        yield

    monkeypatch.setattr(tr, "gpu_lock", lock)
    with pytest.raises(RuntimeError, match="attesa oltre 240 minuti"):
        notte.trascrivi({"id": 1, "folder": "lezione"}, {})
    assert wait == [tr.MAX_TIMEOUT_S]


def test_gpu_occupata_diventa_runtime_error(monkeypatch, tmp_path):
    visti = {}

    @contextmanager
    def lock(owner, poll_s=2.0, timeout=None):
        visti["timeout"] = timeout
        raise tr.LockTimeout("lock gpu.lock occupato da ollama bge-m3")
        yield

    monkeypatch.setattr(tr, "gpu_lock", lock)
    with pytest.raises(RuntimeError, match="GPU occupata da ollama bge-m3"):
        tr.transcribe(tmp_path / "a.wav", tmp_path / "o.json")
    assert visti["timeout"] == 4 * 3600


def test_embed_gpu_occupata_diventa_embedding_error(monkeypatch):
    from studyhub.ingest import embed

    visti = {}

    @contextmanager
    def lock(owner, poll_s=2.0, timeout=None):
        visti["timeout"] = timeout
        raise embed.LockTimeout("lock gpu.lock occupato da whisper x")
        yield

    monkeypatch.setattr(embed, "gpu_lock", lock)
    with pytest.raises(embed.EmbeddingError, match="GPU occupata da whisper x"):
        embed.embed_documents(["a"])
    assert visti["timeout"] == 30 * 60
