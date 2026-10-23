"""Export: PDF (appunti di una lezione, dispensa del corso) e mazzi Anki (.apkg).

I PDF si generano con il Chromium di Playwright già installato: stesso rendering Markdown + KaTeX
del player, quindi le formule escono identiche. Tutto offline.
"""
from __future__ import annotations

import html
import json
import re
from datetime import date
from pathlib import Path

from .config import LOCAL_DIR
from .db import session
from .paths import safe_name, uni_path

VENDOR = Path(__file__).parent / "api" / "static" / "vendor"

_PAGE = """<!doctype html><html lang="it"><head><meta charset="utf-8">
<link rel="stylesheet" href="{katex_css}">
<style>
  body {{ font: 10.5pt/1.5 "Segoe UI", system-ui, sans-serif; color: #1d1d1f; }}
  h1 {{ font-size: 18pt; margin: 0 0 4pt; }} h2 {{ font-size: 13pt; margin-top: 16pt; border-bottom: 1px solid #ddd; padding-bottom: 2pt; }}
  h3 {{ font-size: 11pt; }} h1, h2, h3 {{ break-after: avoid; }}
  .lezione {{ break-before: page; }} .lezione:first-of-type {{ break-before: auto; }}
  .katex-display {{ overflow: hidden; }} details {{ margin: 2pt 0 6pt; }} summary {{ color: #666; }}
  details > *:not(summary) {{ display: block; }}
  code {{ font-size: 9pt; }} table {{ border-collapse: collapse; }} td, th {{ border: 1px solid #ccc; padding: 2pt 4pt; }}
  .cover {{ text-align: center; margin-top: 30vh; }} .cover h1 {{ font-size: 26pt; }}
  .toc li {{ margin: 2pt 0; }}
</style>
<script src="{katex_js}"></script><script src="{marked_js}"></script></head>
<body><div id="out"></div>
<script>
const parts = {parts};
function renderMd(md) {{
  const math = [];
  const keep = (tex, display) => {{ math.push({{ tex, display }}); return "\\u0000" + (math.length - 1) + "\\u0000"; }};
  md = md.replace(/\\$\\$([\\s\\S]+?)\\$\\$/g, (_, t) => keep(t, true)).replace(/\\$([^\\n$]+?)\\$/g, (_, t) => keep(t, false));
  return marked.parse(md, {{ mangle: false, headerIds: false }}).replace(/\\u0000(\\d+)\\u0000/g, (_, i) =>
    katex.renderToString(math[i].tex, {{ displayMode: math[i].display, throwOnError: false }}));
}}
const out = document.getElementById("out");
for (const p of parts) {{
  const sec = document.createElement("section"); sec.className = p.cls || "";
  sec.innerHTML = p.html != null ? p.html : renderMd(p.md);
  sec.querySelectorAll("details").forEach((d) => d.open = true);  // nel PDF le risposte si vedono
  out.append(sec);
}}
window.__done = true;
</script></body></html>"""


def _pdf(parts: list[dict], dest: Path, title: str) -> Path:
    from playwright.sync_api import sync_playwright
    tmp_dir = LOCAL_DIR / "cache" / "print"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    page_file = tmp_dir / "page.html"
    page_file.write_text(_PAGE.format(katex_css=(VENDOR / "katex" / "katex.min.css").as_uri(),
                                      katex_js=(VENDOR / "katex" / "katex.min.js").as_uri(),
                                      marked_js=(VENDOR / "marked.min.js").as_uri(),
                                      parts=json.dumps(parts, ensure_ascii=False)), encoding="utf-8")
    dest.parent.mkdir(parents=True, exist_ok=True)
    footer = (f"<div style='font-size:7pt;color:#888;width:100%;padding:0 12mm;display:flex;justify-content:space-between'>"
              f"<span>{html.escape(title)}</span><span><span class='pageNumber'></span> / <span class='totalPages'></span></span></div>")
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.goto(page_file.as_uri())
        page.wait_for_function("window.__done === true", timeout=60000)
        page.wait_for_timeout(300)  # font KaTeX
        page.pdf(path=str(dest), format="A4", print_background=True, display_header_footer=True,
                 header_template="<span></span>", footer_template=footer,
                 margin={"top": "14mm", "bottom": "16mm", "left": "14mm", "right": "14mm"})
        browser.close()
    return dest


def _latest_notes(db, course_id: int) -> list[tuple[dict, str]]:
    rows = db.execute(
        """SELECT a.*, l.date, l.number, l.title FROM ai_outputs a JOIN lectures l ON l.id=a.target_id
           WHERE a.kind='lecture_notes' AND a.course_id=? ORDER BY a.id""", (course_id,)).fetchall()
    latest = {}
    for r in rows:
        latest[r["target_id"]] = dict(r)
    out = []
    for r in sorted(latest.values(), key=lambda r: (r["date"] or "", r["number"] or 0)):
        p = uni_path(r["md_path"])
        if p.exists():
            out.append((r, p.read_text(encoding="utf-8")))
    return out


def lecture_pdf(lecture_id: int) -> Path:
    with session() as db:
        row = db.execute("""SELECT a.md_path, l.title FROM ai_outputs a JOIN lectures l ON l.id=a.target_id
                            WHERE a.kind='lecture_notes' AND a.target_id=? ORDER BY a.id DESC LIMIT 1""",
                         (lecture_id,)).fetchone()
    if not row:
        raise ValueError("Questa lezione non ha ancora gli appunti AI.")
    md_path = uni_path(row["md_path"])
    return _pdf([{"md": md_path.read_text(encoding="utf-8")}], md_path.with_suffix(".pdf"), row["title"])


def course_pdf(course_id: int) -> Path:
    """Dispensa del corso: copertina, indice, profilo d'esame (se c'è) e appunti di tutte le lezioni."""
    with session() as db:
        course = dict(db.execute("SELECT * FROM courses WHERE id=?", (course_id,)).fetchone())
        notes = _latest_notes(db, course_id)
    profile = uni_path(course["folder"]) / "studio_ai" / "profilo_esame.md"
    if not notes and not profile.exists():
        raise ValueError("Niente da esportare: genera prima gli appunti di qualche lezione o il profilo d'esame.")
    name = re.sub(r"\s*\(20\d\d/20\d\d\)", "", course["fullname"])
    toc = "".join(f"<li>{html.escape(r['title'])} — {html.escape(md.splitlines()[0].lstrip('# '))}</li>" for r, md in notes)
    parts = [{"html": f"<div class='cover'><h1>{html.escape(name)}</h1><p>Dispensa StudyHub · {date.today():%d/%m/%Y}</p>"
                      f"<p>{len(notes)} lezioni</p></div>"},
             {"cls": "lezione", "html": f"<h1>Indice</h1><ol class='toc'>{toc}</ol>"}]
    if profile.exists():
        parts.append({"cls": "lezione", "md": profile.read_text(encoding="utf-8")})
    parts += [{"cls": "lezione", "md": md} for _r, md in notes]
    dest = uni_path(course["folder"]) / "studio_ai" / f"Dispensa_{safe_name(name, 60).replace(' ', '_')}.pdf"
    return _pdf(parts, dest, name)


# --- Anki --------------------------------------------------------------------------

def to_anki_html(text: str) -> str:
    """Markdown minimale → HTML per Anki; LaTeX $…$/$$…$$ → MathJax \\(…\\) / \\[…\\]."""
    math: list[str] = []

    def keep(m: re.Match, display: bool) -> str:
        math.append(("\\[" if display else "\\(") + m.group(1) + ("\\]" if display else "\\)"))
        return f"\x00{len(math) - 1}\x00"

    text = re.sub(r"\$\$([\s\S]+?)\$\$", lambda m: keep(m, True), text)
    text = re.sub(r"\$([^\n$]+?)\$", lambda m: keep(m, False), text)
    text = html.escape(text)
    text = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", text)
    text = re.sub(r"(?<!\*)\*(?!\s)(.+?)(?<!\s)\*(?!\*)", r"<i>\1</i>", text)
    text = text.replace("\n", "<br>")
    return re.sub(r"\x00(\d+)\x00", lambda m: html.escape(math[int(m.group(1))], quote=False), text)


def anki_apkg(course_id: int | None = None) -> Path:
    import genanki
    with session() as db:
        sql = """SELECT f.id, f.front, f.back, f.course_id, c.fullname, l.title AS lecture FROM flashcards f
                 LEFT JOIN courses c ON c.id=f.course_id LEFT JOIN lectures l ON l.id=f.lecture_id WHERE f.suspended=0"""
        rows = db.execute(sql + (" AND f.course_id=?" if course_id is not None else ""),
                          [course_id] if course_id is not None else []).fetchall()
    if not rows:
        raise ValueError("Nessuna flashcard da esportare.")
    model = genanki.Model(
        1607392319, "StudyHub",
        fields=[{"name": "Fronte"}, {"name": "Retro"}, {"name": "Fonte"}],
        templates=[{"name": "Carta", "qfmt": "{{Fronte}}",
                    "afmt": "{{FrontSide}}<hr id=answer>{{Retro}}<div style='color:#888;font-size:12px;margin-top:10px'>{{Fonte}}</div>"}])
    decks: dict[int, genanki.Deck] = {}
    for r in rows:
        cname = re.sub(r"\s*\(20\d\d/20\d\d\)", "", r["fullname"] or "StudyHub")
        if r["course_id"] not in decks:
            decks[r["course_id"]] = genanki.Deck(1_900_000_000 + abs(r["course_id"]) % 100_000_000, f"StudyHub::{cname}")
        decks[r["course_id"]].add_note(genanki.Note(
            model=model, fields=[to_anki_html(r["front"]), to_anki_html(r["back"]), html.escape(r["lecture"] or "")],
            guid=genanki.guid_for("studyhub", r["id"])))  # stessa carta = stesso guid: reimportare aggiorna
    out_dir = LOCAL_DIR / "cache" / "export"
    out_dir.mkdir(parents=True, exist_ok=True)
    dest = out_dir / (f"StudyHub_{course_id}.apkg" if course_id is not None else "StudyHub.apkg")
    genanki.Package(list(decks.values())).write_to_file(str(dest))
    return dest
