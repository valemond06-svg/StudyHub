# DATABASE_STORAGE_DESIGN.md — StudioHub Sprint 2A

**Data**: 2026-11-17  
**Branch**: `ai/sprint2-security-foundation`  
**Status**: IMPLEMENTED + VERIFIED

---

## Obiettivo

Separare il database operativo SQLite dalla sincronizzazione Google Drive, spostandolo in una directory locale appropriata (`~/.studyhub/`) e implementare backup cifrati tramite Restic.

---

## Analisi Pre-Implementazione

### Percorsi Originali
| Componente | Percorso Originale | Problema |
|------------|-------------------|----------|
| Database principale | `C:\Users\valem\Desktop\02_Università\_StudyHub\studyhub.db` | Sincronizzato con Google Drive (Desktop) |
| Media root | `G:\Il mio Drive\StudyHub` (config.yaml) | Già su Google Drive, OK |
| LOCAL_DIR | `C:\Users\valem\.studyhub` | Già usato per secrets, cache, browser-profile |

### Riferimenti al Database Individuati
- `backend/src/studyhub/config.py`: `Settings.db_path` property → `APP_DIR / "studyhub.db"`
- `backend/src/studyhub/db.py`: `connect()` usa `settings.db_path`
- `backend/src/studyhub/doctor.py`: usa `settings.db_path`
- `backend/src/studyhub/cli.py`: nessun riferimento diretto

---

## Implementazione

### 1. Configurazione (`config.py`)

**Modifiche**:
```python
@property
def db_path(self) -> Path:
    # Database in LOCAL_DIR (~/.studyhub) — NON in Google Drive (APP_DIR)
    return LOCAL_DIR / "studyhub.db"

@property
def old_db_path(self) -> Path:
    """Percorso vecchio del database (in APP_DIR, sincronizzato con Google Drive).
    Usato per la migrazione una tantum."""
    return APP_DIR / "studyhub.db"
```

- `LOCAL_DIR = Path(os.environ.get("STUDYHUB_LOCAL_DIR", Path.home() / ".studyhub"))` (già esistente)
- `APP_DIR` rimane il percorso del progetto per codice/config

### 2. Migrazione Database

**Script**: `migrate_db.py` (utilizza SQLite Backup API)

```python
with sqlite3.connect(old_path) as source:
    with sqlite3.connect(new_path) as dest:
        source.backup(dest)  # Coerente con WAL/SHM
```

**Risultato**:
- Vecchio DB: `C:\Users\valem\Desktop\02_Università\_StudyHub\studyhub.db` (318 MB, v15, 40 tabelle, 17 corsi, 199 lezioni)
- Nuovo DB: `C:\Users\valem\.studyhub\studyhub.db` (identico contenuto)
- Vecchio DB rinominato a `studyhub.db.bak-migrated` (backup di sicurezza)

### 3. Verifica Funzionamento

- Backend avviato con nuovo DB → `/api/courses` risponde 200 con 17 corsi
- Tutti i 475 test backend passano
- Nessuna regressione rilevata

---

## Restic Backup Implementation

### Modulo: `backend/src/studyhub/backup.py`

**Repository**:
- Locale: `D:\Backup\restic-studyhub`
- VPS (SFTP): `sftp:bot@194.164.172.248:/home/bot/restic-studyhub`
- Google Drive (opzionale, via rclone): `rclone:gdrive:StudyHub/restic`

**Password**: Gestita in `~/.studyhub/secrets/restic.pass` (generata al primo uso, `chmod 600`)

**Percorsi in Backup**:
1. Database: `~/.studyhub/studyhub.db`
2. Cache OCR: `~/.studyhub/ocr/`
3. Cache export: `~/.studyhub/cache/`

**Esclusioni**: `node_modules`, `.venv`, `__pycache__`, `*.log`, `*.lock`, `.git`, `*.db-shm`, `*.db-wal`

**Retention Policy**:
- Daily: 14
- Weekly: 8
- Monthly: 12

**Comandi Principali**:
```python
from studyhub.backup import backup, check_integrity, list_snapshots, restore_latest, verify_restore

# Backup
result = backup(["local", "vps"])

# Verifica integrità
result = check_integrity(["local"])

# Lista snapshot
snapshots = list_snapshots(["local"])

# Test restore
with tempfile.TemporaryDirectory() as tmp:
    result = restore_latest("local", Path(tmp), ["/home/valem/.studyhub/studyhub.db"])
    verify = verify_restore(Path(tmp) / "home" / "valem" / ".studyhub" / "studyhub.db")
```

---

## Verifica Backup & Restore (Completata)

### 1. Inizializzazione Repo Locale
```
init_repo("local") → "created"
```

### 2. Primo Backup
```
backup(["local"]) → OK
- Files new: 196
- Data added: 365 MB (258 MB packed)
- Snapshot: 4dffa70c
- Durata: 2.1s
```

### 3. Verifica Integrità (`restic check --read-data`)
```
check_integrity(["local"]) → OK
- Repository sano, tutti i dati leggibili
```

### 4. Restore Test
```
restore_latest("local", tmpdir, ["/home/valem/.studyhub/studyhub.db"]) → OK
- DB ripristinato in struttura directory originale
verify_restore() → OK
- Version: 15
- Tables: 40
- Courses: 17
- Integrity: ok
```

---

## Sicurezza

- Password Restic solo in file `~/.studyhub/secrets/restic.pass` (600)
- Nessuna credenziale in codice o config
- Repo VPS via SFTP con chiave SSH `id_ed25519_2026b`
- Log sanitizzati: `_sanitize_error()` rimuove URL repo, host, IP, percorsi

---

## Compatibilità

- Migrazione una tantum: script idempotente (controlla versioni prima di copiare)
- Vecchio DB mantenuto come `.bak-migrated` per rollback manuale
- `settings.old_db_path` disponibile per tooling futuro
- Nessuna modifica a schema DB (user_version = 15 invariato)

---

## Prossimi Passi (Sprint 2B+)

- [ ] Aggiungere backup automatico schedulato (Windows Task Scheduler / systemd timer)
- [ ] Integrare notifiche backup in Brain (`/ingest/event` type `backup.restic`)
- [ ] Test restore da repo VPS (disaster recovery)
- [ ] Documentare procedura di disaster recovery completa