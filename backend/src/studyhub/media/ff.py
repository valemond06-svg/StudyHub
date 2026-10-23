"""Piccoli wrapper su ffmpeg (binario statico di imageio-ffmpeg: niente installazioni di sistema)."""
from __future__ import annotations

import re
import subprocess
from functools import cache
from pathlib import Path

import imageio_ffmpeg


@cache
def ffmpeg() -> str:
    return imageio_ffmpeg.get_ffmpeg_exe()


def run(*args: str | Path, check: bool = True) -> subprocess.CompletedProcess:
    cmd = [ffmpeg(), "-hide_banner", "-nostdin", *map(str, args)]
    res = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if check and res.returncode != 0:
        raise RuntimeError(f"ffmpeg fallito ({res.returncode}): {res.stderr[-800:]}")
    return res


def probe(src: str | Path) -> dict:
    """Durata e tipi di stream, letti dall'output di `ffmpeg -i` (non c'è ffprobe)."""
    err = run("-i", src, check=False).stderr
    m = re.search(r"Duration: (\d+):(\d+):([\d.]+)", err)
    duration = int(m[1]) * 3600 + int(m[2]) * 60 + float(m[3]) if m else 0.0
    size = re.search(r"Video: .*?(\d{3,5})x(\d{3,5})", err)
    return {
        "duration": duration,
        "has_audio": "Audio:" in err,
        "has_video": "Video:" in err,
        "width": int(size[1]) if size else 0,
        "height": int(size[2]) if size else 0,
    }


def download(url: str, dest: Path) -> Path:
    """Copia un flusso (MP4 progressivo o HLS) in un file locale senza ricodifica."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".part" + dest.suffix)
    run("-y", "-i", url, "-c", "copy", "-f", "mp4", tmp)
    tmp.replace(dest)
    return dest
