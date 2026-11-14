"""Bozza degli appunti di una lezione col 35B locale (prova P1.1, 14/11/2026).

Stesso SYSTEM e stesso SCHEMA di lecture_notes (Sonnet), ma solo testo: il llama-server del fisso non ha la
vista, quindi le pagine scansionate e le schermate del video diventano un segnaposto. La bozza va in
<corso>/studio_ai/lezioni_bozze_35b/ e NON entra in ai_outputs: serve solo al confronto con gli appunti Sonnet.

Uso:  python -m studyhub.ai.lecture_notes_local 177 168 89
"""
from __future__ import annotations

import json
import sys
import time
from datetime import datetime
from pathlib import Path

from ..db import session
from ..paths import uni_path
from . import llm
from .lecture_notes import SCHEMA, SYSTEM, build_input, to_markdown

MAX_TOKENS = 16384
NOTA_LOCALE = ("\n\nNota: ricevi SOLO testo. Dove compare «[immagine non disponibile]» la pagina o la schermata "
               "non è leggibile: non inventarne il contenuto, ricavalo dalla trascrizione se il docente lo spiega.")


def _text_only(content: list[dict]) -> tuple[str, int]:
    parts, images = [], 0
    for b in content:
        if b.get("type") == "image":
            images += 1
            parts.append("[immagine non disponibile]")
        elif b.get("type") == "text":
            parts.append(b["text"])
    return "\n".join(parts), images


def draft(lecture_id: int) -> dict:
    lec, content, sources, _hash = build_input(lecture_id)
    text, images = _text_only(content)
    payload = {"model": llm.get_local_llm_model(),
               "messages": [{"role": "system", "content": SYSTEM + NOTA_LOCALE},
                            {"role": "user", "content": text}],
               "temperature": 0.2, "max_tokens": MAX_TOKENS}
    base = llm.get_local_llm_url() or llm.FALLBACK_LOCAL_URL
    t0 = time.time()
    res = llm._post_json(base, payload, SCHEMA)
    elapsed = round(time.time() - t0, 1)
    msg = (res.get("choices") or [{}])[0].get("message", {})
    data = llm._extract_json(msg.get("content") or "")
    with session() as db:
        course = dict(db.execute("SELECT * FROM courses WHERE id=?", (lec["course_id"],)).fetchone())
    out_dir = uni_path(course["folder"]) / "studio_ai" / "lezioni_bozze_35b"
    out_dir.mkdir(parents=True, exist_ok=True)
    name = Path(lec["folder"]).name
    usage = res.get("usage") or {}
    meta = {"lecture_id": lecture_id, "model": res.get("model"), "created_at": datetime.now().isoformat(timespec="seconds"),
            "elapsed_s": elapsed, "images_skipped": images, "input_chars": len(text),
            "prompt_tokens": usage.get("prompt_tokens"), "completion_tokens": usage.get("completion_tokens"),
            "finish_reason": (res.get("choices") or [{}])[0].get("finish_reason"), "sources": sources}
    (out_dir / f"{name}.json").write_text(json.dumps({**meta, **data}, ensure_ascii=False, indent=1), encoding="utf-8")
    try:
        md = to_markdown(data, lec)
    except (KeyError, TypeError) as e:  # bozza incompleta: si salva lo stesso il JSON
        md = f"# bozza incompleta ({e})\n"
    (out_dir / f"{name}.md").write_text(md, encoding="utf-8")
    return {**meta, "md_path": str(out_dir / f"{name}.md")}


if __name__ == "__main__":
    for arg in sys.argv[1:]:
        try:
            r = draft(int(arg))
            print(json.dumps({k: v for k, v in r.items() if k != "sources"}, ensure_ascii=False), flush=True)
        except Exception as e:
            print(json.dumps({"lecture_id": int(arg), "errore": str(e)[:500]}, ensure_ascii=False), flush=True)
