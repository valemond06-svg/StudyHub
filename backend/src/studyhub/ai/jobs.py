"""Coda AI dentro il server: un solo worker, una lezione alla volta, appunti solo con Claude Sonnet.

- I job manuali (un click o un comando) hanno priorità `MANUAL_PRIORITY` e passano sempre davanti.
- Con `claude_backlog: true` in config.yaml il worker mette in coda da solo, ogni 30 minuti, le lezioni
  trascritte senza appunti (arretrati), prima i corsi «corrente», poi «arretrato» e «futuro», e dentro
  ogni corso dalla più recente. Gli arretrati partono solo se la finestra Pro è sotto
  `claude_backlog_stop_at` (default 0.70): il resto della finestra resta libero per te.
- I PDF scansionati (`kind='ocr'`, target = id del documento) entrano negli arretrati con priorità `OCR_PRIORITY`,
  sotto le lezioni e sotto la stessa soglia; dopo l'OCR nascono le unità di studio del corso.
- Se la finestra di Claude Pro è quasi piena, la coda si mette in pausa fino al reset e poi riparte.
- Durante il turno di notte niente embedding dopo gli appunti (il 35B ha bisogno di tutta la RAM).
"""
from __future__ import annotations

import logging
import threading
import time
from datetime import datetime

from ..config import settings
from ..db import session
from .claude_runner import ClaudeError, RateLimited, check_budget, last_usage, paused_until

log = logging.getLogger(__name__)
PAUSE_FALLBACK_S = 15 * 60   # limite senza ora di reset nota: si riprova tra 15 minuti
MANUAL_PRIORITY = 100        # click e comandi: sempre prima degli arretrati
OCR_PRIORITY = 5             # PDF scansionati: stessa finestra Claude, ma dopo le lezioni
STAGE_PRIORITY = {"corrente": 30, "arretrato": 20, "futuro": 10}   # corsi in 'archivio' esclusi
BACKLOG_EVERY_S = 30 * 60
BACKLOG_MAX_ERRORS = 3       # una lezione che fallisce 3 volte non torna più in coda da sola
BACKLOG_RETRY_AFTER = "-1 day"
_last_backlog = 0.0

_lock = threading.Lock()
_wake = threading.Event()
_worker: threading.Thread | None = None
state = {"current": None, "paused_reason": None, "paused_until": None, "backlog_wait": None}


def backlog_enabled() -> bool:
    return bool(settings.extra.get("claude_backlog", False))


def backlog_stop_at() -> float:
    try:
        return float(settings.extra.get("claude_backlog_stop_at", 0.70))
    except (TypeError, ValueError):
        return 0.70


def _backlog_allowed() -> bool:
    """Gli arretrati usano la finestra Pro solo fino a `claude_backlog_stop_at`, poi aspettano il reset."""
    u = last_usage()
    util, resets = u.get("utilization"), u.get("resets_at")
    if util is not None and util >= backlog_stop_at() and resets and resets > time.time():
        when = time.strftime("%H:%M", time.localtime(resets))
        state["backlog_wait"] = f"arretrati fermi: finestra Pro al {util:.0%}, ripartono dopo le {when}"
        return False
    state["backlog_wait"] = None
    return True


def _pause(reason: str) -> None:
    """La coda si ferma fino al reset della finestra Pro (o 15 minuti), poi riparte da sola."""
    state["paused_reason"] = reason
    state["paused_until"] = paused_until() or time.time() + PAUSE_FALLBACK_S


def _resume_if_due() -> None:
    until = state.get("paused_until")
    if state["paused_reason"] is not None and until is not None and time.time() >= until:
        state.update(paused_reason=None, paused_until=None)


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _insert(db, lecture_id: int, priority: int, kind: str = "lecture_notes") -> int | None:
    """Nuovo job, o priorità alzata se il target è già in coda (un click scavalca gli arretrati)."""
    row = db.execute("SELECT id FROM ai_jobs WHERE kind=? AND target_id=? AND status IN ('in_coda','in_corso')",
                     (kind, lecture_id)).fetchone()
    if row:
        db.execute("UPDATE ai_jobs SET priority=MAX(priority, ?) WHERE id=?", (priority, row["id"]))
        return None
    return db.execute("INSERT INTO ai_jobs (kind, target_id, created_at, priority) VALUES (?, ?, ?, ?)",
                      (kind, lecture_id, _now(), priority)).lastrowid


def enqueue(lecture_ids: list[int], priority: int = MANUAL_PRIORITY) -> list[int]:
    ids = []
    with session() as db:
        for lid in lecture_ids:
            jid = _insert(db, lid, priority)
            if jid:
                ids.append(jid)
    state.update(paused_reason=None, paused_until=None)
    _ensure_worker()
    _wake.set()
    return ids


def backlog_candidates() -> list[tuple[int, int]]:
    """(lecture_id, priorità) delle lezioni trascritte senza appunti, nell'ordine in cui vanno fatte."""
    cases = " ".join(f"WHEN '{k}' THEN {v}" for k, v in STAGE_PRIORITY.items())
    with session() as db:
        rows = db.execute(f"""
            SELECT l.id, CASE c.stage {cases} ELSE 0 END AS prio
            FROM lectures l JOIN courses c ON c.id = l.course_id
            WHERE l.status = 'trascritta' AND c.passed = 0 AND c.stage IN ({','.join('?' * len(STAGE_PRIORITY))})
              AND NOT EXISTS (SELECT 1 FROM ai_outputs o WHERE o.kind='lecture_notes' AND o.target_id=l.id)
              AND NOT EXISTS (SELECT 1 FROM ai_jobs j WHERE j.kind='lecture_notes' AND j.target_id=l.id
                              AND (j.status IN ('in_coda','in_corso')
                                   OR (j.status='errore' AND j.finished_at > datetime('now', ?, 'localtime'))))
              AND (SELECT COUNT(*) FROM ai_jobs j WHERE j.kind='lecture_notes' AND j.target_id=l.id
                   AND j.status='errore') < ?
            ORDER BY prio DESC, l.date DESC, l.number DESC, l.id DESC""",
            (*STAGE_PRIORITY, BACKLOG_RETRY_AFTER, BACKLOG_MAX_ERRORS)).fetchall()
    return [(r[0], r[1]) for r in rows]


def _excluded_for_errors(db, kind: str, target_id: int) -> bool:
    """Già in coda, fallito da poco o fallito BACKLOG_MAX_ERRORS volte: non torna negli arretrati da solo."""
    if db.execute("""SELECT 1 FROM ai_jobs WHERE kind=? AND target_id=? AND (status IN ('in_coda','in_corso')
                     OR (status='errore' AND finished_at > datetime('now', ?, 'localtime')))""",
                  (kind, target_id, BACKLOG_RETRY_AFTER)).fetchone():
        return True
    n = db.execute("SELECT COUNT(*) FROM ai_jobs WHERE kind=? AND target_id=? AND status='errore'",
                   (kind, target_id)).fetchone()[0]
    return n >= BACKLOG_MAX_ERRORS


def ocr_candidates() -> list[int]:
    """Id dei documenti da leggere con la visione, nell'ordine di `ocr.pending()` (corsi correnti prima)."""
    from ..ingest import ocr
    docs = ocr.pending()
    with session() as db:
        return [d["id"] for d in docs if not _excluded_for_errors(db, "ocr", d["id"])]


def enqueue_backlog() -> list[int]:
    """Mette in coda gli arretrati. Non azzera una pausa in corso: ripartono al reset della finestra."""
    global _last_backlog
    _last_backlog = time.time()
    ids = []
    with session() as db:
        for lid, prio in backlog_candidates():
            jid = _insert(db, lid, prio)
            if jid:
                ids.append(jid)
    try:
        doc_ids = ocr_candidates()
    except Exception:
        log.exception("coda AI: elenco OCR non riuscito")
        doc_ids = []
    with session() as db:
        for did in doc_ids:
            jid = _insert(db, did, OCR_PRIORITY, "ocr")
            if jid:
                ids.append(jid)
    if ids:
        log.info("coda AI: %d job arretrati in coda", len(ids))
    return ids


def cancel_queued() -> int:
    with session() as db:
        return db.execute("UPDATE ai_jobs SET status='annullato', finished_at=? WHERE status='in_coda'", (_now(),)).rowcount


def status() -> dict:
    with session() as db:
        jobs = [dict(r) for r in db.execute(
            """SELECT j.*, CASE j.kind WHEN 'ocr' THEN COALESCE(d.title, d.path) ELSE l.title END AS title
               FROM ai_jobs j LEFT JOIN lectures l ON j.kind='lecture_notes' AND l.id=j.target_id
               LEFT JOIN documents d ON j.kind='ocr' AND d.id=j.target_id
               WHERE j.status IN ('in_coda','in_corso') OR j.finished_at > datetime('now','-1 hour','localtime')
               ORDER BY j.id DESC LIMIT 30""")]
    return {"jobs": jobs, "paused_reason": state["paused_reason"], "usage": last_usage(),
            "backlog": {"enabled": backlog_enabled(), "stop_at": backlog_stop_at(), "waiting": state["backlog_wait"]}}


def _next_job(allow_backlog: bool = True) -> dict | None:
    """Priorità più alta prima; a pari priorità la lezione più recente. Senza `allow_backlog` solo i manuali."""
    with session() as db:
        row = db.execute(
            """SELECT j.* FROM ai_jobs j LEFT JOIN lectures l ON j.kind='lecture_notes' AND l.id = j.target_id
               WHERE j.status='in_coda' AND j.priority >= ?
               ORDER BY j.priority DESC, l.date DESC, j.id LIMIT 1""",
            (0 if allow_backlog else MANUAL_PRIORITY,)).fetchone()
        if row:
            db.execute("UPDATE ai_jobs SET status='in_corso', started_at=? WHERE id=?", (_now(), row["id"]))
        return dict(row) if row else None


def _finish(job_id: int, status_: str, message: str | None = None) -> None:
    with session() as db:
        db.execute("UPDATE ai_jobs SET status=?, message=?, finished_at=? WHERE id=?", (status_, message, _now(), job_id))


def _do_lecture(job: dict) -> None:
    from ..ingest.indexer import embed_pending, index_course
    from ..turno import notte_attiva
    from .lecture_notes import process
    res = process(job["target_id"])
    _finish(job["id"], "fatto", "già elaborata" if res.get("cached") else res.get("md_path"))
    try:
        with session() as db:
            course = dict(db.execute("SELECT c.* FROM courses c JOIN lectures l ON l.course_id=c.id WHERE l.id=?",
                                     (job["target_id"],)).fetchone())
        index_course(course)
        if not notte_attiva():  # di notte Ollama toglierebbe RAM al 35B: gli embedding li fa il turno dopo
            try:
                embed_pending()
            except Exception:
                pass  # Ollama spento: gli appunti restano cercabili per parole chiave
    except Exception as e:
        note = f"{res.get('md_path') or 'già elaborata'} · indicizzazione non riuscita: {str(e)[:200]}"
        _finish(job["id"], "fatto", note)  # il lavoro è fatto; l'indice si rifà al prossimo "index"


def _do_ocr(job: dict) -> None:
    """OCR del documento, chunk sostituiti, poi le unità di studio del corso (nessun'altra chiamata a Claude)."""
    from ..ingest import ocr
    from ..ingest.indexer import embed_pending
    from ..study.bank import sync_units
    from ..turno import notte_attiva
    with session() as db:
        row = db.execute("SELECT * FROM documents WHERE id=? AND duplicate_of IS NULL", (job["target_id"],)).fetchone()
    if not row:
        _finish(job["id"], "fatto", "documento non più presente")
        return
    doc = dict(row)
    n = ocr.process_doc(doc)
    _finish(job["id"], "fatto", f"{doc['path']} · {n} chunk")
    try:
        sync_units(doc["course_id"])
        if not notte_attiva():
            try:
                embed_pending()
            except Exception:
                pass  # Ollama spento: il testo resta cercabile per parole chiave
    except Exception as e:
        _finish(job["id"], "fatto", f"{doc['path']} · {n} chunk · unità non create: {str(e)[:200]}")


def _process_job(job: dict) -> None:
    """Esegue un job per tipo. Il lavoro riuscito resta "fatto" anche se l'indicizzazione poi fallisce
    (prima il job veniva riscritto come "errore" pur avendo gli appunti pronti)."""
    state["current"] = job["id"]
    try:
        (_do_ocr if job.get("kind") == "ocr" else _do_lecture)(job)
    except RateLimited as e:
        _finish(job["id"], "in_coda", str(e))  # torna in coda: riprenderà quando riattivi
        with session() as db:
            db.execute("UPDATE ai_jobs SET status='in_coda', finished_at=NULL WHERE id=?", (job["id"],))
        _pause(str(e))
    except (ClaudeError, Exception) as e:
        _finish(job["id"], "errore", str(e)[:500])
    finally:
        state["current"] = None


def _loop() -> None:
    while True:
        try:
            _wake.wait(timeout=30)
            _wake.clear()
            _resume_if_due()
            while state["paused_reason"] is None:
                try:
                    check_budget()
                except RateLimited as e:
                    _pause(str(e))
                    break
                if backlog_enabled() and time.time() - _last_backlog >= BACKLOG_EVERY_S:
                    enqueue_backlog()
                job = _next_job(allow_backlog=_backlog_allowed())
                if not job:
                    break
                _process_job(job)
        except Exception:  # DB bloccato o altro imprevisto: il worker non deve morire
            log.exception("coda AI: errore nel ciclo, riprovo tra 30 s")
            time.sleep(30)


def _ensure_worker() -> None:
    global _worker
    with _lock:
        if _worker is None or not _worker.is_alive():
            # I job rimasti "in_corso" da un server chiuso a metà tornano in coda.
            with session() as db:
                db.execute("UPDATE ai_jobs SET status='in_coda' WHERE status='in_corso'")
            _worker = threading.Thread(target=_loop, name="ai-worker", daemon=True)
            _worker.start()


def start_if_needed() -> None:
    """All'avvio del server: il worker parte se ci sono job rimasti in coda o se gli arretrati sono attivi."""
    with session() as db:
        pending = db.execute("SELECT 1 FROM ai_jobs WHERE status IN ('in_coda','in_corso') LIMIT 1").fetchone()
    if pending or backlog_enabled():
        _ensure_worker()
