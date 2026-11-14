"""Turno di notte nativo: `studyhub notte --solo-locale`.

Sul PC fisso il 35B (llama-server, 1 slot) condivide RAM e GPU con Whisper e con Ollama bge-m3, quindi le fasi
girano rigorosamente in sequenza (mai sovrapposte):

  1. GPU/CPU pesanti: trascrizione Whisper delle lezioni già scaricate (`media_ok`), indice e embedding;
  2. pulizia: Ollama scaricato dalla memoria, Whisper rilasciato;
  3. 35B locale: unità di studio `nuova`, fino all'ora limite.

Il comando tiene `turno.NOTTE_LOCK` per tutta la durata: `auto-sync` e il server lo vedono con `notte_attiva()`.
Niente rete verso Moodle/Panopto: i download restano di `auto-sync`.
"""
from __future__ import annotations

import datetime as dt
import gc
import json
import os
import sys
import threading
import time
import urllib.request
from dataclasses import dataclass

from . import turno
from .filelock import LockTimeout, file_lock

DEFAULT_LLM_URL = "http://127.0.0.1:8081"
LOCAL_TIMEOUT_S = 1200


def _now() -> dt.datetime:
    return dt.datetime.now()


def log(msg: str) -> None:
    print(f"{_now():%H:%M:%S} {msg}", flush=True)


def _parse_hhmm(s: str) -> tuple[int, int]:
    try:
        h, m = (int(x) for x in s.split(":"))
        if not (0 <= h < 24 and 0 <= m < 60):
            raise ValueError
        return h, m
    except ValueError:
        raise ValueError(f"orario non valido '{s}' (atteso HH:MM)") from None


def _next_at(start: dt.datetime, hhmm: str) -> dt.datetime:
    h, m = _parse_hhmm(hhmm)
    t = start.replace(hour=h, minute=m, second=0, microsecond=0)
    return t if t > start else t + dt.timedelta(days=1)


@dataclass
class Esito:
    trascritte: int = 0
    fatte: int = 0
    errori: int = 0
    saltate: int = 0


# --- aiuti sostituibili nei test -----------------------------------------------------------------------------

def llm_url() -> str:
    from .config import settings
    return str(os.environ.get("STUDYHUB_LOCAL_LLM_URL") or settings.extra.get("local_llm_url") or DEFAULT_LLM_URL).rstrip("/")


def llm_risponde(url: str) -> bool:
    """Come notte.sh: GET {url}/v1/models deve dare 200."""
    try:
        with urllib.request.urlopen(f"{url}/v1/models", timeout=10) as r:
            return r.status == 200
    except Exception:
        return False


def lezioni_da_trascrivere() -> list[tuple[dict, dict]]:
    """(lezione, corso) in `media_ok`, con l'audio su disco e senza trascrizione Whisper. Nessuna rete."""
    from .db import session
    from .paths import uni_path
    out: list[tuple[dict, dict]] = []
    with session() as db:
        rows = [dict(r) for r in db.execute(
            "SELECT l.* FROM lectures l JOIN courses c ON c.id=l.course_id "
            "WHERE l.status='media_ok' AND c.active=1 AND c.id>0 AND c.folder IS NOT NULL "
            "ORDER BY c.priority DESC, l.date DESC, l.number DESC, l.id")]
        courses = {r["id"]: dict(r) for r in db.execute("SELECT * FROM courses")}
    for lec in rows:
        ldir = uni_path(lec["folder"])
        if not (ldir / "audio.opus").exists():
            continue
        tr = ldir / "transcript.json"
        if tr.exists():
            try:
                if json.loads(tr.read_text(encoding="utf-8")).get("source") == "whisper":
                    continue
            except (OSError, ValueError):
                pass
        out.append((lec, courses[lec["course_id"]]))
    return out


def trascrivi(lec: dict, course: dict) -> None:
    from .media.pipeline import transcribe_ready
    transcribe_ready(lec, course)


def indicizza(course: dict) -> None:
    from .ingest.indexer import index_course
    index_course(course)


def embedding(stop_event: threading.Event) -> int:
    from .ingest.indexer import embed_pending
    return embed_pending(stop_event=stop_event)


def scarica_ollama() -> list[str]:
    """keep_alive=0 per ogni modello in memoria. Se Ollama non risponde ritorna []."""
    import httpx

    from .ingest.embed import OLLAMA
    try:
        ps = httpx.get(f"{OLLAMA}/api/ps", timeout=5).json()
    except Exception:
        return []
    scaricati = []
    for m in ps.get("models", []):
        name = m.get("name") or m.get("model")
        if not name:
            continue
        try:
            httpx.post(f"{OLLAMA}/api/generate", json={"model": name, "keep_alive": 0}, timeout=20)
            scaricati.append(name)
        except Exception as e:
            log(f"Ollama: {name} non scaricato ({e})")
    return scaricati


def rilascia_whisper() -> str:
    """Whisper gira in un sottoprocesso (media/transcribe.py): la VRAM è già libera. Si ripulisce comunque
    ciò che il processo potrebbe tenere (torch importato da altri)."""
    gc.collect()
    torch = sys.modules.get("torch")
    if torch is not None:
        try:
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
                return "torch.cuda.empty_cache"
        except Exception:
            pass
    return "nessun modello in memoria (sottoprocesso)"


# --- fasi ----------------------------------------------------------------------------------------------------

def fase1(fine_gpu: dt.datetime, max_trascrizioni: int, esito: Esito) -> None:
    log("--- fase 1: GPU e CPU (Whisper, indice, embedding)")
    stop = threading.Event()
    attesa = (fine_gpu - _now()).total_seconds()
    timer = None
    if attesa <= 0:
        stop.set()
    else:
        timer = threading.Timer(attesa, stop.set)
        timer.daemon = True
        timer.start()
    toccati: dict[int, dict] = {}
    try:
        try:
            coda = lezioni_da_trascrivere()
        except Exception as e:
            log(f"elenco lezioni da trascrivere: {e}")
            coda = []
        log(f"lezioni in attesa di trascrizione: {len(coda)} (massimo {max_trascrizioni})")
        tentate = 0
        for lec, course in coda:
            if tentate >= max_trascrizioni:  # conta i tentativi: Whisper rotto non deve scorrere tutta la coda
                log(f"raggiunto il massimo di {max_trascrizioni} trascrizioni")
                break
            if _now() >= fine_gpu:
                stop.set()
                log("fine della fase GPU raggiunta: niente altre trascrizioni")
                break
            t = time.time()
            tentate += 1
            try:
                trascrivi(lec, course)
                esito.trascritte += 1
                toccati[course["id"]] = course
                log(f"  trascritta '{lec['title']}' in {time.time() - t:.0f}s")
            except Exception as e:
                esito.errori += 1
                log(f"  lezione '{lec['title']}' ERRORE trascrizione: {e}")
        for course in toccati.values():
            try:
                indicizza(course)
                log(f"  indice aggiornato: {course['fullname']}")
            except Exception as e:
                log(f"  indice {course['fullname']}: {e}")
        if _now() >= fine_gpu:
            stop.set()
        try:
            n = embedding(stop)
            log(f"embedding salvati: {n}" + (" (interrotti all'ora limite)" if stop.is_set() else ""))
        except Exception as e:  # EmbeddingError: Ollama spento, non è fatale
            log(f"embedding rimandati: {e}")
    finally:
        if timer:
            timer.cancel()
    log("fase 1 finita")


def fase2() -> None:
    log("--- fase 2: pulizia (Ollama e Whisper)")
    try:
        for m in scarica_ollama():
            log(f"  Ollama: scaricato {m}")
    except Exception as e:
        log(f"  Ollama non raggiungibile: {e}")
    log(f"  Whisper: {rilascia_whisper()}")
    log("fase 2 finita")


def _riprendi(**kw) -> None:
    from .study import riprese
    r = riprese.riprendi_sicuro(log=log, **kw)
    if any(r.values()):
        log(f"riprese automatiche: {r}")


def fase3(fino: dt.datetime, max_unita: int, esito: Esito) -> None:
    log("--- fase 3: unità di studio col 35B locale")
    from .ai.lecture_notes import existing
    from .db import session
    from .fullrun import _courses
    from .study import bank

    bank.release_stale()
    _riprendi(lezioni=False, unita=True)  # unità vuote/in errore scadute: rigenerabili nel turno di stanotte
    for c in _courses():
        try:
            bank.sync_units(c["id"])
        except Exception as e:
            log(f"unità {c['fullname']}: {e}")
            continue
        with session() as db:
            units = [dict(r) for r in db.execute(
                "SELECT * FROM study_units WHERE course_id=? AND status='nuova' ORDER BY day, id", (c["id"],))]
        log(f"{c['fullname']}: {len(units)} unità nuove")
        for u in units:
            if max_unita and esito.fatte + esito.errori >= max_unita:
                log(f"raggiunte {max_unita} unità")
                return
            if _now() >= fino:
                log("ora limite raggiunta")
                return
            if u["kind"] == "lezione" and not existing(u["ref_id"]):
                esito.saltate += 1  # gli appunti delle lezioni li fa Sonnet in coda
                continue
            if not bank.claim(u["id"]):
                continue
            t = time.time()
            try:
                r = bank.run_claimed(u["id"])
                esito.fatte += 1
                log(f"  unità {u['id']} ({u['kind']}) {time.time() - t:.0f}s {r or ''}")
            except Exception as e:
                esito.errori += 1
                log(f"  unità {u['id']} ERRORE {e}")


def conta() -> dict:
    """Lavoro che il turno troverebbe adesso, senza farlo: lezioni da trascrivere e unità per il 35B.

    Applica prima le riprese scadute e sincronizza le unità (come farebbe il turno), poi conta. Serve a
    `notte.sh` per uscire subito, senza fermare brain-worker, quando non c'è niente da fare.
    """
    from .ai.lecture_notes import existing
    from .db import session
    from .fullrun import _courses
    from .study import bank

    _riprendi(lezioni=True, unita=True)
    trascrizioni = len(lezioni_da_trascrivere())
    unita = 0
    for c in _courses():
        try:
            bank.sync_units(c["id"])
        except Exception as e:
            log(f"unità {c['fullname']}: {e}")
            continue
        with session() as db:
            rows = db.execute("SELECT kind, ref_id FROM study_units WHERE course_id=? AND status='nuova'",
                              (c["id"],)).fetchall()
        unita += sum(1 for r in rows if r["kind"] != "lezione" or existing(r["ref_id"]))
    return {"trascrizioni": trascrizioni, "unita": unita}


def run(solo_locale: bool = False, fino: str = "04:15", max_unita: int = 0, max_trascrizioni: int = 4,
        fine_fase_gpu: str = "00:30") -> int:
    if not solo_locale:
        print("Per ora esiste solo la modalità locale: usa `studyhub notte --solo-locale`.", file=sys.stderr)
        return 2
    try:
        start = _now()
        lim = _next_at(start, fino)
        fine_gpu = _next_at(start, fine_fase_gpu)
    except ValueError as e:
        print(str(e), file=sys.stderr)
        return 2
    if fine_gpu > lim:  # l'ora della fase GPU è già passata per questo turno: la fase GPU non ha tempo
        fine_gpu = start
    try:
        with file_lock(turno.NOTTE_LOCK, f"notte pid {os.getpid()}", timeout=0):
            return _turno(lim, fine_gpu, max_unita, max_trascrizioni)
    except LockTimeout:
        log("turno di notte già in corso")
        return 0


def _evento(inizio: dt.datetime, esito: "Esito", ok: bool) -> None:
    """Evento `studyhub.notte` per il Brain. Non fa mai fallire il turno."""
    try:
        from . import brain_events
        data = {"trascritte": esito.trascritte, "unita_fatte": esito.fatte, "errori": esito.errori,
                "saltate": esito.saltate, "durata_min": round((_now() - inizio).total_seconds() / 60),
                "esito": "ok" if ok else "llm_giu"}
        level = "error" if not ok else ("warn" if esito.errori > 0 else "info")
        brain_events.send("studyhub.notte", data, level=level, id=f"studyhub-notte-{inizio:%Y%m%d}")
    except Exception:
        pass


def _scrivi_ultimo(inizio: dt.datetime, esito: "Esito", ok: bool) -> None:
    """`notte_ultimo.json` per il pannello della UI: scrittura atomica, un errore non fa fallire il turno."""
    try:
        from .config import LOCAL_DIR
        fine = _now()
        data = {"inizio": inizio.isoformat(timespec="seconds"), "fine": fine.isoformat(timespec="seconds"),
                "esito": "ok" if ok else "llm_giu", "trascritte": esito.trascritte, "unita_fatte": esito.fatte,
                "errori": esito.errori, "saltate": esito.saltate,
                "durata_min": round((fine - inizio).total_seconds() / 60)}
        LOCAL_DIR.mkdir(parents=True, exist_ok=True)
        dest = LOCAL_DIR / "notte_ultimo.json"
        tmp = dest.with_name(f"{dest.name}.{os.getpid()}.tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, dest)
    except Exception:
        pass


def _turno(lim: dt.datetime, fine_gpu: dt.datetime, max_unita: int, max_trascrizioni: int) -> int:
    from .config import settings
    inizio = _now()
    url = llm_url()
    if not llm_risponde(url):
        log(f"LLM {url} non risponde: stop")
        _evento(inizio, Esito(), False)
        _scrivi_ultimo(inizio, Esito(), False)
        return 1
    settings.extra["ai_provider"] = "local"  # solo in questo processo: config.yaml non cambia
    settings.extra["local_llm_url"] = url
    settings.extra.setdefault("local_llm_timeout_s", LOCAL_TIMEOUT_S)  # env STUDYHUB_LOCAL_LLM_TIMEOUT vince comunque
    log(f"=== inizio turno di notte (fino alle {lim:%H:%M}, unità max {max_unita or 'illimitate'}, "
        f"fase GPU fino alle {fine_gpu:%H:%M})")
    esito = Esito()
    # Prima della fase 1: le lezioni riprese (media_ok) entrano subito nella coda di trascrizione.
    _riprendi(lezioni=True, unita=False)
    fase1(fine_gpu, max_trascrizioni, esito)
    fase2()
    fase3(lim, max_unita, esito)
    log(f"=== fine turno: trascritte {esito.trascritte}, unità fatte {esito.fatte}, errori {esito.errori}, "
        f"saltate (servono appunti Claude) {esito.saltate}")
    _evento(inizio, esito, True)
    _scrivi_ultimo(inizio, esito, True)
    return 0
