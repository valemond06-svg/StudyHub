"""Flashcard con ripetizione spaziata FSRS (py-fsrs).

Le carte nascono dagli appunti AI delle lezioni (campo "flashcard" del JSON in studio_ai/)
e si reimportano senza doppioni: la chiave è lezione + testo del fronte.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
from datetime import datetime, time, timezone
from math import ceil
from sqlite3 import Connection, Row

from fsrs import Card, Rating, Scheduler

from ..db import session
from ..paths import uni_path
from . import sources

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
            ocr_source = bool(out["ocr_source"] or data.get("ocr_source"))
            for fc in data.get("flashcard", []):
                card = Card()
                cur = db.execute(
                    """INSERT OR IGNORE INTO flashcards (course_id, lecture_id, front, back, t_start, origin, origin_key,
                                                         fsrs, due, created_at, ocr_source)
                       VALUES (?,?,?,?,?,'ai',?,?,?,?,?)""",
                    (out["course_id"], out["target_id"], fc["fronte"], fc["retro"], fc.get("inizio_s"),
                     _key(out["target_id"], fc["fronte"]), card.to_json(), _iso(card.due), _now_iso(), ocr_source))
                added += cur.rowcount
    return added


def _public(row: Row) -> dict:
    card = dict(row)
    card.pop("fsrs")
    card.pop("ocr_source")
    card["suspended"] = bool(card["suspended"])
    card["url_hint"] = sources.url_hint(card["lecture_id"], card["t_start"], card["doc_id"], card["page"])
    return card


def _get(db: Connection, card_id: int) -> dict:
    row = db.execute("SELECT * FROM flashcards WHERE id=?", (card_id,)).fetchone()
    if row is None:
        raise LookupError("Flashcard non trovata")
    return _public(row)


def get(card_id: int) -> dict:
    with session() as db:
        return _get(db, card_id)


def listing(course_id: int | None, suspended: bool | None, origin: str | None,
            limit: int, offset: int) -> list[dict]:
    filters = {"course_id": course_id, "suspended": suspended, "origin": origin}
    filters = {key: val for key, val in filters.items() if val is not None}
    where = " WHERE " + " AND ".join(f"{key}=?" for key in filters) if filters else ""
    with session() as db:
        return [_public(row) for row in db.execute(
            f"SELECT * FROM flashcards{where} ORDER BY id DESC LIMIT ? OFFSET ?",
            [*filters.values(), limit, offset],
        )]


def _insert(db: Connection, values: dict, origin: str, attempt_id: int | None = None) -> dict:
    sources.validate(db, values["course_id"], values)
    card = Card()
    card_id = db.execute(
        """INSERT INTO flashcards (course_id, lecture_id, doc_id, t_start, page, front, back,
                                   origin, attempt_id, fsrs, due, created_at, ocr_source)
           VALUES (:course_id, :lecture_id, :doc_id, :t_start, :page, :front, :back,
                   :origin, :attempt_id, :fsrs, :due, :created_at, :ocr_source)""",
        dict(values, origin=origin, attempt_id=attempt_id, fsrs=card.to_json(), ocr_source=values.get("ocr_source", 0),
             due=_iso(card.due), created_at=_now_iso()),
    ).lastrowid
    return _get(db, card_id)


def create(values: dict) -> dict:
    with session() as db:
        db.execute("BEGIN IMMEDIATE")
        return _insert(db, values, "manuale")


def from_error(attempt_id: int) -> dict:
    with session() as db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute(
            """SELECT a.score, i.course_id, i.prompt_md AS front, i.answer_md AS back, t.ocr_source,
                      l.id AS lecture_id, d.id AS doc_id,
                      CASE WHEN l.id IS NOT NULL AND typeof(i.t_start) IN ('real', 'integer')
                                AND i.t_start >= 0 THEN i.t_start END AS t_start,
                      CASE WHEN d.id IS NOT NULL AND typeof(i.page)='integer'
                                AND i.page >= 1 THEN i.page END AS page
               FROM study_attempts a JOIN study_items i ON i.id=a.item_id
               JOIN study_topics t ON t.id=i.topic_id
               JOIN study_sessions s ON s.id=a.session_id AND s.course_id=i.course_id
               LEFT JOIN lectures l ON l.id=i.lecture_id AND l.course_id=i.course_id
               LEFT JOIN documents d ON d.id=i.doc_id AND d.course_id=i.course_id
               WHERE a.id=?""", (attempt_id,),
        ).fetchone()
        if row is None:
            raise LookupError("Risposta di sessione non trovata")
        if row["score"] >= 0.5:
            raise ValueError("La risposta non risulta sbagliata")
        existing = db.execute("SELECT * FROM flashcards WHERE attempt_id=?", (attempt_id,)).fetchone()
        if existing is not None:
            return _public(existing)
        return _insert(db, dict(row), "errore", attempt_id)


def update(card_id: int, values: dict) -> dict:
    with session() as db:
        db.execute("BEGIN IMMEDIATE")
        card = _get(db, card_id)
        if values:
            card.update(values)
            sources.validate(db, card["course_id"], card)
            if any(card[key] is None for key in ("front", "back", "suspended")):
                raise ValueError("Fronte, retro e stato di sospensione sono obbligatori")
            columns = ", ".join(f"{key}=?" for key in values)
            db.execute(f"UPDATE flashcards SET {columns} WHERE id=?", [*values.values(), card_id])
        return _get(db, card_id)


def delete(card_id: int) -> None:
    with session() as db:
        if not db.execute("DELETE FROM flashcards WHERE id=?", (card_id,)).rowcount:
            raise LookupError("Flashcard non trovata")


def due_cards(course_id: int | None = None, limit: int = 50, *, include_ocr: bool = True) -> list[dict]:
    with session() as db:
        sql = """SELECT f.*, l.title AS lecture_title, c.fullname AS course FROM flashcards f
                 LEFT JOIN lectures l ON l.id=f.lecture_id LEFT JOIN courses c ON c.id=f.course_id
                 WHERE f.suspended=0 AND f.due <= ?"""
        params: list = [_now_iso()]
        if not include_ocr:
            sql += " AND f.ocr_source=0"
        if course_id is not None:
            sql += " AND f.course_id=?"
            params.append(course_id)
        rows = db.execute(sql + " ORDER BY f.due, f.id LIMIT ?", [*params, limit]).fetchall()
    return [dict(_public(row), suspended=row["suspended"]) for row in rows]


def review_today(course_id: int | None, limit: int, offset: int, daily_new: int, daily_backlog: int) -> dict:
    now = datetime.now(timezone.utc)
    today = now.astimezone().date()
    midnight = _iso(datetime.combine(today, time.min).astimezone())
    scope = "AND f.course_id=?" if course_id is not None else ""
    params = [_iso(now), *([course_id] if course_id is not None else [])]
    with session() as db:
        db.execute("BEGIN")
        classification = f"""SELECT f.*,
            EXISTS (SELECT 1 FROM reviews r WHERE r.card_id=f.id) AS seen
            FROM flashcards f WHERE f.suspended=0 AND f.due<=? {scope}"""
        counts = db.execute(
            f"""SELECT COUNT(*) AS due, COUNT(*) FILTER (WHERE NOT seen) AS new,
                       COUNT(*) FILTER (WHERE due<?) AS overdue,
                       COUNT(*) FILTER (WHERE seen AND due<?) AS overdue_seen
                FROM ({classification})""",
            [midnight, midnight, *params],
        ).fetchone()
        rows = db.execute(
            f"""SELECT * FROM ({classification})
                ORDER BY CASE WHEN seen AND due>=? THEN 0 WHEN seen THEN 1 ELSE 2 END,
                         due, id LIMIT ? OFFSET ?""",
            [*params, midnight, limit, offset],
        ).fetchall()
    cards = []
    for row in rows:
        card = _public(row)
        seen = card.pop("seen")
        card["review_bucket"] = ("new" if not seen else "backlog" if card["due"] < midnight else "scheduled")
        cards.append(card)
    due, new, overdue, overdue_seen = counts
    scheduled_today = due - new - overdue_seen
    backlog_today = min(overdue_seen, daily_backlog)
    new_today = min(new, daily_new)
    return {
        "day": today.isoformat(), "course_id": course_id,
        "cards": cards, "due_count": due, "new_count": new, "overdue_count": overdue,
        "overdue_review_count": overdue_seen, "estimated_minutes": ceil(due / 3),
        "proposal": {
            "scheduled_today": scheduled_today, "backlog_today": backlog_today, "new_today": new_today,
            "estimated_minutes": ceil((scheduled_today + backlog_today + new_today) / 3),
            "remaining_backlog": overdue_seen - backlog_today, "remaining_new": new - new_today,
            "remaining_days": max(ceil((overdue_seen - backlog_today) / daily_backlog),
                                  ceil((new - new_today) / daily_new)),
        },
    }


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
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT fsrs, suspended FROM flashcards WHERE id=?", (card_id,)).fetchone()
        if not row:
            raise KeyError(card_id)
        if row["suspended"]:
            raise ValueError("Flashcard sospesa")
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
