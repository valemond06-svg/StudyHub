"""Test path traversal protection."""
import sys
sys.path.insert(0, 'src')
import os
os.environ['STUDYHUB_API_TOKEN'] = 'test-api-token-12345'

from fastapi.testclient import TestClient
from studyhub.api.app import app
from studyhub.paths import uni_path
from studyhub.config import settings
from pathlib import Path
import tempfile
import sqlite3

client = TestClient(app, raise_server_exceptions=False)

# Test uni_path() direttamente
print('=== Test uni_path() ===')

with tempfile.TemporaryDirectory() as tmp:
    uni_root = Path(tmp)
    # Monkeypatch settings.uni_root
    import studyhub.config as config_module
    original_uni_root = config_module.settings.uni_root
    config_module.settings.uni_root = uni_root

    try:
        # Crea struttura di test
        (uni_root / "course1").mkdir(parents=True)
        (uni_root / "course1" / "test.txt").write_text("ok")

        # Path normale
        p = uni_path("course1/test.txt")
        print(f'Normale: {p} - exists: {p.exists()}')
        assert p.exists()

        # Path traversal con ..
        try:
            p = uni_path("course1/../../etc/passwd")
            print(f'Traversale ..: {p} - ERRORE: avrebbe dovuto fallire')
            assert False, 'Should have raised'
        except ValueError as e:
            print(f'Traversale .. bloccato: {e}')

        # Path traversal con separatori alternativi
        try:
            p = uni_path("course1\\..\\..\\etc\\passwd")
            print(f'Traversale backslash: {p} - ERRORE: avrebbe dovuto fallire')
            assert False, 'Should have raised'
        except ValueError as e:
            print(f'Traversale backslash bloccato: {e}')

        # Path assoluto
        try:
            p = uni_path("/etc/passwd")
            print(f'Path assoluto: {p} - ERRORE: avrebbe dovuto fallire')
            assert False, 'Should have raised'
        except ValueError as e:
            print(f'Path assoluto bloccato: {e}')

        # Symlink (se supportato)
        try:
            (uni_root / "link").symlink_to(uni_root / "course1")
            p = uni_path("link/test.txt")
            print(f'Symlink dentro root: {p} - exists: {p.exists()}')
            assert p.exists()
        except (OSError, NotImplementedError):
            print('Symlink non supportato su questo FS')

    finally:
        config_module.settings.uni_root = original_uni_root

# Test endpoint /media/ con database isolato
print()
print('=== Test endpoint /media/ ===')

with tempfile.TemporaryDirectory() as tmp:
    uni_root = Path(tmp)
    db_path = uni_root / 'test.db'
    import studyhub.config as config_module
    original_uni_root = config_module.settings.uni_root
    original_db_path = config_module.Settings.db_path
    config_module.settings.uni_root = uni_root
    config_module.Settings.db_path = property(lambda self: db_path)

    try:
        # Init DB
        from studyhub import db as dbmod
        with dbmod.session() as conn:
            conn.execute('INSERT INTO courses (id, fullname, folder) VALUES (999, "Test", "course1")')
            conn.execute('INSERT INTO lectures (id, course_id, title, date, number, folder, status) VALUES (999, 999, "Lez 1", "2026-01-01", 1, "course1", "media_ok")')

        # Crea file
        (uni_root / "course1").mkdir(parents=True, exist_ok=True)
        (uni_root / "course1" / "audio.opus").write_bytes(b"fake audio")

        # Richiesta normale
        r = client.get('/media/999/audio.opus', headers={'Authorization': 'Bearer test-api-token-12345'})
        print(f'Normale: {r.status_code}')

        # Traversale
        r = client.get('/media/999/../../etc/passwd', headers={'Authorization': 'Bearer test-api-token-12345'})
        print(f'Traversale /media: {r.status_code} - {r.json() if r.status_code != 200 else "OK"}')
        assert r.status_code == 404, 'Should be 404'

    finally:
        config_module.settings.uni_root = original_uni_root
        config_module.Settings.db_path = original_db_path

print()
print('=== TUTTI I TEST PATH TRAVERSAL PASSATI ===')