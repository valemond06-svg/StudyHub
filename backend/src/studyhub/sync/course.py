"""Sync completo di un corso Moodle nella cartella `<corso>/moodle/`.

`moodle/` è gestita dall'app: rispecchia il corso (una cartella per sezione, pagine in .md,
allegati originali). I file aggiornati su Moodle vengono riscaricati al loro posto.
"""
from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from datetime import datetime
from html import unescape
from pathlib import Path
from urllib.parse import unquote, urlsplit, urlunsplit

from markdownify import markdownify
from rich.console import Console

from ..db import session
from ..paths import ensure_course_dirs, rel_to_uni, safe_name, uni_path
from .moodle import Moodle, MoodleError

console = Console()
PANOPTO_RE = re.compile(r"https?://[^\s\"'<>]*panopto[^\s\"'<>]*", re.I)
SKIP_CONTENT_MODS = {"label"}  # niente file, solo testo nella sezione
VIDEO_EXT = {".mp4", ".m4v", ".mov", ".mkv", ".webm", ".avi"}


@dataclass
class SyncReport:
    new_files: int = 0
    updated_files: int = 0
    skipped_files: int = 0
    media_found: int = 0
    errors: list[str] = field(default_factory=list)
    new_paths: list[str] = field(default_factory=list)


def html_to_md(html: str | None) -> str:
    if not html or not html.strip():
        return ""
    md = markdownify(html, heading_style="ATX", bullets="-")
    return re.sub(r"\n{3,}", "\n\n", md).strip()


def _clean_url(url: str) -> str:
    """URL senza token/forcedownload: è la chiave stabile del file nel DB."""
    parts = urlsplit(url)
    query = "&".join(q for q in parts.query.split("&") if q and not q.startswith(("token=", "forcedownload=")))
    return urlunsplit((parts.scheme, parts.netloc, parts.path.replace("/webservice/pluginfile.php", "/pluginfile.php"),
                       query, ""))


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


class CourseSync:
    def __init__(self, m: Moodle, course: dict):
        self.m = m
        self.course = course
        self.root = uni_path(course["folder"])
        self.mdir = self.root / "moodle"
        self.report = SyncReport()
        self.db = None

    # --- file ------------------------------------------------------------------

    def _record(self, content: dict, dest: Path, module_id: int | None, key: str, mime: str | None) -> None:
        self.db.execute(
            """INSERT INTO files (course_id, module_id, source_url, path, size, timemodified, sha256, mime, downloaded_at)
               VALUES (?,?,?,?,?,?,?,?,?)
               ON CONFLICT(source_url) DO UPDATE SET path=excluded.path, size=excluded.size,
                 timemodified=excluded.timemodified, sha256=excluded.sha256, mime=excluded.mime,
                 downloaded_at=excluded.downloaded_at""",
            (self.course["id"], module_id, key, rel_to_uni(dest), content.get("filesize"),
             content.get("timemodified"), _sha256(dest), mime, datetime.now().isoformat(timespec="seconds")),
        )
        self.db.commit()  # file per file: se il sync si interrompe, quanto già scaricato resta registrato

    def _fetch_file(self, content: dict, dest: Path, module_id: int | None) -> Path:
        key = _clean_url(content["fileurl"])
        row = self.db.execute("SELECT * FROM files WHERE source_url=?", (key,)).fetchone()
        if row:
            dest = uni_path(row["path"])  # percorso stabile tra un sync e l'altro
            if (dest.exists() and row["timemodified"] == content.get("timemodified")
                    and row["size"] == content.get("filesize")):
                self.report.skipped_files += 1
                return dest
        elif (dest.exists() and content.get("filesize") and dest.stat().st_size == content["filesize"]
              and not self.db.execute("SELECT 1 FROM files WHERE path=?", (rel_to_uni(dest),)).fetchone()):
            # Già sul disco ma non nel DB (es. sync interrotto): si adotta invece di riscaricarlo come "(2)".
            self._record(content, dest, module_id, key, content.get("mimetype"))
            self.report.skipped_files += 1
            return dest
        else:
            dest = self._unique(dest)
        try:
            resp = self.m.download(content["fileurl"], dest)
        except Exception as e:  # un file rotto non deve fermare il corso
            self.report.errors.append(f"{dest.name}: {e}")
            return dest
        self._record(content, dest, module_id, key, resp.headers.get("content-type"))
        if row:
            self.report.updated_files += 1
        else:
            self.report.new_files += 1
            self.report.new_paths.append(rel_to_uni(dest))
        console.print(f"  [green]↓[/] {rel_to_uni(dest)}")
        return dest

    def _unique(self, dest: Path) -> Path:
        taken = {r[0] for r in self.db.execute("SELECT path FROM files WHERE course_id=?", (self.course["id"],))}
        candidate, i = dest, 2
        while candidate.exists() or rel_to_uni(candidate) in taken:
            candidate = dest.with_name(f"{dest.stem} ({i}){dest.suffix}")
            i += 1
        return candidate

    # --- media -----------------------------------------------------------------

    def _media(self, url: str, kind: str, title: str, module_id: int | None) -> None:
        cur = self.db.execute(
            "INSERT OR IGNORE INTO media_sources (course_id, module_id, kind, url, title) VALUES (?,?,?,?,?)",
            (self.course["id"], module_id, kind, url, title),
        )
        self.report.media_found += cur.rowcount

    def _scan_panopto(self, html: str | None, title: str, module_id: int | None) -> None:
        for url in set(PANOPTO_RE.findall(html or "")):
            self._media(url.rstrip(").,;"), "panopto_link", title, module_id)

    # --- moduli ----------------------------------------------------------------

    def _page_like(self, mod: dict, base: Path) -> Path:
        """page/book: index.html (uno o più capitoli) + immagini → Markdown con link locali."""
        files_dir = base / f"{safe_name(mod['name'], 60)}_files"
        locals_by_name: dict[str, Path] = {}
        htmls = []
        for c in mod.get("contents", []):
            if c.get("type") != "file":
                continue
            if c["filename"] == "index.html":
                htmls.append(c)
            else:
                sub = files_dir / safe_name(c.get("filepath", "/").strip("/") or ".", 40)
                locals_by_name[c["filename"]] = self._fetch_file(c, sub / safe_name(c["filename"]), mod["id"])
        chapters = []
        for c in sorted(htmls, key=lambda c: c.get("filepath", "")):
            try:
                html = self.m.get_text(c["fileurl"])
            except Exception as e:
                self.report.errors.append(f"{mod['name']}: {e}")
                continue
            self._scan_panopto(html, mod["name"], mod["id"])
            md = html_to_md(html)
            for name, path in locals_by_name.items():
                rel = path.relative_to(base).as_posix()
                md = re.sub(r"\]\([^)]*?" + re.escape(name) + r"[^)]*\)", f"]({rel})", md)
                md = re.sub(r"\]\([^)]*?" + re.escape(name.replace(" ", "%20")) + r"[^)]*\)", f"]({rel})", md)
            chapters.append(md)
        out = base / f"{safe_name(mod['name'], 70)}.md"
        out.write_text(f"# {mod['name']}\n\n" + "\n\n---\n\n".join(chapters) + "\n", encoding="utf-8")
        return out

    def _module(self, mod: dict, sdir: Path, section_id: int, lines: list[str]) -> None:
        modname = mod.get("modname")
        desc_md = html_to_md(mod.get("description"))
        self.db.execute(
            """INSERT INTO modules (id, course_id, section_id, modname, name, url, description_md, visible)
               VALUES (?,?,?,?,?,?,?,?)
               ON CONFLICT(id) DO UPDATE SET section_id=excluded.section_id, modname=excluded.modname,
                 name=excluded.name, url=excluded.url, description_md=excluded.description_md,
                 visible=excluded.visible""",
            (mod["id"], self.course["id"], section_id, modname, mod["name"], mod.get("url"), desc_md,
             mod.get("visible", 1)),
        )
        self._scan_panopto(mod.get("description"), mod["name"], mod["id"])

        if modname == "label":
            if desc_md:
                lines.append(desc_md)
            return

        entry = f"- **{mod['name']}** ({modname})"
        files = [c for c in mod.get("contents", []) if c.get("type") == "file"]

        if modname in ("page", "book"):
            out = self._page_like(mod, sdir)
            entry += f" → [{out.name}]({out.name.replace(' ', '%20')})"
        elif modname == "url":
            ext = next((c.get("fileurl") for c in mod.get("contents", []) if c.get("type") == "url"), None)
            if ext:
                entry += f" → <{ext}>"
                if "panopto" in ext.lower():
                    self._media(ext, "panopto_link", mod["name"], mod["id"])
        elif modname == "lti":
            # Spesso è il collegamento Panopto del corso: lo elabora la Fase 2.
            self._media(mod.get("url", ""), "lti", mod["name"], mod["id"])
            entry += " → strumento esterno (registrato per la Fase 2)"
        elif files:
            # I video caricati su Moodle NON si scaricano qui: diventano lezioni e passano dalla pipeline
            # atomica (audio + slide, poi il .mp4 si cancella), come le registrazioni Panopto.
            videos = [c for c in files if Path(c["filename"]).suffix.lower() in VIDEO_EXT]
            for c in videos:
                self._media(_clean_url(c["fileurl"]), "moodle_video", mod["name"], mod["id"])
            files = [c for c in files if c not in videos]
            if videos:
                entry += f" → 🎬 registrazione ({len(videos)} video, elaborati in lezioni/)"
            # resource, folder, assign, ecc.: alberatura per filepath.
            base = sdir if modname == "resource" and len(files) == 1 else sdir / safe_name(mod["name"], 60)
            saved = []
            for c in files:
                sub = [safe_name(p, 50) for p in c.get("filepath", "/").strip("/").split("/") if p]
                dest = base.joinpath(*sub, safe_name(unquote(c["filename"])))
                saved.append(self._fetch_file(c, dest, mod["id"]))
            if saved:
                links = ", ".join(f"[{p.name}]({p.relative_to(sdir).as_posix().replace(' ', '%20')})" for p in saved)
                entry += f" → {links}"
        lines.append(entry)
        if desc_md:
            lines.append("  " + desc_md.replace("\n", "\n  "))

    # --- avvisi ----------------------------------------------------------------

    def _announcements(self) -> None:
        try:
            forums = self.m.ws("mod_forum_get_forums_by_courses", courseids=[self.course["id"]])
        except MoodleError as e:
            self.report.errors.append(f"avvisi: {e}")
            return
        parts = []
        for forum in forums:
            if forum.get("type") != "news":
                continue
            for d in self.m.news_discussions(forum["id"]):
                when = datetime.fromtimestamp(d.get("created") or d.get("timemodified", 0)).strftime("%d/%m/%Y")
                parts.append(f"## {d.get('name') or d.get('subject')} — {when}\n\n{html_to_md(d.get('message'))}")
                self._scan_panopto(d.get("message"), d.get("name", ""), None)
        if parts:
            (self.mdir / "_avvisi.md").write_text("# Avvisi\n\n" + "\n\n---\n\n".join(parts) + "\n", encoding="utf-8")

    # --- corso -----------------------------------------------------------------

    def run(self) -> SyncReport:
        ensure_course_dirs(self.root)
        sections = self.m.course_contents(self.course["id"])
        for sec in sections:  # i nomi arrivano con entità HTML (es. "Esercitazioni 1&amp;2")
            sec["name"] = unescape(sec.get("name") or "")
            for mod in sec.get("modules", []):
                mod["name"] = unescape(mod.get("name") or "")
        (self.mdir / "_corso.json").write_text(json.dumps(sections, ensure_ascii=False, indent=1), encoding="utf-8")
        with session() as self.db:
            started = datetime.now().isoformat(timespec="seconds")
            index = [f"# {self.course['fullname']}\n", f"Sincronizzato: {started}\n"]
            for sec in sections:
                num = sec.get("section", 0)
                title = sec.get("name") or f"Sezione {num}"
                sdir = self.mdir / f"{num:02d}_{safe_name(title, 50)}"
                summary = html_to_md(sec.get("summary"))
                self.db.execute(
                    """INSERT INTO sections (id, course_id, number, name, summary_md, folder) VALUES (?,?,?,?,?,?)
                       ON CONFLICT(id) DO UPDATE SET number=excluded.number, name=excluded.name,
                         summary_md=excluded.summary_md, folder=excluded.folder""",
                    (sec["id"], self.course["id"], num, title, summary, rel_to_uni(sdir)),
                )
                self._scan_panopto(sec.get("summary"), title, None)
                if not summary and not sec.get("modules"):
                    continue
                sdir.mkdir(parents=True, exist_ok=True)
                lines = [f"# {title}", summary] if summary else [f"# {title}"]
                for mod in sec.get("modules", []):
                    try:
                        self._module(mod, sdir, sec["id"], lines)
                    except Exception as e:
                        self.report.errors.append(f"{mod.get('name')}: {e}")
                (sdir / "_sezione.md").write_text("\n\n".join(lines) + "\n", encoding="utf-8")
                index.append(f"- [{title}]({sdir.name.replace(' ', '%20')}/_sezione.md) — {len(sec.get('modules', []))} elementi")
            self._announcements()
            (self.mdir / "INDICE.md").write_text("\n".join(index) + "\n", encoding="utf-8")
            r = self.report
            self.db.execute("UPDATE courses SET last_sync=? WHERE id=?", (started, self.course["id"]))
            self.db.execute(
                "INSERT INTO sync_runs (course_id, started_at, finished_at, new_files, updated_files, errors) VALUES (?,?,?,?,?,?)",
                (self.course["id"], started, datetime.now().isoformat(timespec="seconds"), r.new_files,
                 r.updated_files, json.dumps(r.errors, ensure_ascii=False)),
            )
        return self.report
