"""Preparazione delle foto (data URL dal browser) da mandare a un modello con vista.

Ridimensiona (lato massimo 1600 px), ricodifica in JPEG e limita il numero: ogni immagine costa token e tempo,
e un modello locale con 32k di contesto non regge una dozzina di foto da 12 megapixel.
Restituisce blocchi nel formato interno di llm.run_json_content: {"type": "image", "media_type", "data" (base64)}.
"""
from __future__ import annotations

import base64
import binascii
import io

from PIL import Image, ImageOps

MAX_SIDE = 1600
MAX_IMAGES = 6                    # in totale per chiamata
MAX_DECODED_BYTES = 20 * 1024 * 1024
JPEG_QUALITY = 85


def prepare_image(data_url: str, max_side: int = MAX_SIDE) -> dict | None:
    """Un data URL 'data:image/...;base64,...' -> blocco immagine ridimensionato, o None se non è un'immagine valida."""
    if not isinstance(data_url, str) or not data_url.startswith("data:image/") or "," not in data_url:
        return None
    header, _, payload = data_url.partition(",")
    if ";base64" not in header:
        return None
    try:
        raw = base64.b64decode(payload, validate=False)
    except (binascii.Error, ValueError):
        return None
    if not raw or len(raw) > MAX_DECODED_BYTES:
        return None
    try:
        with Image.open(io.BytesIO(raw)) as im:
            im = ImageOps.exif_transpose(im)          # le foto del telefono arrivano ruotate
            if im.mode in ("RGBA", "LA", "P"):
                im = im.convert("RGBA")
                fondo = Image.new("RGB", im.size, "white")  # il trasparente diventerebbe nero: illeggibile
                fondo.paste(im, mask=im.getchannel("A"))
                im = fondo
            else:
                im = im.convert("RGB")
            im.thumbnail((max_side, max_side), Image.LANCZOS)  # solo riduzione, mai ingrandimento
            out = io.BytesIO()
            im.save(out, "JPEG", quality=JPEG_QUALITY, optimize=True)
    except Exception:  # file troncato, formato non supportato, decompression bomb
        return None
    return {"type": "image", "media_type": "image/jpeg", "data": base64.b64encode(out.getvalue()).decode("ascii")}


def prepare_images(data_urls: list, limit: int = MAX_IMAGES, max_side: int = MAX_SIDE) -> tuple[list[dict], int]:
    """(immagini pronte, quante scartate perché non valide o oltre il limite)."""
    ready, skipped = [], 0
    for url in data_urls:
        if len(ready) >= limit:
            skipped += 1
            continue
        block = prepare_image(url, max_side)
        if block:
            ready.append(block)
        else:
            skipped += 1
    return ready, skipped
