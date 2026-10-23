"""Server MCP (stdio): il tuo materiale di studio dentro Claude Desktop e Claude Code.

    python -m studyhub.mcp_server

Strumenti quasi tutti in sola lettura; l'unica scrittura è add_flashcard.
Non avvia nessuna elaborazione AI di StudyHub: è Claude, nella tua chat, a leggere il materiale.
"""
from __future__ import annotations

import json

import pymupdf
from mcp.server.mcpserver import MCPServer

from .db import session
from .paths import uni_path

server = MCPServer(
    "StudyHub",
    instructions=(
        "Materiale universitario locale dello studente (UniVR): "
        "PDF e pagine Moodle, trascrizioni delle lezioni con timestamp, appunti AI per lezione, profili d'esame, "
        "flashcard. Usa search_material per trovare i passaggi e cita sempre la fonte (titolo + pagina o minuto). "
        "Per una lezione intera preferisci get_lecture_notes; per i dettagli get_transcript."),
)


def _course(ref: str | int | None) -> dict | None:
    if ref in (None, ""):
        return None
    with session() as db:
        rows = [dict(r) for r in db.execute("SELECT * FROM courses WHERE folder IS NOT NULL")]
    s = str(ref).strip().lower()
    contains = [r for r in rows if s in r["fullname"].lower()]
    # Dal più preciso al più largo: id, inizio del nome, corsi attivi, qualsiasi corrispondenza.
    for hits in ([r for r in rows if str(r["id"]) == s],
                 [r for r in contains if r["fullname"].lower().startswith(s)],
                 [r for r in contains if r["active"]], contains):
        if len(hits) == 1:
            return hits[0]
    if len(hits) != 1:
        raise ValueError(f"Corso '{ref}' ambiguo o non trovato. Corsi: {[r['fullname'] for r in rows]}")
    return hits[0]


def _mmss(t: float | None) -> str:
    if t is None:
        return ""
    t = int(t)
    return f"{t // 60}:{t % 60:02d}"


@server.tool()
def list_courses() -> list[dict]:
    """Corsi con anno, stato (attivo/superato) e quante lezioni hanno registrazioni e appunti."""
    with session() as db:
        rows = db.execute(
            """SELECT c.id, c.fullname, c.year_of_study, c.passed, c.active,
                      (SELECT COUNT(*) FROM lectures l WHERE l.course_id=c.id) AS lezioni,
                      (SELECT COUNT(DISTINCT target_id) FROM ai_outputs a WHERE a.course_id=c.id AND a.kind='lecture_notes') AS con_appunti
               FROM courses c WHERE c.folder IS NOT NULL ORDER BY c.active DESC, c.year_of_study DESC, c.fullname""")
        return [dict(r) for r in rows]


@server.tool()
def search_material(query: str, course: str | None = None, limit: int = 8) -> list[dict]:
    """Ricerca ibrida (parole chiave + significato) in PDF, pagine Moodle, trascrizioni e appunti.
    `course`: id o parte del nome del corso (facoltativo)."""
    from .search import search
    c = _course(course)
    res = search(query, [c["id"]] if c else None, limit=max(1, min(limit, 20)))["results"]
    with session() as db:
        texts = {r[0]: r[1] for r in db.execute(
            f"SELECT id, text FROM chunks WHERE id IN ({','.join('?' * len(res)) or 'NULL'})", [r["id"] for r in res])}
    return [{"fonte": r["title"], "corso": r["course"], "tipo": r["kind"], "pagina": r["page"],
             "minuto": _mmss(r["t_start"]), "lecture_id": r["lecture_id"], "doc_id": r["doc_id"],
             "testo": texts.get(r["id"], "")[:1800]} for r in res]


@server.tool()
def list_lectures(course: str) -> list[dict]:
    """Lezioni registrate di un corso, con data e stato di elaborazione."""
    c = _course(course)
    with session() as db:
        rows = db.execute(
            """SELECT l.id, l.number, l.title, l.date, l.duration, l.transcript_source,
                      EXISTS(SELECT 1 FROM ai_outputs a WHERE a.kind='lecture_notes' AND a.target_id=l.id) AS ha_appunti
               FROM lectures l WHERE l.course_id=? ORDER BY l.date, l.number""", (c["id"],))
        return [dict(r) for r in rows]


@server.tool()
def get_lecture_notes(lecture_id: int) -> str:
    """Appunti AI completi di una lezione (Markdown + LaTeX, con timestamp ▶ mm:ss)."""
    with session() as db:
        row = db.execute("SELECT md_path FROM ai_outputs WHERE kind='lecture_notes' AND target_id=? ORDER BY id DESC LIMIT 1",
                         (lecture_id,)).fetchone()
    if not row:
        return "Appunti non ancora generati per questa lezione: usa get_transcript."
    return uni_path(row[0]).read_text(encoding="utf-8")


@server.tool()
def get_transcript(lecture_id: int, from_min: float = 0, to_min: float | None = None) -> str:
    """Trascrizione della lezione (Whisper o Panopto) con timestamp, eventualmente limitata a un intervallo."""
    with session() as db:
        row = db.execute("SELECT folder, title FROM lectures WHERE id=?", (lecture_id,)).fetchone()
    if not row:
        raise ValueError("Lezione non trovata")
    data = json.loads((uni_path(row["folder"]) / "transcript.json").read_text(encoding="utf-8"))
    lo, hi = from_min * 60, (to_min * 60 if to_min is not None else float("inf"))
    lines = [f"[{_mmss(s['start'])}] {s['text']}" for s in data["segments"] if lo <= s["start"] <= hi]
    text = f"# {row['title']} (trascrizione {data.get('source')})\n" + "\n".join(lines)
    return text[:60000] + ("\n…(troncata: usa from_min/to_min)" if len(text) > 60000 else "")


@server.tool()
def get_document_page(doc_id: int, page: int) -> str:
    """Testo di una pagina di un PDF del corso (doc_id e pagina arrivano da search_material)."""
    with session() as db:
        d = db.execute("SELECT path, kind, n_pages FROM documents WHERE id=?", (doc_id,)).fetchone()
    if not d or d["kind"] != "pdf":
        raise ValueError("Documento PDF non trovato")
    doc = pymupdf.open(uni_path(d["path"]))
    try:
        text = doc[page - 1].get_text("text").strip()
    finally:
        doc.close()
    return text or "(pagina senza testo: probabilmente una scansione o una figura)"


@server.tool()
def get_exam_profile(course: str) -> str:
    """Profilo d'esame del corso: formato, argomenti per frequenza, esercizi tipo, teoria richiesta."""
    c = _course(course)
    p = uni_path(c["folder"]) / "studio_ai" / "profilo_esame.md"
    return p.read_text(encoding="utf-8") if p.exists() else "Profilo d'esame non ancora creato (StudyHub → Oggi → corso)."


@server.tool()
def upcoming_exams() -> list[dict]:
    """Appelli in calendario con i giorni mancanti."""
    from .study.exam import upcoming_exams as ue
    return [{k: e[k] for k in ("course", "date", "kind", "note", "days_left")} for e in ue()]


@server.tool()
def due_flashcards(course: str | None = None, limit: int = 20) -> list[dict]:
    """Flashcard da ripassare adesso (fronte e retro)."""
    from .study.flashcards import due_cards
    c = _course(course)
    return [{"id": x["id"], "fronte": x["front"], "retro": x["back"], "lezione": x["lecture_title"]}
            for x in due_cards(c["id"] if c else None, max(1, min(limit, 100)))]


@server.tool()
def add_flashcard(course: str, front: str, back: str, lecture_id: int | None = None) -> dict:
    """Aggiunge una flashcard al ripasso FSRS di StudyHub (es. da una spiegazione appena data in chat)."""
    import hashlib
    from datetime import datetime, timezone

    from fsrs import Card
    c = _course(course)
    card = Card()
    key = "manual:" + hashlib.sha1(f"{c['id']}:{front.strip().lower()}".encode()).hexdigest()
    with session() as db:
        cur = db.execute(
            """INSERT OR IGNORE INTO flashcards (course_id, lecture_id, front, back, origin, origin_key, fsrs, due, created_at)
               VALUES (?,?,?,?,'manuale',?,?,?,?)""",
            (c["id"], lecture_id, front, back, key, card.to_json(),
             card.due.astimezone(timezone.utc).replace(microsecond=0).isoformat(),
             datetime.now().isoformat(timespec="seconds")))
    return {"aggiunta": bool(cur.rowcount), "corso": c["fullname"]}


if __name__ == "__main__":
    server.run("stdio")
