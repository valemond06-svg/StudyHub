# PROJECT_STATE.md — StudioHub (Sprint 2A Completato)

## Stato verificato al 2026-11-17

### Repository
- **Path**: `C:\Users\valem\Desktop\02_Università\_StudyHub`
- **Branch attivo**: `ai/sprint2-security-foundation` (da `ai/studyhub-frontend-v3`)
- **Commit HEAD Sprint 1.5**: `f02e2f8` — UX Sprint 1 - FE-001/UX-001
- **Commit main**: `9494fc6` — studyhub login: rinnova anche i cookie Panopto

### Modifiche Sprint 2A (SEC-010 + SEC-012)

**Backend - Nuovi file:**
- `backend/src/studyhub/backup.py` — Modulo backup Restic completo (init, backup, check, restore, verify)
- `backend/src/studyhub/ai/privacy.py` — Privacy filter StudyHub-specific (analisi sensibilità, check provider, scope)
- `backend/tests/test_privacy.py` — 19 test privacy filter

**Backend - File modificati:**
- `backend/src/studyhub/config.py` — `db_path` → `LOCAL_DIR/studyhub.db`, aggiunto `old_db_path` per migrazione
- `backend/src/studyhub/ai/llm.py` — Integrazione privacy filter in `_gemini`, `run_json`, `run_json_content`

**Database Migration:**
- DB spostato da `C:\Users\valem\Desktop\02_Università\_StudyHub\studyhub.db` (Google Drive) a `C:\Users\valem\.studyhub\studyhub.db` (LOCAL_DIR)
- Migrazione con SQLite Backup API (coerente WAL/SHM)
- Vecchio DB rinominato `studyhub.db.bak-migrated`
- Contenuto identico: v15, 40 tabelle, 17 corsi, 199 lezioni

**Restic Backup:**
- Repo locale: `D:\Backup\restic-studyhub` ✅ inizializzato
- Repo VPS: `sftp:bot@194.164.172.248:/home/bot/restic-studyhub` ✅ configurato
- Password: `~/.studyhub/secrets/restic.pass` (600)
- Primo backup: snapshot 4dffa70c, 348 MiB, 196 file, 2.1s
- `restic check --read-data` ✅ OK
- Restore test ✅ DB verificato (v15, 40 tabelle, 17 corsi)

**Privacy Filter:**
- Deny-by-default per provider esterni (Gemini, Claude)
- Provider locale (Qwen 35B su 10.10.10.1) SEMPRE consentito
- Sensibilità: none/low/medium/high con pattern CF, IBAN, Luhn, email, matricole, keyword
- Modalità: `strict` (default), `permissive`, `local_only` via `STUDYHUB_PRIVACY_MODE`
- Context manager `scope(kind, private)` per job kinds privati
- Audit log senza contenuti privati

### Backend
- **Entry point**: `python -m studyhub.cli serve` (funziona nel venv)
- **Packaging**: `pyproject.toml` con `studyhub = "studyhub.cli:app"` in `[project.scripts]`
- **Venv**: `backend/.venv/` con Python 3.12.10, studyhub.exe installato
- **Database**: `~/.studyhub/studyhub.db` — schema versione 15 ✓
- **Porta**: 8765 in ascolto, servizio sano
- **Test**: **475/475 passati** (456 originali + 19 privacy)

### Frontend
- **Framework**: Vite + React 18 + TypeScript + Tailwind
- **Porta dev**: 5173 (IPv6) / 5177
- **Proxy Vite**: `/api`, `/media`, `/video` → `http://localhost:8765` ✓
- **Build**: `npm run build` — OK (typecheck + vite build)
- **Typecheck**: `tsc --noEmit` — 0 errori
- **Lint**: oxlint — solo warning (variabili inutilizzate, impure function)

### Sprint 2A — Risultati Verificati

| Verifica | Stato | Note |
|----------|-------|------|
| **SEC-010**: DB fuori Google Drive | ✅ COMPLETATO | DB in `~/.studyhub/`, migrazione verificata |
| **SEC-010**: Backup Restic locale | ✅ COMPLETATO | Repo `D:\Backup\restic-studyhub`, snapshot 4dffa70c |
| **SEC-010**: Backup Restic VPS | ✅ CONFIGURATO | Repo SFTP pronto, test manuale successivo |
| **SEC-010**: Check integrità | ✅ VERIFICATO | `restic check --read-data` OK |
| **SEC-010**: Restore test | ✅ VERIFICATO | DB ripristinato e verificato identico |
| **SEC-012**: Privacy filter modulo | ✅ COMPLETATO | `privacy.py` + 19 test |
| **SEC-012**: Integrazione llm.py | ✅ COMPLETATO | `_gemini`, `run_json`, `run_json_content` filtrati |
| **SEC-012**: Anti-bypass | ✅ VERIFICATO | Tutti i percorsi esterni passano per check |
| **Backend tests totali** | ✅ 475/475 PASS | Zero regressioni |

### Architettura Sprint 2A

```
┌─────────────────────────────────────────────────────────────────┐
│                    StudyHub (ai/sprint2-security-foundation)    │
├─────────────────────────────────────────────────────────────────┤
│  Frontend (Vite, React, TS, Tailwind)                          │
│  http://localhost:5173  → proxy /api → Backend :8765           │
├─────────────────────────────────────────────────────────────────┤
│  Backend (FastAPI, SQLite, FTS5, sqlite-vec)                   │
│  http://127.0.0.1:8765                                          │
│  Auth: API Token + CSRF + Privacy Filter                       │
│  Modules: ai/ (llm.py + privacy.py), api/, study/, sync/,      │
│           ingest/, media/, backup/                             │
│  DB: ~/.studyhub/studyhub.db (v15) — FUORI Google Drive        │
│  Security: CORS, path traversal, keyring, privacy filter       │
│  Backup: Restic → D:\Backup\restic-studyhub + VPS SFTP         │
├─────────────────────────────────────────────────────────────────┤
│  Provider AI:                                                   │
│  ┌─────────────┐    ┌──────────────┐    ┌─────────────┐       │
│  │   LOCAL     │───▶│   GEMINI     │───▶│   CLAUDE    │       │
│  │ (Qwen 35B)  │    │  (filtered)  │    │  (filtered) │       │
│  │ ALWAYS OK   │    │ deny-by-def. │    │ deny-by-def.│       │
│  └─────────────┘    └──────────────┘    └─────────────┘       │
├─────────────────────────────────────────────────────────────────┤
│  Integrazioni: Moodle UniVR, Panopto, Whisper, Ollama (bge-m3) │
│  Brain events: /ingest/event (se BRAIN_EVENT_URL configurato)  │
└─────────────────────────────────────────────────────────────────┘
```

### Prossimi passi (Sprint 2B — Core Features Reali)
1. **FE-002**: CorsoDetail "Studia" Tab — Mappa Corso Reale
2. **FE-003/UX-002/003**: Lab + CorsoDetail "Lab" Tab — Flashcard/Quiz Reali (FSRS)
3. **UX-004**: Tutor RAG — Pagina `/lab?tab=tutor` (usa privacy filter)
4. **UX-005**: Exam X-Ray / Simulazioni — Flusso completo (usa privacy filter)
5. **SEC-027**: Llama-Server Bind Restriction + Key Rotation (coordina fixed PC)