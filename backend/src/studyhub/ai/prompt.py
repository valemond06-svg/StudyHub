"""Testo per i prompt e provenienza da conservare attraverso le trasformazioni."""
from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

_OCR_MARKER = "<!-- studyhub:ocr_source -->\n"


def is_generated_material(path: str) -> bool:
    """Gli export in studio_ai possono riportare testo OCR senza metadati propri."""
    return "studio_ai" in PurePosixPath(path).parts[:-1]


@dataclass(frozen=True)
class Prompt:
    text: str
    ocr_source: bool = False

    def with_text(self, text: str) -> Prompt:
        return Prompt(text, self.ocr_source)

    def block(self) -> dict:
        return {"type": "text", "text": self.text, "ocr_source": self.ocr_source}

    def write_markdown(self, path: Path) -> None:
        path.write_text((_OCR_MARKER if self.ocr_source else "") + self.text, encoding="utf-8")

    @classmethod
    def read_markdown(cls, path: Path, ocr_source: bool) -> Prompt:
        text = path.read_text(encoding="utf-8")
        return cls(text.removeprefix(_OCR_MARKER), ocr_source or text.startswith(_OCR_MARKER))

    @classmethod
    def join(cls, parts: Iterable[str | Prompt], separator: str = "\n\n", limit: int | None = None) -> Prompt:
        texts = []
        ocr_source = False
        remaining = limit
        for part in parts:
            if isinstance(part, str):
                part = cls(part)
            if remaining is not None and texts:
                remaining -= len(separator)
            if remaining is not None and remaining <= 0:
                break
            text = part.text[:remaining]
            texts.append(text)
            ocr_source |= bool(text) and part.ocr_source
            if remaining is not None:
                remaining -= len(text)
        return cls(separator.join(texts)[:limit], ocr_source)

    @classmethod
    def from_blocks(cls, content: list[dict], limit: int | None = None) -> Prompt:
        return cls.join((cls(b["text"], bool(b.get("ocr_source")))
                         for b in content if b.get("type") == "text"), limit=limit)
