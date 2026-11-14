"""Embeddings bge-m3 via Ollama.

Indicizzazione: GPU, sotto lock GPU, con keep_alive=0 a ogni chiamata (la VRAM torna
libera subito; Whisper non deve mai trovarla occupata).
Query di ricerca: CPU (num_gpu=0), così una ricerca non tocca la VRAM e non deve
aspettare che finisca un job GPU.
"""
from __future__ import annotations

import threading
import time

import httpx
import numpy as np

from ..media.gpu import LockTimeout, gpu_lock

OLLAMA = "http://127.0.0.1:11434"
MODEL = "bge-m3"
DIM = 1024
BATCH = 96
GPU_LOCK_TIMEOUT_S = 30 * 60  # per ogni blocco
LOCK_BLOCK = 96  # testi per ogni presa del lock GPU (un batch Ollama)
YIELD_S = 2.5  # pausa senza lock tra due blocchi (> poll 2 s del file_lock)


class EmbeddingError(Exception):
    pass


def _embed(texts: list[str], options: dict, keep_alive) -> np.ndarray:
    try:
        r = httpx.post(f"{OLLAMA}/api/embed", timeout=600, json={
            "model": MODEL, "input": texts, "truncate": True, "keep_alive": keep_alive, "options": options})
    except httpx.ConnectError:
        raise EmbeddingError("Ollama non è in esecuzione (avvia l'app Ollama).")
    if r.status_code != 200:
        raise EmbeddingError(f"Ollama: {r.status_code} {r.text[:200]}")
    vecs = np.asarray(r.json()["embeddings"], dtype=np.float32)
    vecs /= np.linalg.norm(vecs, axis=1, keepdims=True) + 1e-12
    return vecs


def iter_embed_blocks(texts: list[str], stop_event: threading.Event | None = None):
    """Calcola gli embedding a blocchi di LOCK_BLOCK testi, prendendo il lock GPU per ogni blocco.

    Genera (indice_iniziale, vettori). Dopo ogni blocco il lock è rilasciato e, prima del
    successivo, si attende YIELD_S: chi aspetta la GPU (Whisper, poll 2 s) riesce a prenderla.
    Nessuna pausa dopo l'ultimo blocco. Se `stop_event` è impostato tra due blocchi, si ferma.
    Se il lock non arriva entro GPU_LOCK_TIMEOUT_S, EmbeddingError: i blocchi già generati
    sono già stati consegnati a chi consuma il generatore."""
    for i in range(0, len(texts), LOCK_BLOCK):
        if i:
            if stop_event is not None and stop_event.is_set():
                return
            time.sleep(YIELD_S)
            if stop_event is not None and stop_event.is_set():
                return
        try:
            with gpu_lock("ollama bge-m3", timeout=GPU_LOCK_TIMEOUT_S):
                vecs = np.vstack([_embed(texts[j:j + BATCH], {}, keep_alive=0)
                                  for j in range(i, min(i + LOCK_BLOCK, len(texts)), BATCH)])
        except LockTimeout as e:
            raise EmbeddingError(f"GPU occupata da {str(e).split('occupato da ', 1)[-1]}: embeddings rimandati")
        yield i, vecs


def embed_documents(texts: list[str], on_progress=None) -> np.ndarray:
    out = []
    for i, vecs in iter_embed_blocks(texts):
        out.append(vecs)
        if on_progress:
            on_progress(min(len(texts), i + LOCK_BLOCK), len(texts))
    return np.vstack(out) if out else np.zeros((0, DIM), np.float32)


def embed_query(text: str) -> np.ndarray:
    # Su CPU: nessuna VRAM usata, quindi niente lock GPU. Il modello resta in RAM 5 minuti
    # per rendere veloci le ricerche successive.
    return _embed([text], {"num_gpu": 0}, keep_alive="5m")[0]
