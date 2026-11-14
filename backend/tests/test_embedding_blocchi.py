"""P1.5: embedding a blocchi, lock GPU rilasciato tra un blocco e l'altro. Niente rete né Ollama."""
from __future__ import annotations

import threading
from types import SimpleNamespace

import numpy as np
import pytest

from studyhub.ingest import embed, indexer
from studyhub.media import gpu


@pytest.fixture
def setup(ambiente, monkeypatch):
    monkeypatch.setattr(gpu, "LOCK_FILE", ambiente / "gpu.lock")
    monkeypatch.setattr(embed, "LOCK_BLOCK", 2)
    monkeypatch.setattr(embed, "BATCH", 2)
    monkeypatch.setattr(embed, "YIELD_S", 0.0)
    monkeypatch.setattr(embed, "_embed", lambda texts, options, keep_alive: np.ones((len(texts), embed.DIM), np.float32))
    from studyhub.db import session
    with session() as db:
        db.execute("INSERT INTO documents (id, course_id, path, kind, sha256) VALUES (1, 1, 'a.md', 'md', 'x')")
        db.executemany("INSERT INTO chunks (id, doc_id, course_id, heading, text) VALUES (?,?,?,?,?)",
                       [(i, 1, 1, "h", f"t{i}") for i in range(1, 8)])  # 7 chunk = 4 blocchi da 2
    return ambiente


def _n_salvati():
    from studyhub.db import session
    with session() as db:
        return db.execute("SELECT COUNT(*) FROM chunks WHERE embedding IS NOT NULL").fetchone()[0]


def test_lock_rilasciato_tra_i_blocchi(setup, monkeypatch):
    preso = {}
    blocchi_fatti = []
    orig = embed._embed

    def conta(texts, options, keep_alive):
        blocchi_fatti.append(len(texts))
        return orig(texts, options, keep_alive)

    monkeypatch.setattr(embed, "_embed", conta)

    def attende():
        with gpu.gpu_lock("whisper", poll_s=0.01, timeout=10):
            preso["dopo"] = len(blocchi_fatti)

    t = threading.Thread(target=attende)
    pause = []

    def pausa(s):
        pause.append(s)
        if len(pause) == 1:  # dopo il primo blocco il lock è libero: Whisper lo prende
            t.start()
            t.join(5)

    monkeypatch.setattr(embed, "time", SimpleNamespace(sleep=pausa))
    assert indexer.embed_pending() == 7
    assert preso["dopo"] == 1 < len(blocchi_fatti) == 4
    assert len(pause) == 3  # nessuna pausa dopo l'ultimo blocco


def test_timeout_a_meta_salva_i_blocchi_fatti(setup, monkeypatch):
    from contextlib import contextmanager
    n = {"k": 0}
    reale = embed.gpu_lock

    @contextmanager
    def lock(owner, poll_s=2.0, timeout=None):
        n["k"] += 1
        if n["k"] == 3:
            raise embed.LockTimeout("lock gpu.lock occupato da whisper x")
        with reale(owner, poll_s=poll_s, timeout=timeout):
            yield

    monkeypatch.setattr(embed, "gpu_lock", lock)
    with pytest.raises(embed.EmbeddingError, match="GPU occupata da whisper x"):
        indexer.embed_pending()
    assert _n_salvati() == 4  # due blocchi da 2 già salvati


def test_stop_event_tra_i_blocchi(setup, monkeypatch):
    stop = threading.Event()
    pause = []
    monkeypatch.setattr(embed, "time", SimpleNamespace(sleep=lambda s: (pause.append(s), stop.set())))
    assert indexer.embed_pending(stop_event=stop) == 2
    assert _n_salvati() == 2
    stop.clear()
    assert indexer.embed_pending() == 5  # il giro successivo riparte dal resto
    assert _n_salvati() == 7


def test_progress_corretto(setup):
    visti = []
    assert indexer.embed_pending(on_progress=lambda d, t: visti.append((d, t))) == 7
    assert visti == [(2, 7), (4, 7), (6, 7), (7, 7)]


def test_pausa_default_maggiore_del_poll():
    assert embed.YIELD_S > 2.0 and embed.LOCK_BLOCK == 96 and embed.BATCH == 96
