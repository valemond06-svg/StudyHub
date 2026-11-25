"""Sessioni Pomodoro persistenti con scadenze calcolate dal server."""
from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from sqlite3 import Row

from ..db import session


class FocusAlreadyRunning(ValueError):
    pass


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


def _finish(row: Row, now: datetime) -> tuple[str, int]:
    start = datetime.fromisoformat(row["started_at"])
    end = max(start, min(now, datetime.fromisoformat(row["ends_at"])))
    return end.isoformat(), int((end - start).total_seconds())


def _snapshot(row: Row, now: datetime) -> dict:
    result = dict(row)
    if row["stopped_at"] is not None:
        result["status"] = "stopped"
    else:
        end, seconds = _finish(row, now)
        expired = end == row["ends_at"]
        result.update(stopped_at=end if expired else None, actual_seconds=seconds,
                      status="stopped" if expired else "running")
    return result


def start(course_id: int, task: str | None, planned_seconds: int, kind: str) -> dict:
    with session() as db:
        db.execute("BEGIN IMMEDIATE")
        now = _now()
        if not db.execute("SELECT 1 FROM courses WHERE id=?", (course_id,)).fetchone():
            raise LookupError("Corso non trovato")
        active = db.execute("SELECT * FROM focus_sessions WHERE stopped_at IS NULL").fetchone()
        if active is not None:
            if active["ends_at"] > now.isoformat():
                raise FocusAlreadyRunning("C'è già una sessione in corso")
            end, seconds = _finish(active, now)
            db.execute("UPDATE focus_sessions SET stopped_at=?, actual_seconds=? WHERE id=?",
                       (end, seconds, active["id"]))
        ends_at = now + timedelta(seconds=planned_seconds)
        row = db.execute(
            """INSERT INTO focus_sessions (course_id, task, started_at, planned_seconds, ends_at, kind)
               VALUES (?, ?, ?, ?, ?, ?) RETURNING *""",
            (course_id, task, now.isoformat(), planned_seconds, ends_at.isoformat(), kind),
        ).fetchone()
        return _snapshot(row, now)


def stop(session_id: int) -> dict:
    with session() as db:
        db.execute("BEGIN IMMEDIATE")
        now = _now()
        row = db.execute("SELECT * FROM focus_sessions WHERE id=?", (session_id,)).fetchone()
        if row is None:
            raise LookupError("Sessione focus non trovata")
        if row["stopped_at"] is None:
            end, seconds = _finish(row, now)
            row = db.execute(
                "UPDATE focus_sessions SET stopped_at=?, actual_seconds=? WHERE id=? RETURNING *",
                (end, seconds, session_id),
            ).fetchone()
        return _snapshot(row, now)


def _day_bounds(day: date) -> tuple[datetime, datetime]:
    try:
        start = datetime.combine(day, time.min).astimezone(timezone.utc)
        end = datetime.combine(day + timedelta(days=1), time.min).astimezone(timezone.utc)
    except (OSError, OverflowError, ValueError) as error:
        raise ValueError("Data fuori dall'intervallo supportato") from error
    return start, end


def _sessions(db, course_id: int | None, bounds: tuple[datetime, datetime] | None):
    where, values = [], []
    if course_id is not None:
        where.append("course_id=?")
        values.append(course_id)
    if bounds is not None:
        start, end = bounds
        where.append("started_at < ? AND coalesce(stopped_at, ends_at) > ?")
        values.extend((end.isoformat(), start.isoformat()))
    clause = " WHERE " + " AND ".join(where) if where else ""
    return db.execute("SELECT * FROM focus_sessions" + clause + " ORDER BY started_at DESC, id DESC", values)


def listing(course_id: int | None, day: date | None, limit: int, offset: int) -> list[dict]:
    now = _now()
    with session() as db:
        rows = _sessions(db, course_id, _day_bounds(day) if day else None)
        results = []
        skipped = 0
        for row in rows:
            snapshot = _snapshot(row, now)
            if day and snapshot["status"] == "running" and day > now.astimezone().date():
                continue
            if skipped < offset:
                skipped += 1
                continue
            results.append(snapshot)
            if len(results) == limit:
                break
        return results


def summary(course_id: int | None, day: date | None) -> dict:
    now = _now()
    day = day or now.astimezone().date()
    bounds = _day_bounds(day)
    totals = {"focus": 0, "pausa": 0}
    counts = {"focus": 0, "pausa": 0}
    with session() as db:
        for row in _sessions(db, course_id, bounds):
            start = datetime.fromisoformat(row["started_at"])
            end = datetime.fromisoformat(row["stopped_at"]) if row["stopped_at"] else min(
                now, datetime.fromisoformat(row["ends_at"]),
            )
            overlap = min(end, bounds[1]) - max(start, bounds[0])
            if overlap > timedelta(0):
                totals[row["kind"]] += int(overlap.total_seconds())
                counts[row["kind"]] += 1
    return {"day": day.isoformat(), "course_id": course_id,
            "focus_seconds": totals["focus"], "break_seconds": totals["pausa"],
            "focus_count": counts["focus"], "break_count": counts["pausa"]}
