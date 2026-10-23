"""Tutor RAG: risponde SOLO dal tuo materiale, con citazioni cliccabili.

Ogni domanda = 1 chiamata Sonnet con: i passaggi più pertinenti (ricerca ibrida), le ultime
battute della conversazione e la domanda. Due modalità:
  - normale: spiega e risponde;
  - socratico: non dà subito la risposta, ti guida con domande e suggerimenti.
"""
from __future__ import annotations

import json
from datetime import datetime

from ..ai.claude_runner import run
from ..db import session
from ..search import search

MODEL = "sonnet"
CONTEXT_CHUNKS = 10
HISTORY_TURNS = 3         # ultimi scambi rimandati a Claude (il resto resta solo nel DB)
MAX_CHUNK_CHARS = 1600

SYSTEM = """Sei il tutor personale di uno studente di Ingegneria. Rispondi in italiano.
Usa SOLO le fonti numerate fornite (appunti, slide, trascrizioni delle lezioni, libri del corso).
- Cita le fonti nel testo con [n] subito dopo l'affermazione che supportano.
- Se le fonti non bastano, dillo chiaramente in "fuori_materiale" e, solo se utile, aggiungi una breve
  spiegazione generale marcata come "(fuori dal materiale del corso)".
- Formule in LaTeX ($...$, $$...$$). Sii chiaro e preciso, con passaggi espliciti quando serve.
- Correggi con gentilezza eventuali errori o misconcezioni nella domanda."""

SOCRATIC = """
MODALITÀ SOCRATICA: non dare la soluzione completa. Fai capire allo studente dove sta il punto chiave
con 1-3 domande mirate e un suggerimento, partendo da ciò che sa già. Dai la risposta completa solo
se lo studente lo chiede esplicitamente o ha già risposto correttamente."""

SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["risposta_md", "fonti_usate", "fuori_materiale"],
    "properties": {
        "risposta_md": {"type": "string"},
        "fonti_usate": {"type": "array", "items": {"type": "integer"}},
        "fuori_materiale": {"type": "boolean"},
    },
}


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _where(r: dict) -> str:
    if r.get("t_start") is not None:
        t = int(r["t_start"])
        return f"lezione, minuto {t // 60}:{t % 60:02d}"
    return f"p. {r['page']}" if r.get("page") else (r.get("kind") or "")


def new_thread(course_id: int | None, mode: str = "normale") -> int:
    with session() as db:
        return db.execute("INSERT INTO tutor_threads (course_id, mode, created_at) VALUES (?,?,?)",
                          (course_id, mode if mode in ("normale", "socratico") else "normale", _now())).lastrowid


def thread(thread_id: int) -> dict:
    with session() as db:
        t = db.execute("SELECT * FROM tutor_threads WHERE id=?", (thread_id,)).fetchone()
        if not t:
            raise KeyError(thread_id)
        msgs = [dict(r) for r in db.execute("SELECT * FROM tutor_messages WHERE thread_id=? ORDER BY id", (thread_id,))]
    for m in msgs:
        m["citations"] = json.loads(m["citations"]) if m["citations"] else []
    return {**dict(t), "messages": msgs}


def threads(limit: int = 30) -> list[dict]:
    with session() as db:
        return [dict(r) for r in db.execute(
            """SELECT t.*, c.fullname AS course, (SELECT COUNT(*) FROM tutor_messages m WHERE m.thread_id=t.id) AS n
               FROM tutor_threads t LEFT JOIN courses c ON c.id=t.course_id ORDER BY t.id DESC LIMIT ?""", (limit,))]


def ask(thread_id: int, question: str) -> dict:
    th = thread(thread_id)
    history = th["messages"][-HISTORY_TURNS * 2:]
    # La ricerca usa anche l'ultima domanda: le domande di seguito ("e nel caso n=2?") hanno senso nel contesto.
    prev_q = next((m["content"] for m in reversed(history) if m["role"] == "user"), "")
    hits = search(f"{question} {prev_q}"[:500], [th["course_id"]] if th["course_id"] is not None else None,
                  limit=CONTEXT_CHUNKS)["results"]
    with session() as db:
        texts = {r["id"]: r["text"] for r in db.execute(
            f"SELECT id, text FROM chunks WHERE id IN ({','.join('?' * len(hits)) or 'NULL'})", [h["id"] for h in hits])}
    sources = []
    blocks = []
    for n, h in enumerate(hits, start=1):
        sources.append({"n": n, "chunk_id": h["id"], "doc_id": h["doc_id"], "title": h["title"], "kind": h["kind"],
                        "page": h["page"], "t_start": h["t_start"], "lecture_id": h["lecture_id"],
                        "course": h["course"], "where": _where(h)})
        blocks.append(f"[{n}] {h['title']} ({_where(h)})\n{texts.get(h['id'], '')[:MAX_CHUNK_CHARS]}")
    conv = "\n".join(f"{'Studente' if m['role'] == 'user' else 'Tutor'}: {m['content'][:1500]}" for m in history)
    content = [{"type": "text", "text":
                "=== Fonti ===\n" + ("\n\n".join(blocks) or "(nessuna fonte trovata)") +
                (f"\n\n=== Conversazione finora ===\n{conv}" if conv else "") +
                f"\n\n=== Domanda dello studente ===\n{question}"}]
    system = SYSTEM + (SOCRATIC if th["mode"] == "socratico" else "")
    res = run(system, content, SCHEMA, model=MODEL)
    used = set(res.data.get("fonti_usate") or [])
    cited = [s for s in sources if s["n"] in used] or sources[:0]
    u = res.usage
    tin = (u.get("input_tokens") or 0) + (u.get("cache_read_input_tokens") or 0) + (u.get("cache_creation_input_tokens") or 0)
    with session() as db:
        db.execute("INSERT INTO tutor_messages (thread_id, role, content, created_at) VALUES (?,?,?,?)",
                   (thread_id, "user", question, _now()))
        db.execute("""INSERT INTO tutor_messages (thread_id, role, content, citations, tokens_in, tokens_out, created_at)
                      VALUES (?,?,?,?,?,?,?)""",
                   (thread_id, "assistant", res.data["risposta_md"], json.dumps(sources, ensure_ascii=False), tin,
                    u.get("output_tokens"), _now()))
        if not th.get("title"):
            db.execute("UPDATE tutor_threads SET title=? WHERE id=?", (question[:80], thread_id))
    return {"answer": res.data["risposta_md"], "sources": sources, "cited": [s["n"] for s in cited],
            "outside": res.data.get("fuori_materiale"), "tokens_in": tin, "tokens_out": u.get("output_tokens"),
            "utilization": res.utilization}
