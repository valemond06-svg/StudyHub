"""Elaborazione AI di una lezione: UNA chiamata Sonnet con output JSON strutturato.

Input:
  - trascrizione (Whisper se c'è, altrimenti Panopto) compattata con i timestamp;
  - il PDF della lezione, se esiste (es. Lezione_AMM_8.pdf): testo per le pagine testuali,
    immagine SOLO per pagine scansionate o "visive" (formule dense, schemi);
  - in mancanza del PDF, le slide estratte dal video (le più "lunghe", con un tetto);
  - la riga del diario/programma del corso relativa alla lezione, se c'è.
Output: appunti strutturati + concetti, definizioni, teoremi, formule, esempi, segnali
d'esame, domande di autoverifica, flashcard. Salvati in <corso>/studio_ai/lezioni/.
"""
from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime
from pathlib import Path

import pymupdf

from ..db import session
from ..ingest.extract import render_page
from ..paths import rel_to_uni, uni_path
from .claude_runner import ClaudeResult, image_block, run

PROMPT_VERSION = "lecture-v2"  # v2: regole d'esame ufficiali nel contesto
MODEL = "sonnet"
MAX_IMAGES = 12
MAX_LONG_SIDE = 1568      # oltre, Claude ridimensiona comunque: sarebbero token sprecati
TRANSCRIPT_LINE_S = 45

SYSTEM = """Sei un tutor universitario esperto. Trasformi il materiale di UNA lezione in appunti di studio
completi, rigorosi e in italiano, per uno studente di Ingegneria che deve preparare l'esame.

Regole:
- Basati SOLO sul materiale fornito (trascrizione, pagine di appunti/slide). Se aggiungi qualcosa che
  non c'è (un passaggio mancante, un chiarimento), segnalalo con "(integrazione)".
- La trascrizione è automatica: correggi gli errori di riconoscimento usando le pagine scritte
  (formule, nomi, simboli). Le pagine scritte a mano vanno lette con attenzione: riporta le formule
  corrette in LaTeX.
- Formule: LaTeX con $...$ inline e $$...$$ in display. Niente HTML.
- Riferimenti: nel testo degli appunti cita il punto della lezione come "▶ mm:ss" e le pagine
  come "📄 p. N" quando utile. Nei campi numerici *_s usa i secondi dall'inizio della lezione.
- Gli appunti devono permettere di studiare senza riascoltare la lezione: definizioni, enunciati,
  dimostrazioni (passaggi chiave), esempi ed esercizi svolti con i passaggi.
- "segnali_esame": SOLO frasi in cui il docente dice esplicitamente o fa capire che qualcosa è
  importante per l'esame (o che non lo è); cita le sue parole. Se non ce ne sono, lista vuota.
- Se ricevi le "Regole d'esame UFFICIALI del corso", sono la fonte autorevole su modalità, formulario,
  dimostrazioni richieste, ecc.: se la trascrizione le contraddice è quasi sempre un errore di
  riconoscimento vocale. Correggi la citazione mettendo la parola giusta tra [quadre] e scrivi nella nota
  la regola ufficiale. Se il diario segna con un simbolo le dimostrazioni richieste all'esame, indica nei
  teoremi quali lo sono.
- Flashcard atomiche (una idea per carta), 10-25, fronte breve, retro preciso.
- Sii completo ma senza ripetizioni."""

SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["titolo", "riassunto", "sezioni", "concetti", "definizioni", "teoremi", "formule",
                 "esempi", "segnali_esame", "domande_autoverifica", "flashcard"],
    "properties": {
        "titolo": {"type": "string"},
        "riassunto": {"type": "string", "description": "5-8 righe"},
        "sezioni": {"type": "array", "items": {
            "type": "object", "additionalProperties": False,
            "required": ["titolo", "inizio_s", "contenuto_md"],
            "properties": {"titolo": {"type": "string"}, "inizio_s": {"type": "number"},
                           "contenuto_md": {"type": "string"}}}},
        "concetti": {"type": "array", "items": {
            "type": "object", "additionalProperties": False, "required": ["nome", "spiegazione"],
            "properties": {"nome": {"type": "string"}, "spiegazione": {"type": "string"},
                           "prerequisiti": {"type": "array", "items": {"type": "string"}}}}},
        "definizioni": {"type": "array", "items": {
            "type": "object", "additionalProperties": False, "required": ["termine", "definizione_md"],
            "properties": {"termine": {"type": "string"}, "definizione_md": {"type": "string"},
                           "inizio_s": {"type": "number"}}}},
        "teoremi": {"type": "array", "items": {
            "type": "object", "additionalProperties": False, "required": ["nome", "enunciato_md"],
            "properties": {"nome": {"type": "string"}, "enunciato_md": {"type": "string"},
                           "dimostrazione_md": {"type": "string"}, "inizio_s": {"type": "number"}}}},
        "formule": {"type": "array", "items": {
            "type": "object", "additionalProperties": False, "required": ["latex", "significato"],
            "properties": {"latex": {"type": "string"}, "significato": {"type": "string"}}}},
        "esempi": {"type": "array", "items": {
            "type": "object", "additionalProperties": False, "required": ["titolo", "svolgimento_md"],
            "properties": {"titolo": {"type": "string"}, "svolgimento_md": {"type": "string"},
                           "inizio_s": {"type": "number"}}}},
        "segnali_esame": {"type": "array", "items": {
            "type": "object", "additionalProperties": False, "required": ["citazione", "nota"],
            "properties": {"citazione": {"type": "string"}, "nota": {"type": "string"},
                           "inizio_s": {"type": "number"}}}},
        "domande_autoverifica": {"type": "array", "items": {
            "type": "object", "additionalProperties": False, "required": ["domanda", "risposta_md"],
            "properties": {"domanda": {"type": "string"}, "risposta_md": {"type": "string"}}}},
        "flashcard": {"type": "array", "items": {
            "type": "object", "additionalProperties": False, "required": ["fronte", "retro"],
            "properties": {"fronte": {"type": "string"}, "retro": {"type": "string"},
                           "inizio_s": {"type": "number"}}}},
    },
}


def _mmss(t: float) -> str:
    t = int(t)
    return f"{t // 3600}:{t % 3600 // 60:02d}:{t % 60:02d}" if t >= 3600 else f"{t // 60}:{t % 60:02d}"


def _transcript_text(segments: list[dict]) -> str:
    lines, cur, start = [], [], None
    for s in segments:
        if start is None:
            start = s["start"]
        cur.append(s["text"].strip())
        if s["end"] - start >= TRANSCRIPT_LINE_S:
            lines.append(f"[{_mmss(start)}] {' '.join(cur)}")
            cur, start = [], None
    if cur:
        lines.append(f"[{_mmss(start)}] {' '.join(cur)}")
    return "\n".join(lines)


def _lecture_pdf(db, lec: dict) -> dict | None:
    """PDF del corso il cui nome indica questa lezione (es. 'Lezione_AMM_8.pdf' ↔ lezione 8)."""
    if not lec["number"]:
        return None
    for d in db.execute("SELECT * FROM documents WHERE course_id=? AND kind='pdf' AND duplicate_of IS NULL",
                        (lec["course_id"],)):
        stem = Path(d["path"]).stem.lower()
        if re.search(r"lez|lecture|lesson", stem):
            nums = re.findall(r"\d+", re.sub(r"20\d\d[-_]?\d\d[-_]?\d\d", "", stem))
            if nums and int(nums[-1]) == lec["number"]:
                return dict(d)
    return None


def _syllabus_hint(db, lec: dict) -> str:
    if not lec["number"]:
        return ""
    rows = db.execute(
        """SELECT c.text FROM chunks c JOIN documents d ON d.id=c.doc_id
           WHERE c.course_id=? AND (lower(d.title) LIKE '%diario%' OR lower(d.title) LIKE '%programma%'
                 OR lower(d.title) LIKE '%registro%')""", (lec["course_id"],)).fetchall()
    pat = re.compile(rf"Lezione\s+{lec['number']}\b[^\n]*(?:\n(?!\s*Lezione\s+\d)[^\n]*){{0,6}}", re.I)
    for r in rows:
        m = pat.search(r[0])
        if m:
            return m.group(0).strip()[:900]
    return ""


EXAM_SECTION = re.compile(r"esam|verific|valutazion|prov[ae]\b|appell", re.I)
EXAM_LINE = re.compile(r"esam|appell|formulari|dimostrazion\w* richiest|asterisc|prova (scritta|orale)", re.I)
MAX_RULES_CHARS = 3000


def _exam_rules(db, course_id: int) -> str:
    """Regole d'esame ufficiali: sezioni Moodle sull'esame, avvisi e righe del diario che ne parlano.
    Servono a Claude per non fidarsi di una trascrizione sbagliata (es. "a quattro" invece di "A4")."""
    parts: list[str] = []
    for s in db.execute("SELECT name, folder FROM sections WHERE course_id=? ORDER BY number", (course_id,)):
        if EXAM_SECTION.search(s["name"] or "") and s["folder"]:
            f = uni_path(s["folder"]) / "_sezione.md"
            if f.exists():
                parts.append(f.read_text(encoding="utf-8").strip())
    course = db.execute("SELECT folder FROM courses WHERE id=?", (course_id,)).fetchone()
    avvisi = uni_path(course["folder"]) / "moodle" / "_avvisi.md" if course and course["folder"] else None
    if avvisi and avvisi.exists():
        lines = [ln for ln in avvisi.read_text(encoding="utf-8").split("\n\n") if EXAM_LINE.search(ln)]
        if lines:
            parts.append("Avvisi del docente sull'esame:\n" + "\n\n".join(lines)[:1200])
    for r in db.execute(
            """SELECT c.text FROM chunks c JOIN documents d ON d.id=c.doc_id
               WHERE c.course_id=? AND (lower(d.title) LIKE '%diario%' OR lower(d.title) LIKE '%programma%'
                     OR lower(d.title) LIKE '%registro%') ORDER BY c.page LIMIT 3""", (course_id,)):
        hits = [ln.strip() for ln in re.split(r"(?<=[.:])\s+|\n", r[0]) if EXAM_LINE.search(ln)]
        if hits:
            parts.append("Dal diario/programma: " + " ".join(dict.fromkeys(hits)))
            break
    return "\n\n".join(parts)[:MAX_RULES_CHARS]


def _render(pdf: Path, page_no: int, sha: str) -> Path:
    doc = pymupdf.open(pdf)
    rect = doc[page_no - 1].rect
    doc.close()
    dpi = int(min(150, MAX_LONG_SIDE / (max(rect.width, rect.height) / 72)))
    return render_page(pdf, page_no, sha, dpi=dpi)


def build_input(lecture_id: int) -> tuple[dict, list[dict], list[dict], str]:
    with session() as db:
        lec = dict(db.execute("SELECT * FROM lectures WHERE id=?", (lecture_id,)).fetchone())
        course = dict(db.execute("SELECT * FROM courses WHERE id=?", (lec["course_id"],)).fetchone())
        pdf = _lecture_pdf(db, lec)
        pages = [dict(r) for r in db.execute("SELECT * FROM pages WHERE doc_id=? ORDER BY page", (pdf["id"],))] if pdf else []
        hint = _syllabus_hint(db, lec)
        rules = _exam_rules(db, lec["course_id"])
    ldir = uni_path(lec["folder"])
    tr = json.loads((ldir / "transcript.json").read_text(encoding="utf-8"))
    transcript = _transcript_text(tr["segments"])

    content: list[dict] = []
    sources: list[dict] = [{"tipo": "trascrizione", "fonte": tr.get("source")}]
    intro = (f"Corso: {course['fullname']}\nLezione: {lec['title']} ({lec['date'] or ''})\n"
             f"Durata: {_mmss(lec['duration'] or 0)}\n")
    if hint:
        intro += f"\nDal diario/programma del corso:\n{hint}\n"
    if rules:
        intro += ("\n=== Regole d'esame UFFICIALI del corso (da Moodle) ===\n"
                  f"{rules}\n=== fine regole d'esame ===\n")
        sources.append({"tipo": "regole_esame", "caratteri": len(rules)})
    content.append({"type": "text", "text": intro})
    hash_parts = [PROMPT_VERSION, MODEL, transcript, hint, rules]

    n_img = 0
    if pdf:
        pdf_path = uni_path(pdf["path"])
        doc = pymupdf.open(pdf_path)
        content.append({"type": "text", "text": f"\n=== Appunti/slide della lezione: {Path(pdf['path']).name} ==="})
        for p in pages:
            if (p["is_scan"] or p["is_visual"]) and n_img < MAX_IMAGES:
                content.append({"type": "text", "text": f"--- pagina {p['page']} (immagine) ---"})
                content.append(image_block(_render(pdf_path, p["page"], pdf["sha256"])))
                n_img += 1
            else:
                text = doc[p["page"] - 1].get_text("text").strip()
                if text:
                    content.append({"type": "text", "text": f"--- pagina {p['page']} ---\n{text}"})
        doc.close()
        sources.append({"tipo": "pdf", "doc_id": pdf["id"], "path": pdf["path"], "immagini": n_img})
        hash_parts.append(pdf["sha256"])
    else:
        slides = json.loads((ldir / "slides.json").read_text(encoding="utf-8")) if (ldir / "slides.json").exists() else []
        chosen = sorted(sorted(slides, key=lambda s: s["end"] - s["start"], reverse=True)[:MAX_IMAGES],
                        key=lambda s: s["start"])
        if chosen:
            content.append({"type": "text", "text": "\n=== Schermate principali della lezione (dal video) ==="})
        for s in chosen:
            content.append({"type": "text", "text": f"--- schermata a ▶ {_mmss(s['start'])} ---"})
            content.append(image_block(ldir / "slides" / s["file"]))
            hash_parts.append(s["file"])
        sources.append({"tipo": "slide", "immagini": len(chosen)})

    content.append({"type": "text", "text": f"\n=== Trascrizione (timestamp mm:ss) ===\n{transcript}"})
    content.append({"type": "text", "text": "\nProduci gli appunti di studio di questa lezione secondo lo schema."})
    input_hash = hashlib.sha256("\x00".join(map(str, hash_parts)).encode()).hexdigest()
    return lec, content, sources, input_hash


def to_markdown(d: dict, lec: dict) -> str:
    out = [f"# {d['titolo']}", f"*{lec['title']} · {lec['date'] or ''}*", "", "## Riassunto", d["riassunto"], ""]
    for s in d["sezioni"]:
        out += [f"## {s['titolo']}  ▶ {_mmss(s['inizio_s'])}", s["contenuto_md"], ""]
    if d["definizioni"]:
        out.append("## Definizioni")
        out += [f"- **{x['termine']}**: {x['definizione_md']}" for x in d["definizioni"]]
        out.append("")
    if d["teoremi"]:
        out.append("## Teoremi e risultati")
        for t in d["teoremi"]:
            out += [f"### {t['nome']}" + (f"  ▶ {_mmss(t['inizio_s'])}" if t.get("inizio_s") is not None else ""),
                    t["enunciato_md"]]
            if t.get("dimostrazione_md"):
                out += ["", "*Dimostrazione.* " + t["dimostrazione_md"]]
            out.append("")
    if d["formule"]:
        out.append("## Formule")
        out += [f"- $ {f['latex']} $ — {f['significato']}" for f in d["formule"]]
        out.append("")
    if d["esempi"]:
        out.append("## Esempi ed esercizi svolti")
        for e in d["esempi"]:
            out += [f"### {e['titolo']}" + (f"  ▶ {_mmss(e['inizio_s'])}" if e.get("inizio_s") is not None else ""),
                    e["svolgimento_md"], ""]
    if d["segnali_esame"]:
        out.append("## ⚠ Segnali per l'esame")
        out += [f"- «{s['citazione']}»" + (f" ▶ {_mmss(s['inizio_s'])}" if s.get("inizio_s") is not None else "")
                + f" — {s['nota']}" for s in d["segnali_esame"]]
        out.append("")
    if d["concetti"]:
        out.append("## Concetti chiave")
        out += [f"- **{c['nome']}**: {c['spiegazione']}" for c in d["concetti"]]
        out.append("")
    if d["domande_autoverifica"]:
        out.append("## Domande di autoverifica")
        for i, q in enumerate(d["domande_autoverifica"], 1):
            out += [f"{i}. {q['domanda']}", "", f"   <details><summary>Risposta</summary>\n\n{q['risposta_md']}\n\n</details>", ""]
    return "\n".join(out) + "\n"


def existing(lecture_id: int) -> dict | None:
    with session() as db:
        row = db.execute("SELECT * FROM ai_outputs WHERE kind='lecture_notes' AND target_id=? ORDER BY id DESC LIMIT 1",
                         (lecture_id,)).fetchone()
    return dict(row) if row else None


def process(lecture_id: int, force: bool = False) -> dict:
    lec, content, sources, input_hash = build_input(lecture_id)
    prev = existing(lecture_id)
    if prev and prev["input_hash"] == input_hash and not force and uni_path(prev["json_path"]).exists():
        return {**prev, "cached": True}
    res: ClaudeResult = run(SYSTEM, content, SCHEMA, model=MODEL)
    with session() as db:
        course = dict(db.execute("SELECT * FROM courses WHERE id=?", (lec["course_id"],)).fetchone())
    out_dir = uni_path(course["folder"]) / "studio_ai" / "lezioni"
    out_dir.mkdir(parents=True, exist_ok=True)
    base = Path(lec["folder"]).name
    payload = {"lecture_id": lecture_id, "prompt_version": PROMPT_VERSION, "model": res.model,
               "created_at": datetime.now().isoformat(timespec="seconds"), "sources": sources, **res.data}
    json_path, md_path = out_dir / f"{base}.json", out_dir / f"{base}.md"
    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    md_path.write_text(to_markdown(res.data, lec), encoding="utf-8")
    u = res.usage
    row = {"kind": "lecture_notes", "target_id": lecture_id, "course_id": lec["course_id"], "input_hash": input_hash,
           "prompt_version": PROMPT_VERSION, "model": res.model, "json_path": rel_to_uni(json_path),
           "md_path": rel_to_uni(md_path), "sources": json.dumps(sources, ensure_ascii=False),
           "input_tokens": (u.get("input_tokens") or 0) + (u.get("cache_read_input_tokens") or 0)
                           + (u.get("cache_creation_input_tokens") or 0),
           "output_tokens": u.get("output_tokens"), "cost_usd": res.cost_usd, "duration_s": res.duration_s,
           "created_at": payload["created_at"]}
    with session() as db:
        db.execute(f"INSERT INTO ai_outputs ({','.join(row)}) VALUES ({','.join('?' * len(row))})", list(row.values()))
    from ..study.flashcards import import_from_notes
    import_from_notes(lec["course_id"])  # le nuove flashcard entrano subito nel ripasso
    return {**row, "cached": False, "utilization": res.utilization, "api_calls": res.api_calls,
            "num_turns": res.num_turns}
