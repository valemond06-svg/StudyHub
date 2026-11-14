"""Dati leggeri per il pannello «Coda AI e turno di notte»: solo query SQL e file locali.

Mai sync, mai chiamate a LLM o Claude: deve rispondere in meno di un secondo.
"""
from __future__ import annotations

import json
import time

from .. import turno
from .. import config
from ..db import session
from . import jobs
from .claude_runner import last_usage

MAX_MSG = 200


def _coda() -> dict:
    with session() as db:
        per_stato = {r[0]: r[1] for r in db.execute("SELECT status, COUNT(*) FROM ai_jobs GROUP BY status")}
        per_tipo = {r[0]: r[1] for r in db.execute(
            "SELECT kind, COUNT(*) FROM ai_jobs WHERE status IN ('in_coda','in_corso') GROUP BY kind")}
        titoli = """CASE j.kind WHEN 'ocr' THEN COALESCE(d.title, d.path) ELSE l.title END"""
        join = ("FROM ai_jobs j LEFT JOIN lectures l ON j.kind='lecture_notes' AND l.id=j.target_id "
                "LEFT JOIN documents d ON j.kind='ocr' AND d.id=j.target_id")
        errori = [{"id": r["id"], "kind": r["kind"], "titolo": r["titolo"],
                   "messaggio": (r["message"] or "")[:MAX_MSG], "data": r["finished_at"]}
                  for r in db.execute(f"SELECT j.id, j.kind, j.message, j.finished_at, {titoli} AS titolo {join} "
                                      "WHERE j.status='errore' ORDER BY j.id DESC LIMIT 5")]
        in_corso = [{"id": r["id"], "kind": r["kind"], "titolo": r["titolo"], "avviato": r["started_at"]}
                    for r in db.execute(f"SELECT j.id, j.kind, j.started_at, {titoli} AS titolo {join} "
                                        "WHERE j.status='in_corso' ORDER BY j.id")]
    return {"per_stato": per_stato, "per_tipo": per_tipo, "ultimi_errori": errori, "in_corso": in_corso}


def _arretrati() -> dict:
    with session() as db:
        senza_appunti = len(jobs.backlog_candidates())
        da_trascrivere = db.execute("SELECT COUNT(*) FROM lectures WHERE status='media_ok'").fetchone()[0]
        nuove = db.execute(
            "SELECT s.kind, EXISTS (SELECT 1 FROM ai_outputs o WHERE o.kind='lecture_notes' AND o.target_id=s.ref_id) "
            "FROM study_units s WHERE s.status='nuova'").fetchall()
    lezioni_attesa = sum(1 for k, ha in nuove if k == "lezione" and not ha)
    return {"trascritte_senza_appunti": senza_appunti, "da_trascrivere": da_trascrivere,
            "unita_nuove": len(nuove) - lezioni_attesa, "unita_lezione_attesa_sonnet": lezioni_attesa}


def _finestra() -> dict:
    u = last_usage()
    util, resets, soglia = u.get("utilization"), u.get("resets_at"), jobs.backlog_stop_at()
    attiva = bool(resets and resets > time.time())
    in_pausa = bool(util is not None and util >= soglia and attiva)
    return {"claude_backlog": jobs.backlog_enabled(), "uso_pct": None if util is None else round(util * 100),
            "soglia_pct": round(soglia * 100), "arretrati_in_pausa": in_pausa,
            "reset_alle": resets if attiva else None,
            "coda_in_pausa": jobs.state.get("paused_reason")}


def _notte() -> dict:
    try:
        ultimo = json.loads((config.LOCAL_DIR / "notte_ultimo.json").read_text(encoding="utf-8"))
    except Exception:
        ultimo = None
    try:
        in_corso = turno.notte_attiva()
    except Exception:
        in_corso = False
    return {"in_corso": in_corso, "ultimo": ultimo}


def dati() -> dict:
    return {"coda": _coda(), "arretrati": _arretrati(), "finestra": _finestra(), "notte": _notte()}
