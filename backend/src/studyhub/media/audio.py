"""Audio della lezione (opus mono, ~15 MB/ora) e mappa dei silenzi per il player."""
from __future__ import annotations

import json
import re
from pathlib import Path

from . import ff

SILENCE_DB = -35
SILENCE_MIN_S = 1.0


def extract_audio(src: str | Path, dest: Path) -> Path:
    tmp = dest.with_name(dest.stem + ".part.opus")
    ff.run("-y", "-i", src, "-vn", "-ac", "1", "-c:a", "libopus", "-b:a", "32k",
           "-application", "voip", tmp)
    tmp.replace(dest)
    return dest


def detect_silences(audio: Path, dest: Path) -> list[list[float]]:
    err = ff.run("-i", audio, "-af", f"silencedetect=n={SILENCE_DB}dB:d={SILENCE_MIN_S}",
                 "-f", "null", "-").stderr
    starts = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", err)]
    ends = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", err)]
    silences = [[round(s, 2), round(e, 2)] for s, e in zip(starts, ends)]
    dest.write_text(json.dumps(silences), encoding="utf-8")
    return silences
