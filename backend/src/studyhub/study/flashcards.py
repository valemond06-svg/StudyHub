"""Flashcard con ripetizione spaziata FSRS (py-fsrs).

Le carte nascono dagli appunti AI delle lezioni (campo "flashcard" del JSON in studio_ai/)
e si reimportano senza doppioni: la chiave è lezione + testo del fronte.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
from datetime import datetime, timezone

from fsrs import Card, Rating, Scheduler

from ..db import session
from ..paths import uni_path

scheduler = Scheduler(desired_retention=0.9)
RATINGS = {1: Rating.Again, 2: Rating.Hard, 3: Rating.Good, 4: Rating.Easy}


def _iso(dt: datetime) -> str:
    """Sempre UTC al secondo: le date si confrontano come stringhe nel DB."""
    return dt.astimezone(timezone.utc).replace(microsecond=0).isoformat()


def _now_iso() -> str:
    return _iso(datetime.now(timezone.utc))


def _key(lecture_id: int | None, front: str) -> str:
    return hashlib.sha1(f"{lecture_id}:{front.strip().lower()}".encode()).hexdigest()


def import_from_notes(course_id: int | None = None) -> int:
    """Importa le flashcard da tutti gli appunti AI (o di un corso). Restituisce quante sono nuove."""
    added = 0
    with session() as db:
        sql = "SELECT * FROM ai_outputs WHERE kind='lecture_notes'"
        params: list = []
        if course_id is not None:
            sql += " AND course_id=?"
            params.append(course_id)
        latest: dict[int, dict] = {}
        for r in db.execute(sql + " ORDER BY id", params):
            latest[r["target_id"]] = dict(r)  # solo la versione più recente degli appunti
        for out in latest.values():
            path = uni_path(out["json_path"])
            if not path.exists():
                continue
            data = json.loads(path.read_text(encoding="utf-8"))
            for fc in data.get("flashcard", []):
                card = Card()
                cur = db.execute(
                    """INSERT OR IGNORE INTO flashcards (course_id, lecture_id, front, back, t_start, origin, origin_key,
                                                         fsrs, due, created_at) VALUES (?,?,?,?,?,'ai',?,?,?,?)""",
                    (out["course_id"], out["target_id"], fc["fronte"], fc["retro"], fc.get("inizio_s"),
                     _key(out["target_id"], fc["fronte"]), card.to_json(), _iso(card.due), _now_iso()))
                added += cur.rowcount
    return added


def due_cards(course_id: int | None = None, limit: int = 50) -> list[dict]:
    with session() as db:
        sql = """SELECT f.*, l.title AS lecture_title, c.fullname AS course FROM flashcards f
                 LEFT JOIN lectures l ON l.id=f.lecture_id LEFT JOIN courses c ON c.id=f.course_id
                 WHERE f.suspended=0 AND f.due <= ?"""
        params: list = [_now_iso()]
        if course_id is not None:
            sql += " AND f.course_id=?"
            params.append(course_id)
        rows = db.execute(sql + " ORDER BY f.due LIMIT ?", [*params, limit]).fetchall()
    return [{k: r[k] for k in r.keys() if k != "fsrs"} for r in rows]


def stats(course_id: int | None = None) -> dict:
    with session() as db:
        where, params = ("WHERE course_id=?", [course_id]) if course_id is not None else ("", [])
        total = db.execute(f"SELECT COUNT(*) FROM flashcards {where}", params).fetchone()[0]
        due = db.execute(f"SELECT COUNT(*) FROM flashcards {where} {'AND' if where else 'WHERE'} suspended=0 AND due<=?",
                         [*params, _now_iso()]).fetchone()[0]
        today = db.execute("SELECT COUNT(*) FROM reviews WHERE reviewed_at >= ?",
                           (datetime.now(timezone.utc).strftime("%Y-%m-%dT00:00:00"),)).fetchone()[0]
    return {"totale": total, "da_ripassare": due, "ripassate_oggi": today}


def review(card_id: int, rating: int) -> dict:
    with session() as db:
        row = db.execute("SELECT fsrs FROM flashcards WHERE id=?", (card_id,)).fetchone()
        if not row:
            raise KeyError(card_id)
        card, log = scheduler.review_card(Card.from_json(row["fsrs"]), RATINGS[rating])
        db.execute("UPDATE flashcards SET fsrs=?, due=? WHERE id=?", (card.to_json(), _iso(card.due), card_id))
        db.execute("INSERT INTO reviews (card_id, rating, reviewed_at, log) VALUES (?,?,?,?)",
                   (card_id, rating, _now_iso(), log.to_json()))
    return {"due": _iso(card.due), "state": int(card.state)}


def anki_tsv(course_id: int | None = None) -> str:
    """Export per Anki (File → Importa, separatore tab, HTML abilitato)."""
    with session() as db:
        sql = "SELECT f.front, f.back, c.fullname FROM flashcards f LEFT JOIN courses c ON c.id=f.course_id"
        rows = db.execute(sql + (" WHERE f.course_id=?" if course_id is not None else ""),
                          [course_id] if course_id is not None else []).fetchall()
    buf = io.StringIO()
    w = csv.writer(buf, delimiter="\t", lineterminator="\n")
    buf.write("#separator:tab\n#html:true\n#tags column:3\n")
    for front, back, course in rows:
        tag = "".join(ch if ch.isalnum() else "_" for ch in (course or "StudyHub"))[:60]
        w.writerow([front.replace("\n", "<br>"), back.replace("\n", "<br>"), tag])
    return buf.getvalue()
