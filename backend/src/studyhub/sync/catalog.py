"""Elenco corsi Moodle e classificazione per anno.

`corsi.yaml` è la fonte di verità per la classificazione: lo generiamo con delle ipotesi,
tu lo correggi una volta, e i successivi aggiornamenti mantengono le tue modifiche.
"""
from __future__ import annotations

import re

import yaml

from ..config import settings
from ..db import session
from ..paths import folder_name
from .moodle import Moodle

USER_FIELDS = ("anno", "semestre", "superato", "attivo", "priorita", "cartella", "sync")


def _academic_year(*texts: str) -> str | None:
    for t in texts:
        m = re.search(r"(20\d\d)\s*[/-]\s*(?:20)?(\d\d)\b", t or "")
        if m:
            return f"{m.group(1)}/{m.group(2)}"
    return None


def _guess(course: dict) -> dict:
    name = course["fullname"]
    ay = _academic_year(name, course.get("shortname", ""), course.get("coursecategory", ""))
    year = None
    if ay:
        start_cur = int(settings.current_academic_year[:4])
        year = settings.current_year_of_study - (start_cur - int(ay[:4]))
        if not 1 <= year <= 5:
            year = None
    lowered = name.lower()
    # extra_active_courses (config.yaml): corsi di anni precedenti non ancora superati
    first_year_active = any(re.search(p, lowered) for p in settings.extra_active_courses)
    if first_year_active and year is None:
        year = 1
    superato = year is not None and year < settings.current_year_of_study and not first_year_active
    attivo = year == settings.current_year_of_study or first_year_active
    base = folder_name(name)
    if year is None:
        folder = f"_Da_classificare/{base}"
    elif superato:
        folder = f"{year}_Anno/_Superati/{base}"
    else:
        folder = f"{year}_Anno/{base}"
    return {
        "anno_accademico": ay, "anno": year, "semestre": None, "superato": superato,
        "attivo": attivo, "priorita": 1 if first_year_active else 0, "cartella": folder,
        "sync": attivo,
    }


def refresh_catalog(m: Moodle) -> list[dict]:
    courses = m.enrolled_courses()
    existing = {}
    if settings.courses_file.exists():
        data = yaml.safe_load(settings.courses_file.read_text(encoding="utf-8")) or {}
        existing = {c["id"]: c for c in data.get("corsi", [])}

    entries = []
    for c in courses:
        entry = {"id": c["id"], "nome": c["fullname"], "categoria": c.get("coursecategory"),
                 "url": c.get("viewurl"), **_guess(c)}
        if c["id"] in existing:  # le tue correzioni vincono sulle ipotesi
            entry.update({k: existing[c["id"]][k] for k in USER_FIELDS if k in existing[c["id"]]})
            entry["anno_accademico"] = existing[c["id"]].get("anno_accademico", entry["anno_accademico"])
        entries.append(entry)
    entries.sort(key=lambda e: (e["anno"] or 99, e["superato"], e["nome"]))

    header = ("# Classificazione dei corsi Moodle. Correggi anno/superato/attivo/cartella se serve;\n"
              "# metti sync: true sui corsi da scaricare. Le tue modifiche vengono mantenute.\n")
    settings.courses_file.write_text(
        header + yaml.safe_dump({"corsi": entries}, allow_unicode=True, sort_keys=False, width=120),
        encoding="utf-8",
    )
    apply_catalog()
    return entries


def load_catalog() -> list[dict]:
    if not settings.courses_file.exists():
        return []
    return (yaml.safe_load(settings.courses_file.read_text(encoding="utf-8")) or {}).get("corsi", [])


def apply_catalog() -> None:
    with session() as db:
        for e in load_catalog():
            db.execute(
                """INSERT INTO courses (id, fullname, category, academic_year, year_of_study, semester,
                                        passed, active, priority, folder, url)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?)
                   ON CONFLICT(id) DO UPDATE SET fullname=excluded.fullname, category=excluded.category,
                     academic_year=excluded.academic_year, year_of_study=excluded.year_of_study,
                     semester=excluded.semester, passed=excluded.passed, active=excluded.active,
                     priority=excluded.priority, folder=excluded.folder, url=excluded.url""",
                (e["id"], e["nome"], e.get("categoria"), e.get("anno_accademico"), e.get("anno"),
                 e.get("semestre"), int(bool(e.get("superato"))), int(bool(e.get("attivo"))),
                 e.get("priorita") or 0, e.get("cartella"), e.get("url")),
            )
