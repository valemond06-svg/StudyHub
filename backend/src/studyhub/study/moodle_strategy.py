"""Strategia di Selezione e Download Adattivo dei Contenuti Moodle per Corso.

Analizza i contenuti Moodle di ogni corso e seleziona in modo intelligente:
- TIER 1: Contenuti critici per l'esame (appelli, soluzioni, laboratori, codice, homework svolti, slide ufficiali).
- TIER 2: Materiali di supporto (trascrizioni, formulari, note di approfondimento).
- TIER 3 (Esclusi): Rumore informativo (avvisi aule, assemblee, link Zoom scaduti, forum generici).
"""
from __future__ import annotations

import re
from dataclasses import asdict, dataclass
from typing import Any

from ..db import session
from .archetype import get_course_archetype


@dataclass
class ContentStrategyItem:
    doc_id: int
    title: str
    category: str
    path: str
    tier: int  # 1 = Critico Esame, 2 = Supporto, 3 = Escluso/Bassa priorità
    motivo: str
    adattamento_didattico: str


@dataclass
class CourseMoodleStrategy:
    course_id: int
    course_name: str
    archetype_id: str
    archetype_title: str
    archetype_badge: str
    download_policy_summary: str
    exam_prep_focus: str
    total_docs: int
    tier1_count: int
    tier2_count: int
    tier3_count: int
    selected_items: list[dict[str, Any]]
    rules_applied: list[str]


def evaluate_course_moodle_strategy(course_id: int) -> CourseMoodleStrategy:
    """Valuta tutti i documenti di un corso e applica la strategia adattiva di download e studio."""
    with session() as db:
        c_row = db.execute("SELECT fullname FROM courses WHERE id=?", (course_id,)).fetchone()
        course_name = c_row[0] if c_row else "Corso"
        
        docs = db.execute("""
            SELECT d.id, d.title, d.path, d.kind, dt.category,
                   (SELECT text FROM chunks c WHERE c.doc_id=d.id ORDER BY c.page, c.id LIMIT 1) AS snippet
            FROM documents d
            LEFT JOIN doc_tags dt ON dt.doc_id = d.id
            WHERE d.course_id = ?
            ORDER BY d.id
        """, (course_id,)).fetchall()

    arch = get_course_archetype(course_id, course_name)
    items: list[ContentStrategyItem] = []

    for r in docs:
        did, title, path, kind, cat, snippet = r
        title = title or path.rsplit("/", 1)[-1]
        cat = cat or "materiale"
        low_path = path.lower()
        low_title = title.lower()

        # Verifica se corrisponde a pattern da ignorare
        is_ignored = any(re.search(pat, low_path) or re.search(pat, low_title) for pat in arch.moodle_ignored_patterns)
        
        if is_ignored:
            tier = 3
            motivo = "Avviso organizzativo o contenuto amministrativo non rilevante ai fini della prova d'esame"
            adattamento = "Escluso dall'ingestione didattica per non inquinare i prompt dell'AI"
        elif cat in ("appello", "soluzione"):
            tier = 1
            motivo = "Tema d'esame o soluzione ufficiale: fondamentale per estrarre la frequenza degli argomenti"
            adattamento = "Usato dal Profilo d'Esame e per generare gli esempi da esame svolti passo-passo"
        elif cat == "codice" or low_path.endswith((".m", ".c", ".h", ".py", ".cir", ".dat", ".mat")):
            tier = 1
            motivo = f"Codice sorgente / dataset pratico ({arch.software_default}): core della prova pratica"
            adattamento = f"Integrato nel blocco Laboratorio Pratico con syntax highlighting e download diretto"
        elif cat == "esercizi" or re.search(r"hw|homework|eserciz|lab\d", low_path):
            tier = 1
            motivo = "Esercitazione o compito con soluzioni assegnato durante il corso"
            adattamento = "Fonte primaria per le sfide interattive e le verifiche a risposta multipla"
        elif cat in ("programma", "regole_esame", "calendario"):
            tier = 1
            motivo = "Regole d'esame, programma e diario lezioni ufficiale del docente"
            adattamento = "Definisce l'ordine didattico dei capitoli e i vincoli di sbarramento della prova"
        elif cat == "slide":
            tier = 1
            motivo = "Slide ufficiali delle lezioni: struttura concettuale di riferimento"
            adattamento = "Fornisce definizioni formali, teoremi chiave e grafici di base"
        elif cat in ("formulario", "appunti"):
            tier = 2
            motivo = "Formulario di consultazione o appunti delle lezioni"
            adattamento = "Usato per arricchire la sezione 'Da sapere a memoria' e formule chiave"
        elif cat == "trascrizione":
            tier = 2
            motivo = "Trascrizione del parlato del docente"
            adattamento = "Estratte intuizioni verbali, analogie ed enfasi su cosa viene chiesto all'esame"
        else:
            tier = 2
            motivo = "Materiale didattico generale di supporto"
            adattamento = "Consultazione contestuale per le risposte del tutor"

        items.append(ContentStrategyItem(
            doc_id=did,
            title=title,
            category=cat,
            path=path,
            tier=tier,
            motivo=motivo,
            adattamento_didattico=adattamento
        ))

    t1 = sum(1 for it in items if it.tier == 1)
    t2 = sum(1 for it in items if it.tier == 2)
    t3 = sum(1 for it in items if it.tier == 3)

    rules = [
        f"Priorità TIER 1 assegnata ad appelli, soluzioni, codice ({arch.file_extension}), esercitazioni e slide ufficiali.",
        f"Esclusione TIER 3 per {len(arch.moodle_ignored_patterns)} pattern di rumore organizzativo ({', '.join(arch.moodle_ignored_patterns)}).",
        f"Adattamento epistemologico orientato a: {arch.title} ({arch.software_default}).",
        f"Target d'esame: {arch.exam_format_summary}"
    ]

    return CourseMoodleStrategy(
        course_id=course_id,
        course_name=course_name,
        archetype_id=arch.archetype_id,
        archetype_title=arch.title,
        archetype_badge=arch.badge,
        download_policy_summary=f"Download selettivo intelligente ({t1} critici esame, {t2} supporto, {t3} esclusi).",
        exam_prep_focus=arch.exam_format_summary,
        total_docs=len(items),
        tier1_count=t1,
        tier2_count=t2,
        tier3_count=t3,
        selected_items=[asdict(it) for it in items[:60]],  # Primi 60 per panoramica immediata
        rules_applied=rules
    )
