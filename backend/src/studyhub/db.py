"""Schema SQLite. Le fasi successive aggiungono tabelle con nuove migrazioni in MIGRATIONS."""
from __future__ import annotations

import sqlite3
from contextlib import closing, contextmanager
from pathlib import Path
from tempfile import TemporaryDirectory

from .config import settings
from .filelock import file_lock

_CANCEL_DUPLICATE_AI_JOBS = """
WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (
        PARTITION BY kind, target_id ORDER BY status = 'in_corso' DESC, id
    ) AS position
    FROM ai_jobs
    WHERE status IN ('in_coda', 'in_corso')
)
UPDATE ai_jobs
SET status = 'annullato', message = 'Duplicato riconciliato durante la migrazione',
    finished_at = datetime('now', 'localtime')
WHERE id IN (SELECT id FROM ranked WHERE position > 1);
"""

MIGRATIONS = [
    """
    CREATE TABLE courses (
        id INTEGER PRIMARY KEY,              -- id del corso su Moodle
        fullname TEXT NOT NULL,
        shortname TEXT,
        category TEXT,
        academic_year TEXT,                  -- es. 2026/27
        year_of_study INTEGER,               -- 1, 2, 3
        semester INTEGER,
        passed INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,
        priority INTEGER NOT NULL DEFAULT 0,
        folder TEXT,                         -- relativo alla cartella università
        url TEXT,
        last_sync TEXT
    );
    CREATE TABLE sections (
        id INTEGER PRIMARY KEY,
        course_id INTEGER NOT NULL REFERENCES courses(id),
        number INTEGER,
        name TEXT,
        summary_md TEXT,
        folder TEXT
    );
    CREATE TABLE modules (
        id INTEGER PRIMARY KEY,              -- cmid Moodle
        course_id INTEGER NOT NULL REFERENCES courses(id),
        section_id INTEGER REFERENCES sections(id),
        modname TEXT,
        name TEXT,
        url TEXT,
        description_md TEXT,
        visible INTEGER
    );
    CREATE TABLE files (
        id INTEGER PRIMARY KEY,
        course_id INTEGER NOT NULL REFERENCES courses(id),
        module_id INTEGER REFERENCES modules(id),
        source_url TEXT NOT NULL UNIQUE,
        path TEXT NOT NULL,                  -- relativo alla cartella università
        size INTEGER,
        timemodified INTEGER,
        sha256 TEXT,
        mime TEXT,
        downloaded_at TEXT
    );
    CREATE TABLE media_sources (              -- candidati Panopto/video, elaborati in Fase 2
        id INTEGER PRIMARY KEY,
        course_id INTEGER NOT NULL REFERENCES courses(id),
        module_id INTEGER REFERENCES modules(id),
        kind TEXT,                           -- lti | panopto_link | embed
        url TEXT NOT NULL,
        title TEXT,
        status TEXT NOT NULL DEFAULT 'nuovo',
        UNIQUE(course_id, url)
    );
    CREATE TABLE sync_runs (
        id INTEGER PRIMARY KEY,
        course_id INTEGER,
        started_at TEXT,
        finished_at TEXT,
        new_files INTEGER,
        updated_files INTEGER,
        errors TEXT
    );
    """,
    """
    CREATE TABLE lectures (
        id INTEGER PRIMARY KEY,
        course_id INTEGER NOT NULL REFERENCES courses(id),
        panopto_id TEXT UNIQUE,
        title TEXT NOT NULL,
        date TEXT,                           -- YYYY-MM-DD
        number INTEGER,
        folder TEXT NOT NULL,                -- relativo alla cartella università
        viewer_url TEXT,
        duration REAL,
        has_audio INTEGER NOT NULL DEFAULT 0,
        n_slides INTEGER NOT NULL DEFAULT 0,
        transcript_source TEXT,              -- panopto | whisper
        status TEXT NOT NULL DEFAULT 'nuova',  -- nuova | media_ok | trascritta | errore
        error TEXT,
        updated_at TEXT
    );
    """,
    """
    CREATE TABLE documents (
        id INTEGER PRIMARY KEY,
        course_id INTEGER,
        path TEXT NOT NULL UNIQUE,           -- relativo alla cartella università
        kind TEXT NOT NULL,                  -- pdf | md | docx | pptx | code | text | transcript
        sha256 TEXT NOT NULL,
        size INTEGER,
        mtime REAL,
        title TEXT,
        n_pages INTEGER,
        lecture_id INTEGER REFERENCES lectures(id),
        duplicate_of INTEGER REFERENCES documents(id),  -- stesso contenuto già indicizzato altrove
        indexed_at TEXT
    );
    CREATE INDEX documents_sha ON documents(sha256);
    CREATE TABLE pages (
        doc_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        page INTEGER NOT NULL,               -- 1-based
        chars INTEGER,
        is_scan INTEGER NOT NULL DEFAULT 0,  -- niente testo estraibile: servirà OCR
        is_visual INTEGER NOT NULL DEFAULT 0,  -- formule/figure: da passare a Claude come immagine
        PRIMARY KEY (doc_id, page)
    );
    CREATE TABLE chunks (
        id INTEGER PRIMARY KEY,
        doc_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        course_id INTEGER,
        kind TEXT,
        page INTEGER,
        t_start REAL,
        t_end REAL,
        heading TEXT,
        text TEXT NOT NULL,
        embedding BLOB                       -- float16, copia di riserva (fallback NumPy)
    );
    CREATE INDEX chunks_doc ON chunks(doc_id);
    CREATE INDEX chunks_course ON chunks(course_id);
    CREATE VIRTUAL TABLE chunks_fts USING fts5(
        heading, text, content='chunks', content_rowid='id', tokenize='unicode61 remove_diacritics 2'
    );
    CREATE TRIGGER chunks_ai AFTER INSERT ON chunks BEGIN
        INSERT INTO chunks_fts(rowid, heading, text) VALUES (new.id, new.heading, new.text);
    END;
    CREATE TRIGGER chunks_ad AFTER DELETE ON chunks BEGIN
        INSERT INTO chunks_fts(chunks_fts, rowid, heading, text) VALUES ('delete', old.id, old.heading, old.text);
    END;
    """,
    """
    CREATE TABLE ai_outputs (
        id INTEGER PRIMARY KEY,
        kind TEXT NOT NULL,                  -- lecture_notes | …
        target_id INTEGER NOT NULL,          -- es. lectures.id
        course_id INTEGER,
        input_hash TEXT NOT NULL,            -- hash(input + prompt + versione + modello): cache
        prompt_version TEXT,
        model TEXT,
        json_path TEXT,
        md_path TEXT,
        sources TEXT,                        -- JSON: documenti/pagine usati come input
        input_tokens INTEGER,
        output_tokens INTEGER,
        cost_usd REAL,                       -- equivalente API (con Pro non si paga a token)
        duration_s REAL,
        created_at TEXT
    );
    CREATE INDEX ai_outputs_target ON ai_outputs(kind, target_id);
    CREATE TABLE ai_jobs (
        id INTEGER PRIMARY KEY,
        kind TEXT NOT NULL,
        target_id INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'in_coda',  -- in_coda | in_corso | fatto | errore | annullato
        message TEXT,
        created_at TEXT,
        started_at TEXT,
        finished_at TEXT
    );
    """,
    """
    CREATE TABLE flashcards (
        id INTEGER PRIMARY KEY,
        course_id INTEGER NOT NULL,
        lecture_id INTEGER,
        front TEXT NOT NULL,
        back TEXT NOT NULL,
        t_start REAL,                        -- punto della lezione a cui si riferisce
        origin TEXT NOT NULL DEFAULT 'ai',   -- ai | manuale
        origin_key TEXT UNIQUE,              -- evita doppioni quando si reimporta
        suspended INTEGER NOT NULL DEFAULT 0,
        fsrs TEXT NOT NULL,                  -- stato della carta (py-fsrs, JSON)
        due TEXT NOT NULL,                   -- ISO UTC, per le query "da ripassare oggi"
        created_at TEXT
    );
    CREATE INDEX flashcards_due ON flashcards(course_id, due);
    CREATE TABLE reviews (
        id INTEGER PRIMARY KEY,
        card_id INTEGER NOT NULL REFERENCES flashcards(id) ON DELETE CASCADE,
        rating INTEGER NOT NULL,             -- 1 Again · 2 Hard · 3 Good · 4 Easy
        reviewed_at TEXT NOT NULL,
        log TEXT
    );
    CREATE TABLE tutor_threads (
        id INTEGER PRIMARY KEY,
        course_id INTEGER,
        mode TEXT NOT NULL DEFAULT 'normale',  -- normale | socratico
        title TEXT,
        created_at TEXT
    );
    CREATE TABLE tutor_messages (
        id INTEGER PRIMARY KEY,
        thread_id INTEGER NOT NULL REFERENCES tutor_threads(id) ON DELETE CASCADE,
        role TEXT NOT NULL,                  -- user | assistant
        content TEXT NOT NULL,
        citations TEXT,                      -- JSON: fonti usate
        tokens_in INTEGER,
        tokens_out INTEGER,
        created_at TEXT
    );
    CREATE TABLE quizzes (
        id INTEGER PRIMARY KEY,
        course_id INTEGER NOT NULL,
        lecture_id INTEGER,
        title TEXT,
        questions TEXT NOT NULL,             -- JSON
        input_hash TEXT,
        created_at TEXT
    );
    CREATE TABLE quiz_attempts (
        id INTEGER PRIMARY KEY,
        quiz_id INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
        answers TEXT NOT NULL,               -- JSON: risposte e correzioni per domanda
        score REAL,
        max_score REAL,
        created_at TEXT
    );
    """,
    """
    CREATE TABLE exams (                     -- appelli a cui intendi presentarti (li inserisci tu)
        id INTEGER PRIMARY KEY,
        course_id INTEGER NOT NULL,
        date TEXT NOT NULL,                  -- YYYY-MM-DD
        kind TEXT NOT NULL DEFAULT 'scritto',
        note TEXT,
        done INTEGER NOT NULL DEFAULT 0,
        grade TEXT,
        created_at TEXT
    );
    CREATE TABLE exam_sims (
        id INTEGER PRIMARY KEY,
        course_id INTEGER NOT NULL,
        title TEXT,
        duration_min INTEGER,
        content TEXT NOT NULL,               -- JSON con domande, soluzioni e criteri
        created_at TEXT
    );
    CREATE TABLE exam_attempts (
        id INTEGER PRIMARY KEY,
        sim_id INTEGER NOT NULL REFERENCES exam_sims(id) ON DELETE CASCADE,
        answers TEXT NOT NULL,
        grading TEXT,
        grade REAL,                          -- voto in trentesimi
        passed INTEGER,
        elapsed_min REAL,
        created_at TEXT
    );
    """,
    """
    CREATE TABLE notifications (
        id INTEGER PRIMARY KEY,
        created_at TEXT NOT NULL,
        kind TEXT NOT NULL,                  -- file | lezione | avviso | errore
        course_id INTEGER,
        title TEXT NOT NULL,
        body TEXT,
        ref TEXT,                            -- percorso o id lezione da aprire
        read INTEGER NOT NULL DEFAULT 0
    );
    """,
    """
    ALTER TABLE lectures ADD COLUMN source TEXT NOT NULL DEFAULT 'panopto';  -- panopto | moodle
    ALTER TABLE lectures ADD COLUMN media_url TEXT;                          -- video caricato su Moodle
    CREATE UNIQUE INDEX lectures_media_url ON lectures(media_url);
    """,
    """
    -- Modalità Studia: il materiale del corso fino a oggi diventa argomenti + banca di domande,
    -- e ogni risposta aggiorna la padronanza (FSRS per domanda).
    CREATE TABLE study_units (               -- una lezione o una parte di un documento
        id INTEGER PRIMARY KEY,
        course_id INTEGER NOT NULL,
        kind TEXT NOT NULL,                  -- lezione | documento
        ref_id INTEGER NOT NULL,             -- lectures.id o documents.id
        part INTEGER NOT NULL DEFAULT 0,     -- parte del documento (pagine a blocchi)
        page_from INTEGER, page_to INTEGER,
        title TEXT,
        day TEXT,                            -- data della lezione / del file, per l'ordine cronologico
        source_hash TEXT,
        status TEXT NOT NULL DEFAULT 'nuova',  -- nuova | in_corso | pronta | errore | vuota
        provider TEXT, message TEXT, done_at TEXT,
        UNIQUE (kind, ref_id, part)
    );
    CREATE TABLE study_topics (
        id INTEGER PRIMARY KEY,
        course_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        weight INTEGER NOT NULL DEFAULT 2,   -- peso all'esame: 3 alto · 2 medio · 1 basso
        summary_md TEXT,                     -- la "scheda": cosa devi sapere
        unit_id INTEGER, day TEXT,           -- dove compare per la prima volta
        lecture_id INTEGER, t_start REAL, doc_id INTEGER, page INTEGER,
        UNIQUE (course_id, name)
    );
    CREATE TABLE study_items (
        id INTEGER PRIMARY KEY,
        course_id INTEGER NOT NULL,
        unit_id INTEGER NOT NULL REFERENCES study_units(id) ON DELETE CASCADE,
        topic_id INTEGER NOT NULL REFERENCES study_topics(id),
        kind TEXT NOT NULL,                  -- richiamo | multipla | vero_falso | aperta | esercizio
        difficulty INTEGER NOT NULL DEFAULT 2,
        prompt_md TEXT NOT NULL,
        options TEXT,                        -- JSON (multipla)
        correct INTEGER,                     -- indice (multipla) · 1/0 (vero_falso)
        answer_md TEXT NOT NULL,
        rubric TEXT,                         -- JSON: punti che una risposta completa deve toccare
        lecture_id INTEGER, t_start REAL, doc_id INTEGER, page INTEGER,
        fsrs TEXT, due TEXT,                 -- NULL finché non ci hai mai risposto
        suspended INTEGER NOT NULL DEFAULT 0,
        origin_key TEXT UNIQUE
    );
    CREATE INDEX study_items_course ON study_items(course_id, topic_id);
    CREATE TABLE study_sessions (
        id INTEGER PRIMARY KEY,
        course_id INTEGER NOT NULL,
        started_at TEXT NOT NULL, ended_at TEXT,
        minutes INTEGER,
        focus_topic INTEGER,
        queue TEXT NOT NULL,                 -- JSON: [{"t":"scheda","topic":id} | {"t":"domanda","item":id}]
        xp INTEGER NOT NULL DEFAULT 0,
        ready_before REAL, ready_after REAL
    );
    CREATE TABLE study_attempts (
        id INTEGER PRIMARY KEY,
        item_id INTEGER NOT NULL REFERENCES study_items(id) ON DELETE CASCADE,
        session_id INTEGER,
        score REAL NOT NULL,                 -- 0..1
        confidence INTEGER,                  -- 3 sicuro · 2 credo · 1 tiro a indovinare
        answer TEXT, feedback_md TEXT,
        graded_by TEXT,                      -- auto | ai | io (autovalutazione con i criteri)
        seconds REAL,
        created_at TEXT NOT NULL
    );
    CREATE INDEX study_attempts_item ON study_attempts(item_id);
    """,
    """
    CREATE TABLE study_lessons (             -- lezione interattiva di un argomento (passi + verifiche + esempio)
        topic_id INTEGER PRIMARY KEY REFERENCES study_topics(id) ON DELETE CASCADE,
        data TEXT,                           -- JSON della lezione
        status TEXT NOT NULL DEFAULT 'in_coda',  -- in_coda | in_corso | pronta | errore
        provider TEXT, message TEXT,
        created_at TEXT,
        completed_at TEXT                    -- quando l'hai finita tu
    );
    """,
    """
    -- Ordine didattico del corso (non la data dei file): capitoli, posizione, argomenti da nascondere.
    ALTER TABLE study_topics ADD COLUMN position INTEGER;
    ALTER TABLE study_topics ADD COLUMN chapter TEXT;
    ALTER TABLE study_topics ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;  -- es. "struttura del corso", "regole d'esame"
    ALTER TABLE courses ADD COLUMN topics_order_key TEXT;                    -- argomenti già ordinati (hash dei nomi)
    """,
    # Stato reale del corso e natura di ogni documento (calendario, appello, soluzione...).
    """
    ALTER TABLE courses ADD COLUMN stage TEXT NOT NULL DEFAULT 'archivio';   -- corrente | arretrato | futuro | archivio
    CREATE TABLE IF NOT EXISTS doc_tags (
        doc_id INTEGER PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
        category TEXT NOT NULL,
        exam_date TEXT,
        updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_doc_tags_category ON doc_tags(category);
    """,
    # Coda AI con priorità: i click (100) prima degli arretrati messi in coda da soli (10-30).
    """
    ALTER TABLE ai_jobs ADD COLUMN priority INTEGER NOT NULL DEFAULT 100;
    CREATE INDEX IF NOT EXISTS idx_ai_jobs_status ON ai_jobs(status, priority);

    -- P1.1 CRITICAL FIX: race condition duplicazione jobs. Unique constraint parziale
    -- LIMITATO allo status che possono crearsi in concorrenza (server + fullrun + CLI).
    -- Jobs "fatto"/"errore"/"annullato" possono esistere più volte (es. retry).
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_jobs_unique
    ON ai_jobs(kind, target_id)
    WHERE status IN ('in_coda', 'in_corso');
    """,
    """
    -- P1.3: ripresa automatica di lezioni in errore e unità vuote/in errore (backoff in study/riprese.py)
    ALTER TABLE lectures ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE lectures ADD COLUMN next_retry_at TEXT;
    ALTER TABLE study_units ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE study_units ADD COLUMN next_retry_at TEXT;
    """,
    # Recupera l'indice sui DB che avevano già applicato la migrazione delle priorità.
    """
    WITH priorities AS (
        SELECT kind, target_id, MAX(priority) AS priority
        FROM ai_jobs
        WHERE status IN ('in_coda', 'in_corso')
        GROUP BY kind, target_id
        HAVING COUNT(*) > 1
    )
    UPDATE ai_jobs AS job SET priority = priorities.priority
    FROM priorities
    WHERE job.kind = priorities.kind AND job.target_id = priorities.target_id
      AND job.status IN ('in_coda', 'in_corso') AND job.priority < priorities.priority;
    """
    + _CANCEL_DUPLICATE_AI_JOBS
    + """
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_jobs_unique
    ON ai_jobs(kind, target_id)
    WHERE status IN ('in_coda', 'in_corso');
    """,
    """
    CREATE TABLE notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
        lecture_id INTEGER REFERENCES lectures(id) ON DELETE SET NULL,
        topic_id INTEGER REFERENCES study_topics(id) ON DELETE SET NULL,
        doc_id INTEGER REFERENCES documents(id) ON DELETE SET NULL,
        timestamp_s REAL CHECK (timestamp_s >= 0),
        page INTEGER CHECK (page >= 1),
        body TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    CREATE INDEX notes_course_updated ON notes(course_id, updated_at DESC);
    CREATE VIRTUAL TABLE notes_fts USING fts5(
        tags, body, content='notes', content_rowid='id', tokenize='unicode61 remove_diacritics 2'
    );
    CREATE TRIGGER notes_ai AFTER INSERT ON notes BEGIN
        INSERT INTO notes_fts(rowid, tags, body) VALUES (new.id, new.tags, new.body);
    END;
    CREATE TRIGGER notes_ad AFTER DELETE ON notes BEGIN
        INSERT INTO notes_fts(notes_fts, rowid, tags, body) VALUES ('delete', old.id, old.tags, old.body);
    END;
    CREATE TRIGGER notes_au AFTER UPDATE OF tags, body ON notes BEGIN
        INSERT INTO notes_fts(notes_fts, rowid, tags, body) VALUES ('delete', old.id, old.tags, old.body);
        INSERT INTO notes_fts(rowid, tags, body) VALUES (new.id, new.tags, new.body);
    END;

    ALTER TABLE flashcards ADD COLUMN doc_id INTEGER REFERENCES documents(id) ON DELETE SET NULL;
    ALTER TABLE flashcards ADD COLUMN page INTEGER CHECK (page >= 1);
    ALTER TABLE flashcards ADD COLUMN attempt_id INTEGER REFERENCES study_attempts(id) ON DELETE SET NULL;
    CREATE UNIQUE INDEX flashcards_attempt ON flashcards(attempt_id) WHERE attempt_id IS NOT NULL;
    CREATE INDEX flashcards_active_due ON flashcards(due) WHERE suspended=0;
    CREATE INDEX reviews_card ON reviews(card_id);
    CREATE INDEX study_attempts_session ON study_attempts(session_id);

    CREATE TABLE focus_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
        task TEXT,
        started_at TEXT NOT NULL,
        planned_seconds INTEGER NOT NULL CHECK (planned_seconds > 0),
        ends_at TEXT NOT NULL,
        stopped_at TEXT,
        actual_seconds INTEGER CHECK (actual_seconds >= 0),
        kind TEXT NOT NULL CHECK (kind IN ('focus', 'pausa'))
    );
    CREATE INDEX focus_course_started ON focus_sessions(course_id, started_at);
    CREATE UNIQUE INDEX focus_one_active ON focus_sessions((1)) WHERE stopped_at IS NULL;

    CREATE TABLE availability (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        hours_by_weekday TEXT NOT NULL,
        days_off TEXT NOT NULL
    );

    CREATE TABLE provider_health (
        provider TEXT PRIMARY KEY CHECK (provider IN ('gemini', 'claude')),
        status TEXT NOT NULL,
        checked_at TEXT NOT NULL
    );
    """,
]

# Versione storica che aggiunge priority e tenta di creare lo stesso indice.
_AI_JOB_PRIORITY_VERSION = 1 + next(
    i for i, sql in enumerate(MIGRATIONS) if "ALTER TABLE ai_jobs ADD COLUMN priority" in sql
)


def _load_vec(conn: sqlite3.Connection) -> bool:
    try:
        import sqlite_vec
        conn.enable_load_extension(True)
        sqlite_vec.load(conn)
        conn.enable_load_extension(False)
        return True
    except Exception:  # Python senza supporto alle estensioni: si usa il fallback NumPy
        return False


VEC_AVAILABLE: bool | None = None


def snapshot_database(source: Path, destination: Path) -> None:
    """Copia uno snapshot autonomo, comprese le transazioni confermate nel WAL."""
    source_uri = source.resolve().as_uri() + "?mode=ro"
    with closing(sqlite3.connect(source_uri, uri=True, timeout=30)) as src:
        with closing(sqlite3.connect(destination, timeout=30)) as dst:
            src.backup(dst)
            dst.execute("PRAGMA journal_mode = DELETE")


def _copy_legacy_database(path: Path) -> None:
    old = settings.old_db_path
    if not path.exists() and old.is_file():
        with TemporaryDirectory(prefix="db-migration-", dir=path.parent) as tmp:
            snapshot = Path(tmp) / path.name
            snapshot_database(old, snapshot)
            snapshot.replace(path)


def connect() -> sqlite3.Connection:
    global VEC_AVAILABLE
    path = settings.db_path
    lock_path = path.with_suffix(path.suffix + ".init.lock")
    if not path.exists():
        # Il lock crea anche la directory locale al primo avvio.
        with file_lock(lock_path, "inizializzazione database"):
            _copy_legacy_database(path)
    conn = sqlite3.connect(path, timeout=30)
    try:
        conn.row_factory = sqlite3.Row
        VEC_AVAILABLE = _load_vec(conn)
        conn.execute("PRAGMA foreign_keys = ON")
        version = conn.execute("PRAGMA user_version").fetchone()[0]
        if version < len(MIGRATIONS) or conn.execute("PRAGMA journal_mode").fetchone()[0] != "wal":
            with file_lock(lock_path, "migrazione database"):
                conn.execute("PRAGMA journal_mode = WAL")
                _migrate(conn)
    except BaseException:
        conn.close()
        raise
    return conn


def _migrate(conn: sqlite3.Connection) -> None:
    version = conn.execute("PRAGMA user_version").fetchone()[0]
    for i, sql in enumerate(MIGRATIONS[version:], start=version + 1):
        # Sui database ancora precedenti a priority, evita che l'indice storico
        # fallisca prima che si possa raggiungere la nuova migrazione.
        before = _CANCEL_DUPLICATE_AI_JOBS if i == _AI_JOB_PRIORITY_VERSION else ""
        conn.executescript(f"BEGIN IMMEDIATE;\n{before}{sql}\nPRAGMA user_version = {i};\nCOMMIT;")


@contextmanager
def session():
    conn = connect()
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()
