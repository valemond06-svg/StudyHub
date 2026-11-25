"""Lettura locale dei PDF scansionati o scritti a mano.

Il testo finisce nell'indice come quello degli altri PDF, così ricerca, quiz e profili d'esame lo vedono. Il risultato
è salvato per contenuto del file in ~/.studyhub/ocr: se il PDF non cambia non si paga due volte.
"""
from __future__ import annotations

import base64
import json

import pymupdf

from ..ai.claude_runner import RateLimited
from ..ai.llm import VisionBlockedByPrivacy, run_json_content
from ..ai.privacy import scope
from ..ai.vision import MAX_SIDE
from ..config import LOCAL_DIR
from ..db import session
from ..paths import uni_path
from .chunking import chunk_pages
from .extract import Page

BATCH_PAGES = 5
DPI = 130
MAX_DOC_PAGES = 40  # oltre è materiale culturale (es. il report EDVAC): non vale la spesa
MIN_CHARS_PER_PAGE = 80  # sotto, in media, il testo estratto non basta: si legge con la visione
CACHE = LOCAL_DIR / "ocr"
SYSTEM = """Trascrivi fedelmente le pagine di materiale universitario (spesso appunti scritti a mano). Formule in
LaTeX con $...$. Descrivi in una riga fra [] figure e circuiti. Non aggiungere nulla di tuo, non riassumere, non
tradurre. Se una parte è illeggibile scrivi [illeggibile]."""
SCHEMA = {"type": "object", "additionalProperties": False, "required": ["pagine"], "properties": {"pagine": {
    "type": "array", "items": {"type": "object", "additionalProperties": False, "required": ["numero", "testo"],
                               "properties": {"numero": {"type": "integer"}, "testo": {"type": "string"}}}}}}


def needs_ocr(doc: dict) -> bool:
    """Vero se del PDF (1..MAX_DOC_PAGES pagine) non si legge abbastanza testo: la maggioranza delle pagine è una
    scansione (`is_scan`) oppure la media di caratteri per pagina è sotto MIN_CHARS_PER_PAGE. Non dipende dai chunk:
    una scansione con un po' di rumore da OCR del PDF ha chunk, ma quasi vuoti."""
    n_doc = doc.get("n_pages") or 0
    if not 1 <= n_doc <= MAX_DOC_PAGES:
        return False
    with session() as db:
        n, scans, chars = db.execute(
            "SELECT COUNT(*), COALESCE(SUM(is_scan),0), COALESCE(SUM(chars),0) FROM pages WHERE doc_id=?",
            (doc["id"],)).fetchone()
        if not n:  # nessun dato per pagina (indice vecchio): vale solo «nessun chunk»
            return not db.execute("SELECT 1 FROM chunks WHERE doc_id=? LIMIT 1", (doc["id"],)).fetchone()
    return scans * 2 > n or chars / n < MIN_CHARS_PER_PAGE


def cache_path(sha256: str):
    return CACHE / f"{sha256}.json"


def cached_pages(sha256: str | None) -> list[str] | None:
    """Testo OCR già in cache, pagina per pagina (indice = numero pagina - 1); None se non c'è."""
    if not sha256 or not cache_path(sha256).exists():
        return None
    try:
        data = json.loads(cache_path(sha256).read_text(encoding="utf-8"))
        by_num = {int(p["numero"]): str(p.get("testo") or "") for p in data}
    except (OSError, ValueError, KeyError, TypeError):
        return None
    return [by_num.get(i, "") for i in range(1, max(by_num, default=0) + 1)]


def pending() -> list[dict]:
    with session() as db:
        rows = [dict(r) for r in db.execute(
            """SELECT d.id, d.course_id, d.path, d.title, d.sha256, d.n_pages FROM documents d
               JOIN courses c ON c.id=d.course_id
               WHERE d.kind='pdf' AND d.duplicate_of IS NULL AND c.stage IN ('corrente','arretrato','futuro')
                 AND COALESCE(d.n_pages,0) BETWEEN 1 AND ?
               ORDER BY c.stage='corrente' DESC, d.course_id, d.path""", (MAX_DOC_PAGES,))]
    return [d for d in rows if not cache_path(d["sha256"]).exists() and needs_ocr(d)]


def _transcribe(path, n_pages: int) -> list[dict]:
    out = []
    # Le immagini possono contenere dati personali invisibili all'estrazione testuale.
    with scope(kind="personal_notes", private=True), pymupdf.open(path) as doc:
        for start in range(0, n_pages, BATCH_PAGES):
            content: list[dict] = []
            for i in range(start, min(start + BATCH_PAGES, n_pages)):
                page = doc[i]
                scale = min(DPI / 72, MAX_SIDE / max(page.rect.width, page.rect.height))
                pixmap = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale))
                data = base64.b64encode(pixmap.tobytes("jpeg", jpg_quality=85)).decode("ascii")
                content += [{"type": "text", "text": f"Pagina {i + 1}:"},
                            {"type": "image", "media_type": "image/jpeg", "data": data}]
            out += run_json_content(SYSTEM, content, SCHEMA, require_images=True).data["pagine"]
    return out


def process_doc(d: dict) -> int | None:
    """OCR del documento (salvo cache con lo stesso sha256) e sostituzione dei suoi chunk. Ritorna i chunk nuovi.
    Ritorna None quando manca un modello locale con vista."""
    from .indexer import replace_chunks
    if cached_pages(d["sha256"]) is None:
        try:
            pages = _transcribe(uni_path(d["path"]), d["n_pages"])
        except VisionBlockedByPrivacy:
            return None
        CACHE.mkdir(parents=True, exist_ok=True)
        tmp = cache_path(d["sha256"]).with_suffix(".part")
        tmp.write_text(json.dumps(pages, ensure_ascii=False), encoding="utf-8")
        tmp.replace(cache_path(d["sha256"]))
    else:
        pages = json.loads(cache_path(d["sha256"]).read_text(encoding="utf-8"))
    chunks = chunk_pages([Page(p["numero"], p["testo"], True, True) for p in pages], d["title"] or "Documento")
    with session() as db:
        replace_chunks(db, d["id"], d["course_id"], "pdf", chunks)
    return len(chunks)


def run_pending(limit: int | None = None, on_item=print) -> dict:
    """Giro a mano (`studyhub ocr`): OCR dei PDF che servono, poi le unità di studio dei corsi toccati."""
    from ..study.bank import sync_units
    done, failed, deferred, courses = 0, [], [], set()
    for d in pending()[:limit]:
        try:
            n = process_doc(d)
            if n is None:
                deferred.append(d["path"])
                on_item(f"rinviato_privacy {d['path']}: modello locale con vista indisponibile")
                continue
            courses.add(d["course_id"])
            done += 1
            on_item(f"ok {d['path']} ({n} chunk)")
        except RateLimited as e:
            failed.append(f"{d['path']}: {e}")
            break  # finestra piena: il resto al prossimo giro
        except Exception as e:  # noqa: BLE001 — un PDF rotto non ferma gli altri
            failed.append(f"{d['path']}: {e}")
    for cid in courses:
        try:
            sync_units(cid)
        except Exception as e:  # noqa: BLE001
            failed.append(f"unità corso {cid}: {e}")
    return {"letti": done, "errori": failed, "rinviato_privacy": deferred, "restano": len(pending())}
