"""Padronanza misurata, non percepita.

Ogni domanda della banca ha una sua memoria FSRS: rispondere bene fa crescere la stabilità, ma la
probabilità di ricordare (R) cala col tempo. La padronanza di una domanda è R × qualità delle ultime
risposte; quella di un argomento è la media pesata delle SUE domande, comprese quelle mai provate
(contano 0). Esercizi e domande aperte pesano più di crocette e vero/falso.

Due numeri per il corso:
  - "oggi": quanto sapresti adesso;
  - "all'esame": la stessa stima proiettata alla data dell'appello (o tra 14 giorni se non c'è):
    è il numero che conta, perché premia il ripasso distribuito e non l'abbuffata del giorno prima.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

from fsrs import Card

from ..db import session
from .flashcards import scheduler

KIND_WEIGHT = {"vero_falso": 0.5, "multipla": 0.75, "richiamo": 1.0, "aperta": 1.5, "esercizio": 2.0}
LEVELS = [(0.9, 4, "Pronto"), (0.75, 3, "Solido"), (0.5, 2, "In crescita"), (0.2, 1, "Fragile"), (0.0, 0, "Da iniziare")]
HORIZON_DAYS = 14


def level(m: float, attempted: bool = True) -> tuple[int, str]:
    if not attempted:
        return 0, "Mai provato"
    return next((n, name) for th, n, name in LEVELS if m >= th)


def _utc(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def next_exam(db, course_id: int) -> dict | None:
    row = db.execute("""SELECT * FROM exams WHERE course_id=? AND done=0 AND date >= date('now','localtime')
                        ORDER BY date LIMIT 1""", (course_id,)).fetchone()
    if not row:
        return None
    d = dict(row)
    d["days_left"] = (date.fromisoformat(d["date"]) - date.today()).days
    return d


def item_states(db, course_id: int) -> list[dict]:
    """Domande attive con l'esito delle ultime risposte (qualità = media mobile dei punteggi)."""
    items = [dict(r) for r in db.execute(
        """SELECT id, topic_id, kind, difficulty, fsrs, due FROM study_items WHERE course_id=? AND suspended=0
           AND topic_id NOT IN (SELECT id FROM study_topics WHERE hidden=1)""", (course_id,))]
    hist: dict[int, list] = defaultdict(list)
    for r in db.execute("""SELECT a.item_id, a.score, a.created_at FROM study_attempts a
                           JOIN study_items i ON i.id=a.item_id WHERE i.course_id=? ORDER BY a.id""", (course_id,)):
        hist[r[0]].append((r[1], r[2]))
    for it in items:
        h = hist.get(it["id"], [])
        q = None
        for s, _ in h:
            q = s if q is None else 0.6 * s + 0.4 * q
        it["quality"] = q or 0.0
        it["attempts"] = len(h)
        it["last_score"] = h[-1][0] if h else None
        it["good_days"] = len({t[:10] for s, t in h if s >= 0.7})
    return items


def item_mastery(it: dict, at: datetime) -> float:
    if not it["fsrs"]:
        return 0.0
    r = scheduler.get_card_retrievability(Card.from_json(it["fsrs"]), _utc(at))
    return float(r) * it["quality"]


def topic_mastery(items: list[dict], at: datetime) -> dict[int, dict]:
    out: dict[int, dict] = defaultdict(lambda: {"num": 0.0, "den": 0.0, "n": 0, "tried": 0})
    for it in items:
        w = KIND_WEIGHT.get(it["kind"], 1.0)
        t = out[it["topic_id"]]
        t["num"] += w * item_mastery(it, at)
        t["den"] += w
        t["n"] += 1
        t["tried"] += it["attempts"] > 0
    return {tid: {"m": (t["num"] / t["den"]) if t["den"] else 0.0, "n": t["n"], "tried": t["tried"]}
            for tid, t in out.items()}


def _streak(db) -> int:
    """Giorni di fila (fino a oggi o ieri) con almeno 10 risposte."""
    days = {r[0] for r in db.execute("""SELECT substr(created_at,1,10) d FROM study_attempts
                                        GROUP BY d HAVING COUNT(*) >= 10""")}
    d, n = date.today(), 0
    if d.isoformat() not in days:
        d -= timedelta(days=1)
    while d.isoformat() in days:
        n += 1
        d -= timedelta(days=1)
    return n


def estimated_grade(ready_exam: float, coverage: float) -> str | None:
    """Stima grezza, dichiarata come tale. Serve a dire "non ci sei ancora", non a promettere un voto."""
    if coverage < 0.5:
        return None
    if ready_exam < 0.55:
        return "sotto il 18"
    return f"{min(30, round(18 + 12 * (ready_exam - 0.55) / 0.40))}/30"


def overview(course_id: int) -> dict:
    now = datetime.now(timezone.utc)
    with session() as db:
        course = dict(db.execute("SELECT id, fullname, folder, academic_year FROM courses WHERE id=?",
                                 (course_id,)).fetchone())
        exam = next_exam(db, course_id)
        topics = [dict(r) for r in db.execute(
            """SELECT t.id, t.name, t.weight, t.day, t.lecture_id, t.t_start, t.doc_id, t.page, u.title AS unit,
                      t.chapter, l.status AS lesson, l.completed_at AS learned
               FROM study_topics t LEFT JOIN study_units u ON u.id=t.unit_id LEFT JOIN study_lessons l ON l.topic_id=t.id
               WHERE t.course_id=? AND t.hidden=0 ORDER BY COALESCE(t.position, 1000000), t.day, t.id""", (course_id,))]
        items = item_states(db, course_id)
        streak = _streak(db)
        xp_total = db.execute("SELECT COALESCE(SUM(xp),0) FROM study_sessions").fetchone()[0]
        xp_today = db.execute("SELECT COALESCE(SUM(xp),0) FROM study_sessions WHERE started_at >= date('now','localtime')").fetchone()[0]
        recent = db.execute("""SELECT a.score, a.confidence FROM study_attempts a JOIN study_items i ON i.id=a.item_id
                               WHERE i.course_id=? AND a.confidence IS NOT NULL ORDER BY a.id DESC LIMIT 60""",
                            (course_id,)).fetchall()
        sims = db.execute("""SELECT MAX(grade) FROM exam_attempts a JOIN exam_sims s ON s.id=a.sim_id
                             WHERE s.course_id=?""", (course_id,)).fetchone()[0]
        due = db.execute("""SELECT COUNT(*) FROM study_items WHERE course_id=? AND suspended=0 AND due IS NOT NULL
                            AND due <= ?""", (course_id, now.replace(microsecond=0).isoformat())).fetchone()[0]
    at_exam = (datetime.combine(date.fromisoformat(exam["date"]), datetime.min.time(), timezone.utc)
               if exam else now + timedelta(days=HORIZON_DAYS))
    m_now, m_exam = topic_mastery(items, now), topic_mastery(items, at_exam)
    num_now = num_exam = den = 0.0
    for t in topics:
        a, b = m_now.get(t["id"], {"m": 0, "n": 0, "tried": 0}), m_exam.get(t["id"], {"m": 0})
        t.update(m=round(a["m"], 3), m_exam=round(b["m"], 3), n_items=a["n"], tried=a["tried"])
        t["level"], t["level_name"] = level(a["m"], a["tried"] > 0)
        num_now += t["weight"] * a["m"]
        num_exam += t["weight"] * b["m"]
        den += t["weight"]
    ready_now = num_now / den if den else 0.0
    ready_exam = num_exam / den if den else 0.0
    coverage = sum(1 for it in items if it["attempts"]) / len(items) if items else 0.0
    sure = [r for r in recent if r[1] == 3]
    overconf = sum(1 for r in sure if r[0] < 0.5) / len(sure) if len(sure) >= 5 else None
    return {
        "course": course, "exam": exam, "topics": topics, "n_items": len(items), "due": due,
        "ready_now": round(ready_now, 3), "ready_exam": round(ready_exam, 3), "coverage": round(coverage, 3),
        "horizon": exam["date"] if exam else (now + timedelta(days=HORIZON_DAYS)).date().isoformat(),
        "grade_estimate": estimated_grade(ready_exam, coverage), "best_sim": sims,
        "overconfidence": None if overconf is None else round(overconf, 2),
        "streak": streak, "xp_total": xp_total, "xp_today": xp_today,
        "verdict": verdict(topics, ready_exam, coverage, exam),
    }


def verdict(topics: list[dict], ready_exam: float, coverage: float, exam: dict | None) -> dict:
    """Il giudizio sincero: cosa manca per essere pronto davvero, non per sembrarlo."""
    if not topics:
        return {"tone": "info", "title": "Ancora niente da valutare",
                "text": "Analizza il materiale del corso: poi ogni risposta che dai misura dove sei davvero."}
    heavy_gaps = [t for t in topics if t["weight"] == 3 and t["level"] < 3]
    untried = [t for t in topics if not t["tried"]]
    when = f"all'appello del {exam['date']}" if exam else "tra due settimane"
    if ready_exam >= 0.8 and not heavy_gaps:
        return {"tone": "ok", "title": "Pronto su tutto quello fatto finora",
                "text": f"Le stime reggono anche {when}. Ora conta mantenerlo: ripasso breve ogni giorno "
                        "e una simulazione completa a tempo."}
    if coverage < 0.3:
        title = "Non sai ancora dove sei"
        text = (f"Hai provato solo il {coverage:.0%} delle domande: finché non ti metti alla prova la prontezza "
                "resta bassa per definizione. Le prime sessioni servono a misurarti.")
    elif ready_exam < 0.5:
        title = "Non sei pronto"
        text = f"Se l'esame fosse {when}, ricorderesti circa il {ready_exam:.0%} di quanto serve."
    else:
        title = "Ci sei quasi, ma restano lacune"
        text = f"Proiezione {when}: {ready_exam:.0%}. Il margine si chiude sugli argomenti pesanti ancora deboli."
    if heavy_gaps:
        text += f" Argomenti ad alto peso sotto «Solido»: {len(heavy_gaps)}."
    if untried:
        text += f" Mai provati: {len(untried)}."
    return {"tone": "warn" if ready_exam < 0.8 else "info", "title": title, "text": text,
            "gaps": [{"id": t["id"], "name": t["name"], "level_name": t["level_name"]}
                     for t in sorted(heavy_gaps, key=lambda t: t["m"])[:5]]}
