"""Server locale (127.0.0.1): API JSON + file delle lezioni + player offline."""
from __future__ import annotations

import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse

from ..db import session
from ..paths import uni_path

STATIC = Path(__file__).parent / "static"
app = FastAPI(title="StudyHub")


def _json(path: Path, default):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


def _lecture(lecture_id: int) -> dict:
    with session() as db:
        row = db.execute("SELECT * FROM lectures WHERE id=?", (lecture_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Lezione non trovata")
    return dict(row)


@app.get("/api/courses")
def courses():
    with session() as db:
        rows = db.execute(
            """SELECT c.id, c.fullname, c.year_of_study, c.passed, c.active, c.priority, c.folder,
                      COUNT(l.id) AS lectures, SUM(l.status IN ('media_ok','trascritta')) AS ready
               FROM courses c LEFT JOIN lectures l ON l.course_id = c.id
               GROUP BY c.id ORDER BY c.active DESC, c.year_of_study DESC, c.priority DESC, c.fullname"""
        ).fetchall()
    return [dict(r) for r in rows]


@app.get("/api/courses/{course_id}/lectures")
def lectures(course_id: int):
    with session() as db:
        rows = db.execute("SELECT * FROM lectures WHERE course_id=? ORDER BY date, number", (course_id,)).fetchall()
    return [dict(r) for r in rows]


@app.get("/api/courses/{course_id}/notes-index")
def notes_index(course_id: int):
    """Id delle lezioni del corso che hanno già gli appunti AI (per lo stato nell'elenco)."""
    with session() as db:
        return [r[0] for r in db.execute(
            "SELECT DISTINCT target_id FROM ai_outputs WHERE kind='lecture_notes' AND course_id=?", (course_id,))]


@app.get("/api/lectures/{lecture_id}")
def lecture(lecture_id: int):
    lec = _lecture(lecture_id)
    d = uni_path(lec["folder"])
    meta = _json(d / "lezione.json", {})
    videos = [k for k, p in (meta.get("video") or {}).items() if Path(p).exists()]
    return {
        **lec,
        "videos": videos,  # video archiviati su Google Drive, guardabili in streaming
        "slides": _json(d / "slides.json", []),
        "transcript": _json(d / "transcript.json", {"segments": []}),
        "silences": _json(d / "silences.json", []),
    }


@app.get("/video/{lecture_id}/{kind}")
def lecture_video(lecture_id: int, kind: str):
    """Video archiviato su Drive: solo percorsi registrati in lezione.json e dentro media_root."""
    from ..media import storage
    meta = _json(uni_path(_lecture(lecture_id)["folder"]) / "lezione.json", {})
    path = (meta.get("video") or {}).get(kind)
    root = storage.media_root()
    if not path or root is None or not Path(path).resolve().is_relative_to(root.resolve()) or not Path(path).exists():
        raise HTTPException(404, "Video non disponibile (Google Drive avviato?)")
    return FileResponse(path, media_type="video/mp4")


@app.get("/api/storage")
def storage_status():
    import shutil

    from ..media import storage
    root = storage.media_root()
    free = shutil.disk_usage(uni_path(".")).free
    return {"media_root": str(root) if root else None, "free_gb": round(free / 1e9, 1)}


@app.get("/media/{lecture_id}/{rel:path}")
def media(lecture_id: int, rel: str):
    base = uni_path(_lecture(lecture_id)["folder"]).resolve()
    target = (base / rel).resolve()
    if not target.is_relative_to(base) or not target.is_file():
        raise HTTPException(404)
    return FileResponse(target)


@app.get("/api/search")
def api_search(q: str, course_id: int | None = None, year: int | None = None, limit: int = 20):
    from ..search import search
    ids = [course_id] if course_id is not None else None
    if ids is None and year is not None:
        with session() as db:
            ids = [r[0] for r in db.execute("SELECT id FROM courses WHERE year_of_study=?", (year,))]
    return search(q, ids, min(limit, 50))


def _document(doc_id: int) -> dict:
    with session() as db:
        row = db.execute("SELECT * FROM documents WHERE id=?", (doc_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Documento non trovato")
    return dict(row)


@app.get("/api/docs/{doc_id}")
def doc_info(doc_id: int):
    d = _document(doc_id)
    with session() as db:
        d["pages"] = [dict(r) for r in db.execute("SELECT page, chars, is_scan, is_visual FROM pages WHERE doc_id=?", (doc_id,))]
    return d


@app.get("/api/docs/{doc_id}/file")
def doc_file(doc_id: int):
    path = uni_path(_document(doc_id)["path"])
    if not path.is_file():
        raise HTTPException(404)
    return FileResponse(path, content_disposition_type="inline", filename=path.name)


@app.get("/api/docs/{doc_id}/page/{page}.png")
def doc_page(doc_id: int, page: int, dpi: int = 110):
    from ..ingest.extract import render_page
    d = _document(doc_id)
    if d["kind"] != "pdf" or not 1 <= page <= (d["n_pages"] or 0):
        raise HTTPException(404)
    return FileResponse(render_page(uni_path(d["path"]), page, d["sha256"], dpi=max(60, min(dpi, 200))))


@app.get("/api/lectures/{lecture_id}/notes")
def lecture_notes(lecture_id: int):
    from ..ai.lecture_notes import existing
    out = existing(lecture_id)
    if not out or not uni_path(out["md_path"]).exists():
        return {"exists": False}
    data = _json(uni_path(out["json_path"]), {})
    return {"exists": True, "md": uni_path(out["md_path"]).read_text(encoding="utf-8"), "model": out["model"],
            "created_at": out["created_at"], "input_tokens": out["input_tokens"], "output_tokens": out["output_tokens"],
            "flashcard": data.get("flashcard", []), "sources": data.get("sources", [])}


@app.post("/api/lectures/{lecture_id}/notes")
def request_notes(lecture_id: int):
    """Avviato SOLO da un click: mette in coda la lezione per l'elaborazione AI."""
    from ..ai import jobs
    _lecture(lecture_id)
    return {"queued": jobs.enqueue([lecture_id])}


@app.post("/api/ai/queue")
def queue_course(course_id: int, limit: int = 3):
    """Coda manuale: le prime N lezioni del corso non ancora elaborate."""
    from ..ai import jobs
    from ..ai.lecture_notes import existing
    with session() as db:
        rows = db.execute("SELECT id FROM lectures WHERE course_id=? AND status IN ('media_ok','trascritta') "
                          "ORDER BY date, number", (course_id,)).fetchall()
    todo = [r[0] for r in rows if not existing(r[0])][:max(1, min(limit, 10))]
    return {"queued": jobs.enqueue(todo)}


@app.get("/api/ai/status")
def ai_status():
    from ..ai import jobs
    return jobs.status()


@app.post("/api/ai/cancel")
def ai_cancel():
    from ..ai import jobs
    return {"cancelled": jobs.cancel_queued()}


# --- Studio: flashcard, tutor, quiz ---------------------------------------------

from fastapi.responses import PlainTextResponse  # noqa: E402
from pydantic import BaseModel  # noqa: E402


def _ai_call(fn, *args):
    """Errori di Claude → risposte HTTP leggibili dalla UI."""
    from ..ai.claude_runner import ClaudeError, RateLimited
    try:
        return fn(*args)
    except RateLimited as e:
        raise HTTPException(429, str(e))
    except ClaudeError as e:
        raise HTTPException(502, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.get("/api/flashcards/due")
def cards_due(course_id: int | None = None, limit: int = 50):
    from ..study import flashcards
    return {"cards": flashcards.due_cards(course_id, limit), "stats": flashcards.stats(course_id)}


@app.post("/api/flashcards/import")
def cards_import(course_id: int | None = None):
    from ..study import flashcards
    return {"added": flashcards.import_from_notes(course_id)}


class Review(BaseModel):
    rating: int


@app.post("/api/flashcards/{card_id}/review")
def card_review(card_id: int, body: Review):
    from ..study import flashcards
    if body.rating not in (1, 2, 3, 4):
        raise HTTPException(400, "rating 1-4")
    try:
        return flashcards.review(card_id, body.rating)
    except KeyError:
        raise HTTPException(404)


@app.get("/api/flashcards/anki.tsv")
def cards_anki(course_id: int | None = None):
    from ..study import flashcards
    return PlainTextResponse(flashcards.anki_tsv(course_id), media_type="text/tab-separated-values",
                             headers={"Content-Disposition": 'attachment; filename="studyhub_flashcard.txt"'})


class NewThread(BaseModel):
    course_id: int | None = None
    mode: str = "normale"


class Ask(BaseModel):
    question: str


@app.get("/api/tutor/threads")
def tutor_threads():
    from ..study import tutor
    return tutor.threads()


@app.post("/api/tutor/threads")
def tutor_new(body: NewThread):
    from ..study import tutor
    return tutor.thread(tutor.new_thread(body.course_id, body.mode))


@app.get("/api/tutor/threads/{thread_id}")
def tutor_get(thread_id: int):
    from ..study import tutor
    try:
        return tutor.thread(thread_id)
    except KeyError:
        raise HTTPException(404)


@app.post("/api/tutor/threads/{thread_id}/ask")
def tutor_ask(thread_id: int, body: Ask):
    from ..study import tutor
    if not body.question.strip():
        raise HTTPException(400, "Domanda vuota")
    return _ai_call(tutor.ask, thread_id, body.question.strip()[:4000])


@app.get("/api/lectures/{lecture_id}/quizzes")
def lecture_quizzes(lecture_id: int):
    from ..study import quiz
    return quiz.list_for_lecture(lecture_id)


@app.post("/api/lectures/{lecture_id}/quiz")
def lecture_quiz_new(lecture_id: int, n: int = 10):
    from ..study import quiz
    return _ai_call(quiz.generate, lecture_id, max(4, min(n, 20)))


@app.get("/api/quizzes/{quiz_id}")
def quiz_get(quiz_id: int):
    from ..study import quiz
    try:
        return quiz.get(quiz_id)
    except KeyError:
        raise HTTPException(404)


class Submit(BaseModel):
    answers: list


@app.post("/api/quizzes/{quiz_id}/submit")
def quiz_submit(quiz_id: int, body: Submit):
    from ..study import quiz
    return _ai_call(quiz.submit, quiz_id, body.answers)


# --- Esami: calendario, profilo, simulazioni, piano ------------------------------

class NewExam(BaseModel):
    course_id: int
    date: str
    kind: str = "scritto"
    note: str | None = None


@app.get("/api/plan")
def plan():
    from ..study import planner
    return planner.today_plan()


@app.post("/api/exams")
def exam_add(body: NewExam):
    from ..study import exam
    try:
        return {"id": exam.add_exam(body.course_id, body.date, body.kind, body.note)}
    except ValueError:
        raise HTTPException(400, "Data non valida (AAAA-MM-GG)")


@app.delete("/api/exams/{exam_id}")
def exam_delete(exam_id: int):
    from ..study import exam
    exam.delete_exam(exam_id)
    return {"ok": True}


@app.get("/api/courses/{course_id}/exam")
def course_exam(course_id: int):
    from ..study import exam
    prof = exam.get_profile(course_id)
    md = None
    if prof:
        with session() as db:
            folder = db.execute("SELECT folder FROM courses WHERE id=?", (course_id,)).fetchone()[0]
        mp = uni_path(folder) / "studio_ai" / "profilo_esame.md"
        md = mp.read_text(encoding="utf-8") if mp.exists() else None
    return {"profile": prof, "profile_md": md, "sims": exam.list_sims(course_id)}


@app.post("/api/courses/{course_id}/exam/profile")
def course_exam_profile(course_id: int, force: bool = False):
    from ..study import exam
    return _ai_call(exam.build_profile, course_id, force)


@app.post("/api/courses/{course_id}/exam/sims")
def course_exam_sim(course_id: int):
    from ..study import exam
    return _ai_call(exam.generate_sim, course_id)


@app.get("/api/sims/{sim_id}")
def sim_get(sim_id: int):
    from ..study import exam
    try:
        return exam.get_sim(sim_id)
    except KeyError:
        raise HTTPException(404)


class SimSubmit(BaseModel):
    answers: list[dict]
    elapsed_min: float | None = None


@app.post("/api/sims/{sim_id}/submit")
def sim_submit(sim_id: int, body: SimSubmit):
    from ..study import exam
    return _ai_call(exam.grade_sim, sim_id, body.answers, body.elapsed_min)


# --- Studia: corso → argomenti, sessioni guidate, prontezza ---------------------------

@app.get("/api/study")
def study_courses():
    """I corsi attivi con la prontezza stimata, per la scelta del corso da studiare."""
    from ..study import bank, mastery
    with session() as db:
        ids = [r[0] for r in db.execute("""SELECT id FROM courses WHERE active=1 AND folder IS NOT NULL
                                           ORDER BY priority DESC, year_of_study DESC, fullname""")]
    out = []
    for cid in ids:
        ov, pr = mastery.overview(cid), bank.prepare_status(cid)
        nxt = next(((i + 1, t["name"]) for i, t in enumerate(ov["topics"]) if not t["learned"]), None)
        out.append({"id": cid, "name": ov["course"]["fullname"], "ready_exam": ov["ready_exam"], "exam": ov["exam"],
                    "learned": sum(1 for t in ov["topics"] if t["learned"]), "next": nxt,
                    "n_topics": len(ov["topics"]), "n_items": ov["n_items"], "due": ov["due"],
                    "units": pr["units"], "running": pr["running"]})
    out.sort(key=lambda c: (c["n_items"] == 0 and not c["units"], c["exam"] is None))
    return out


@app.get("/api/fullrun")
def fullrun_status():
    from .. import fullrun
    return fullrun.status()


# --- Primo avvio: login, corsi, elaborazione completa (senza terminale) -----------------

_login_proc: subprocess.Popen | None = None


@app.get("/api/setup")
def setup_status():
    from .. import doctor, fullrun
    checks = doctor.checks()
    return {"checks": checks, "ready": all(c["ok"] for c in checks if c["required"]),
            "login_running": _login_proc is not None and _login_proc.poll() is None,
            "fullrun_running": fullrun.is_running()}


@app.post("/api/setup/login")
def setup_login():
    """Apre la finestra di Chromium per il login SSO: le credenziali le scrivi tu, lì."""
    global _login_proc
    if _login_proc is None or _login_proc.poll() is not None:
        _login_proc = subprocess.Popen([sys.executable, "-m", "studyhub.cli", "login"],
                                       creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    return {"started": True}


@app.post("/api/setup/courses")
def setup_courses():
    from ..sync.auth import LoginRequired, get_session
    from ..sync.catalog import refresh_catalog
    from ..sync.moodle import Moodle
    try:
        m = Moodle(get_session(token_only_ok=True))
    except LoginRequired as e:
        raise HTTPException(400, str(e))
    try:
        entries = refresh_catalog(m)
    finally:
        m.close()
    return {"courses": len(entries), "active": sum(1 for e in entries if e.get("attivo"))}


@app.post("/api/setup/fullrun")
def setup_fullrun():
    """Avvia (o riprende) l'elaborazione completa in un processo a sé: continua anche chiudendo l'app."""
    from .. import fullrun
    from ..config import APP_DIR
    if not fullrun.is_running():
        subprocess.Popen(["wscript.exe", str(APP_DIR / "elabora_tutto.vbs")])
    return {"started": True}


@app.get("/favicon.png")
def favicon():
    return FileResponse(STATIC / "favicon.png")


_ordering: set[int] = set()


def _order_in_background(course_id: int) -> None:
    """Argomenti cambiati: l'ordine didattico si rifà in background (una chiamata Gemini)."""
    import threading
    from ..study import syllabus
    if course_id in _ordering or not syllabus.needs_order(course_id):
        return
    _ordering.add(course_id)

    def work() -> None:
        try:
            syllabus.order_course(course_id)
        except Exception:
            pass
        finally:
            _ordering.discard(course_id)
    threading.Thread(target=work, daemon=True).start()


@app.get("/api/study/{course_id}")
def study_overview(course_id: int):
    from ..study import bank, mastery
    _order_in_background(course_id)
    return {**mastery.overview(course_id), "prepare": bank.prepare_status(course_id)}


@app.post("/api/study/{course_id}/prepare")
def study_prepare(course_id: int, limit: int | None = None):
    """Avviato SOLO da un clic: analizza il materiale non ancora trasformato in domande."""
    from ..study import bank
    return bank.start_prepare(course_id, limit)


@app.get("/api/study/{course_id}/scan")
def study_scan(course_id: int):
    """Quante unità nuove ci sono (senza AI): serve a proporre l'aggiornamento dopo un sync."""
    from ..study import bank
    res = bank.sync_units(course_id)
    return {**bank.prepare_status(course_id), "added": res["added"], "skipped": res["skipped"]}


@app.post("/api/study/{course_id}/prepare/stop")
def study_prepare_stop(course_id: int):
    from ..study import bank
    bank.stop_prepare(course_id)
    return bank.prepare_status(course_id)


class NewSession(BaseModel):
    minutes: int = 45
    focus_topic: int | None = None


@app.post("/api/study/{course_id}/sessions")
def study_session_start(course_id: int, body: NewSession):
    from ..study import session as ss
    try:
        return ss.start(course_id, body.minutes, body.focus_topic)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.get("/api/study/sessions/{sid}")
def study_session_get(sid: int):
    from ..study import session as ss
    try:
        return ss.get(sid)
    except KeyError:
        raise HTTPException(404)


class Answer(BaseModel):
    idx: int
    choice: int | None = None
    text: str | None = None
    self_criteria: list[bool] | None = None
    self_score: float | None = None
    confidence: int | None = None
    seconds: float | None = None


@app.post("/api/study/sessions/{sid}/answer")
def study_session_answer(sid: int, body: Answer):
    from ..study import session as ss
    return _ai_call(ss.answer, sid, body.idx, body.model_dump())


@app.post("/api/study/sessions/{sid}/reveal/{idx}")
def study_session_reveal(sid: int, idx: int):
    from ..study import session as ss
    return ss.reveal(sid, idx)


@app.post("/api/study/sessions/{sid}/finish")
def study_session_finish(sid: int):
    from ..study import session as ss
    return ss.finish(sid)


class Chapter(BaseModel):
    chapter: str
    exclude: bool = True


@app.post("/api/study/{course_id}/chapters")
def study_chapter(course_id: int, body: Chapter):
    """Escludi (o rimetti) un capitolo che non devi studiare, es. la parte di Analisi 1 già superata."""
    with session() as db:
        n = db.execute("""UPDATE study_topics SET hidden=? WHERE course_id=? AND chapter=? AND hidden IN (0, 2)""",
                       (2 if body.exclude else 0, course_id, body.chapter)).rowcount
    return {"topics": n}


@app.get("/api/study/{course_id}/chapters/excluded")
def study_chapters_excluded(course_id: int):
    with session() as db:
        return [r[0] for r in db.execute("""SELECT chapter FROM study_topics WHERE course_id=? AND hidden=2
                                            GROUP BY chapter ORDER BY MIN(position)""", (course_id,))]


@app.get("/api/lectures/{lecture_id}/topics")
def lecture_topics(lecture_id: int):
    """Gli argomenti di Studia nati da questa lezione registrata (per passare dal video alla lezione interattiva)."""
    with session() as db:
        return [dict(r) for r in db.execute(
            """SELECT DISTINCT t.id, t.name, l.completed_at AS learned, COALESCE(t.position, 1000000) AS pos
               FROM study_topics t JOIN study_items i ON i.topic_id=t.id JOIN study_units u ON u.id=i.unit_id
               LEFT JOIN study_lessons l ON l.topic_id=t.id
               WHERE u.kind='lezione' AND u.ref_id=? AND t.hidden=0 ORDER BY pos""", (lecture_id,))]


@app.get("/api/study/topics/{topic_id}/lesson")
def study_lesson(topic_id: int, prepare: bool = True):
    """La lezione interattiva dell'argomento; se manca la mette in coda (Gemini) e risponde subito."""
    from ..study import lesson
    try:
        out = lesson.get(topic_id)
    except KeyError:
        raise HTTPException(404)
    if prepare and out["status"] in (None, "errore"):
        lesson.request([topic_id])
        out = lesson.get(topic_id)
    return out


@app.post("/api/study/topics/{topic_id}/lesson/done")
def study_lesson_done(topic_id: int):
    from ..study import lesson
    lesson.complete(topic_id)
    return {"ok": True}


class Ask(BaseModel):
    question: str = ""
    context: str = ""
    mode: str = "domanda"   # domanda | altro_modo


@app.post("/api/study/topics/{topic_id}/ask")
def study_ask(topic_id: int, body: Ask):
    from ..study import lesson
    return {"answer_md": _ai_call(lesson.ask, topic_id, body.question, body.context, body.mode)}


@app.post("/api/study/{course_id}/lessons/prefetch")
def study_prefetch(course_id: int, n: int = 4):
    from ..study import lesson
    return {"topics": lesson.prefetch(course_id, max(1, min(n, 40)))}


@app.get("/api/study/topics/{topic_id}")
def study_topic(topic_id: int):
    with session() as db:
        t = db.execute("SELECT * FROM study_topics WHERE id=?", (topic_id,)).fetchone()
        if not t:
            raise HTTPException(404)
        units = [dict(r) for r in db.execute(
            """SELECT DISTINCT u.kind, u.ref_id, u.title, u.page_from FROM study_items i
               JOIN study_units u ON u.id=i.unit_id WHERE i.topic_id=?""", (topic_id,))]
    return {**dict(t), "units": units}


# --- Export e novità ---------------------------------------------------------------

def _download(path: Path, media_type: str) -> FileResponse:
    return FileResponse(path, media_type=media_type, filename=path.name)


@app.get("/api/lectures/{lecture_id}/notes.pdf")
def lecture_notes_pdf(lecture_id: int):
    from .. import export
    return _download(_ai_call(export.lecture_pdf, lecture_id), "application/pdf")


@app.get("/api/courses/{course_id}/dispensa.pdf")
def course_dispensa(course_id: int):
    from .. import export
    return _download(_ai_call(export.course_pdf, course_id), "application/pdf")


@app.get("/api/flashcards/anki.apkg")
def cards_apkg(course_id: int | None = None):
    from .. import export
    return _download(_ai_call(export.anki_apkg, course_id), "application/octet-stream")


@app.get("/api/notifications")
def notifications():
    from .. import notify
    return notify.unread()


@app.post("/api/notifications/read")
def notifications_read():
    from .. import notify
    notify.mark_read()
    return {"ok": True}


@app.get("/vendor/{rel:path}")
def vendor(rel: str):
    base = (STATIC / "vendor").resolve()
    target = (base / rel).resolve()
    if not target.is_relative_to(base) or not target.is_file():
        raise HTTPException(404)
    return FileResponse(target)


NO_CACHE = {"Cache-Control": "no-cache"}  # il browser ricontrolla sempre: dopo un aggiornamento vedi subito la nuova versione


def _ui_version() -> str:
    return str(int((STATIC / "index.html").stat().st_mtime))


_clients: dict[str, dict] = {}


@app.get("/api/version")
def ui_version(request: Request, v: str | None = None):
    """La pagina lo confronta con la sua: se l'app è cambiata si ricarica da sola.
    Annota anche quale versione sta girando in ogni finestra (diagnostica: /api/version/clients)."""
    if v:
        ua = request.headers.get("user-agent", "")[:120]
        _clients[ua] = {"version": v, "seen": datetime.now().isoformat(timespec="seconds")}
    return {"ui": _ui_version()}


@app.get("/api/version/clients")
def ui_clients():
    return {"server": _ui_version(), "clients": _clients}


@app.get("/")
def index(request: Request):
    _clients[request.headers.get("user-agent", "")[:120]] = {"version": "pagina servita " + _ui_version(),
                                                              "seen": datetime.now().isoformat(timespec="seconds")}
    html = (STATIC / "index.html").read_text(encoding="utf-8").replace("__UI_VERSION__", _ui_version())
    return HTMLResponse(html, headers=NO_CACHE)
