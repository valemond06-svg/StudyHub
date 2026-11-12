import sqlite3

from studyhub import db as dbmod


def test_schema_creato_e_versione_allineata(ambiente):
    with dbmod.session() as conn:
        versione = conn.execute("PRAGMA user_version").fetchone()[0]
        tabelle = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert versione == len(dbmod.MIGRATIONS)
    for t in ("courses", "lectures", "flashcards", "study_items", "study_topics", "exam_sims", "doc_tags", "chunks_fts"):
        assert t in tabelle


def test_migrazioni_idempotenti_e_dati_conservati(ambiente):
    with dbmod.session() as conn:
        conn.execute("INSERT INTO courses (id, fullname) VALUES (7, 'Fisica')")
    # Riapertura: non deve rieseguire le migrazioni (CREATE TABLE fallirebbe) né perdere dati.
    with dbmod.session() as conn:
        assert conn.execute("SELECT fullname FROM courses WHERE id=7").fetchone()[0] == "Fisica"
        assert conn.execute("PRAGMA user_version").fetchone()[0] == len(dbmod.MIGRATIONS)


def test_migrazione_parziale_riprende_dal_punto_giusto(ambiente):
    """Un DB fermo alla versione 3 deve ricevere solo le migrazioni 4+."""
    conn = sqlite3.connect(ambiente / "test.db")
    for sql in dbmod.MIGRATIONS[:3]:
        conn.executescript(sql)
    conn.execute("PRAGMA user_version = 3")
    conn.commit()
    conn.close()
    with dbmod.session() as c:
        assert c.execute("PRAGMA user_version").fetchone()[0] == len(dbmod.MIGRATIONS)
        colonne = {r[1] for r in c.execute("PRAGMA table_info(lectures)")}
    assert "media_url" in colonne  # aggiunta da una migrazione successiva


def test_chiavi_esterne_attive(ambiente):
    with dbmod.session() as conn:
        try:
            conn.execute("INSERT INTO sections (id, course_id) VALUES (1, 999)")
            ok = True
        except sqlite3.IntegrityError:
            ok = False
    assert not ok


def test_fts_segue_inserimento_e_cancellazione_dei_chunk(ambiente):
    with dbmod.session() as conn:
        conn.execute("INSERT INTO documents (id, path, kind, sha256) VALUES (1, 'a.pdf', 'pdf', 'x')")
        conn.execute("INSERT INTO chunks (id, doc_id, heading, text) VALUES (1, 1, 'Intro', 'autovalori e autovettori')")
        assert conn.execute("SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH 'autovalori'").fetchone()[0] == 1
        conn.execute("DELETE FROM documents WHERE id=1")  # ON DELETE CASCADE -> trigger di cancellazione
        assert conn.execute("SELECT COUNT(*) FROM chunks_fts WHERE chunks_fts MATCH 'autovalori'").fetchone()[0] == 0
