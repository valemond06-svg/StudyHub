"""Verifica completa migrazioni database."""
import tempfile
import sqlite3
from pathlib import Path
import sys
sys.path.insert(0, 'src')

def make_settings_mock(db_path):
    from studyhub.config import Settings
    original_db_path = Settings.db_path
    Settings.db_path = property(lambda self: db_path)
    return original_db_path

# Test 1: Database nuovo
print('=== TEST 1: Database nuovo ===')
with tempfile.TemporaryDirectory() as tmp:
    db_path = Path(tmp) / 'test.db'
    original = make_settings_mock(db_path)

    try:
        from studyhub import db as dbmod
        with dbmod.session() as conn:
            version = conn.execute('PRAGMA user_version').fetchone()[0]
            tables = {r[0] for r in conn.execute('SELECT name FROM sqlite_master WHERE type="table"')}
            print(f'Version: {version}')
            print(f'Tables: {sorted(tables)}')
            print(f'Expected migrations: {len(dbmod.MIGRATIONS)}')
            assert version == len(dbmod.MIGRATIONS), f'Version mismatch: {version} != {len(dbmod.MIGRATIONS)}'
            for t in ('courses', 'lectures', 'flashcards', 'study_items', 'study_topics', 'exam_sims', 'doc_tags', 'chunks_fts'):
                assert t in tables, f'Missing table: {t}'
        print('✓ Database nuovo OK')
    finally:
        from studyhub.config import Settings
        Settings.db_path = original

# Test 2: Database con migrazioni parziali (versione 3)
print()
print('=== TEST 2: Migrazione parziale (v3 → current) ===')
with tempfile.TemporaryDirectory() as tmp:
    db_path = Path(tmp) / 'test.db'
    original = make_settings_mock(db_path)

    try:
        from studyhub import db as dbmod
        conn = sqlite3.connect(db_path)
        for sql in dbmod.MIGRATIONS[:3]:
            conn.executescript(sql)
        conn.execute('PRAGMA user_version = 3')
        conn.commit()
        conn.close()

        with dbmod.session() as conn:
            version = conn.execute('PRAGMA user_version').fetchone()[0]
            cols = {r[1] for r in conn.execute('PRAGMA table_info(lectures)')}
            print(f'Version after migrate: {version}')
            print(f'lectures columns: {sorted(cols)}')
            assert version == len(dbmod.MIGRATIONS), f'Version mismatch: {version}'
            assert 'media_url' in cols, 'Missing media_url column (added in later migration)'
        print('✓ Migrazione parziale OK')
    finally:
        from studyhub.config import Settings
        Settings.db_path = original

# Test 3: Idempotenza
print()
print('=== TEST 3: Idempotenza ===')
with tempfile.TemporaryDirectory() as tmp:
    db_path = Path(tmp) / 'test.db'
    original = make_settings_mock(db_path)

    try:
        from studyhub import db as dbmod
        with dbmod.session() as conn:
            conn.execute('INSERT INTO courses (id, fullname) VALUES (7, "Fisica")')
        # Riapertura
        with dbmod.session() as conn:
            name = conn.execute('SELECT fullname FROM courses WHERE id=7').fetchone()[0]
            version = conn.execute('PRAGMA user_version').fetchone()[0]
            print(f'Course name: {name}')
            print(f'Version: {version}')
            assert name == 'Fisica', 'Data lost on reopen'
            assert version == len(dbmod.MIGRATIONS), 'Version changed on reopen'
        print('✓ Idempotenza OK')
    finally:
        from studyhub.config import Settings
        Settings.db_path = original

# Test 4: Integrità referenziale
print()
print('=== TEST 4: Foreign Keys ===')
with tempfile.TemporaryDirectory() as tmp:
    db_path = Path(tmp) / 'test.db'
    original = make_settings_mock(db_path)

    try:
        from studyhub import db as dbmod
        with dbmod.session() as conn:
            try:
                conn.execute('INSERT INTO sections (id, course_id) VALUES (1, 999)')
                ok = True
            except sqlite3.IntegrityError:
                ok = False
        print(f'FK violation caught: {not ok}')
        assert not ok, 'Foreign key not enforced'
        print('✓ Foreign Keys OK')
    finally:
        from studyhub.config import Settings
        Settings.db_path = original

# Test 5: Indice unico parziale su ai_jobs (migrazione 14)
print()
print('=== TEST 5: Indice unico parziale ai_jobs ===')
with tempfile.TemporaryDirectory() as tmp:
    db_path = Path(tmp) / 'test.db'
    original = make_settings_mock(db_path)

    try:
        from studyhub import db as dbmod
        with dbmod.session() as conn:
            # Insert job in_coda
            conn.execute("INSERT INTO ai_jobs (kind, target_id, status, created_at) VALUES ('lecture_notes', 1, 'in_coda', '2026-01-01')")
            # Try duplicate in_coda - should fail
            try:
                conn.execute("INSERT INTO ai_jobs (kind, target_id, status, created_at) VALUES ('lecture_notes', 1, 'in_coda', '2026-01-01')")
                dup_allowed = True
            except sqlite3.IntegrityError:
                dup_allowed = False
            # Insert job fatto - should be allowed (different status)
            conn.execute("INSERT INTO ai_jobs (kind, target_id, status, created_at) VALUES ('lecture_notes', 1, 'fatto', '2026-01-01')")
            # Insert job errore - should be allowed (different status)
            conn.execute("INSERT INTO ai_jobs (kind, target_id, status, created_at) VALUES ('lecture_notes', 1, 'errore', '2026-01-01')")
            # Count
            count = conn.execute("SELECT COUNT(*) FROM ai_jobs WHERE kind='lecture_notes' AND target_id=1").fetchone()[0]
            print(f'Duplicate in_coda blocked: {not dup_allowed}')
            print(f'Total jobs for same kind/target_id: {count}')
            assert not dup_allowed, 'Unique index not blocking duplicates in_coda'
            assert count == 3, 'Should allow fatto/errore duplicates'
        print('✓ Indice unico parziale OK')
    finally:
        from studyhub.config import Settings
        Settings.db_path = original

print()
print('=== TUTTI I TEST MIGRAZIONI PASSATI ===')
