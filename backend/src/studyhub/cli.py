"""Riga di comando di StudyHub. L'app si apre con `studyhub serve` (o il collegamento sul desktop)."""
from __future__ import annotations

import re
import sys

import typer
from rich.console import Console
from rich.table import Table
from rich.text import Text

from .db import session
from .sync.auth import LoginRequired, browser_login, get_session
from .sync.catalog import apply_catalog, load_catalog, refresh_catalog
from .sync.course import CourseSync
from .sync.moodle import Moodle

for stream in (sys.stdout, sys.stderr):  # la console Windows di default è cp1252
    if hasattr(stream, "reconfigure"):
        stream.reconfigure(encoding="utf-8", errors="replace")

app = typer.Typer(help="StudyHub: Moodle UniVR → materiale di studio locale", no_args_is_help=True)
console = Console()


def _moodle(interactive: bool = False, token_only_ok: bool = False) -> Moodle:
    try:
        return Moodle(get_session(interactive=interactive, token_only_ok=token_only_ok))
    except LoginRequired as e:
        console.print(f"[red]{e}[/]")
        raise typer.Exit(1)


@app.command()
def login():
    """Apre Chromium: fai tu il login SSO UniVR. Salva sessione e (se disponibile) token dell'app."""
    console.print("Si apre una finestra di Chromium: accedi con le credenziali d'ateneo (hai 10 minuti).")
    sess = browser_login(interactive=True)
    console.print("[green]Login riuscito.[/] Token app mobile: " + ("[green]sì[/]" if sess.token else "[yellow]no (userò AJAX)[/]"))


@app.command()
def courses(refresh: bool = typer.Option(True, help="Riscarica l'elenco da Moodle")):
    """Elenca i corsi e aggiorna corsi.yaml (classificazione per anno)."""
    if refresh:
        m = _moodle(token_only_ok=True)
        entries = refresh_catalog(m)
        m.close()
    else:
        apply_catalog()
        entries = load_catalog()
    t = Table("id", "corso", "A.A.", "anno", "superato", "attivo", "sync", "cartella")
    for e in entries:
        t.add_row(str(e["id"]), e["nome"][:55], e.get("anno_accademico") or "?", str(e.get("anno") or "?"),
                  "✓" if e.get("superato") else "", "✓" if e.get("attivo") else "",
                  "✓" if e.get("sync") else "", e.get("cartella") or "")
    console.print(t)
    console.print("Modifica [bold]_StudyHub/corsi.yaml[/] per correggere la classificazione.")


@app.command()
def sync(query: str = typer.Argument(None, help="id o parte del nome del corso; vuoto = corsi con sync: true")):
    """Scarica tutto il contenuto Moodle del corso nella sua cartella."""
    apply_catalog()
    with session() as db:
        rows = [dict(r) for r in db.execute("SELECT * FROM courses")]
    if query:
        targets = [r for r in rows if str(r["id"]) == query or query.lower() in r["fullname"].lower()]
    else:
        flagged = {e["id"] for e in load_catalog() if e.get("sync")}
        targets = [r for r in rows if r["id"] in flagged]
    if not targets:
        console.print("[yellow]Nessun corso corrispondente. Esegui prima `studyhub courses`.[/]")
        raise typer.Exit(1)
    m = _moodle(token_only_ok=True)
    if not m.has_token:
        console.print("[red]Serve il token dell'app Moodle per scaricare la struttura completa del corso.[/]")
        raise typer.Exit(1)
    for course in targets:
        console.rule(f"{course['fullname']} → {course['folder']}")
        r = CourseSync(m, course).run()
        console.print(f"Nuovi: {r.new_files} · aggiornati: {r.updated_files} · invariati: {r.skipped_files} · "
                      f"sorgenti video trovate: {r.media_found}")
        for err in r.errors:
            console.print(f"  [red]✗[/] {err}")
    m.close()


def _find_course(query: str) -> dict:
    apply_catalog()
    with session() as db:
        rows = [dict(r) for r in db.execute("SELECT * FROM courses")]
    hits = [r for r in rows if str(r["id"]) == query or query.lower() in r["fullname"].lower()]
    if len(hits) != 1:
        console.print(f"[yellow]Corsi trovati per '{query}': {[h['fullname'] for h in hits]}[/]")
        raise typer.Exit(1)
    return hits[0]


@app.command()
def lessons(course: str = typer.Argument(..., help="id o parte del nome del corso")):
    """Elenca le registrazioni Panopto del corso e il loro stato di elaborazione."""
    from .media.pipeline import discover
    c = _find_course(course)
    rows = discover(get_session(), c)
    t = Table("#", "data", "titolo", "stato", "slide", "trascrizione")
    for r in rows:
        t.add_row(str(r["number"] or ""), r["date"] or "", r["title"], r["status"], str(r["n_slides"] or ""),
                  r["transcript_source"] or "")
    console.print(t)


@app.command()
def process(
    course: str = typer.Argument(..., help="id o parte del nome del corso"),
    limit: int = typer.Option(1, help="Quante lezioni elaborare (una alla volta)"),
    lesson: int = typer.Option(None, help="Numero di una lezione specifica"),
    whisper: bool = typer.Option(True, help="Trascrizione Whisper su GPU"),
):
    """Pipeline atomica: audio + silenzi + slide (+ Whisper), una lezione alla volta.
    Vale sia per le registrazioni Panopto sia per i video caricati come file su Moodle."""
    from .media.panopto import Panopto
    from .media.pipeline import discover, discover_moodle_videos, process_lecture, process_moodle_video
    c = _find_course(course)
    try:
        sess = get_session()
        rows = discover(sess, c)
    except LoginRequired:
        sess = None  # senza sessione web niente Panopto; i video Moodle bastano il token
        console.print("[yellow]Sessione web scaduta: salto Panopto (esegui `studyhub login`).[/]")
        rows = []
    known = {r["id"] for r in rows}
    rows += [r for r in discover_moodle_videos(c) if r["id"] not in known]
    target = "trascritta" if whisper else "media_ok"
    if lesson is not None:
        todo = [r for r in rows if r["number"] == lesson]
    else:
        todo = [r for r in rows if r["status"] not in (target, "trascritta")][:limit]
    if sess is None:
        todo = [r for r in todo if r["source"] == "moodle"]
    p = Panopto(sess) if sess else None
    m = Moodle(get_session(token_only_ok=True)) if any(r["source"] == "moodle" for r in todo) else None
    try:
        for r in todo:
            console.rule(r["title"])
            try:
                if r["source"] == "moodle":
                    process_moodle_video(r, c, m, whisper=whisper)
                else:
                    process_lecture(r, c, p, whisper=whisper)
            except Exception as e:
                console.print(f"[red]✗ {e}[/]")
    finally:
        if p:
            p.close()
        if m:
            m.close()


@app.command()
def index(
    course: str = typer.Argument(None, help="id o parte del nome; vuoto = tutti i corsi con una cartella"),
    embed: bool = typer.Option(True, help="Calcola anche gli embeddings (GPU, Ollama)"),
    force: bool = typer.Option(False, help="Reindicizza da zero i corsi scelti (es. dopo un cambio di estrazione)"),
):
    """Indicizza PDF, appunti, codice e trascrizioni per la ricerca (incrementale)."""
    from .ingest.indexer import drop_course_index, embed_pending, index_course, register_local_courses
    apply_catalog()
    register_local_courses()
    if course:
        targets = [_find_course(course)]
    else:
        with session() as db:
            targets = [dict(r) for r in db.execute("SELECT * FROM courses WHERE folder IS NOT NULL ORDER BY folder")]
    for c in targets:
        if force:
            drop_course_index(c)
        s = index_course(c)
        if any(v for k, v in s.items() if k != "errori"):
            console.print(f"{c['folder']}: nuovi {s['nuovi']} · aggiornati {s['aggiornati']} · duplicati {s['duplicati']}"
                          f" · rimossi {s['rimossi']} · chunk {s['chunk']}")
        for e in s["errori"]:
            console.print(f"  [red]✗[/] {e}")
    if embed:
        console.print("Embeddings (attendo la GPU se è occupata)…")
        n = embed_pending(on_progress=lambda d, t: console.print(f"  {d}/{t}", end="\r"))
        console.print(f"Embeddings calcolati: {n}            ")


@app.command()
def search(query: str, course: str = typer.Option(None, help="limita a un corso"), limit: int = 10):
    """Ricerca ibrida (parole + significato) in tutto il materiale."""
    from .search import search as do_search
    ids = [_find_course(course)["id"]] if course else None
    res = do_search(query, ids, limit)
    if not res["semantic"]:
        console.print("[yellow]Ricerca semantica non disponibile (Ollama spento?): solo parole chiave.[/]")
    for r in res["results"]:
        where = f"p. {r['page']}" if r["page"] else (f"⏱ {int(r['t_start'] // 60)}:{int(r['t_start'] % 60):02d}" if r["t_start"] is not None else "")
        console.print(Text.assemble((r["title"] or "", "bold"), f" · {where} · ", (r["course"] or "", "dim")))
        line = Text("   ")
        for i, part in enumerate(re.split(r"\[\[|\]\]", r["snippet"].replace("\n", " ")[:300])):
            line.append(part, "reverse" if i % 2 else "")
        console.print(line)


@app.command("ai-lesson")
def ai_lesson(
    course: str = typer.Argument(..., help="id o parte del nome del corso"),
    lesson: int = typer.Option(None, help="Numero della lezione"),
    limit: int = typer.Option(1, help="Quante lezioni non ancora elaborate (in ordine), se non indichi --lesson"),
    force: bool = typer.Option(False, help="Rigenera anche se esiste già un risultato con lo stesso input"),
):
    """Appunti AI della lezione (1 chiamata Sonnet). Si avvia SOLO a mano: niente batch automatici."""
    from .ai.claude_runner import ClaudeError, RateLimited
    from .ai.lecture_notes import existing, process as ai_process
    from .ingest.indexer import embed_pending, index_course
    c = _find_course(course)
    with session() as db:
        rows = [dict(r) for r in db.execute(
            "SELECT * FROM lectures WHERE course_id=? AND status IN ('media_ok','trascritta') ORDER BY date, number",
            (c["id"],))]
    todo = [r for r in rows if r["number"] == lesson] if lesson is not None else \
        [r for r in rows if not existing(r["id"])][:limit]
    for r in todo:
        console.rule(r["title"])
        try:
            res = ai_process(r["id"], force=force)
        except RateLimited as e:
            console.print(f"[yellow]Fermo la coda: {e}[/]")
            break
        except ClaudeError as e:
            console.print(f"[red]✗ {e}[/]")
            continue
        if res.get("cached"):
            console.print(f"Già elaborata (stesso input): {res['md_path']}")
            continue
        util = res.get("utilization")
        console.print(f"[green]✓[/] {res['md_path']}\n  {res['model']} · {res['input_tokens']} token in / "
                      f"{res['output_tokens']} out · {res['duration_s']:.0f}s · chiamate API {res.get('api_calls', 1)}"
                      + (f" · finestra 5h al {util:.0%}" if util is not None else ""))
    if todo:
        from .ingest.embed import EmbeddingError
        index_course(c)  # gli appunti in studio_ai/ diventano cercabili
        try:
            embed_pending()
        except EmbeddingError as e:
            console.print(f"[yellow]Embeddings rimandati ({e}); gli appunti sono già cercabili per parole chiave.[/]")


@app.command("auto-sync")
def auto_sync(
    max_lectures: int = typer.Option(2, help="Massimo di nuove registrazioni da elaborare per giro"),
    whisper: bool = typer.Option(True, help="Trascrivi le nuove registrazioni con Whisper"),
):
    """Sync di tutti i corsi attivi + nuove registrazioni + indice, con notifica. Non usa Claude."""
    from .autosync import run
    s = run(max_new_lectures=max_lectures, whisper=whisper)
    console.print(f"File nuovi: {s['file']} · lezioni pronte: {s['lezioni']} · corsi con nuovi avvisi: {s['avvisi']}"
                  f" · errori: {len(s['errori'])}")


@app.command("elabora-tutto")
def elabora_tutto():
    """Scarica ed elabora COMPLETAMENTE tutti i corsi attivi: Moodle, tutte le registrazioni (Whisper),
    appunti delle lezioni (Claude, sotto il 70% della finestra) e domande per la sezione Studia (Gemini)."""
    from .fullrun import run
    run()


TASK_NAME = "StudyHub sync"


@app.command()
def schedule(
    time: str = typer.Option("20:00", help="Orario giornaliero HH:MM"),
    remove: bool = typer.Option(False, help="Rimuove l'attività pianificata"),
):
    """Crea (o rimuove) l'attività di Windows che esegue auto-sync ogni giorno."""
    import subprocess

    from .config import APP_DIR
    if remove:
        r = subprocess.run(["schtasks", "/Delete", "/TN", TASK_NAME, "/F"], capture_output=True, text=True, encoding="oem", errors="replace")
    else:
        if not re.fullmatch(r"\d{2}:\d{2}", time):
            console.print("[red]Orario non valido (HH:MM)[/]")
            raise typer.Exit(1)
        vbs = APP_DIR / "sync_nascosto.vbs"
        # /RL LIMITED: nessun privilegio di amministratore. Gira solo quando sei collegato (serve il desktop per il toast).
        # wscript + .vbs: nessuna finestra di console, che chiusa per sbaglio interromperebbe il sync.
        r = subprocess.run(["schtasks", "/Create", "/F", "/SC", "DAILY", "/ST", time, "/TN", TASK_NAME, "/RL", "LIMITED",
                            "/TR", f'wscript.exe "{vbs}"'],
                           capture_output=True, text=True, encoding="oem", errors="replace")
        if r.returncode == 0:
            # Se alle HH:MM il PC è spento, il sync parte alla prossima accensione. A batteria no (Whisper consuma).
            subprocess.run(["powershell", "-NoProfile", "-Command",
                            f"$s = (Get-ScheduledTask -TaskName '{TASK_NAME}').Settings; $s.StartWhenAvailable = $true; "
                            f"Set-ScheduledTask -TaskName '{TASK_NAME}' -Settings $s | Out-Null"], capture_output=True)
    console.print((r.stdout or r.stderr).strip())
    raise typer.Exit(r.returncode)


@app.command("media-migrate")
def media_migrate(
    root: str = typer.Option(None, help='Cartella su Google Drive, es. "G:/Il mio Drive/StudyHub" (salvata in config.yaml)'),
    apply: bool = typer.Option(False, "--apply", help="Esegue lo spostamento (senza: solo anteprima)"),
    min_mb: int = typer.Option(20, help="Sposta solo i file più grandi di così"),
    finalize: bool = typer.Option(False, "--finalize", help="Cancella gli originali già confermati nel cloud"),
):
    """Copia i video/audio pesanti su Google Drive. Gli originali si cancellano solo con --finalize,
    per i file confermati nel cloud (cloud_verified.json, verificato con l'API di Drive)."""
    import yaml

    from .config import CONFIG_FILE, settings
    from .media import storage
    if root:
        data = yaml.safe_load(CONFIG_FILE.read_text(encoding="utf-8")) if CONFIG_FILE.exists() else {}
        data["media_root"] = root
        CONFIG_FILE.write_text(yaml.safe_dump(data, allow_unicode=True), encoding="utf-8")
        settings.extra["media_root"] = root
    if finalize:
        r = storage.finalize()
        console.print(f"Originali rimossi: {r['removed']} · liberati {r['freed_gb']} GB")
        return
    res = storage.migrate(dry_run=not apply, min_mb=min_mb)
    if res["media_root"] is None:
        console.print("[yellow]Cartella su Drive non disponibile: avvia Google Drive e indica --root \"G:/Il mio Drive/StudyHub\".[/]")
    if not res["done"]:
        for p in res["plan"][:15]:
            console.print(f"  {p['mb']:>6} MB  {p['from']}")
        console.print(f"Da spostare: {res['files']} file, {res['gb']} GB" + ("" if res["done"] else " (anteprima: aggiungi --apply)"))
    else:
        console.print(f"Copiati su Drive {res['copied']}/{res['files']} file · errori {res['errors']} · gli originali restano"
                      f" finché il cloud non conferma (poi --finalize) · log: _StudyHub/media_migration_log.json")


@app.command()
def serve(port: int = typer.Option(8765, envvar="PORT"), open_browser: bool = typer.Option(True, "--open/--no-open")):
    """Avvia il server locale e il player (solo su 127.0.0.1)."""
    import threading
    import webbrowser

    import uvicorn
    if open_browser:
        threading.Timer(1.5, lambda: webbrowser.open(f"http://127.0.0.1:{port}")).start()
    uvicorn.run("studyhub.api.app:app", host="127.0.0.1", port=port, log_level="warning")


@app.command()
def doctor():
    """Controlla l'installazione: cosa manca e come sistemarlo."""
    from .doctor import checks
    bad = 0
    for c in checks():
        mark = "[green]✓[/]" if c["ok"] else ("[red]✗[/]" if c["required"] else "[yellow]•[/]")
        console.print(f"{mark} {c['label']}" + (f" [dim]({c['detail']})[/]" if c["detail"] else ""))
        if not c["ok"]:
            console.print(f"    → {c['fix']}")
            bad += c["required"]
    console.print("[green]Pronto.[/]" if not bad else f"[red]{bad} passi obbligatori mancanti.[/]")


@app.command()
def configura(
    anno: int = typer.Option(None, help="Anno di corso attuale (1, 2, 3…)"),
    cartella: str = typer.Option(None, help="Cartella dove salvare i corsi (default: quella che contiene _StudyHub)"),
    ai: str = typer.Option(None, help="auto | gemini | claude"),
):
    """Scrive le impostazioni in config.yaml (mantiene quelle che non indichi)."""
    from pathlib import Path

    import yaml

    from .config import CONFIG_FILE
    data = (yaml.safe_load(CONFIG_FILE.read_text(encoding="utf-8")) or {}) if CONFIG_FILE.exists() else {}
    if anno is not None:
        data["current_year_of_study"] = anno
    if cartella:
        Path(cartella).mkdir(parents=True, exist_ok=True)
        data["uni_root"] = str(Path(cartella).resolve())
    if ai:
        data["ai_provider"] = ai
    data.setdefault("current_year_of_study", 1)
    data.setdefault("extra_active_courses", [])
    CONFIG_FILE.write_text("# Impostazioni di StudyHub (vedi config.example.yaml)\n"
                           + yaml.safe_dump(data, allow_unicode=True, sort_keys=False), encoding="utf-8")
    console.print(f"Salvato {CONFIG_FILE}")


@app.command()
def status():
    """Riepilogo di cosa c'è nel database."""
    with session() as db:
        for r in db.execute(
            """SELECT c.fullname, c.folder, c.last_sync,
                      (SELECT COUNT(*) FROM files f WHERE f.course_id=c.id) AS files,
                      (SELECT COUNT(*) FROM media_sources s WHERE s.course_id=c.id) AS media
               FROM courses c WHERE c.last_sync IS NOT NULL ORDER BY c.year_of_study, c.fullname"""):
            console.print(f"{r['fullname']}: {r['files']} file, {r['media']} video · ultimo sync {r['last_sync']}")


if __name__ == "__main__":
    app()
