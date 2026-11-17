# ARCHITECTURE_CURRENT.md — StudioHub (Fase Zero)

## Panoramica architetturale (stato reale al 2026-11-17)

---

## 1. Backend — FastAPI + SQLite

### Struttura moduli
```
backend/src/studyhub/
├── __main__.py           # Entry point: from .cli import app
├── cli.py                # Typer CLI: studyhub serve, login, courses, notte, auto-sync, doctor, fullrun
├── config.py             # Settings (Pydantic Settings), config.yaml
├── db.py                 # SQLite connection + 15 migrazioni (PRAGMA user_version)
├── paths.py              # uni_path() per percorso corsi
├── autosync.py           # Moodle sync incrementale, budget lezioni
├── brain_events.py       # POST /ingest/event al Brain
├── doctor.py             # Health checks (DB, login, Chromium, Ollama)
├── fullrun.py            # Elaborazione completa (notte)
├── ingest/               # Pipeline ingest documenti
├── media/                # Panopto, Whisper, download
├── notify.py             # Notifiche desktop (plyer)
├── notte.py              # Turno di notte (fasi sequenziali)
├── search.py             # FTS5 + sqlite-vec (BM25 + vettori)
├── sync/                 # Moodle catalog, course, auth (Playwright)
├── api/                  # FastAPI routes
│   └── app.py            # 70+ endpoints /api/*
└── study/                # Logica di studio
    ├── planner.py        # today_plan() — piano giornaliero
    ├── session.py        # Sessioni studio (warmup→learn→practice→boss→cooldown)
    ├── lesson.py         # Lezioni interattive (step, domande, esempi)
    ├── quiz.py           # Quiz adattivi, banco domande, shuffle
    ├── exam.py           # Profilo esame, simulazioni, appelli passati
    └── fsrs.py           # Algoritmo FSRS (spaced repetition)
```

### Database — SQLite (studyhub.db)
- **Schema version**: 15 (PRAGMA user_version)
- **Tabelle principali**: courses, lectures, ai_jobs, ai_outputs, flashcards, reviews, quizzes, quiz_attempts, exam_sims, exams, study_sessions, study_items, study_lessons, study_topics, study_units, tutor_threads, tutor_messages, chunks (FTS5), vec_chunks (sqlite-vec), sections, modules, documents, pages, files, sync_runs, notifications, media_sources, doc_tags
- **Estensioni**: FTS5 (built-in), sqlite-vec (opzionale, fallback NumPy)
- **Indici**: idx_ai_jobs_unique (partial unique su status in_coda/in_corso)

### API endpoints (principali)
| Area | Endpoints |
|------|-----------|
| Corsi | GET /api/courses, /api/courses/{id}, /api/courses/{id}/lectures, /api/courses/{id}/notes-index |
| Lezioni | GET /api/lectures/{id}, /api/lectures/{id}/notes, POST /api/lectures/{id}/notes |
| Media | GET /video/{lecture_id}/{kind}, /media/{lecture_id}/{path} |
| AI | GET /api/ai/status, /api/ai/providers, /api/ai/pannello, POST /api/ai/queue, /api/ai/cancel |
| Flashcards | GET /api/flashcards/due, POST /api/flashcards/import, POST /api/flashcards/{id}/review |
| Tutor | GET/POST /api/tutor/threads, GET/POST /api/tutor/threads/{id}/ask |
| Quiz | GET /api/lectures/{id}/quizzes, POST /api/lectures/{id}/quiz, GET/POST /api/quizzes/{id}/submit |
| Studio | GET /api/plan, /api/study, /api/study/{id}, POST /api/study/{id}/prepare, /scan, /sessions |
| Esami | GET /api/courses/{id}/exam, POST /api/courses/{id}/exam/profile, POST /api/courses/{id}/exam/sims |
| Setup | GET /api/setup, POST /api/setup/login, /courses, /fullrun |

### AI Jobs Queue
- **Tipi**: lecture_notes, lecture_quiz, lecture_topics, exam_profile, exam_sim, study_lesson
- **Status**: in_coda → in_corso → fatto / errore / annullato
- **Priorità**: numerica (più alto = prima)
- **Backoff**: lezioni/errore → next_retry_at (1h, 6h, 24h, max 3 tentativi)
- **Worker**: singolo (llama-server 1 slot), processati di notte

### Turno di notte (`studyhub notte --solo-locale`)
Fasi sequenziali (mai sovrapposte):
1. Whisper + embedding (GPU)
2. Scarico Ollama da memoria
3. Unità di studio col 35B (CPU)
4. Job AI in coda (Claude Sonnet per note)

### Sync Moodle
- `auto-sync`: incrementale, salta se turno notte o fullrun attivi
- Login: Playwright + Chromium (profilo persistente), SSO UniVR
- Token: app mobile Moodle + cookie Panopto nello stesso profilo
- Catalogo: corsi.yaml (classificazione per anno)

---

## 2. Frontend — Vite + React 18 + TypeScript + Tailwind

### Struttura
```
studyhub-frontend/src/
├── main.tsx                    # React root, QueryClientProvider, BrowserRouter
├── App.tsx                     # Routes + lazy loading + MainLayout
├── lib/
│   ├── api.ts                  # API layer (request<T>, enhanceLecture/Course, queryClient)
│   └── utils.ts                # cn() (clsx + tailwind-merge)
├── components/
│   ├── ui/                     # shadcn/ui (Button, Card, Badge, Progress, Tabs, ScrollArea, Input, Dialog, etc.)
│   ├── layout/                 # MainLayout, Header, Sidebar
│   ├── player/                 # VideoPlayer (custom)
│   ├── command-palette.tsx     # ⌘K global search
│   └── gamification/           # XP, streak, badges (nuovo)
├── hooks/
│   └── use-gamification.ts     # Gamification state
├── pages/
│   ├── Home.tsx                # Dashboard: corsi, prossimi esami, attività oggi, ripassi dovuti
│   ├── Corsi.tsx               # Elenco corsi con filtri, ricerca, stato
│   ├── CorsoDetail.tsx         # 4 tab: Studia, Lezioni, Esame, Lab
│   ├── Studio.tsx              # Sessione guidata (5 fasi) — USA MOCK DATA
│   ├── Lab.tsx                 # Flashcard, Quiz, Tutor, Ricerca, Export, Pomodoro
│   └── Impostazioni.tsx        # Provider AI, Sync, Tema, Backup, Privacy, Feature flags
└── types/
    └── index.ts                # TypeScript interfaces (Course, Lecture, Exam, ExamProfile, Simulation, etc.)
```

### Routing
```
/                          → Home
/corsi                     → Corsi (elenco)
/corsi/:id                 → CorsoDetail (4 tab)
/studio/:courseId          → Studio (sessione guidata)
/lab                       → Lab (strumenti trasversali)
/impostazioni              → Impostazioni
```

### State Management
- **TanStack Query** (v5): server state (corsi, lezioni, exam, plan, flashcard, quiz, tutor)
- **Zustand**: client state (UI, gamification, command palette)
- **React Router v6**: routing con lazy loading + Suspense

### Design System
- **Tailwind v4** (via @tailwindcss/vite)
- **shadcn/ui** (Radix UI primitives)
- **Palette**: neutral + accent (blue #3d52ff) + semantic (success, warning, destructive)
- **Dark mode**: class-based (media query + manual toggle)
- **Tipografia**: Inter (sans), JetBrains Mono (code)
- **Icone**: lucide-react

### Build & Dev
- **Dev**: `npm run dev` (Vite HMR, porta 5173+)
- **Build**: `npm run build` → `tsc -b && vite build` (esbuild + Rollup)
- **Preview**: `npm run preview`
- **Lint**: `oxlint`

### API Contract (frontend ↔ backend)
- Base URL: `""` (proxy Vite su `/api`, `/media`, `/video`)
- `request<T>(path, options)`: fetch wrapper con error handling
- Transformazioni: `enhanceLecture`, `enhanceLectures`, `enhanceCourse`
- Tipi: `Course`, `Lecture`, `ExamProfile`, `Simulation`, `PlanData`, `Flashcard`, `Quiz`, ecc.

---

## 3. Integrazioni esterne

| Servizio | Uso | Auth |
|----------|-----|------|
| Moodle UniVR | Corsi, lezioni, risorse, video | Playwright + SSO (cookie) |
| Panopto | Registrazioni video | Cookie nello stesso profilo Chromium |
| Whisper (faster-whisper) | Trascrizione audio | Locale (GPU/CPU) |
| Ollama (bge-m3) | Embedding vettoriali ricerca | Locale (HTTP) |
| llama.cpp / llama-server | Modello 35B locale (quiz, esercizi) | Locale (HTTP, 1 slot) |
| Claude Sonnet (API) | Appunti lezioni, profilo esame, simulazioni | API key (config.yaml) |
| FreeLLMAPI (VPS) | ~~Disabilitato per privacy~~ | — |
| Brain (Second Brain) | Eventi: studyhub.sync, studyhub.notte, studyhub.ai_job_fallito | POST /ingest/event |

---

## 4. Deployment & Operations

### Windows (laptop — client)
- Installer: `installa.ps1` → `%USERPROFILE%\.studyhub\venv`, Playwright Chromium, collegamento desktop
- Launcher: `studyhub.bat` / `start.bat` → `python -m studyhub.cli %*`
- MCP server: `python -m studyhub.mcp_server` (registrato in Claude Code)

### Linux (PC fisso — server)
- systemd service: `studyhub` (porta 8765)
- Timer: `brain-notte.timer` → `notte.sh` ogni notte 22:30
- Venv: `/opt/brain/.venv` o locale
- Whisper + Ollama + llama-server come servizi

### Database & Backup
- `studyhub.db` (SQLite WAL mode)
- Backup: restic su D: e VPS (config `brain-backup-pc.md`)
- Migrazioni: automatiche all'avvio (PRAGMA user_version)

---

## 5. Dipendenze chiave

### Backend (pyproject.toml)
```
fastapi>=0.156.7, uvicorn, typer, rich, playwright, beautifulsoup4,
faster-whisper>=1.2.1, sqlite-vec, sqlite-utils, pydantic, pydantic-settings,
python-dotenv, httpx, tenacity, apscheduler, plyer, watchdog
```

### Frontend (package.json)
```
react@18, react-dom, react-router-dom@6,
@tanstack/react-query@5, zustand,
tailwindcss@4, @tailwindcss/vite,
@radix-ui/* (12+ componenti), lucide-react,
date-fns, clsx, tailwind-merge,
vite@8, typescript, oxlint
```

---

## 6. Gap noti vs specifiche (da audit precedenti)

| Area | Gap |
|------|-----|
| Studio.tsx | **Prevalentemente mock data** — non collegato a endpoint reali |
| API contracts | Alcuni mismatch (risolti in Fase Zero per Course) |
| Accessibilità | Mancanti ARIA, focus management, keyboard nav |
| Toast system | Implementazione fragile |
| State management | Navigazione/componenti con stato fragile |
| Mutazioni | Endpoint POST/PUT senza CSRF/protezione adeguata |
| Cookie/token | Moodle/Panopto in chiaro (config.yaml, file system) |
| FreeLLMAPI | Disabilitata (privacy) — necessaria soluzione verificata |
| Quiz/Esami | Validazione e shuffle risposte problematici |
| File upload | Possibile perdita in finalize() |

---

## 7. Decisioni architetturali confermate

1. **Single-page React app** servita da Vite (dev) / backend static files (prod)
2. **SQLite locale** come source of truth — no server DB remoto
3. **AI locale notturna** (35B) per generazione quiz/esercizi; **Claude Sonnet** (API) per note/profilo esame
4. **Event-driven Brain integration** — fire-and-forget con coda locale di fallback
5. **Privacy-first**: contenuti didattici non vanno a provider esterni senza filtro (FreeLLMAPI disabilitata)
6. **No mock in production code** — Studio.tsx deve usare dati reali
7. **Apple-minimal design** — shadcn/ui + Tailwind, niente librerie UI pesanti