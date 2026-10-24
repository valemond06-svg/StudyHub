"""Elaborazione COMPLETA di tutti i corsi attivi: la lanci tu una volta (`studyhub elabora-tutto`).

1. Moodle: scarica tutto il contenuto di ogni corso attivo e aggiorna l'indice di ricerca.
2. Poi due lavori in parallelo:
   a. registrazioni: tutte le lezioni (video caricati su Moodle e Panopto), in ordine di data,
      con la pipeline atomica + Whisper su GPU. Se il login Panopto è scaduto, aspetta che tu lo
      rifaccia (`studyhub login`) e intanto va avanti con il resto;
   b. studio: ogni contenuto diventa argomenti + domande (Gemini). Le lezioni passano prima dagli
      appunti di Claude Sonnet, ma solo finché la finestra di 5 ore è sotto il 70%: oltre, aspetta il
      reset così Claude resta libero anche per te.
Si può interrompere e rilanciare: riprende da dove era. Stato in ~/.studyhub/full_run.json.
"""
from __future__ import annotations

import json
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

from rich.console import Console

from . import notify
from .ai.claude_runner import last_usage
from .ai.lecture_notes import existing
from .config import LOCAL_DIR
from .db import session
from .sync.auth import LoginRequired, get_session

console = Console()
STATUS_FILE = LOCAL_DIR / "full_run.json"
LOCK_FILE = LOCAL_DIR / "full_run.lock"
CLAUDE_BATCH_LIMIT = 0.70
LOGIN_WAIT_H = 7 * 24   # Moodle può restare sospeso per giorni (manutenzione dell'Ateneo)

state: dict = {}
_lock = threading.Lock()


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _save(**kw) -> None:
    with _lock:
        state.update(kw, updated_at=_now())
        tmp = STATUS_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(state, ensure_ascii=False, indent=1), encoding="utf-8")
        tmp.replace(STATUS_FILE)


def status() -> dict:
    try:
        d = json.loads(STATUS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}
    d["alive"] = is_running()
    return d


def is_running() -> bool:
    """Il lucchetto è tenuto aperto dal processo finché lavora."""
    if not LOCK_FILE.exists():
        return False
    try:
        os.remove(LOCK_FILE)  # su Windows non si può cancellare un file aperto da un altro processo
        return False
    except PermissionError:
        return True
    except OSError:
        return False


def _courses() -> list[dict]:
    with session() as db:
        return [dict(r) for r in db.execute(
            "SELECT * FROM courses WHERE active=1 AND id>0 AND folder IS NOT NULL ORDER BY priority DESC, fullname")]


def _log(msg: str) -> None:
    console.print(f"[dim]{datetime.now():%H:%M}[/] {msg}")


# --- 1. Moodle ---------------------------------------------------------------------------

def wait_login(token_only_ok: bool, what: str):
    """Aspetta (fino a 7 giorni) che Moodle torni raggiungibile e il login sia valido; intanto lo segnala nell'app."""
    deadline = time.time() + LOGIN_WAIT_H * 3600
    while time.time() < deadline:
        try:
            return get_session(token_only_ok=token_only_ok)
        except LoginRequired:
            _save(login=f"{what}: Moodle non raggiungibile o login scaduto. Se Moodle è di nuovo attivo, premi «Accedi a Moodle» "
                        "(o doppio clic su accedi_moodle.bat); riprovo da solo ogni 10 minuti.")
            time.sleep(600)
    return None


def moodle_phase() -> None:
    from .autosync import run as autosync_run
    from .ingest.embed import EmbeddingError
    from .ingest.indexer import embed_pending, index_course
    _save(phase="Aspetto il login a Moodle")
    if not wait_login(True, "Moodle"):
        return
    _save(phase="Scarico tutto da Moodle", login=None)
    s = autosync_run(max_new_lectures=0, toast=False, force=True)
    _log(f"Moodle: {s['file']} file nuovi, errori: {len(s['errori'])}")
    _save(phase="Aggiorno l'indice di ricerca", moodle={"file": s["file"], "errori": s["errori"][:10]})
    for c in _courses():
        try:
            index_course(c)
        except Exception as e:
            _log(f"[red]indice {c['fullname']}: {e}[/]")
    try:
        embed_pending()
    except EmbeddingError:
        pass


# --- 2a. Registrazioni ---------------------------------------------------------------------

def _media_progress(**kw) -> None:
    _save(media={**state.get("media", {}), **kw})


def media_track() -> None:
    from .media.pipeline import discover_moodle_videos, process_moodle_video
    from .sync.moodle import Moodle
    courses = _courses()
    done = errors = 0
    # Video caricati su Moodle (basta il token dell'app).
    sess0 = wait_login(True, "Video Moodle")
    if not sess0:
        return
    m = Moodle(sess0)
    try:
        todo = []
        for c in courses:  # un corso irraggiungibile (rete) non ferma gli altri
            try:
                todo += [(c, l) for l in sorted(
                    (l for l in discover_moodle_videos(c) if l["status"] in ("nuova", "errore", "media_ok")),
                    key=lambda l: l["date"] or "9999")]
            except Exception as e:
                _log(f"[red]video Moodle {c['fullname']}: {e}[/]")
        _media_progress(total=len(todo), done=0, errors=0)
        for c, lec in todo:
            _media_progress(current=f"{c['fullname']}: {lec['title']}")
            for attempt in range(3):  # la rete può cadere per un attimo: riprovo prima di arrendermi
                try:
                    process_moodle_video(lec, c, m, whisper=True)
                    done += 1
                    break
                except Exception as e:
                    if attempt == 2:
                        errors += 1
                        _log(f"[red]✗ {lec['title']}: {e}[/]")
                    else:
                        time.sleep(60)
            _media_progress(done=done, errors=errors)
    finally:
        m.close()
    # Panopto: serve la sessione web (SSO). Se è scaduta aspetto il tuo login.
    sess = wait_login(False, "Registrazioni Panopto")
    if not sess:
        _media_progress(panopto="saltato: login non fatto entro 7 giorni", current=None)
        return
    from .media.panopto import Panopto
    from .media.pipeline import discover, process_lecture
    _media_progress(panopto="collegato")
    _save(login=None)
    p = Panopto(sess)
    try:
        todo = []
        for c in courses:
            try:
                todo += [(c, l) for l in discover(sess, c)
                         if l["source"] == "panopto" and l["status"] in ("nuova", "errore", "media_ok")]
            except Exception as e:
                _log(f"[red]Panopto {c['fullname']}: {e}[/]")
        todo.sort(key=lambda x: x[1]["date"] or "9999")
        _media_progress(total=state["media"].get("total", 0) + len(todo))
        for c, lec in todo:
            _media_progress(current=f"{c['fullname']}: {lec['title']}")
            try:
                process_lecture(lec, c, p, whisper=True)
                done += 1
            except Exception as e:
                errors += 1
                _log(f"[red]✗ {lec['title']}: {e}[/]")
            _media_progress(done=done, errors=errors)
    finally:
        p.close()
        _media_progress(current=None)


# --- 2b. Studio ----------------------------------------------------------------------------

def _claude_busy() -> str | None:
    u = last_usage()
    util, resets = u.get("utilization"), u.get("resets_at")
    if util is not None and util >= CLAUDE_BATCH_LIMIT and resets and resets > time.time():
        return f"Claude al {util:.0%}: gli appunti delle lezioni riprendono dopo le {time.strftime('%H:%M', time.localtime(resets))}"
    return None


def study_track(media_done: threading.Event) -> None:
    from .study import bank
    gemini_pause_until = 0.0
    while True:
        bank.release_stale()
        worked = waiting = False
        summary = {}
        for c in _courses():
            try:
                bank.sync_units(c["id"])
            except Exception as e:
                _log(f"[red]unità {c['fullname']}: {e}[/]")
                continue
            with session() as db:
                units = [dict(r) for r in db.execute(
                    "SELECT * FROM study_units WHERE course_id=? AND status='nuova' ORDER BY day, id", (c["id"],))]
            runnable = []
            for u in units:
                if u["kind"] == "lezione" and not existing(u["ref_id"]):
                    busy = _claude_busy()
                    if busy:
                        waiting = True
                        _save(claude=busy)
                        continue
                runnable.append(u["id"])
            if runnable and time.time() >= gemini_pause_until:
                _save(phase="Studio il materiale", study_current=c["fullname"])

                def one(uid: int) -> str | None:
                    return bank.run_claimed(uid) if bank.claim(uid) else None

                with ThreadPoolExecutor(max_workers=2) as pool:
                    limits = [x for x in pool.map(one, runnable) if x]
                worked = True
                if limits:
                    _log(f"[yellow]limite d'uso: {limits[0]}[/]")
                    gemini_pause_until = time.time() + 15 * 60
            try:
                from .study.syllabus import order_course
                order_course(c["id"])  # solo se l'elenco degli argomenti è cambiato
            except Exception as e:
                _log(f"[red]ordine argomenti {c['fullname']}: {e}[/]")
            st = bank.prepare_status(c["id"])
            summary[c["fullname"]] = {"pronte": st["ready"], "da_fare": st["todo"]}
        _save(study=summary, claude=_claude_busy())
        if not worked and not waiting and media_done.is_set():
            return
        if not worked:
            time.sleep(120)


# --- Avvio -----------------------------------------------------------------------------------

def _keep_awake(on: bool) -> None:
    """Il PC non va in sospensione per inattività finché l'elaborazione lavora (come un video in riproduzione).
    Chiudere il coperchio o spegnere resta possibile: si riprende con «Riprendi» in Studia."""
    try:
        import ctypes
        ES_CONTINUOUS, ES_SYSTEM_REQUIRED = 0x80000000, 0x00000001
        ctypes.windll.kernel32.SetThreadExecutionState(ES_CONTINUOUS | (ES_SYSTEM_REQUIRED if on else 0))
    except Exception:
        pass


def run() -> None:
    LOCAL_DIR.mkdir(parents=True, exist_ok=True)
    if is_running():
        console.print("[yellow]L'elaborazione completa è già in corso.[/]")
        return
    lock = open(LOCK_FILE, "w")  # tenuto aperto: segnala agli altri processi che sto lavorando
    _keep_awake(True)
    try:
        state.clear()
        _save(started_at=_now(), finished_at=None, phase="Avvio", media={}, study={})
        media_done = threading.Event()

        def media() -> None:  # Moodle + registrazioni; lo studio intanto lavora su quello che c'è già
            try:
                moodle_phase()
                media_track()
            except Exception as e:
                _media_progress(error=str(e)[:300])
                _log(f"[red]registrazioni: {e}[/]")
            finally:
                media_done.set()

        t = threading.Thread(target=media, name="media", daemon=True)
        t.start()
        _save(phase="Registrazioni e studio in corso")
        study_track(media_done)
        t.join()
        _save(phase="Finito", finished_at=_now())
        notify.toast("StudyHub: elaborazione completa finita", "Tutti i corsi sono pronti nella sezione Studia.")
    finally:
        lock.close()
        LOCK_FILE.unlink(missing_ok=True)
        _keep_awake(False)
