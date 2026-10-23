"""Sync automatico (pensato per l'Utilità di pianificazione di Windows).

Fa SOLO lavoro locale o di download: Moodle, nuove registrazioni Panopto (pipeline atomica e
Whisper su GPU), indice di ricerca. Non chiama MAI Claude: gli appunti AI restano on-demand.
Alla fine registra le novità e manda una notifica di Windows.
"""
from __future__ import annotations

import hashlib
from pathlib import Path

from rich.console import Console

from . import notify
from .db import session
from .paths import uni_path
from .sync.auth import LoginRequired, get_session
from .sync.catalog import apply_catalog
from .sync.course import CourseSync
from .sync.moodle import Moodle

console = Console()


def _hash(p: Path) -> str | None:
    return hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None


def run(max_new_lectures: int = 2, whisper: bool = True, toast: bool = True, force: bool = False) -> dict:
    from .fullrun import is_running
    from .ingest.embed import EmbeddingError
    from .ingest.indexer import embed_pending, index_course

    if not force and is_running():  # l'elaborazione completa sta già facendo tutto questo
        console.print("[yellow]Elaborazione completa in corso: salto il sync automatico.[/]")
        return {"file": 0, "lezioni": 0, "avvisi": 0, "errori": []}

    apply_catalog()
    with session() as db:
        courses = [dict(r) for r in db.execute(
            "SELECT * FROM courses WHERE active=1 AND id>0 AND folder IS NOT NULL ORDER BY priority DESC, fullname")]
    summary = {"file": 0, "lezioni": 0, "avvisi": 0, "errori": []}
    touched: list[dict] = []

    # 1. Moodle: basta il token dell'app.
    try:
        m = Moodle(get_session(token_only_ok=True))
    except LoginRequired as e:
        notify.add("errore", "Sync Moodle non riuscito", str(e))
        summary["errori"].append(str(e))
        m = None
    if m:
        for c in courses:
            avvisi = uni_path(c["folder"]) / "moodle" / "_avvisi.md"
            before = _hash(avvisi)
            try:
                rep = CourseSync(m, c).run()
            except Exception as e:
                summary["errori"].append(f"{c['fullname']}: {e}")
                continue
            if rep.new_paths:
                names = ", ".join(Path(p).name for p in rep.new_paths[:4]) + ("…" if len(rep.new_paths) > 4 else "")
                notify.add("file", f"{len(rep.new_paths)} nuovi file · {c['fullname']}", names, c["id"], rep.new_paths[0])
                summary["file"] += len(rep.new_paths)
                touched.append(c)
            if before and _hash(avvisi) != before:
                notify.add("avviso", f"Nuovi avvisi · {c['fullname']}", "Apri gli avvisi del corso su StudyHub.", c["id"],
                           str(avvisi))
                summary["avvisi"] += 1

    budget = max_new_lectures

    def lecture_ready(c: dict, lec: dict) -> None:
        nonlocal budget
        notify.add("lezione", f"Nuova lezione pronta · {lec['title']}",
                   "Audio, slide e trascrizione disponibili. Gli appunti AI li generi tu quando vuoi.", c["id"], str(lec["id"]))
        summary["lezioni"] += 1
        budget -= 1
        if c not in touched:
            touched.append(c)

    # 2a. Video caricati come file su Moodle: stessa pipeline atomica (il .mp4 non resta su disco).
    if m:
        from .media.pipeline import discover_moodle_videos, process_moodle_video
        for c in courses:
            # Prima le lezioni più recenti (anno in corso); quelle senza data per ultime.
            pending = sorted((l for l in discover_moodle_videos(c) if l["status"] == "nuova"),
                             key=lambda l: l["date"] or "", reverse=True)
            for lec in pending:
                if budget <= 0:
                    break
                try:
                    process_moodle_video(lec, c, m, whisper=whisper)
                    lecture_ready(c, lec)
                except Exception as e:
                    summary["errori"].append(f"{lec['title']}: {e}")
        m.close()

    # 2b. Panopto: serve la sessione web (SSO). Se è scaduta, lo segnaliamo e basta.
    try:
        sess = get_session()
    except LoginRequired:
        sess = None
        notify.add("errore", "Panopto: login necessario", "Esegui `studyhub login` per riprendere il download delle registrazioni.")
    if sess:
        from .media.panopto import Panopto
        from .media.pipeline import discover, process_lecture
        p = Panopto(sess)
        try:
            for c in courses:
                try:
                    lectures = discover(sess, c)
                except Exception as e:
                    summary["errori"].append(f"Panopto {c['fullname']}: {e}")
                    continue
                for lec in [l for l in lectures if l["status"] == "nuova" and l["source"] == "panopto"]:
                    if budget <= 0:
                        break
                    try:
                        process_lecture(lec, c, p, whisper=whisper)
                        lecture_ready(c, lec)
                    except Exception as e:
                        summary["errori"].append(f"{lec['title']}: {e}")
        finally:
            p.close()

    # 3. Indice di ricerca.
    for c in touched:
        index_course(c)
    try:
        embed_pending()
    except EmbeddingError:
        pass  # Ollama spento: si recupera al prossimo giro, la ricerca per parole funziona comunque

    for e in summary["errori"]:
        console.print(f"[red]✗[/] {e}")
    if toast and (summary["file"] or summary["lezioni"] or summary["avvisi"]):
        parts = [f"{summary['file']} file nuovi" if summary["file"] else "",
                 f"{summary['lezioni']} lezioni pronte" if summary["lezioni"] else "",
                 f"{summary['avvisi']} corsi con nuovi avvisi" if summary["avvisi"] else ""]
        notify.toast("StudyHub: novità dai corsi", " · ".join(x for x in parts if x))
    return summary
