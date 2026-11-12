"""Riparazioni della banca di domande.

Crocette perse: dal 27/10 `bank._store` scartava ogni domanda a scelta multipla (un `continue` di troppo, ora
tolto). Le unità preparate da allora sono 'pronta' ma senza nemmeno una `multipla`. Rimettendole 'nuova' con
l'hash della fonte azzerato, "Analizza il corso" le rigenera: `_store` toglie le domande mai usate, sospende
quelle con storico e le riattiva se la stessa domanda ricompare (la chiave è unitá + testo).
"""
from __future__ import annotations

import sqlite3
from datetime import datetime
from pathlib import Path

from ..config import settings
from ..db import session


def units_without_multiple_choice(db) -> list[dict]:
    """Unità pronte che non hanno nessuna domanda 'multipla' (nemmeno sospesa)."""
    return [dict(r) for r in db.execute(
        """SELECT u.id, u.course_id, u.title, u.day, u.kind, c.fullname AS course,
                  (SELECT COUNT(*) FROM study_items i WHERE i.unit_id=u.id) AS n_items
           FROM study_units u LEFT JOIN courses c ON c.id=u.course_id
           WHERE u.status='pronta'
             AND NOT EXISTS (SELECT 1 FROM study_items i WHERE i.unit_id=u.id AND i.kind='multipla')
           ORDER BY u.course_id, u.day, u.id""")]


def backup_db(dest_dir: Path | None = None) -> Path:
    """Copia coerente del database (API di backup di SQLite, sicura anche con WAL e server acceso)."""
    src = settings.db_path
    dest = (dest_dir or src.parent) / f"{src.name}.bak-{datetime.now():%Y%m%d-%H%M%S}"
    s, d = sqlite3.connect(src), sqlite3.connect(dest)
    try:
        s.backup(d)
    finally:
        d.close()
        s.close()
    return dest


def requeue(unit_ids: list[int]) -> int:
    """Rimette in coda le unità: status 'nuova' e hash azzerato (altrimenti prepare_unit le darebbe per già fatte)."""
    if not unit_ids:
        return 0
    with session() as db:
        return db.execute(
            f"""UPDATE study_units SET status='nuova', source_hash=NULL, message='rigenerazione crocette'
                WHERE status='pronta' AND id IN ({','.join('?' * len(unit_ids))})""", unit_ids).rowcount
