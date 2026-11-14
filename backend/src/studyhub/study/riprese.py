"""Ripresa automatica (P1.3) di lezioni in `errore` e unità di studio `vuota`/`errore`.

Ogni fallimento incrementa `attempts` e fissa `next_retry_at = adesso + backoff`. Dopo `MAX_*` riprese il
campo resta NULL e lo stato resta com'è: serve un intervento manuale. Un successo azzera i contatori.
`attempts` conta i fallimenti: il 1° fallimento si riprova dopo 1 h, il 2° dopo 6 h, il 3° dopo 24 h
(3 riprese al massimo); dal 4° fallimento in poi nessuna ripresa automatica.
Le righe già in errore prima della migrazione hanno attempts=0 e next_retry_at NULL: contano come scadute
e vengono riprese subito, una volta.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta

from ..db import session
from ..paths import uni_path

BACKOFF_ORE = (1, 6, 24)
MAX_ATTEMPTS_LEZIONI = 3
MAX_ATTEMPTS_UNITA = 3
_MAX = {"lectures": MAX_ATTEMPTS_LEZIONI, "study_units": MAX_ATTEMPTS_UNITA}


def _ora(dt: datetime | None = None) -> str:
    return (dt or datetime.now()).isoformat(timespec="seconds")


def prossimo_tentativo(attempts: int, table: str, adesso: datetime | None = None) -> str | None:
    """next_retry_at dopo il fallimento numero `attempts` (1-based); None oltre il massimo."""
    if attempts > _MAX[table] or attempts < 1:
        return None
    ore = BACKOFF_ORE[min(attempts, len(BACKOFF_ORE)) - 1]
    return _ora((adesso or datetime.now()) + timedelta(hours=ore))


def segna_fallita(table: str, row_id: int, adesso: datetime | None = None) -> None:
    """Da chiamare dopo aver messo lo stato di errore/vuota: incrementa attempts e fissa il backoff."""
    assert table in _MAX
    with session() as db:
        r = db.execute(f"SELECT attempts FROM {table} WHERE id=?", (row_id,)).fetchone()
        if r is None:
            return
        n = (r[0] or 0) + 1
        db.execute(f"UPDATE {table} SET attempts=?, next_retry_at=? WHERE id=?",
                   (n, prossimo_tentativo(n, table, adesso), row_id))


def segna_riuscita(table: str, row_id: int) -> None:
    assert table in _MAX
    with session() as db:
        db.execute(f"UPDATE {table} SET attempts=0, next_retry_at=NULL WHERE id=?", (row_id,))


_SCADUTA = "((next_retry_at IS NOT NULL AND next_retry_at <= ?) OR (next_retry_at IS NULL AND attempts = 0))"


def _stato_lezione(lec: dict) -> str:
    """Stato da cui la pipeline riprende la lezione.

    Con audio, silenzi e slide già su disco manca al più la trascrizione: `media_ok` (o `trascritta` se il
    transcript Whisper c'è già), che la fase 1 del turno di notte lavora senza rete. Altrimenti `nuova`:
    `process_lecture`/`process_moodle_video` sono idempotenti e rifanno solo ciò che manca (auto-sync).
    """
    ldir = uni_path(lec["folder"])
    if not all((ldir / f).exists() for f in ("audio.opus", "silences.json", "slides.json")):
        return "nuova"
    tr = ldir / "transcript.json"
    try:
        if tr.exists() and json.loads(tr.read_text(encoding="utf-8")).get("source") == "whisper":
            return "trascritta"
    except (OSError, ValueError):
        pass
    return "media_ok"


def _riprendi_lezioni(adesso: str, log) -> int:
    with session() as db:
        rows = [dict(r) for r in db.execute(
            f"SELECT * FROM lectures WHERE status='errore' AND {_SCADUTA}", (adesso,))]
        for lec in rows:
            nuovo = _stato_lezione(lec)
            log(f"ripresa lezione {lec['id']} '{lec['title']}' -> {nuovo} (tentativo {lec['attempts'] + 1}; "
                f"errore precedente: {(lec['error'] or '')[:160]})")
            db.execute("UPDATE lectures SET status=?, error=NULL, next_retry_at=NULL, updated_at=? WHERE id=?",
                       (nuovo, adesso, lec["id"]))
    return len(rows)


def _riprendi_unita(adesso: str, log) -> dict:
    from ..ai.lecture_notes import existing
    n = {"unita": 0, "unita_senza_appunti": 0}
    with session() as db:
        rows = [dict(r) for r in db.execute(
            f"SELECT * FROM study_units WHERE status IN ('vuota','errore') AND {_SCADUTA}", (adesso,))]
    for u in rows:
        if u["kind"] == "lezione" and not existing(u["ref_id"]):
            n["unita_senza_appunti"] += 1  # aspettano Sonnet
            continue
        log(f"ripresa unità {u['id']} ({u['status']}, tentativo {u['attempts'] + 1}): {(u['message'] or '')[:120]}")
        with session() as db:
            # status vuota/errore -> nuova. source_hash va azzerato: così la rigenerazione non dipende mai dalla cache.
            db.execute("UPDATE study_units SET status='nuova', source_hash=NULL, next_retry_at=NULL WHERE id=? "
                       "AND status IN ('vuota','errore')", (u["id"],))
        n["unita"] += 1
    return n


def riprendi(lezioni: bool = True, unita: bool = True, log=print) -> dict:
    """Rimette in coda ciò che è in errore o vuoto e il cui backoff è scaduto. Ritorna i conteggi."""
    adesso = _ora()
    out = {"lezioni": 0, "unita": 0, "unita_senza_appunti": 0}
    if lezioni:
        out["lezioni"] = _riprendi_lezioni(adesso, log)
    if unita:
        out.update(_riprendi_unita(adesso, log))
    return out


def riprendi_sicuro(**kw) -> dict:
    """Come `riprendi`, ma un'eccezione viene solo loggata: non deve fermare auto-sync né il turno."""
    try:
        return riprendi(**kw)
    except Exception as e:  # noqa: BLE001
        print(f"ripresa automatica fallita: {e}", flush=True)
        return {}
