"""Embeddings bge-m3 via Ollama.

Indicizzazione: GPU, sotto lock GPU, con keep_alive=0 a ogni chiamata (la VRAM torna
libera subito; Whisper non deve mai trovarla occupata).
Query di ricerca: CPU (num_gpu=0), così una ricerca non tocca la VRAM e non deve
aspettare che finisca un job GPU.
"""
from __future__ import annotations

import httpx
import numpy as np

from ..media.gpu import gpu_lock

OLLAMA = "http://127.0.0.1:11434"
MODEL = "bge-m3"
DIM = 1024
BATCH = 96


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


def embed_documents(texts: list[str], on_progress=None) -> np.ndarray:
    out = []
    with gpu_lock("ollama bge-m3"):
        for i in range(0, len(texts), BATCH):
            out.append(_embed(texts[i:i + BATCH], {}, keep_alive=0))
            if on_progress:
                on_progress(min(len(texts), i + BATCH), len(texts))
    return np.vstack(out) if out else np.zeros((0, DIM), np.float32)


def embed_query(text: str) -> np.ndarray:
    # Su CPU: nessuna VRAM usata, quindi niente lock GPU. Il modello resta in RAM 5 minuti
    # per rendere veloci le ricerche successive.
    return _embed([text], {"num_gpu": 0}, keep_alive="5m")[0]
