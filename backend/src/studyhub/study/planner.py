"""Piano di studio di oggi, calcolato in locale (nessuna chiamata AI).

Ogni corso attivo riceve un'urgenza in base al prossimo appello in calendario e a quanto lavoro
resta (lezioni senza appunti, quiz non fatti, profilo/simulazioni mancanti). Le attività che usano
Claude sono contate a parte e limitate, perché con Pro la finestra di 5 ore è stretta.
"""
from __future__ import annotations

import json
from datetime import date, datetime, time, timedelta, timezone
from math import ceil

from ..db import session
from ..paths import uni_path
from .exam import calendar, upcoming_exams
from .flashcards import stats as card_stats
from .mastery import item_states, topic_mastery

MAX_AI_TASKS_PER_DAY = 3
DEFAULT_HOURS = (2, 2, 2, 2, 2, 1, 0)
BLOCK_ORDER = ("theory", "exercises", "simulation", "fsrs")


def _course_state(db, course: dict) -> dict:
    cid = course["id"]
    lectures = [dict(r) for r in db.execute(
        "SELECT id, title, number, status FROM lectures WHERE course_id=? ORDER BY date, number", (cid,))]
    with_notes = {r[0] for r in db.execute("SELECT DISTINCT target_id FROM ai_outputs WHERE kind='lecture_notes' AND course_id=?", (cid,))}
    with_quiz = {r[0] for r in db.execute(
        "SELECT DISTINCT q.lecture_id FROM quizzes q JOIN quiz_attempts a ON a.quiz_id=q.id WHERE q.course_id=?", (cid,))}
    sims = db.execute("SELECT COUNT(*) FROM exam_attempts a JOIN exam_sims s ON s.id=a.sim_id WHERE s.course_id=?", (cid,)).fetchone()[0]
    best = db.execute("SELECT MAX(grade) FROM exam_attempts a JOIN exam_sims s ON s.id=a.sim_id WHERE s.course_id=?", (cid,)).fetchone()[0]
    profile = course["folder"] and (uni_path(course["folder"]) / "studio_ai" / "profilo_esame.json").exists()
    return {"lectures": lectures, "with_notes": with_notes, "with_quiz": with_quiz, "sims": sims,
            "best_grade": best, "profile": bool(profile)}


def today_plan() -> dict:
    exams = upcoming_exams()
    next_exam = {}
    for e in exams:
        next_exam.setdefault(e["course_id"], e)
    tasks, ai_tasks = [], 0
    cards = card_stats()
    if cards["da_ripassare"]:
        tasks.append({"kind": "flashcard", "priority": 100, "title": f"Ripassa {cards['da_ripassare']} flashcard",
                      "detail": "Ripetizione spaziata: pochi minuti al giorno valgono più di un ripasso lungo."})
    overview = []
    with session() as db:
        courses = [dict(r) for r in db.execute(
            "SELECT * FROM courses WHERE active=1 AND folder IS NOT NULL ORDER BY priority DESC, fullname")]
        for c in courses:
            st = _course_state(db, c)
            ex = next_exam.get(c["id"])
            days = ex["days_left"] if ex else None
            # Urgenza: appello vicino = alta; senza data, i corsi prioritari (es. esami arretrati) vengono prima.
            urgency = (100 / (days + 1)) if days is not None else (3 if c["priority"] else 1)
            ready = [l for l in st["lectures"] if l["status"] in ("media_ok", "trascritta")]
            no_notes = [l for l in ready if l["id"] not in st["with_notes"]]
            no_quiz = [l for l in ready if l["id"] in st["with_notes"] and l["id"] not in st["with_quiz"]]
            overview.append({"course_id": c["id"], "course": c["fullname"], "exam": ex, "days_left": days,
                             "lectures": len(st["lectures"]), "with_notes": len(st["with_notes"]),
                             "profile": st["profile"], "sims": st["sims"], "best_grade": st["best_grade"],
                             "urgency": round(urgency, 2)})
            if days is not None and days <= 30 and not st["profile"]:
                tasks.append({"kind": "profile", "course_id": c["id"], "priority": urgency * 3, "ai": True,
                              "title": f"Crea il profilo d'esame di {c['fullname']}",
                              "detail": f"Appello tra {days} giorni: capire cosa chiede l'esame viene prima di tutto."})
            for l in no_quiz[:1]:
                tasks.append({"kind": "quiz", "course_id": c["id"], "lecture_id": l["id"], "priority": urgency * 2, "ai": True,
                              "title": f"Quiz su {l['title']}", "detail": "Hai gli appunti ma non ti sei ancora verificato."})
            for l in no_notes[:2]:
                tasks.append({"kind": "notes", "course_id": c["id"], "lecture_id": l["id"], "priority": urgency * 1.5, "ai": True,
                              "title": f"Studia {l['title']}", "detail": "Genera gli appunti AI e ascolta i punti chiave."})
            if days is not None and days <= 21 and st["profile"]:
                tasks.append({"kind": "sim", "course_id": c["id"], "priority": urgency * (2.5 if st["sims"] == 0 else 1.2),
                              "ai": True, "title": f"Simulazione d'esame di {c['fullname']}",
                              "detail": "Prova a tempo, come all'esame." + (f" Miglior voto finora: {st['best_grade']:g}/30." if st["best_grade"] else "")})
    tasks.sort(key=lambda t: -t["priority"])
    plan = []
    for t in tasks:
        if t.get("ai"):
            if ai_tasks >= MAX_AI_TASKS_PER_DAY:
                continue
            ai_tasks += 1
        plan.append(t)
    overview.sort(key=lambda o: -o["urgency"])

    today_dt = date.today()
    start_of_week = today_dt - timedelta(days=today_dt.weekday())
    with session() as db:
        active_days_week = db.execute(
            """SELECT COUNT(DISTINCT substr(created_at,1,10)) FROM study_attempts WHERE created_at >= ?""",
            (start_of_week.isoformat(),)
        ).fetchone()[0]
        completed_sessions = db.execute(
            """SELECT COUNT(*) FROM study_sessions WHERE started_at >= ? AND ended_at IS NOT NULL""",
            (start_of_week.isoformat(),)
        ).fetchone()[0]
        quiz_week = db.execute(
            """SELECT COUNT(*) FROM quiz_attempts WHERE created_at >= ?""",
            (start_of_week.isoformat(),)
        ).fetchone()[0]

    return {
        "today": date.today().isoformat(),
        "exams": exams,
        "tasks": plan[:8],
        "courses": overview,
        "flashcards": cards,
        "week_progress": {
            "completed": active_days_week,
            "total": 7,
            "tasks_completed": completed_sessions + quiz_week,
            "label": f"{active_days_week}/7",
        },
    }


def _availability(db) -> dict:
    row = db.execute("SELECT hours_by_weekday, days_off FROM availability WHERE id=1").fetchone()
    return ({"hours_by_weekday": json.loads(row[0]), "days_off": json.loads(row[1])} if row
            else {"hours_by_weekday": list(DEFAULT_HOURS), "days_off": []})


def availability() -> dict:
    with session() as db:
        return _availability(db)


def save_availability(hours_by_weekday: list[float], days_off: list[date]) -> dict:
    days = sorted({day.isoformat() for day in days_off})
    with session() as db:
        db.execute(
            """INSERT INTO availability VALUES (1, ?, ?)
               ON CONFLICT(id) DO UPDATE SET hours_by_weekday=excluded.hours_by_weekday,
                                             days_off=excluded.days_off""",
            (json.dumps(hours_by_weekday), json.dumps(days)),
        )
    return {"hours_by_weekday": hours_by_weekday, "days_off": days}


def _block(exam: dict, kind: str, minutes: int, topic: dict | None = None) -> dict:
    topic_id = topic["id"] if topic else None
    return {
        "id": f"{exam['id']}:{kind}:{topic_id or 0}", "kind": kind, "minutes": minutes,
        "exam_id": exam["id"], "exam_date": exam["date"], "course_id": exam["course_id"],
        "course": exam["course"], "topic_id": topic_id,
        "topic": topic["name"] if topic else None, "mastery": topic["mastery"] if topic else None,
    }


def _exam_blocks(db, exam: dict, items: list[dict], topics: list[dict]) -> list[tuple[dict, int]]:
    deadline = date.fromisoformat(exam["date"])
    cutoff = datetime.combine(deadline, time.min).astimezone(timezone.utc).isoformat()
    mastery = topic_mastery(items, datetime.fromisoformat(cutoff))
    due = db.execute(
        "SELECT COUNT(*) FROM flashcards WHERE course_id=? AND suspended=0 AND due<?",
        (exam["course_id"], cutoff),
    ).fetchone()[0]
    due += sum(item["due"] is not None and item["due"] < cutoff for item in items)
    simulation_minutes = 30 if exam["kind"].casefold() in {"orale", "oral"} else 60
    blocks = [
        (dict(_block(exam, "fsrs", min(30, max(10, ceil(due / 3)))), due_count=due), 1),
        (_block(exam, "simulation", simulation_minutes), 2),
    ]
    ranked = [dict(t, mastery=round(mastery.get(t["id"], {}).get("m", 0), 3)) for t in topics]
    ranked.sort(key=lambda t: (-t["weight"] * (1 - t["mastery"]), t["id"]))
    for topic in ranked:
        gap = 1 - topic["mastery"]
        if topic["mastery"] < 0.9:
            minutes = 10 + 5 * ceil(topic["weight"] * gap)
            blocks.append((_block(exam, "exercises", minutes, topic), 3))
        if topic["mastery"] < 0.5:
            minutes = 15 + 5 * ceil(topic["weight"] * gap)
            blocks.append((_block(exam, "theory", minutes, topic), 5))
    if not ranked:
        blocks.extend([(_block(exam, "exercises", 25), 3), (_block(exam, "theory", 25), 5)])
    return blocks


def _place(block: dict, days: range, capacity, used: dict[date, int]) -> date | None:
    for ordinal in days:
        day = date.fromordinal(ordinal)
        if used.get(day, 0) + block["minutes"] <= capacity(day):
            used[day] = used.get(day, 0) + block["minutes"]
            return day
    return None


def _move_missed(
    blocks: list[dict], missed: date, today: date, capacity, used: dict[date, int],
) -> list[dict]:
    displaced = [block for block in blocks if block["day"] == missed]
    displaced.sort(key=lambda b: (b["exam_date"], BLOCK_ORDER.index(b["kind"]), b["id"]))
    earliest = max(today.toordinal(), missed.toordinal() + 1)
    changes = []
    for block in displaced:
        deadline = date.fromisoformat(block["exam_date"]).toordinal()
        phase = BLOCK_ORDER.index(block["kind"])
        peers = [b for b in blocks if b["exam_id"] == block["exam_id"] and b["day"] is not None and b["day"] > missed
                 and (b["topic_id"] is None or block["topic_id"] is None or b["topic_id"] == block["topic_id"])]
        later_phases = [b["day"].toordinal() for b in peers if BLOCK_ORDER.index(b["kind"]) > phase]
        earlier_phases = [b["day"].toordinal() for b in peers if BLOCK_ORDER.index(b["kind"]) < phase]
        if later_phases:
            deadline = min(deadline, min(later_phases) + 1)
        first = max(earliest, max(earlier_phases, default=earliest))
        new_day = _place(block, range(first, deadline), capacity, used)
        block["day"] = new_day
        changes.append({
            "block_id": block["id"], "kind": block["kind"], "exam_id": block["exam_id"],
            "course_id": block["course_id"], "topic_id": block["topic_id"], "minutes": block["minutes"],
            "from_day": missed.isoformat(), "to_day": new_day.isoformat() if new_day else None,
            "reason": "missed_day" if new_day else "no_slot_before_exam",
        })
    used.pop(missed, None)
    return changes


def week_plan(start: date | None = None, missed_day: date | None = None) -> dict:
    """Pianifica prima dell'appello, poi mostra la finestra di sette giorni richiesta."""
    today = date.today()
    anchor = min(today, missed_day) if missed_day else today
    start = start or today
    if start.toordinal() + 6 > date.max.toordinal():
        raise ValueError("La settimana supera la data massima")
    with session() as db:
        db.execute("BEGIN")
        settings = _availability(db)
        exams = calendar(db, today)
        materials = {}
        for exam in exams:
            course_id = exam["course_id"]
            if course_id not in materials:
                topics = [dict(row) for row in db.execute(
                    "SELECT id, name, weight FROM study_topics WHERE course_id=? AND hidden=0", (course_id,))]
                materials[course_id] = item_states(db, course_id), topics
        candidates = [(exam, _exam_blocks(db, exam, *materials[exam["course_id"]])) for exam in exams]

    minutes = [round(hours * 60) for hours in settings["hours_by_weekday"]]
    days_off = {date.fromisoformat(value) for value in settings["days_off"]}

    def capacity(day: date) -> int:
        return 0 if day < anchor or day in days_off else minutes[day.weekday()]

    used: dict[date, int] = {}
    blocks: list[dict] = []
    for exam, choices in candidates:
        exam_day = date.fromisoformat(exam["date"]).toordinal()
        assigned = {}
        for block, lead in choices:
            day = None
            if block["minutes"] <= max(minutes):
                deadline = max(anchor.toordinal(), exam_day - lead)
                deadline = min(deadline, exam_day - 1)
                next_kind = {"theory": "exercises", "exercises": "simulation", "simulation": "fsrs"}.get(block["kind"])
                later = assigned.get((next_kind, block["topic_id"])) or assigned.get((next_kind, None))
                if later:
                    deadline = min(deadline, later.toordinal())
                day = _place(block, range(deadline, anchor.toordinal() - 1, -1), capacity, used)
                if day is None and deadline < exam_day - 1:
                    latest = min(exam_day - 1, later.toordinal()) if later else exam_day - 1
                    day = _place(block, range(latest, deadline, -1), capacity, used)
            assigned[block["kind"], block["topic_id"]] = day
            blocks.append(dict(block, day=day))

    changes = _move_missed(blocks, missed_day, today, capacity, used) if missed_day else []
    by_day: dict[date, list[dict]] = {}
    unscheduled = []
    for block in blocks:
        if block["day"] is None:
            unscheduled.append(dict(block, reason="no_slot_before_exam"))
        else:
            by_day.setdefault(block["day"], []).append(dict(block, day=block["day"].isoformat()))
    days = []
    for ordinal in range(start.toordinal(), start.toordinal() + 7):
        day = date.fromordinal(ordinal)
        day_blocks = sorted(by_day.get(day, []), key=lambda b: (b["exam_date"], BLOCK_ORDER.index(b["kind"]), b["id"]))
        days.append({"day": day.isoformat(), "available_minutes": 0 if day == missed_day else capacity(day),
                     "planned_minutes": used.get(day, 0), "blocks": day_blocks})
    return {"start": start.isoformat(), "days": days, "exams": exams, "unscheduled": unscheduled, "changes": changes}
