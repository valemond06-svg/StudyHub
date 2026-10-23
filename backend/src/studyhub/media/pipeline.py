"""Pipeline atomica delle lezioni (policy video "leggera").

Una lezione alla volta:
  1. sottotitoli Panopto → transcript.json provvisorio (se esistono);
  2. flusso camera → audio.opus + silences.json, poi il .mp4 temporaneo viene cancellato;
  3. flusso schermo → slides/*.png + slides.json, poi il .mp4 temporaneo viene cancellato;
  4. (opzionale) Whisper su GPU → transcript.json definitivo.
Le registrazioni che hai scaricato tu (lezioni/_registrazioni_scaricate) vengono usate come
sorgente al posto del download e NON vengono mai cancellate.
"""
from __future__ import annotations

import json
import re
import shutil
from datetime import datetime
from pathlib import Path
from urllib.parse import unquote, urlsplit

from rich.console import Console

from ..db import session
from ..paths import rel_to_uni, safe_name, uni_path
from ..sync.auth import MoodleSession
from . import ff, storage
from .audio import detect_silences, extract_audio
from .panopto import Panopto, PanoptoSession, list_course_sessions
from .slides import extract_slides
from .transcribe import transcribe

console = Console()
LOCAL_RECORDINGS = "_registrazioni_scaricate"


def _parse_title(title: str) -> tuple[int | None, str | None]:
    num = re.search(r"(?:lezione|lecture|lez\.?)\s*(\d+)", title, re.I)
    date = None
    iso = re.search(r"(20\d\d)[./-](\d{1,2})[./-](\d{1,2})", title)  # 2026.03.05
    d = re.search(r"(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})", title)    # 05.03.26 / 19.03.2026
    if iso:
        date = f"{iso[1]}-{int(iso[2]):02d}-{int(iso[3]):02d}"
    elif d:
        year = int(d[3]) + (2000 if len(d[3]) == 2 else 0)
        date = f"{year:04d}-{int(d[2]):02d}-{int(d[1]):02d}"
    return (int(num[1]) if num else None), date


def discover_moodle_videos(course: dict) -> list[dict]:
    """Le registrazioni caricate come file su Moodle (trovate dal sync) diventano lezioni."""
    with session() as db:
        for src in db.execute("SELECT * FROM media_sources WHERE course_id=? AND kind='moodle_video'", (course["id"],)).fetchall():
            num, date = _parse_title(src["title"] or "")
            folder = Path(course["folder"]) / "lezioni" / safe_name(
                f"{'L%02d_' % num if num else ''}{date or ''}_{src['title']}".replace("__", "_"), 80)
            db.execute(
                """INSERT INTO lectures (course_id, title, date, number, folder, source, media_url, updated_at)
                   VALUES (?,?,?,?,?,'moodle',?,?)
                   ON CONFLICT(media_url) DO UPDATE SET title=excluded.title""",
                (course["id"], src["title"], date, num, folder.as_posix(), src["url"],
                 datetime.now().isoformat(timespec="seconds")))
        return [dict(r) for r in db.execute(
            "SELECT * FROM lectures WHERE course_id=? AND source='moodle' ORDER BY date, number, title", (course["id"],))]


def process_moodle_video(lec: dict, course: dict, moodle, whisper: bool = True) -> None:
    """Un solo file (schermo + audio insieme). Se il vecchio sync l'aveva già scaricato in moodle/ si usa
    quello; in ogni caso, finita l'estrazione, il .mp4 viene cancellato (policy leggera)."""
    ldir = uni_path(lec["folder"])
    tmp = ldir / "_tmp"
    ldir.mkdir(parents=True, exist_ok=True)
    with session() as db:
        old = db.execute("SELECT * FROM files WHERE source_url=?", (lec["media_url"],)).fetchone()
    try:
        audio = ldir / "audio.opus"
        need_video = not audio.exists() or not (ldir / "slides.json").exists()
        src = None
        if need_video:
            # Video finiti in moodle/ con il vecchio sync (anche senza riga nel DB): si riconoscono dal nome.
            name = unquote(Path(urlsplit(lec["media_url"]).path).name)
            stray = storage.find_in_course(course["folder"], name)
            if old and uni_path(old["path"]).exists():
                src = uni_path(old["path"])
                console.print(f"    uso il file già scaricato {src.name}")
            elif stray:
                src = stray
                console.print(f"    uso il file già scaricato {src.name}")
            else:
                console.print("    scarico il video da Moodle…")
                tmp.mkdir(parents=True, exist_ok=True)
                src = tmp / "video.mp4"
                moodle.download(lec["media_url"], src)
        if not audio.exists():
            extract_audio(src, audio)
        if not (ldir / "silences.json").exists():
            detect_silences(audio, ldir / "silences.json")
        _update(lec["id"], has_audio=1, duration=ff.probe(audio)["duration"])
        if not (ldir / "slides.json").exists():
            slides = extract_slides(src, ldir / "slides")
            _update(lec["id"], n_slides=len(slides))
            console.print(f"    slide estratte: {len(slides)}")
        if src is not None:
            root = storage.media_root()
            if root is not None and src.resolve().is_relative_to(root.resolve()):
                _remember_video(ldir, "video", src)  # è già nell'archivio su Drive
            else:
                _dispose_video(src, ldir, "video", temporary=True)
            if old:
                with session() as db:
                    db.execute("DELETE FROM files WHERE id=?", (old["id"],))
        shutil.rmtree(tmp, ignore_errors=True)
        _update(lec["id"], status="media_ok", error=None)
        if whisper:
            transcript = ldir / "transcript.json"
            if not transcript.exists():
                console.print("    trascrizione Whisper (GPU)…")
                res = transcribe(audio, transcript, prompt=_glossary(course))
                console.print(f"    trascritta in {res['elapsed_s']:.0f}s: {len(res['segments'])} segmenti")
                _update(lec["id"], transcript_source="whisper", status="trascritta")
    except Exception as e:
        shutil.rmtree(tmp, ignore_errors=True)
        _update(lec["id"], status="errore", error=str(e)[:500])
        raise


def discover(sess: MoodleSession, course: dict) -> list[dict]:
    """Registra nel DB le registrazioni Panopto del corso (senza scaricare nulla)."""
    found = list_course_sessions(sess, course["id"])
    with session() as db:
        for s in found:
            num, date = _parse_title(s.title)
            prefix = f"L{num:02d}_" if num else ""
            folder = Path(course["folder"]) / "lezioni" / safe_name(f"{prefix}{date or ''}_{s.title}".replace("__", "_"), 70)
            db.execute(
                """INSERT INTO lectures (course_id, panopto_id, title, date, number, folder, viewer_url, updated_at)
                   VALUES (?,?,?,?,?,?,?,?)
                   ON CONFLICT(panopto_id) DO UPDATE SET title=excluded.title, viewer_url=excluded.viewer_url""",
                (course["id"], s.id, s.title, date, num, folder.as_posix(), s.viewer_url,
                 datetime.now().isoformat(timespec="seconds")),
            )
        return [dict(r) for r in db.execute(
            "SELECT * FROM lectures WHERE course_id=? ORDER BY date, number", (course["id"],))]


def _dispose_video(src: Path, ldir: Path, kind: str, temporary: bool) -> None:
    """Video già elaborato: con l'archivio su Drive si conserva lì (per guardarlo in streaming),
    altrimenti si cancella (policy leggera). I file locali tuoi non temporanei restano dove sono:
    li sposta su Drive `studyhub media-migrate`."""
    if not temporary:
        return
    dest = storage.cloud_path(ldir / f"{kind}.mp4")
    if dest is not None and storage.safe_move(src, dest) in ("spostato", "già presente"):
        _remember_video(ldir, kind, dest)
        console.print(f"    video archiviato su Drive: {dest.name}")
    else:
        src.unlink(missing_ok=True)


def _remember_video(ldir: Path, kind: str, path: Path) -> None:
    meta_file = ldir / "lezione.json"
    meta = json.loads(meta_file.read_text(encoding="utf-8")) if meta_file.exists() else {}
    meta.setdefault("video", {})[kind] = str(path)
    meta_file.write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")


def _local_sources(course: dict, title: str) -> dict[str, Path]:
    """File locali 'Titolo (1).mp4' / 'Titolo (2).mp4': quello con audio è la camera."""
    local = uni_path(course["folder"]) / "lezioni" / LOCAL_RECORDINGS
    out: dict[str, Path] = {}
    for d in (local, storage.cloud_path(local)):
        if d is None or not d.is_dir():
            continue
        for f in d.glob("*.mp4"):
            if f.stem.rsplit(" (", 1)[0].strip() == title.strip():
                info = ff.probe(f)
                out.setdefault("camera" if info["has_audio"] else "screen", f)
    return out


def _srt_to_segments(srt: str) -> list[dict]:
    segs = []
    for block in re.split(r"\n\s*\n", srt.strip()):
        lines = block.strip().splitlines()
        if len(lines) < 3 or "-->" not in lines[1]:
            continue
        a, b = (x.strip().replace(",", ".") for x in lines[1].split("-->"))
        to_s = lambda t: sum(float(p) * m for p, m in zip(t.split(":"), (3600, 60, 1)))
        text = " ".join(lines[2:]).replace("[Auto-generated transcript. Edits may have been applied for clarity.]", "").strip()
        if text:
            segs.append({"start": round(to_s(a), 2), "end": round(to_s(b), 2), "text": text})
    return segs


def _glossary(course: dict) -> str:
    with session() as db:
        names = [r[0] for r in db.execute(
            "SELECT name FROM modules WHERE course_id=? AND modname IN ('resource','folder','page') LIMIT 40",
            (course["id"],))]
    words = ", ".join(dict.fromkeys(n for n in names if n))[:500]
    return f"Lezione universitaria di {course['fullname']}. Argomenti: {words}."


def _update(lec_id: int, **fields) -> None:
    fields["updated_at"] = datetime.now().isoformat(timespec="seconds")
    with session() as db:
        db.execute(f"UPDATE lectures SET {', '.join(f'{k}=?' for k in fields)} WHERE id=?",
                   (*fields.values(), lec_id))


def process_lecture(lec: dict, course: dict, panopto: Panopto, whisper: bool = True) -> None:
    ldir = uni_path(lec["folder"])
    tmp = ldir / "_tmp"
    ldir.mkdir(parents=True, exist_ok=True)
    meta_file = ldir / "lezione.json"
    ps = PanoptoSession(lec["panopto_id"], lec["title"], lec["viewer_url"])
    local = _local_sources(course, lec["title"])
    streams = None
    langs: list[int] = []

    def ensure_info() -> None:
        """DeliveryInfo: URL dei flussi, metadati, e cookie Panopto validi (servono ai sottotitoli)."""
        nonlocal streams
        if streams is None:
            info = panopto.delivery_info(ps)
            streams = {("camera" if s.tag.lower() == "dv" else "screen"): s.url for s in panopto.streams(info)}
            langs[:] = info["Delivery"].get("AvailableLanguages") or []
            meta = {"panopto": info["Delivery"].get("SessionName"), "duration": info["Delivery"].get("Duration"),
                    "viewer_url": lec["viewer_url"]}
            meta_file.write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")

    def stream_url(kind: str) -> str:
        ensure_info()
        if kind not in streams:
            raise RuntimeError(f"Flusso '{kind}' non presente su Panopto")
        return streams[kind]

    def source(kind: str) -> tuple[Path, bool]:
        """(file, temporaneo?) – i file locali tuoi non sono mai temporanei."""
        if kind in local:
            console.print(f"    uso il file locale {local[kind].name}")
            return local[kind], False
        console.print(f"    scarico il flusso {kind} da Panopto…")
        return ff.download(stream_url(kind), tmp / f"{kind}.mp4"), True

    try:
        transcript = ldir / "transcript.json"
        if not transcript.exists():
            ensure_info()
            srt = panopto.captions(ps, langs) if langs else None
            if srt:
                segs = _srt_to_segments(srt)
                transcript.write_text(json.dumps({"source": "panopto", "segments": segs}, ensure_ascii=False),
                                      encoding="utf-8")
                _update(lec["id"], transcript_source="panopto")
                console.print(f"    sottotitoli Panopto: {len(segs)} segmenti")

        audio = ldir / "audio.opus"
        if not audio.exists():
            src, is_tmp = source("camera")
            extract_audio(src, audio)
            _dispose_video(src, ldir, "camera", is_tmp)
        if not (ldir / "silences.json").exists():
            detect_silences(audio, ldir / "silences.json")
        _update(lec["id"], has_audio=1, duration=ff.probe(audio)["duration"])

        if not (ldir / "slides.json").exists():
            src, is_tmp = source("screen")
            slides = extract_slides(src, ldir / "slides")
            _dispose_video(src, ldir, "screen", is_tmp)
            _update(lec["id"], n_slides=len(slides))
            console.print(f"    slide estratte: {len(slides)}")
        shutil.rmtree(tmp, ignore_errors=True)
        _update(lec["id"], status="media_ok", error=None)

        if whisper:
            cur = json.loads(transcript.read_text(encoding="utf-8")) if transcript.exists() else {}
            if cur.get("source") != "whisper":
                console.print("    trascrizione Whisper (GPU)…")
                res = transcribe(audio, transcript, prompt=_glossary(course),
                                 on_progress=lambda p: console.print(f"      {p:.0%}", end="\r"))
                console.print(f"    trascritta in {res['elapsed_s']:.0f}s: {len(res['segments'])} segmenti")
                _update(lec["id"], transcript_source="whisper", status="trascritta")
    except Exception as e:
        shutil.rmtree(tmp, ignore_errors=True)  # mai lasciare video temporanei in giro
        _update(lec["id"], status="errore", error=str(e)[:500])
        raise
