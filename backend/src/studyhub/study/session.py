"""Sessione di studio guidata: una "missione" a tempo costruita in locale (nessuna chiamata AI).

Composizione, pensata per non annoiarsi ma studiare sul serio. Si va IN ORDINE: dalle prime cose
viste nel corso alle ultime, sia per il ripasso sia per gli argomenti nuovi.
  1. ripasso di ciò che sta per sfuggire (domande FSRS scadute), intercalato a
  2. rinforzo dei punti deboli (risposte sbagliate, argomenti fragili, domande mai viste di argomenti iniziati);
  3. argomenti nuovi in ordine di lezione: prima la scheda, poi subito domande dal facile al difficile;
  4. il "boss" finale: un esercizio da esame sugli argomenti della sessione.
Ogni domanda chiede prima quanto sei sicuro (calibrazione), poi si corregge. Le sbagliate tornano
in fondo alla sessione. La correzione delle risposte scritte la fa l'AI con i criteri della domanda;
in alternativa ti autovaluti sui criteri, ma l'autovalutazione vale al massimo 0,85.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

from fsrs import Card, Rating

from ..ai.llm import run_json
from ..db import session
from .flashcards import _iso, scheduler
from .mastery import KIND_WEIGHT, item_states, overview, topic_mastery

SECONDS = {"vero_falso": 45, "multipla": 60, "richiamo": 75, "aperta": 240, "esercizio": 480}
SCHEDA_S = 480          # lezione interattiva di un argomento nuovo (circa 8 minuti)
SELF_CAP = 0.85

GRADE_SYSTEM = """Sei l'esaminatore di un corso universitario di Ingegneria. Correggi UNA risposta dello studente
confrontandola con la soluzione e i criteri. Sii giusto ma esigente come all'esame: una risposta vaga, senza
passaggi o con un errore concettuale non è corretta anche se "ci assomiglia". Accetta notazioni diverse se
equivalenti (es. formule scritte in testo semplice). Punteggio da 0 a 1 (frazioni ammesse).
feedback_md: 1-3 frasi, in italiano, su cosa è giusto e cosa manca o è sbagliato, rivolgendoti allo studente con il tu."""

GRADE_SCHEMA = {
    "type": "object", "additionalProperties": False, "required": ["punteggio", "feedback_md", "criteri_ok"],
    "properties": {"punteggio": {"type": "number"}, "feedback_md": {"type": "string"},
                   "criteri_ok": {"type": "array", "items": {"type": "boolean"},
                                  "description": "un valore per ciascun criterio, nell'ordine"}},
}


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _public(it: dict) -> dict:
    """La domanda senza soluzione, per mostrarla prima della risposta."""
    out = {k: it[k] for k in ("id", "kind", "difficulty", "prompt_md", "topic_id")}
    out["options"] = json.loads(it["options"]) if it.get("options") else None
    out["n_criteria"] = len(json.loads(it["rubric"] or "[]"))
    return out


def build_queue(course_id: int, minutes: int, focus_topic: int | None = None) -> tuple[list[dict], dict]:
    now = datetime.now(timezone.utc)
    with session() as db:
        items = item_states(db, course_id)
        topics = {r["id"]: dict(r) for r in db.execute(
            """SELECT id, name, weight, day FROM study_topics WHERE course_id=? AND hidden=0
               ORDER BY COALESCE(position, 1000000), day, id""", (course_id,))}
        learned = {r[0] for r in db.execute(
            "SELECT topic_id FROM study_lessons WHERE completed_at IS NOT NULL")}
    if focus_topic:
        items = [it for it in items if it["topic_id"] == focus_topic]
    mast = topic_mastery(items, now)
    budget = minutes * 60
    by_topic: dict[int, list[dict]] = {}
    for it in items:
        by_topic.setdefault(it["topic_id"], []).append(it)
    now_s = now.replace(microsecond=0).isoformat()

    order = {tid: n for n, tid in enumerate(topics)}  # posizione cronologica dell'argomento nel corso
    due = sorted((it for it in items if it["due"] and it["due"] <= now_s),
                 key=lambda it: (order[it["topic_id"]], it["due"]))
    started = {tid for tid, ts in by_topic.items() if any(it["attempts"] for it in ts)}
    weak = sorted((it for it in items if it not in due and it["topic_id"] in started
                   and (it["attempts"] == 0 or (it["last_score"] or 0) < 0.7)),
                  key=lambda it: (order[it["topic_id"]], it["attempts"] > 0, it["difficulty"]))
    fresh = [tid for tid in topics if tid in by_topic and tid not in started]

    queue, used, spent = [], set(), 0

    def add_item(it: dict) -> bool:
        nonlocal spent
        cost = SECONDS.get(it["kind"], 90)
        if it["id"] in used or spent + cost > budget:
            return False
        queue.append({"t": "domanda", "item": it["id"]})
        used.add(it["id"])
        spent += cost
        return True

    def add_topic(tid: int) -> None:
        nonlocal spent
        if spent + SCHEDA_S + 120 > budget:
            return
        if tid not in learned:  # lezione interattiva già fatta: si passa subito alle domande
            queue.append({"t": "scheda", "topic": tid})
            spent += SCHEDA_S
        ts = sorted(by_topic[tid], key=lambda it: (it["difficulty"], KIND_WEIGHT.get(it["kind"], 1)))
        easy = [it for it in ts if it["kind"] in ("richiamo", "vero_falso", "multipla")][:2]
        hard = [it for it in ts if it["kind"] in ("aperta", "esercizio")][:1]
        for it in easy + hard:
            add_item(it)

    # Ripasso e rinforzo si alternano; ogni 4 domande entra un argomento nuovo finché c'è tempo.
    review_share = 0.65 if fresh else 1.0
    mixed = sorted(due + weak, key=lambda it: order[it["topic_id"]])
    n_since_new = 0
    for it in mixed:
        if spent > budget * review_share:
            break
        if add_item(it):
            n_since_new += 1
        if fresh and n_since_new >= 4:
            add_topic(fresh.pop(0))
            n_since_new = 0
    while fresh and spent + SCHEDA_S + 120 <= budget * 0.92:
        add_topic(fresh.pop(0))
    # Boss: l'esercizio più difficile non ancora usato tra gli argomenti toccati oggi.
    touched = {it["topic_id"] for it in items if it["id"] in used} | {e["topic"] for e in queue if e["t"] == "scheda"}
    boss = sorted((it for it in items if it["topic_id"] in touched and it["id"] not in used
                   and it["kind"] in ("esercizio", "aperta")), key=lambda it: (-it["difficulty"], it["attempts"]))
    if boss:
        queue.append({"t": "domanda", "item": boss[0]["id"], "boss": True})
        used.add(boss[0]["id"])
    # Tempo avanzato (pochi argomenti nuovi): altre domande ancora mai provate.
    for it in sorted(items, key=lambda it: (order[it["topic_id"]], it["attempts"] > 0, it["difficulty"])):
        if spent >= budget * 0.9:
            break
        add_item(it)
    snapshot = {str(tid): round(m["m"], 3) for tid, m in mast.items()}
    return queue, snapshot


def start(course_id: int, minutes: int = 45, focus_topic: int | None = None) -> dict:
    minutes = max(10, min(minutes, 120))
    queue, snapshot = build_queue(course_id, minutes, focus_topic)
    if not queue:
        raise ValueError("Nessuna domanda pronta: analizza prima il materiale del corso.")
    ready = overview(course_id)["ready_exam"]
    with session() as db:
        sid = db.execute("""INSERT INTO study_sessions (course_id, started_at, minutes, focus_topic, queue, ready_before)
                            VALUES (?,?,?,?,?,?)""",
                         (course_id, _now(), minutes, focus_topic,
                          json.dumps({"entries": queue, "snapshot": snapshot}), ready)).lastrowid
    from .lesson import request  # le lezioni degli argomenti nuovi di questa sessione, se non sono già pronte
    request([e["topic"] for e in queue if e["t"] == "scheda"])
    return get(sid)


def _load(db, sid: int) -> tuple[dict, dict]:
    row = db.execute("SELECT * FROM study_sessions WHERE id=?", (sid,)).fetchone()
    if not row:
        raise KeyError(sid)
    return dict(row), json.loads(row["queue"])


def get(sid: int) -> dict:
    with session() as db:
        s, q = _load(db, sid)
        item_ids = [e["item"] for e in q["entries"] if e["t"] == "domanda"]
        topic_ids = {e["topic"] for e in q["entries"] if e["t"] == "scheda"}
        items = {r["id"]: dict(r) for r in db.execute(
            f"SELECT * FROM study_items WHERE id IN ({','.join('?' * len(item_ids)) or 'NULL'})", item_ids)}
        topic_ids |= {it["topic_id"] for it in items.values()}
        topics = {r["id"]: dict(r) for r in db.execute(
            f"SELECT id, name, weight, summary_md, lecture_id, t_start, doc_id, page FROM study_topics "
            f"WHERE id IN ({','.join('?' * len(topic_ids)) or 'NULL'})", list(topic_ids))}
    entries = []
    for e in q["entries"]:
        x = dict(e)
        if e["t"] == "domanda":
            x["question"] = _public(items[e["item"]])
        entries.append(x)
    return {"id": sid, "course_id": s["course_id"], "minutes": s["minutes"], "started_at": s["started_at"],
            "ended_at": s["ended_at"], "xp": s["xp"], "entries": entries, "topics": topics}


def _rating(score: float, confidence: int | None) -> Rating:
    if score < 0.5:
        return Rating.Again
    if score < 0.85 or confidence == 1:
        return Rating.Hard  # giusta ma tirata a indovinare o incompleta: non è ancora saputa
    return Rating.Good


def _grade_ai(it: dict, answer: str) -> tuple[float, str, list]:
    rubric = json.loads(it["rubric"] or "[]")
    text = (f"Domanda ({it['kind']}):\n{it['prompt_md']}\n\nSoluzione di riferimento:\n{it['answer_md']}\n\n"
            + ("Criteri:\n" + "\n".join(f"{i + 1}. {c}" for i, c in enumerate(rubric)) + "\n\n" if rubric else "")
            + f"Risposta dello studente:\n{answer}")
    res = run_json(GRADE_SYSTEM, text, GRADE_SCHEMA, quality="veloce")
    return max(0.0, min(1.0, float(res.data["punteggio"]))), res.data["feedback_md"], res.data.get("criteri_ok") or []


def _source(db, it: dict) -> dict:
    lec = db.execute("SELECT title FROM lectures WHERE id=?", (it["lecture_id"],)).fetchone() if it["lecture_id"] else None
    doc = db.execute("SELECT path FROM documents WHERE id=?", (it["doc_id"],)).fetchone() if it["doc_id"] else None
    return {"lecture_id": it["lecture_id"], "lecture": lec[0] if lec else None, "t_start": it["t_start"],
            "doc_id": it["doc_id"], "doc": doc[0].rsplit("/", 1)[-1] if doc else None, "page": it["page"]}


def reveal(sid: int, idx: int) -> dict:
    """Soluzione e criteri subito dopo aver risposto (la correzione AI arriva qualche secondo dopo).
    Da qui in poi la risposta a quella domanda non si può più cambiare."""
    with session() as db:
        s, q = _load(db, sid)
        entry = q["entries"][idx]
        if entry["t"] != "domanda":
            raise ValueError("Non è una domanda.")
        entry["revealed"] = True
        db.execute("UPDATE study_sessions SET queue=? WHERE id=?", (json.dumps(q), sid))
        it = dict(db.execute("SELECT * FROM study_items WHERE id=?", (entry["item"],)).fetchone())
        src = _source(db, it)
    return {"answer_md": it["answer_md"], "rubric": json.loads(it["rubric"] or "[]"), "source": src}


def answer(sid: int, idx: int, payload: dict) -> dict:
    """payload: choice (multipla/vero_falso) | text | self_criteria (lista di bool) | self_score;
    confidence 1-3; seconds."""
    with session() as db:
        s, q = _load(db, sid)
        entry = q["entries"][idx]
        if entry["t"] != "domanda" or entry.get("done"):
            raise ValueError("Questa domanda è già stata corretta.")
        it = dict(db.execute("SELECT * FROM study_items WHERE id=?", (entry["item"],)).fetchone())
    conf = payload.get("confidence")
    rubric = json.loads(it["rubric"] or "[]")
    feedback, crit_ok, graded_by = None, [], "auto"
    if it["kind"] in ("multipla", "vero_falso"):
        choice = payload.get("choice")
        score = 1.0 if choice is not None and int(choice) == it["correct"] else 0.0
        given = str(choice)
    elif (payload.get("text") or "").strip():
        given = payload["text"].strip()
        score, feedback, crit_ok = _grade_ai(it, given)
        graded_by = "ai"
    else:
        given, graded_by = None, "io"
        crits = payload.get("self_criteria")
        if crits and rubric:
            crit_ok = [bool(c) for c in crits]
            raw = sum(crit_ok) / len(rubric)
        else:
            raw = float(payload.get("self_score", 0))
        score = min(SELF_CAP, raw)
    rating = _rating(score, conf)
    card = Card.from_json(it["fsrs"]) if it["fsrs"] else Card()
    card, _ = scheduler.review_card(card, rating)
    gained = round(10 * KIND_WEIGHT.get(it["kind"], 1) * it["difficulty"] * score)
    if conf == 3 and score >= 0.85 or conf == 1 and score < 0.5:
        gained += 3  # sapevi di sapere (o di non sapere): la calibrazione si premia
    if entry.get("boss") and score >= 0.7:
        gained *= 2
    with session() as db:
        db.execute("UPDATE study_items SET fsrs=?, due=? WHERE id=?", (card.to_json(), _iso(card.due), it["id"]))
        db.execute("""INSERT INTO study_attempts (item_id, session_id, score, confidence, answer, feedback_md, graded_by,
                      seconds, created_at) VALUES (?,?,?,?,?,?,?,?,?)""",
                   (it["id"], sid, score, conf, given, feedback, graded_by, payload.get("seconds"), _now()))
        entry.update(done=True, score=score)
        retry = score < 0.5 and not entry.get("retry")
        if retry:  # la sbagliata torna in fondo: va recuperata, non solo letta
            q["entries"].append({"t": "domanda", "item": it["id"], "retry": True})
        db.execute("UPDATE study_sessions SET queue=?, xp=xp+? WHERE id=?", (json.dumps(q), gained, sid))
        src = _source(db, it)
    return {"score": score, "correct": it["correct"], "answer_md": it["answer_md"], "rubric": rubric,
            "criteria_ok": crit_ok, "feedback_md": feedback, "graded_by": graded_by, "xp": gained, "retry": retry,
            "next_due": _iso(card.due), "source": src}


def finish(sid: int) -> dict:
    with session() as db:
        s, q = _load(db, sid)
    ov = overview(s["course_id"])
    before = q.get("snapshot", {})
    ups = [{"name": t["name"], "from": before.get(str(t["id"]), 0), "to": t["m"], "level_name": t["level_name"]}
           for t in ov["topics"] if t["m"] - before.get(str(t["id"]), 0) >= 0.05]
    done = [e for e in q["entries"] if e.get("done")]
    with session() as db:
        db.execute("UPDATE study_sessions SET ended_at=COALESCE(ended_at, ?), ready_after=? WHERE id=?",
                   (_now(), ov["ready_exam"], sid))
        wrong = [dict(r) for r in db.execute(
            """SELECT i.id, i.prompt_md, i.lecture_id, i.t_start, i.doc_id, i.page, t.name AS topic
               FROM study_attempts a JOIN study_items i ON i.id=a.item_id JOIN study_topics t ON t.id=i.topic_id
               WHERE a.session_id=? AND a.score < 0.5 GROUP BY i.id""", (sid,))]
    return {"answered": len(done), "correct": sum(1 for e in done if e["score"] >= 0.7),
            "xp": s["xp"], "ready_before": s["ready_before"], "ready_after": ov["ready_exam"],
            "topics_up": sorted(ups, key=lambda u: u["from"] - u["to"])[:8], "wrong": wrong,
            "verdict": ov["verdict"], "streak": ov["streak"]}
