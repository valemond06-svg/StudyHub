"""Lettura dei PDF scansionati o scritti a mano (appunti delle lezioni, tutorati): pagine → testo con Claude.

Il testo finisce nell'indice come quello degli altri PDF, così ricerca, quiz e profili d'esame lo vedono. Il risultato
è salvato per contenuto del file in ~/.studyhub/ocr: se il PDF non cambia non si paga due volte.
"""
from __future__ import annotations

import json

import pymupdf

from ..ai.claude_runner import RateLimited, image_block, run
from ..config import LOCAL_DIR
from ..db import session
from ..paths import uni_path
from .chunking import chunk_pages
from .extract import Page

MODEL = "sonnet"
BATCH_PAGES = 5
DPI = 130
MAX_DOC_PAGES = 40  # oltre è materiale culturale (es. il report EDVAC): non vale la spesa
CACHE = LOCAL_DIR / "ocr"
SYSTEM = """Trascrivi fedelmente le pagine di materiale universitario (spesso appunti scritti a mano). Formule in
LaTeX con $...$. Descrivi in una riga fra [] figure e circuiti. Non aggiungere nulla di tuo, non riassumere, non
tradurre. Se una parte è illeggibile scrivi [illeggibile]."""
SCHEMA = {"type": "object", "additionalProperties": False, "required": ["pagine"], "properties": {"pagine": {
    "type": "array", "items": {"type": "object", "additionalProperties": False, "required": ["numero", "testo"],
                               "properties": {"numero": {"type": "integer"}, "testo": {"type": "string"}}}}}}


def pending() -> list[dict]:
    with session() as db:
        return [dict(r) for r in db.execute(
            """SELECT d.id, d.course_id, d.path, d.title, d.sha256, d.n_pages FROM documents d
               JOIN courses c ON c.id=d.course_id
               WHERE d.kind='pdf' AND d.duplicate_of IS NULL AND c.stage IN ('corrente','arretrato','futuro')
                 AND COALESCE(d.n_pages,0) BETWEEN 1 AND ?
                 AND NOT EXISTS (SELECT 1 FROM chunks x WHERE x.doc_id=d.id)
               ORDER BY c.stage='corrente' DESC, d.course_id, d.path""", (MAX_DOC_PAGES,))]


def _transcribe(path, n_pages: int) -> list[dict]:
    out, tmp = [], CACHE / "tmp"
    tmp.mkdir(parents=True, exist_ok=True)
    doc = pymupdf.open(path)
    try:
        for start in range(0, n_pages, BATCH_PAGES):
            content: list[dict] = []
            for i in range(start, min(start + BATCH_PAGES, n_pages)):
                png = tmp / f"p{i}.png"
                doc[i].get_pixmap(dpi=DPI).save(png)
                content += [{"type": "text", "text": f"Pagina {i + 1}:"}, image_block(png)]
            out += run(SYSTEM, content, SCHEMA, model=MODEL).data["pagine"]
    finally:
        doc.close()
    return out


def run_pending(limit: int | None = None, on_item=print) -> dict:
    from .indexer import _insert_chunks
    done, failed = 0, []
    CACHE.mkdir(parents=True, exist_ok=True)
    for d in pending()[:limit]:
        cache = CACHE / f"{d['sha256']}.json"
        try:
            if cache.exists():
                pages = json.loads(cache.read_text(encoding="utf-8"))
            else:
                pages = _transcribe(uni_path(d["path"]), d["n_pages"])
                cache.write_text(json.dumps(pages, ensure_ascii=False), encoding="utf-8")
            chunks = chunk_pages([Page(p["numero"], p["testo"], True, True) for p in pages], d["title"] or "Documento")
            with session() as db:
                _insert_chunks(db, d["id"], d["course_id"], "pdf", chunks)
            done += 1
            on_item(f"ok {d['path']} ({len(chunks)} chunk)")
        except RateLimited as e:
            failed.append(f"{d['path']}: {e}")
            break  # finestra piena: il resto al prossimo giro
        except Exception as e:  # noqa: BLE001 — un PDF rotto non ferma gli altri
            failed.append(f"{d['path']}: {e}")
    return {"letti": done, "errori": failed, "restano": len(pending())}
