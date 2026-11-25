"""API per quaderno personale, ripasso e organizzazione dello studio."""
from __future__ import annotations

from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints

from .. import system_status
from ..study import flashcards, focus, notes, planner
from .auth import get_current_token
from .csrf import csrf_protect

router = APIRouter(prefix="/api", dependencies=[Depends(get_current_token)])
CSRF = [Depends(csrf_protect)]
Id = Annotated[int, Field(gt=0)]
Timestamp = Annotated[float, Field(ge=0, allow_inf_nan=False)]
Limit = Annotated[int, Query(ge=1, le=200)]
Offset = Annotated[int, Query(ge=0)]


def _non_blank(value: str) -> str:
    if not value.strip():
        raise ValueError("Il testo non può essere vuoto")
    return value


Text = Annotated[str, StringConstraints(min_length=1, max_length=100_000), AfterValidator(_non_blank)]
Tag = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
Tags = Annotated[list[Tag], Field(max_length=50)]
Origin = Literal["ai", "manuale", "errore"]
FocusKind = Literal["focus", "pausa"]


class StrictBody(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Attachment(StrictBody):
    lecture_id: Id | None = None
    doc_id: Id | None = None
    page: Id | None = None


class NoteEdit(Attachment):
    topic_id: Id | None = None
    timestamp_s: Timestamp | None = None
    body: Text | None = None
    tags: Tags | None = None


class NewNote(NoteEdit):
    course_id: Id
    body: Text
    tags: Tags = Field(default_factory=list)


class CardSource(Attachment):
    t_start: Timestamp | None = None


class NewCard(CardSource):
    course_id: Id
    front: Text
    back: Text


class CardEdit(CardSource):
    front: Text | None = None
    back: Text | None = None
    suspended: bool | None = None


class FromError(StrictBody):
    attempt_id: Id


class FocusStart(StrictBody):
    course_id: Id
    task: str | None = Field(default=None, max_length=500)
    planned_seconds: int = Field(gt=0, le=86_400)
    kind: FocusKind = "focus"


class Availability(StrictBody):
    hours_by_weekday: list[Annotated[float, Field(ge=0, le=24)]] = Field(min_length=7, max_length=7)
    days_off: list[date] = Field(default_factory=list)


class Recompute(StrictBody):
    missed_day: date
    start: date | None = None


def _call(operation, *args):
    try:
        return operation(*args)
    except LookupError as error:
        raise HTTPException(404, str(error)) from error
    except focus.FocusAlreadyRunning as error:
        raise HTTPException(409, str(error)) from error
    except ValueError as error:
        raise HTTPException(400, str(error)) from error


@router.get("/notes")
def list_notes(
    course_id: int | None = None, lecture_id: int | None = None, topic_id: int | None = None,
    doc_id: int | None = None, page: int | None = None, q: str | None = None, tag: str | None = None,
    limit: Limit = 50, offset: Offset = 0,
):
    fields = {"course_id": course_id, "lecture_id": lecture_id, "topic_id": topic_id, "doc_id": doc_id, "page": page}
    filters = {key: value for key, value in fields.items() if value is not None}
    return {"notes": notes.listing(filters, q, tag, limit, offset)}


@router.post("/notes", status_code=201, dependencies=CSRF)
def create_note(body: NewNote):
    return _call(notes.save, body.model_dump())


@router.get("/notes/{note_id}")
def get_note(note_id: int):
    return _call(notes.get, note_id)


@router.patch("/notes/{note_id}", dependencies=CSRF)
def update_note(note_id: int, body: NoteEdit):
    return _call(notes.save, body.model_dump(exclude_unset=True), note_id)


@router.delete("/notes/{note_id}", status_code=204, dependencies=CSRF)
def delete_note(note_id: int):
    _call(notes.delete, note_id)
    return Response(status_code=204)


@router.get("/flashcards")
def list_cards(
    course_id: int | None = None, suspended: bool | None = None, origin: Origin | None = None,
    limit: Limit = 50, offset: Offset = 0,
):
    return {"cards": flashcards.listing(course_id, suspended, origin, limit, offset)}


@router.post("/flashcards", status_code=201, dependencies=CSRF)
def create_card(body: NewCard):
    return _call(flashcards.create, body.model_dump())


@router.post("/flashcards/from-error", dependencies=CSRF)
def card_from_error(body: FromError):
    return _call(flashcards.from_error, body.attempt_id)


@router.get("/flashcards/{card_id:int}")
def get_card(card_id: int):
    return _call(flashcards.get, card_id)


@router.patch("/flashcards/{card_id:int}", dependencies=CSRF)
def update_card(card_id: int, body: CardEdit):
    return _call(flashcards.update, card_id, body.model_dump(exclude_unset=True))


@router.delete("/flashcards/{card_id:int}", status_code=204, dependencies=CSRF)
def delete_card(card_id: int):
    _call(flashcards.delete, card_id)
    return Response(status_code=204)


@router.post("/focus/start", status_code=201, dependencies=CSRF)
def start_focus(body: FocusStart):
    return _call(focus.start, body.course_id, body.task, body.planned_seconds, body.kind)


@router.post("/focus/{session_id}/stop", dependencies=CSRF)
def stop_focus(session_id: int):
    return _call(focus.stop, session_id)


@router.get("/focus")
def list_focus(course_id: int | None = None, day: date | None = None, limit: Limit = 50, offset: Offset = 0):
    return {"sessions": _call(focus.listing, course_id, day, limit, offset)}


@router.get("/focus/summary")
def focus_summary(course_id: int | None = None, day: date | None = None):
    return _call(focus.summary, course_id, day)


@router.get("/settings/availability")
def get_availability():
    return planner.availability()


@router.put("/settings/availability", dependencies=CSRF)
def set_availability(body: Availability):
    return planner.save_availability(body.hours_by_weekday, body.days_off)


@router.get("/plan/week")
def plan_week(start: date | None = None, missed_day: date | None = None):
    return _call(planner.week_plan, start, missed_day)


@router.post("/plan/recompute", dependencies=CSRF)
def plan_recompute(body: Recompute):
    return _call(planner.week_plan, body.start, body.missed_day)


@router.get("/review/today")
def review_today(
    course_id: int | None = None, limit: Limit = 50, offset: Offset = 0,
    daily_new: Annotated[int, Query(ge=1, le=200)] = 10,
    daily_backlog: Annotated[int, Query(ge=1, le=200)] = 20,
):
    return flashcards.review_today(course_id, limit, offset, daily_new, daily_backlog)


@router.get("/system/status")
def get_system_status(response: Response):
    response.headers["Cache-Control"] = "no-store"
    return system_status.status()
