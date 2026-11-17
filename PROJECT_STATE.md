# PROJECT_STATE.md — StudioHub (Fase Zero)

## Stato verificato al 2026-11-17

### Repository
- **Path**: `C:\Users\valem\Desktop\02_Università\_StudyHub`
- **Branch attivo**: `ai/studyhub-frontend-v3` (up-to-date con origin)
- **Commit HEAD**: `b681e0c` — fix(vite): proxy /api /media /video verso backend su porta 8765
- **Commit main**: `9494fc6` — studyhub login: rinnova anche i cookie Panopto

### Modifiche non committate (14 file)
**Backend (7):**
- `ai/jobs.py`, `ai/llm.py`, `api/app.py`, `db.py`
- `study/exam.py`, `study/lesson.py`, `study/quiz.py`, `study/session.py`

**Frontend (7):**
- `App.tsx`, `lib/api.ts`, `pages/CorsoDetail.tsx`, `pages/Home.tsx`
- `pages/Impostazioni.tsx`, `types/index.ts`

### File non tracciati (11)
- `backend/fix_freellm.ps1`, `backend/src/studyhub/__main__.py`
- `studyhub-frontend/check_build.cjs`, `check_vite.cjs`
- `src/components/command-palette.tsx`
- `src/components/gamification/` (directory)
- `src/components/player/` (directory)
- `src/hooks/use-gamification.ts`
- `src/lib/lectureTransform.ts`
- `test_transform.cjs`, `test_transform.js`

### Backend
- **Entry point**: `python -m studyhub.cli serve` (funziona nel venv)
- **Packaging**: `pyproject.toml` con `studyhub = "studyhub.cli:app"` in `[project.scripts]`
- **Venv**: `backend/.venv/` con Python 3.12.10, studyhub.exe installato
- **Database**: `studyhub.db` — schema versione 15 (15 migrazioni in working tree = 15 in DB) ✓
- **Porta**: 8765 in ascolto (PID 2760), servizio sano
- **Test**: 456/456 passati (0 fail)

### Frontend
- **Framework**: Vite + React 18 + TypeScript + Tailwind
- **Porta dev**: 5177 (5173-5176 occupate)
- **Proxy Vite**: `/api`, `/media`, `/video` → `http://localhost:8765` ✓
- **Build**: `npm run build` — OK (typecheck + vite build)
- **Lint**: oxlint — solo warning (variabili inutilizzate, impure function Date.now)

### Problemi bloccanti risolti

#### A. Avvio backend — RISOLTO
- **Problema**: `python -m studyhub` → `No module named studyhub.__main__`
- **Causa**: Il comando corretto è `python -m studyhub.cli serve` o `studyhub serve` (entrypoint `studyhub.exe` nel venv)
- **Verifica**: Backend avvia e risponde su `/api/ai/status`, `/api/courses`, ecc.

#### B. Schermata bianca CorsoDetail — RISOLTO
- **Problema 1**: `api.ts` duplicato (due copie concatenate) → corretto
- **Problema 2**: `request()` non generico → reso `request<T = any>()`
- **Problema 3**: `enhanceLectures` arrow function con implicit return object → esplicitato con block body
- **Problema 4**: `Brain` import duplicato in `CorsoDetail.tsx` → rimosso
- **Problema 5**: Mismatch tipi `Course` — backend non fornisce `shortname`, `semester`, `readiness`, `next_exam_date` → aggiunto `enhanceCourse()` in api.ts
- **Verifica**: Frontend build OK, proxy API funziona, dati corsi/lezioni arrivano correttamente

### Architettura attuale

```
┌─────────────────────────────────────────────────────────────────┐
│                    StudyHub (ai/studyhub-frontend-v3)           │
├─────────────────────────────────────────────────────────────────┤
│  Frontend (Vite, React, TS, Tailwind)                          │
│  http://localhost:5177  → proxy /api → Backend :8765           │
│  Pages: Home, Corsi, CorsoDetail, Studio, Lab, Impostazioni    │
│  State: Zustand + TanStack Query                                │
├─────────────────────────────────────────────────────────────────┤
│  Backend (FastAPI, SQLite, FTS5, sqlite-vec)                   │
│  http://127.0.0.1:8765                                          │
│  Modules: ai/, api/, study/, sync/, ingest/, media/            │
│  DB: studyhub.db (schema v15)                                   │
│  AI: Claude Sonnet (notes), 35B locale (quiz), FreeLLMAPI      │
├─────────────────────────────────────────────────────────────────┤
│  Integrazioni: Moodle UniVR, Panopto, Whisper, Ollama (bge-m3) │
│  Brain events: /ingest/event (se BRAIN_EVENT_URL configurato)  │
└─────────────────────────────────────────────────────────────────┘
```

### Prossimi passi (Fase Uno)
Avviare 4 audit specialistici in parallelo (sola lettura):
1. **Backend & Data Architecture** — FastAPI, DB, AI jobs, sync, migrazioni
2. **Frontend & Application Engineering** — Pagine, componenti, routing, state, performance
3. **Study UX & Pedagogical Engine** — Sessioni studio, FSRS, quiz, tutor, video, gamification
4. **Security & Privacy** — Auth, CSRF, CORS, cookie, token, privacy contenuti, AI providers