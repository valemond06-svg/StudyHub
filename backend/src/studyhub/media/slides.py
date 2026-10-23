"""Estrazione delle "slide" dal flusso schermo.

Funziona sia con slide classiche sia con appunti scritti a mano su tablet: il video viene
diviso in segmenti quando la schermata cambia molto (nuova slide/pagina/scroll) e di ogni
segmento si salva l'ULTIMO fotogramma, cioè la pagina nel suo stato più completo.
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

import imagehash
import numpy as np
from PIL import Image

from . import ff

SAMPLE_EVERY_S = 2.0
THUMB_W, THUMB_H = 160, 120
PIXEL_DELTA = 40          # differenza di grigio perché un pixel conti come "cambiato"
PAGE_CHANGE = 0.10        # quota di pixel cambiati rispetto al campione precedente
DRIFT_CHANGE = 0.35       # quota cambiata rispetto all'inizio del segmento (scroll lenti)
MIN_SEGMENT_S = 6.0       # le transizioni brevissime non diventano slide
DUP_HASH_DIST = 4         # slide quasi identiche (es. si torna alla stessa pagina) vengono unite


def _thumbnails(src: Path) -> np.ndarray:
    cmd = [ff.ffmpeg(), "-hide_banner", "-nostdin", "-i", str(src), "-vf",
           f"fps=1/{SAMPLE_EVERY_S},scale={THUMB_W}:{THUMB_H},format=gray",
           "-f", "rawvideo", "-pix_fmt", "gray", "-"]
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, THUMB_H, THUMB_W)


def _changed(a: np.ndarray, b: np.ndarray) -> float:
    return float((np.abs(a.astype(np.int16) - b.astype(np.int16)) > PIXEL_DELTA).mean())


def _segments(thumbs: np.ndarray) -> list[tuple[int, int]]:
    """Coppie (indice_inizio, indice_fine) di campioni che mostrano la stessa pagina."""
    segs, start = [], 0
    for i in range(1, len(thumbs)):
        if _changed(thumbs[i], thumbs[i - 1]) > PAGE_CHANGE or _changed(thumbs[i], thumbs[start]) > DRIFT_CHANGE:
            segs.append((start, i - 1))
            start = i
    if len(thumbs):
        segs.append((start, len(thumbs) - 1))
    # Le transizioni brevi si accorpano al segmento successivo.
    merged: list[list[int]] = []
    for s, e in segs:
        if merged and (merged[-1][1] - merged[-1][0] + 1) * SAMPLE_EVERY_S < MIN_SEGMENT_S:
            merged[-1][1] = e
        else:
            merged.append([s, e])
    return [(s, e) for s, e in merged]


def _blank(thumb: np.ndarray) -> bool:
    return float(thumb.std()) < 3.0  # schermata uniforme (nera/bianca): niente da salvare


def _ts(t: float) -> str:
    t = int(t)
    return f"{t // 3600:02d}-{t % 3600 // 60:02d}-{t % 60:02d}"


def extract_slides(src: Path, out_dir: Path) -> list[dict]:
    out_dir.mkdir(parents=True, exist_ok=True)
    thumbs = _thumbnails(src)
    slides: list[dict] = []
    last_hash = None
    for s, e in _segments(thumbs):
        if _blank(thumbs[e]):
            continue
        shot_t = e * SAMPLE_EVERY_S
        name = f"{len(slides) + 1:04d}_{_ts(s * SAMPLE_EVERY_S)}.png"
        path = out_dir / name
        ff.run("-y", "-ss", f"{shot_t:.2f}", "-i", src, "-frames:v", "1", path)
        h = imagehash.dhash(Image.open(path))
        if last_hash is not None and h - last_hash <= DUP_HASH_DIST:
            path.unlink()  # stessa pagina del segmento prima: estende quella
            slides[-1]["end"] = (e + 1) * SAMPLE_EVERY_S
            slides[-1]["shot_at"] = shot_t
            ff.run("-y", "-ss", f"{shot_t:.2f}", "-i", src, "-frames:v", "1", out_dir / slides[-1]["file"])
            continue
        last_hash = h
        slides.append({"file": name, "start": s * SAMPLE_EVERY_S, "end": (e + 1) * SAMPLE_EVERY_S,
                       "shot_at": shot_t})
    (out_dir.parent / "slides.json").write_text(json.dumps(slides, indent=1), encoding="utf-8")
    return slides
