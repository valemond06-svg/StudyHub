"""Piano di studio di oggi, calcolato in locale (nessuna chiamata AI).

Ogni corso attivo riceve un'urgenza in base al prossimo appello in calendario e a quanto lavoro
resta (lezioni senza appunti, quiz non fatti, profilo/simulazioni mancanti). Le attività che usano
Claude sono contate a parte e limitate, perché con Pro la finestra di 5 ore è stretta.
"""
from __future__ import annotations

from datetime import date

from ..db import session
from ..paths import uni_path
from .exam import upcoming_exams
from .flashcards import stats as card_stats

MAX_AI_TASKS_PER_DAY = 3


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
    return {"today": date.today().isoformat(), "exams": exams, "tasks": plan[:8], "courses": overview,
            "flashcards": cards}
