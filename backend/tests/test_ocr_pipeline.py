"""P1.4: i PDF scansionati passano dall'OCR dentro la coda unica (priorità 5) e alimentano chunk e unità di studio.

Niente rete e niente Claude: `ocr._transcribe` e `claude_runner.run` sono sostituiti.
"""
from __future__ import annotations

import pymupdf
import pytest

from studyhub.ai import claude_runner, jobs
from studyhub.ingest import indexer, ocr
from studyhub.study import bank

from conftest import inserisci_corso

TESTO_OCR = ("La macchina di Turing legge un nastro infinito e applica una funzione di transizione ad ogni passo. "
             "Questo e un testo trascritto dalla scansione con parole abbastanza lunghe da contare. ") * 4


@pytest.fixture(autouse=True)
def cache_tmp(ambiente, monkeypatch):
    monkeypatch.setattr(ocr, "CACHE", ambiente / "ocr")
    monkeypatch.setattr(jobs, "_ensure_worker", lambda: None)
    bank._sig_cache.clear()


def _png(path, n=0):
    pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 60, 60), False)
    pix.set_rect(pix.irect, (200, 30 + n, 30))
    pix.save(str(path))


def _pdf_scan(path, pagine=3):
    path.parent.mkdir(parents=True, exist_ok=True)
    doc = pymupdf.open()
    for i in range(pagine):
        png = path.with_suffix(f".{i}.png")
        _png(png, i)
        doc.new_page().insert_image(pymupdf.Rect(50, 50, 300, 300), filename=str(png))
        png.unlink()
    doc.save(str(path))
    doc.close()


def _pdf_testo(path, pagine=3):
    path.parent.mkdir(parents=True, exist_ok=True)
    doc = pymupdf.open()
    for i in range(pagine):
        page = doc.new_page()
        page.insert_textbox(pymupdf.Rect(40, 40, 550, 780), f"Pagina {i} " + "Il teorema del limite centrale vale. " * 25)
    doc.save(str(path))
    doc.close()


def _corso_con_pdf(db, ambiente, scan=True, testo=True, stage="corrente"):
    inserisci_corso(db, 1, stage=stage)
    base = ambiente / "uni" / "corso1" / "moodle"
    if scan:
        _pdf_scan(base / "scansione.pdf")
    if testo:
        _pdf_testo(base / "testo.pdf")
    db.commit()
    corso = dict(db.execute("SELECT * FROM courses WHERE id=1").fetchone())
    indexer.index_course(corso)
    db.commit()
    return corso


def _doc(db, nome):
    return dict(db.execute("SELECT * FROM documents WHERE path LIKE ?", (f"%{nome}",)).fetchone())


def _finto_transcribe(monkeypatch, chiamate):
    def fake(path, n_pages):
        chiamate.append(str(path))
        return [{"numero": i + 1, "testo": f"Pagina {i + 1}. {TESTO_OCR}"} for i in range(n_pages)]
    monkeypatch.setattr(ocr, "_transcribe", fake)


def test_criterio_scansione_si_testo_no(db, ambiente):
    _corso_con_pdf(db, ambiente)
    assert ocr.needs_ocr(_doc(db, "scansione.pdf")) is True
    assert ocr.needs_ocr(_doc(db, "testo.pdf")) is False
    assert [d["path"].endswith("scansione.pdf") for d in ocr.pending()] == [True]


def test_criterio_media_scarsa_anche_con_chunk(db, ambiente):
    """Poche righe per pagina (sotto la soglia media) ma nessuna immagine: serve comunque l'OCR."""
    inserisci_corso(db, 1, stage="corrente")
    p = ambiente / "uni" / "corso1" / "moodle" / "poco.pdf"
    p.parent.mkdir(parents=True)
    doc = pymupdf.open()
    for i in range(3):
        doc.new_page().insert_text((50, 100), f"Appunto numero {i} breve.")
    doc.save(str(p))
    doc.close()
    db.commit()
    indexer.index_course(dict(db.execute("SELECT * FROM courses WHERE id=1").fetchone()))
    d = _doc(db, "poco.pdf")
    assert ocr.needs_ocr(d) is True


def test_criterio_limiti_di_pagine_e_corsi(db, ambiente, monkeypatch):
    _corso_con_pdf(db, ambiente, testo=False)
    d = _doc(db, "scansione.pdf")
    assert ocr.needs_ocr({**d, "n_pages": ocr.MAX_DOC_PAGES + 1}) is False
    assert ocr.needs_ocr({**d, "n_pages": 0}) is False
    db.execute("UPDATE courses SET stage='archivio'")
    db.commit()
    assert ocr.pending() == []


def test_cache_evita_il_secondo_ocr(db, ambiente, monkeypatch):
    _corso_con_pdf(db, ambiente)
    chiamate: list[str] = []
    _finto_transcribe(monkeypatch, chiamate)
    d = _doc(db, "scansione.pdf")
    ocr.process_doc(d)
    ocr.process_doc(d)                     # stessa cache: nessuna nuova trascrizione
    assert len(chiamate) == 1
    assert ocr.pending() == []             # e non viene più proposto
    pagine = ocr.cached_pages(d["sha256"])
    assert len(pagine) == 3 and pagine[0].startswith("Pagina 1.")
    assert ocr.cached_pages("0" * 64) is None


def test_sostituzione_dei_chunk(db, ambiente, monkeypatch):
    _corso_con_pdf(db, ambiente)
    d = _doc(db, "scansione.pdf")
    altro = _doc(db, "testo.pdf")
    prima = db.execute("SELECT COUNT(*) FROM chunks WHERE doc_id=?", (d["id"],)).fetchone()[0]
    n_altro = db.execute("SELECT COUNT(*) FROM chunks WHERE doc_id=?", (altro["id"],)).fetchone()[0]
    db.execute("INSERT INTO chunks (doc_id, course_id, kind, page, heading, text) VALUES (?,?,?,?,?,?)",
               (d["id"], 1, "pdf", 1, "rumore", "xx"))   # chunk quasi vuoto lasciato dall'estrazione
    db.commit()
    _finto_transcribe(monkeypatch, [])
    n = ocr.process_doc(d)
    db.commit()
    righe = db.execute("SELECT text FROM chunks WHERE doc_id=?", (d["id"],)).fetchall()
    assert prima == 0 and n == len(righe) > 0
    assert all("Turing" in r[0] for r in righe) and not any(r[0] == "xx" for r in righe)
    assert db.execute("SELECT COUNT(*) FROM chunks WHERE doc_id=?", (altro["id"],)).fetchone()[0] == n_altro
    assert db.execute("SELECT COUNT(*) FROM documents WHERE id=?", (d["id"],)).fetchone()[0] == 1
    # il testo OCR è cercabile (FTS aggiornato dai trigger)
    assert db.execute("SELECT COUNT(*) FROM chunks_fts WHERE chunks_fts MATCH 'Turing'").fetchone()[0] > 0
    assert db.execute("SELECT COUNT(*) FROM chunks_fts WHERE chunks_fts MATCH 'rumore'").fetchone()[0] == 0


def test_unita_con_testo_ocr_e_hash_che_cambia(db, ambiente, monkeypatch):
    _corso_con_pdf(db, ambiente, testo=False)
    assert bank.sync_units(1)["added"] == 0                 # scansione senza testo: nessuna unità
    d = _doc(db, "scansione.pdf")
    _finto_transcribe(monkeypatch, [])
    ocr.process_doc(d)
    r = bank.sync_units(1)
    assert r["added"] == 1
    unit = dict(db.execute("SELECT * FROM study_units WHERE ref_id=?", (d["id"],)).fetchone())
    testo, h_dopo, refs = bank._unit_text(db, unit)
    assert "Turing" in testo and h_dopo.endswith(":ocr") and refs == {"doc_id": d["id"]}
    # senza cache l'hash è quello di prima, senza suffisso
    ocr.cache_path(d["sha256"]).unlink()
    _, h_prima, _ = bank._unit_text(db, unit)
    assert not h_prima.endswith(":ocr") and h_prima != h_dopo


def test_ocr_solo_sulle_pagine_scarse(db, ambiente, monkeypatch):
    """Un PDF con testo vero non perde le sue pagine: l'OCR entra solo dove l'estratto è sotto soglia."""
    _corso_con_pdf(db, ambiente, scan=False)
    d = _doc(db, "testo.pdf")
    ocr.CACHE.mkdir(parents=True, exist_ok=True)
    ocr.cache_path(d["sha256"]).write_text('[{"numero":1,"testo":"OCR-SBAGLIATO"}]', encoding="utf-8")
    testi = bank.page_texts(ambiente / "uni" / d["path"], d["sha256"])
    assert "OCR-SBAGLIATO" not in " ".join(testi) and "teorema" in testi[0]


def test_enqueue_con_priorita_5_dopo_le_lezioni(db, ambiente):
    _corso_con_pdf(db, ambiente, testo=False)
    db.execute("INSERT INTO lectures (id, course_id, title, date, folder, status) VALUES (7,1,'L7','2026-11-01','c/l7','trascritta')")
    db.commit()
    ids = jobs.enqueue_backlog()
    assert len(ids) == 2
    righe = {(r["kind"], r["priority"]) for r in db.execute("SELECT kind, priority FROM ai_jobs")}
    assert righe == {("lecture_notes", 30), ("ocr", jobs.OCR_PRIORITY)} and jobs.OCR_PRIORITY == 5
    assert jobs.enqueue_backlog() == []                       # niente doppioni
    assert jobs._next_job()["kind"] == "lecture_notes"        # prima la lezione
    assert jobs._next_job()["kind"] == "ocr"
    assert jobs._next_job(allow_backlog=False) is None


def test_errori_ripetuti_escono_anche_per_ocr(db, ambiente):
    _corso_con_pdf(db, ambiente, testo=False)
    did = _doc(db, "scansione.pdf")["id"]
    for _ in range(jobs.BACKLOG_MAX_ERRORS):
        db.execute("INSERT INTO ai_jobs (kind, target_id, status, finished_at) "
                   "VALUES ('ocr', ?, 'errore', datetime('now','-2 days','localtime'))", (did,))
    db.commit()
    assert jobs.ocr_candidates() == []


def test_join_di_next_job_solo_per_le_lezioni(db, ambiente):
    """Un job OCR il cui target_id coincide con l'id di una lezione recente non eredita la data di quella lezione."""
    inserisci_corso(db, 1, stage="corrente")
    db.execute("INSERT INTO lectures (id, course_id, title, date, folder, status) VALUES (5,1,'vecchia','2026-01-01','a','trascritta')")
    db.execute("INSERT INTO lectures (id, course_id, title, date, folder, status) VALUES (9,1,'recente','2026-11-10','b','trascritta')")
    db.execute("INSERT INTO ai_jobs (kind, target_id, priority) VALUES ('lecture_notes', 5, 5)")
    db.execute("INSERT INTO ai_jobs (kind, target_id, priority) VALUES ('ocr', 9, 5)")
    db.commit()
    assert jobs._next_job()["kind"] == "lecture_notes"        # con il join sbagliato passava prima l'OCR (data di L9)


def test_status_mostra_il_titolo_del_documento(db, ambiente):
    _corso_con_pdf(db, ambiente, testo=False)
    jobs.enqueue_backlog()
    titoli = [j["title"] for j in jobs.status()["jobs"] if j["kind"] == "ocr"]
    assert titoli and titoli[0]


def test_job_ocr_crea_unita_e_rate_limited_rimette_in_coda(db, ambiente, monkeypatch):
    import studyhub.ingest.indexer as ix
    corso = _corso_con_pdf(db, ambiente, testo=False)
    d = _doc(db, "scansione.pdf")
    monkeypatch.setattr(ix, "embed_pending", lambda *a, **k: 0)
    monkeypatch.setattr(jobs, "_pause", lambda reason: jobs.state.update(paused_reason=reason))

    def limite(*a, **k):
        raise claude_runner.RateLimited("finestra piena")
    monkeypatch.setattr(claude_runner, "run", limite)         # _transcribe vero: la prima chiamata a Claude fallisce
    jid = jobs._insert(db, d["id"], jobs.OCR_PRIORITY, "ocr")
    db.commit()
    jobs._process_job(jobs._next_job())
    row = dict(db.execute("SELECT * FROM ai_jobs WHERE id=?", (jid,)).fetchone())
    assert row["status"] == "in_coda" and row["finished_at"] is None
    assert jobs.state["paused_reason"] == "finestra piena"
    assert ocr.cached_pages(d["sha256"]) is None              # niente cache a metà
    jobs.state["paused_reason"] = None

    _finto_transcribe(monkeypatch, [])
    jobs._process_job(jobs._next_job())
    assert dict(db.execute("SELECT * FROM ai_jobs WHERE id=?", (jid,)).fetchone())["status"] == "fatto"
    assert db.execute("SELECT COUNT(*) FROM study_units WHERE course_id=?", (corso["id"],)).fetchone()[0] == 1
    assert db.execute("SELECT COUNT(*) FROM chunks WHERE doc_id=?", (d["id"],)).fetchone()[0] > 0
