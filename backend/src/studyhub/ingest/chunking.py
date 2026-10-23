"""Divisione in chunk che rispettano la struttura (pagine, paragrafi, titoli, minuti di lezione)."""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

TARGET = 1200      # caratteri per chunk
OVERLAP = 150
MIN_CHARS = 40
TRANSCRIPT_WINDOW_S = 75


@dataclass
class Chunk:
    text: str
    heading: str = ""
    page: int | None = None
    t_start: float | None = None
    t_end: float | None = None


_ACCENTS = {"`e": "è", "`a": "à", "`o": "ò", "`u": "ù", "`i": "ì", "´e": "é", "`E": "È"}


def _clean(text: str) -> str:
    text = unicodedata.normalize("NFKC", text).replace("­", "")  # NFKC: "ﬃ" → "ffi"
    for bad, good in _ACCENTS.items():  # accenti LaTeX estratti male: "`e" → "è"
        text = text.replace(bad, good)
    text = re.sub(r"-\n(?=[a-zà-ù])", "", text)      # parole spezzate a capo
    text = re.sub(r"[ \t]+", " ", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def split_text(text: str, target: int = TARGET, overlap: int = OVERLAP) -> list[str]:
    text = _clean(text)
    if len(text) <= target * 1.3:
        return [text] if len(text) >= MIN_CHARS else []
    paras = [p.strip() for p in re.split(r"\n\s*\n|\n(?=[A-Z0-9•\-–])", text) if p.strip()]
    out, cur = [], ""
    for p in paras:
        while len(p) > target * 1.5:  # paragrafo enorme: taglio su frase
            cut = p.rfind(". ", 0, target)
            cut = cut + 1 if cut > target // 2 else target
            paras_piece, p = p[:cut], p[cut:].strip()
            if cur:
                out.append(cur)
                cur = ""
            out.append(paras_piece)
        if len(cur) + len(p) + 1 > target and cur:
            out.append(cur)
            cur = cur[-overlap:].split(" ", 1)[-1] + "\n" + p if overlap else p
        else:
            cur = f"{cur}\n{p}" if cur else p
    if cur:
        out.append(cur)
    return [c for c in out if len(c) >= MIN_CHARS]


def chunk_pages(pages, title: str) -> list[Chunk]:
    chunks = []
    for p in pages:
        if not p.text.strip():
            continue
        first = next((ln.strip() for ln in p.text.splitlines() if len(ln.strip()) > 3), "")[:90]
        for piece in split_text(p.text):
            chunks.append(Chunk(piece, f"{title} · p. {p.number} · {first}", page=p.number))
    return chunks


def chunk_markdown(text: str, title: str) -> list[Chunk]:
    chunks, heading, buf = [], title, []

    def flush():
        for piece in split_text("\n".join(buf)):
            chunks.append(Chunk(piece, heading))

    for line in text.splitlines():
        if re.match(r"#{1,4} ", line):
            flush()
            buf = []
            heading = f"{title} · {line.lstrip('# ').strip()}"
        else:
            buf.append(line)
    flush()
    return chunks


def chunk_code(text: str, title: str, lines_per_chunk: int = 80) -> list[Chunk]:
    lines = text.splitlines()
    out = []
    for i in range(0, len(lines), lines_per_chunk - 10):
        piece = "\n".join(lines[i:i + lines_per_chunk]).strip()
        if len(piece) >= MIN_CHARS:
            out.append(Chunk(piece, f"{title} · righe {i + 1}-{min(len(lines), i + lines_per_chunk)}", page=None))
    return out


def chunk_transcript(segments: list[dict], title: str) -> list[Chunk]:
    out, cur, start = [], [], None
    for s in segments:
        if start is None:
            start = s["start"]
        cur.append(s["text"])
        if s["end"] - start >= TRANSCRIPT_WINDOW_S:
            out.append(Chunk(" ".join(cur), title, t_start=start, t_end=s["end"]))
            cur, start = [], None
    if cur and start is not None:
        out.append(Chunk(" ".join(cur), title, t_start=start, t_end=segments[-1]["end"]))
    return out
