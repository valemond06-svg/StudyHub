"""Turbo: smaltisce l'arretrato delle unità-documento con il server vLLM su GPU Modal, molte alla volta.

`studyhub turbo` → ai_provider=modal nel solo processo (config.yaml non cambia), sveglia il server (avvio a freddo
3-5 minuti), poi prende le unità «nuova»/«errore» di tipo documento dei corsi attivi e le elabora in parallelo.
Le lezioni restano fuori: i loro appunti nascono dalle trascrizioni, che per la privacy vanno solo al locale.
Il server si spegne da solo 5 minuti dopo l'ultima richiesta (si paga solo il tempo acceso).
"""
from __future__ import annotations

import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from .ai import llm
from .config import settings
from .db import session


def log(msg: str) -> None:
    print(time.strftime("%H:%M:%S"), msg, flush=True)


def unita_in_coda(max_unita: int = 0) -> list[dict]:
    with session() as db:
        rows = db.execute("""SELECT u.id, u.course_id, u.title FROM study_units u JOIN courses c ON c.id = u.course_id
                             WHERE u.kind='documento' AND u.status IN ('nuova','errore') AND c.active=1
                             ORDER BY u.day, u.id""").fetchall()
    rows = [dict(r) for r in rows]
    return rows[:max_unita] if max_unita else rows


def sveglia(timeout_s: int = 1500) -> float:
    """Chiede /v1/models finché il server risponde: l'avvio a freddo scarica/carica il modello."""
    t0 = time.time()
    req = urllib.request.Request(f"{llm.modal_url()}/v1/models", headers={"Authorization": f"Bearer {llm._modal_key()}"})
    ultimo = None
    while time.time() - t0 < timeout_s:
        try:
            with llm._modal_opener.open(req, timeout=200) as r:
                if r.status == 200:
                    return round(time.time() - t0, 1)
        except Exception as e:  # noqa: BLE001 - finché parte, gli errori sono normali
            ultimo = e
        time.sleep(5)
    raise RuntimeError(f"il server Modal non è partito in {timeout_s}s ({ultimo})")


def run(max_unita: int = 0, workers: int = 0, dry_run: bool = False) -> int:
    from .study import bank
    from .study.syllabus import order_course

    if not llm.modal_configured():
        log("Modal non configurato: serve modal_llm_url in config.yaml (o STUDYHUB_MODAL_URL) e la chiave in "
            "~/.studyhub/secrets/modal_llm_key (o STUDYHUB_MODAL_KEY).")
        return 2
    settings.extra["ai_provider"] = "modal"
    settings.extra["modal_only"] = True  # chi non può andare a Modal resta in coda per il locale
    if workers:
        settings.extra["modal_workers"] = workers
    bank.release_stale()
    coda = unita_in_coda(max_unita)
    log(f"{len(coda)} unità-documento in coda; modello {llm.modal_model()}, {llm.effective_workers()} in parallelo")
    if dry_run or not coda:
        return 0
    log(f"server pronto in {sveglia()} s")

    fatte, errori, saltate, t0 = [0], [0], [0], time.time()
    corsi = set()

    def una(u: dict) -> None:
        with session() as db:
            prima = db.execute("SELECT status, attempts, next_retry_at FROM study_units WHERE id=?", (u["id"],)).fetchone()
        if not bank.claim(u["id"]):
            return
        limite = bank.run_claimed(u["id"])
        with session() as db:
            st, msg = db.execute("SELECT status, message FROM study_units WHERE id=?", (u["id"],)).fetchone()
            if st == "errore" and (msg or "").startswith(llm.SOLO_LOCALE):
                # non è un fallimento: si rimette com'era (stato, tentativi, backoff) per il turno locale
                db.execute("UPDATE study_units SET status=?, message=?, attempts=?, next_retry_at=? WHERE id=?",
                           (prima[0], "resta al locale (privacy)", prima[1], prima[2], u["id"]))
                st = "saltata"
        if st == "pronta":
            fatte[0] += 1
            corsi.add(u["course_id"])
        elif st == "saltata":
            saltate[0] += 1
        else:
            errori[0] += 1
        n = fatte[0] + errori[0] + saltate[0]
        log(f"[{n}/{len(coda)}] {st:7} {u['title'][:60]} — {limite or msg or ''}"[:200])

    with ThreadPoolExecutor(max_workers=llm.effective_workers()) as pool:
        list(pool.map(una, coda))
    for cid in corsi:  # argomenti nuovi: si rifà l'ordine didattico del corso
        try:
            order_course(cid)
        except Exception as e:  # noqa: BLE001
            log(f"ordine del corso {cid} non aggiornato: {e}")
    log(f"fine: {fatte[0]} pronte, {saltate[0]} lasciate al locale, {errori[0]} non riuscite, "
        f"{round(time.time() - t0)} s")
    return 0 if errori[0] == 0 else 1
