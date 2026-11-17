# ROADMAP.md — StudioHub Fase Due (Consolidamento 4 Audit)

**Data**: 2026-11-17  
**Baseline**: 4 audit specialistici (Backend, Frontend, UX, Security) — 154 issue totali  
**Sprint 1.5 COMPLETATO**: 2026-11-17 — Integration, Regression & Quality Gate

---

## Regole di Ownership (File Condivisi → Unico Proprietario)

| File / Area | Proprietario | Agenti che NON toccano |
|-------------|--------------|------------------------|
| `studyhub-frontend/src/lib/api.ts` | **Frontend Agent** | Backend, UX, Security |
| `studyhub-frontend/src/types/index.ts` | **Frontend Agent** | Tutti gli altri |
| `studyhub-frontend/src/pages/Studio.tsx` | **UX Agent** | Frontend, Backend, Security |
| `studyhub-frontend/src/pages/CorsoDetail.tsx` | **UX Agent** | Frontend, Backend, Security |
| `studyhub-frontend/src/pages/Lab.tsx` | **UX Agent** | Frontend, Backend, Security |
| `studyhub-frontend/src/pages/Home.tsx` | **Frontend Agent** | UX, Backend, Security |
| `studyhub-frontend/src/components/player/VideoPlayer.tsx` | **Frontend Agent** | UX, Backend, Security |
| `backend/src/studyhub/api/app.py` | **Backend Agent** | Frontend, UX, Security |
| `backend/src/studyhub/ai/llm.py` | **Backend Agent** | Security (audit only), Frontend, UX |
| `backend/src/studyhub/db.py` | **Backend Agent** | Tutti gli altri |
| `backend/src/studyhub/study/session.py` | **Backend Agent** | UX (richiede modifiche API), Frontend, Security |
| `backend/src/studyhub/study/fsrs.py` | **Backend Agent** | UX, Frontend |
| `backend/src/studyhub/study/exam.py` | **Backend Agent** | UX, Frontend |
| `backend/src/studyhub/sync/auth.py` | **Security Agent** | Backend, Frontend, UX |
| `backend/src/studyhub/media/panopto.py` | **Security Agent** | Backend, Frontend, UX |
| `backend/src/studyhub/config.py` | **Security Agent** | Backend, Frontend, UX |
| `studyhub-frontend/src/store/session.ts` | **Frontend Agent** | UX, Backend |
| `studyhub-frontend/src/hooks/use-gamification.ts` | **Frontend Agent** | UX, Backend |
| `config.yaml` | **Security Agent** | Tutti gli altri |

**Principio**: Chi ha l'ownership implementa; gli altri inviano **richieste di modifica (PR/issue)** con specifiche esatte, non modificano direttamente.

---

## ✅ Sprint 1.5 COMPLETATO (2026-11-17) — Integration, Regression & Quality Gate

| Task | Stato | Commit / Note |
|------|-------|---------------|
| **SEC-002**: Secrets → Keyring + fallback file | ✅ DONE | `config.py`: `_keyring_get/set`, `get_or_create_api_token()` |
| **SEC-008**: `local_llm_key` → Env var + rotate | ✅ DONE | `config.py`: priorità env var, keyring, file; `config.yaml` deprecated |
| **SEC-001/005**: CSRF Double-Submit | ✅ DONE | Nuovo `csrf.py` + middleware; cookie `HttpOnly`, `SameSite=Strict`, `Secure` |
| **SEC-003**: API Token Auth (Bearer) | ✅ DONE | `get_current_token` dependency su tutti `/api/*` |
| **FE-001 + UX-001**: Studio.tsx → API reali | ✅ DONE | 5 phase components, `requestAnimationFrame` timer, Zustand store |
| **BE-001**: Migrazione duplicata rimossa | ✅ DONE | `db.py`: 14 migrazioni, indice unico parziale v14 |
| **Test backend** | ✅ 456/456 PASS | Fixato `test_vuoto` flaky (fixture `locale`) |
| **Frontend build + typecheck** | ✅ PASS | Vite build OK, `tsc --noEmit` 0 errori |
| **Security E2E** | ✅ VERIFICATO | Keyring, Auth, CSRF, Path traversal, Migrazioni DB |
| **Studio Flow E2E** | ✅ VERIFICATO | 5 fasi, dati reali, persistenza sessione |
| **API Contract** | ✅ 62/66 OK | 4 endpoint 500 attesi (servizi esterni) |

---

## Priorità Alta — Sprint 2 (Settimane 3-4): Core Features Reali

### 🟠 FE-002: CorsoDetail "Studia" Tab — Mappa Corso Reale
**Owner**: UX Agent  
**Files**: `CorsoDetail.tsx`, `api.ts` (add `getStudyTopics`), `backend/study/planner.py`  
**Scope**: Sostituire array hardcoded con `useQuery(["study-topics", courseId])` → `/api/study/{id}` + topics endpoint  
**Tests**: Mastery per topic = dati reali; progress bars accurate

### 🟠 FE-003 + UX-002/003: Lab + CorsoDetail "Lab" Tab — Flashcard/Quiz Reali
**Owner**: UX Agent  
**Files**: `Lab.tsx`, `CorsoDetail.tsx`, `api.ts`, `backend/study/fsrs.py`, `backend/study/quiz.py`  
**Scope**: 
- Flashcard: `/api/flashcards/due?course_id=` + `/api/flashcards/{id}/review` (FSRS params)
- Quiz: `/api/lectures/{id}/quizzes` + `/api/quizzes/{id}/submit`
- Rimuovere `Math.random()` e stats hardcoded
**Tests**: Lab → Flashcard tab → stats reali; "Inizia ripasso" → sessione FSRS; quiz genera/sottomette

### 🟠 UX-004: Tutor RAG — Implementare Pagina `/lab?tab=tutor`
**Owner**: UX Agent  
**Files**: Nuova `src/pages/Tutor.tsx`, `Lab.tsx` (routing), `api.ts` (tutor endpoints), `backend/study/tutor.py` (verificare esistenza)  
**Scope**: 
- `createTutorThread(course_id, mode)` → thread
- `askTutor(thread_id, question)` → risposta con citazioni
- UI: chat interface, source citations, modal
**Tests**: E2E: Lab → Tutor tab → domanda → risposta con fonti citate

### 🟠 UX-005: Exam X-Ray / Simulazioni — Completare Flusso
**Owner**: UX Agent  
**Files**: `CorsoDetail.tsx` (tab "Esame"), `api.ts`, `backend/study/exam.py`  
**Scope**: 
- `generateExamProfile` già funziona
- `generateSimulations` → `getSimulation` → `submitSimulation` wiring
- UI: timer, submit, score/grade display
**Tests**: E2E: Profilo → Genera simulazione → Completa → Score salvato

### ✅ SEC-010: DB Fuori da Google Drive + Backup Restic — COMPLETATO
**Owner**: Security Agent  
**Files**: `config.py` (db_path → `~/.studyhub/studyhub.db`), `backend/src/studyhub/backup.py` (nuovo modulo)  
**Scope**: 
- Spostato DB da `APP_DIR` (Desktop/Google Drive) a `LOCAL_DIR` (`~/.studyhub/studyhub.db`)
- Migrazione con SQLite Backup API (coerente WAL/SHM)
- Modulo `backup.py` completo: init repo, backup, check --read-data, restore, verify
- Repo locale: `D:\Backup\restic-studyhub`, VPS: `sftp:bot@194.164.172.248:/home/bot/restic-studyhub`
- Password in `~/.studyhub/secrets/restic.pass` (600)
- Retention: 14d/8w/12m
**Tests**: 
- ✅ `ls ~/.studyhub/studyhub.db` exists (318 MB, v15, 40 tabelle)
- ✅ `restic snapshots` → 1 snapshot (4dffa70c, 348 MiB)
- ✅ `restic check --read-data` → OK
- ✅ Restore test → DB verificato (v15, 40 tabelle, 17 corsi, 199 lezioni)
**Deliverable**: `DATABASE_STORAGE_DESIGN.md`, `BACKUP_RESTORE_REPORT.md`

### ✅ SEC-012: Privacy Filter Integration in `llm.py` — COMPLETATO
**Owner**: Security Agent (implementato in `backend/src/studyhub/ai/`)  
**Files**: 
- Nuovo: `backend/src/studyhub/ai/privacy.py` (modulo privacy StudyHub-specific)
- Modificato: `backend/src/studyhub/ai/llm.py` (integrazione in `_gemini`, `run_json`, `run_json_content`)
- Test: `backend/tests/test_privacy.py` (19 test)
**Scope**: 
- Approccio deny-by-default per provider esterni (Gemini, Claude)
- Provider locale (Qwen 35B su 10.10.10.1) SEMPRE consentito
- Analisi sensibilità: CF, IBAN, carte (Luhn), email, matricole, keyword finanziarie/personali, contenuto universitario
- Modalità: `strict` (default), `permissive`, `local_only` via `STUDYHUB_PRIVACY_MODE`
- Context manager `scope(kind, private)` annidabile per job kinds privati
- Audit log senza contenuti privati
- FreeLLMAPI già disabilitata in `provider_order()`
**Tests**: 
- ✅ 19/19 test privacy PASS
- ✅ 475/475 test backend totali PASS (zero regressioni)
- ✅ Anti-bypass verificato: tutti i percorsi esterni filtrati
**Deliverable**: `PRIVACY_FILTER_DESIGN.md`, `PRIVACY_TEST_REPORT.md`

### 🟠 SEC-017: Path Traversal Hardening in `uni_path()`
**Owner**: Backend Agent  
**Files**: `paths.py` (uni_path), `api/app.py` (media endpoint)  
**Scope**: `uni_path()` verifica `resolve().is_relative_to(uni_root.resolve())`; `media()` double-check  
**Tests**: `folder = "../../../Windows"` → raise/clamp; `/media/1/../../etc/passwd` → 404  
**NOTE**: ✅ **GIA' IMPLEMENTATO E VERIFICATO IN SPRINT 1.5**

### 🟠 SEC-027: Llama-Server Bind Restriction + Key Rotation
**Owner**: Security Agent (coordina con fixed PC)  
**Files**: Fixed PC llama-server config, `config.yaml` (remove key), `llm.py`  
**Scope**: Bind su `127.0.0.1` + Tailscale interface only; Tailscale ACLs; ruotare `local_llm_key`  
**Tests**: Da nodo non autorizzato → 401/403

---

## Priorità Alta — Sprint 2 (Settimane 3-4): Core Features Reali

### 🟠 FE-002: CorsoDetail "Studia" Tab — Mappa Corso Reale
**Owner**: UX Agent  
**Files**: `CorsoDetail.tsx`, `api.ts` (add `getStudyTopics`), `backend/study/planner.py`  
**Scope**: Sostituire array hardcoded con `useQuery(["study-topics", courseId])` → `/api/study/{id}` + topics endpoint  
**Tests**: Mastery per topic = dati reali; progress bars accurate

### 🟠 FE-003 + UX-002/003: Lab + CorsoDetail "Lab" Tab — Flashcard/Quiz Reali
**Owner**: UX Agent  
**Files**: `Lab.tsx`, `CorsoDetail.tsx`, `api.ts`, `backend/study/fsrs.py`, `backend/study/quiz.py`  
**Scope**: 
- Flashcard: `/api/flashcards/due?course_id=` + `/api/flashcards/{id}/review` (FSRS params)
- Quiz: `/api/lectures/{id}/quizzes` + `/api/quizzes/{id}/submit`
- Rimuovere `Math.random()` e stats hardcoded
**Tests**: Lab → Flashcard tab → stats reali; "Inizia ripasso" → sessione FSRS; quiz genera/sottomette

### 🟠 UX-004: Tutor RAG — Implementare Pagina `/lab?tab=tutor`
**Owner**: UX Agent  
**Files**: Nuova `src/pages/Tutor.tsx`, `Lab.tsx` (routing), `api.ts` (tutor endpoints), `backend/study/tutor.py` (verificare esistenza)  
**Scope**: 
- `createTutorThread(course_id, mode)` → thread
- `askTutor(thread_id, question)` → risposta con citazioni
- UI: chat interface, source citations, modal
**Tests**: E2E: Lab → Tutor tab → domanda → risposta con fonti citate

### 🟠 UX-005: Exam X-Ray / Simulazioni — Completare Flusso
**Owner**: UX Agent  
**Files**: `CorsoDetail.tsx` (tab "Esame"), `api.ts`, `backend/study/exam.py`  
**Scope**: 
- `generateExamProfile` già funziona
- `generateSimulations` → `getSimulation` → `submitSimulation` wiring
- UI: timer, submit, score/grade display
**Tests**: E2E: Profilo → Genera simulazione → Completa → Score salvato

### ✅ SEC-010: DB Fuori da Google Drive + Backup Restic — COMPLETATO
**Owner**: Security Agent  
**Files**: `config.py` (db_path → `~/.studyhub/studyhub.db`), `backend/src/studyhub/backup.py` (nuovo modulo)  
**Scope**: 
- Spostato DB da `APP_DIR` (Desktop/Google Drive) a `LOCAL_DIR` (`~/.studyhub/studyhub.db`)
- Migrazione con SQLite Backup API (coerente WAL/SHM)
- Modulo `backup.py` completo: init repo, backup, check --read-data, restore, verify
- Repo locale: `D:\Backup\restic-studyhub`, VPS: `sftp:bot@194.164.172.248:/home/bot/restic-studyhub`
- Password in `~/.studyhub/secrets/restic.pass` (600)
- Retention: 14d/8w/12m
**Tests**: 
- ✅ `ls ~/.studyhub/studyhub.db` exists (318 MB, v15, 40 tabelle)
- ✅ `restic snapshots` → 1 snapshot (4dffa70c, 348 MiB)
- ✅ `restic check --read-data` → OK
- ✅ Restore test → DB verificato (v15, 40 tabelle, 17 corsi, 199 lezioni)
**Deliverable**: `DATABASE_STORAGE_DESIGN.md`, `BACKUP_RESTORE_REPORT.md`

### ✅ SEC-012: Privacy Filter Integration in `llm.py` — COMPLETATO
**Owner**: Security Agent (implementato in `backend/src/studyhub/ai/`)  
**Files**: 
- Nuovo: `backend/src/studyhub/ai/privacy.py` (modulo privacy StudyHub-specific)
- Modificato: `backend/src/studyhub/ai/llm.py` (integrazione in `_gemini`, `run_json`, `run_json_content`)
- Test: `backend/tests/test_privacy.py` (19 test)
**Scope**: 
- Approccio deny-by-default per provider esterni (Gemini, Claude)
- Provider locale (Qwen 35B su 10.10.10.1) SEMPRE consentito
- Analisi sensibilità: CF, IBAN, carte (Luhn), email, matricole, keyword finanziarie/personali, contenuto universitario
- Modalità: `strict` (default), `permissive`, `local_only` via `STUDYHUB_PRIVACY_MODE`
- Context manager `scope(kind, private)` annidabile per job kinds privati
- Audit log senza contenuti privati
- FreeLLMAPI già disabilitata in `provider_order()`
**Tests**: 
- ✅ 19/19 test privacy PASS
- ✅ 475/475 test backend totali PASS (zero regressioni)
- ✅ Anti-bypass verificato: tutti i percorsi esterni filtrati
**Deliverable**: `PRIVACY_FILTER_DESIGN.md`, `PRIVACY_TEST_REPORT.md`

### 🟠 SEC-017: Path Traversal Hardening in `uni_path()`
**Owner**: Backend Agent  
**Files**: `paths.py` (uni_path), `api/app.py` (media endpoint)  
**Scope**: `uni_path()` verifica `resolve().is_relative_to(uni_root.resolve())`; `media()` double-check  
**Tests**: `folder = "../../../Windows"` → raise/clamp; `/media/1/../../etc/passwd` → 404

### 🟠 SEC-027: Llama-Server Bind Restriction + Key Rotation
**Owner**: Security Agent (coordina con fixed PC)  
**Files**: Fixed PC llama-server config, `config.yaml` (remove key), `llm.py`  
**Scope**: Bind su `127.0.0.1` + Tailscale interface only; Tailscale ACLs; ruotare `local_llm_key`  
**Tests**: Da nodo non autorizzato → 401/403

---

## Priorità Media — Sprint 3 (Settimane 5-6): Qualità, Accessibilità, Architettura

### 🟡 Frontend Refactoring (Owner: Frontend Agent)
| Task | Files | Scope |
|------|-------|-------|
| Error Boundary in `App.tsx` | `App.tsx`, nuovo `ErrorBoundary.tsx` | Wrapper class component o `react-error-boundary` per lazy chunks |
| Lazy load Home/CommandPalette/VideoPlayer | `App.tsx`, `CorsoDetail.tsx` | `lazy()` + `Suspense` per chunk splitting |
| shadcn/ui mancanti | `package.json`, `components/ui/` | `npx shadcn add tooltip radio-group checkbox dialog dropdown-menu popover hover-card slider collapsible` |
| TypeScript `strict: true` | `tsconfig.app.json` | Abilitare `"strict": true`, `"noImplicitAny": true`, `"strictNullChecks": true`; fix errori |
| API Layer: `ApiError` type + `ApiClient` class | `api.ts` | `ApiError` interface; class iniettabile per test; `enhance*` immutabili (`structuredClone`) |
| Theme OLED/Light/Dark fix | `index.css`, `Header.tsx`, `store/ui.ts` | `data-theme` attribute + CSS `:root[data-theme="..."]` priorità su media query |
| Zustand persist selective | `store/ui.ts`, `store/session.ts`, `hooks/use-gamification.ts` | `partialize` per persistere solo `theme` + `sidebarCollapsed`; migrare gamification a Zustand persist; Date rehydration in session store |

### 🟡 Backend Refactoring (Owner: Backend Agent)
| Task | Files | Scope |
|------|-------|-------|
| `on_event` → `lifespan` | `api/app.py` | Async context manager per startup/shutdown |
| Pydantic `extra='forbid'` | `api/app.py` (tutti i `BaseModel` request) | `model_config = ConfigDict(extra='forbid')` |
| AI Job Queue race condition | `ai/jobs.py` | `INSERT OR IGNORE` + transazione per `queue_job`; unique constraint già presente |
| GPU Lock timeout alignment | `media/transcribe.py`, `notte.py` | `GPU_LOCK_TIMEOUT` ≥ max transcription timeout (attualmente 300s vs 600s?) |
| KNN Fallback OOM Risk | `vectors.py`, `search.py` | Limitare `k` e batch size per NumPy fallback; streaming |
| Deterministic Shuffle | `study/quiz.py` | Seed fisso per shuffle riproducibile; test property-based |
| Fullrun Lock Cleanup | `fullrun.py` | `try/finally` per lock release; verificare race tra processi |

### 🟡 UX Polish (Owner: UX Agent)
| Task | Files | Scope |
|------|-------|-------|
| Gamification Backend Events | `backend/study/session.py`, `hooks/use-gamification.ts` | Eventi `study_session_completed`, `flashcard_reviewed`, `quiz_submitted` → XP/level persistito DB |
| VideoPlayer Feature Verification | `components/player/VideoPlayer.tsx` | Test manuale: PiP, velocità, transcript sync, slide, note timestamp, keyboard, mobile |
| Offline/Mobile Video | `VideoPlayer.tsx`, `lib/media-cache.ts` | Service Worker per cache video; PiP mobile; download per offline |
| Learning Analytics Dashboard | Nuovo `src/pages/Analytics.tsx` | Grafici: readiness trend, sessioni/settimana, FSRS retention, exam readiness |

### 🟡 Security Hardening (Owner: Security Agent)
| Task | Files | Scope |
|------|-------|-------|
| `CORSMiddleware` esplicito | `api/app.py` | `allow_origins`, `allow_credentials`, `allow_headers` incl. `X-CSRF-Token` |
| ACLs `~/.studyhub` Windows | `config.py`, install script | `icacls .studyhub /inheritance:r /grant:r %USERNAME%:(OI)(CI)F` |
| Image Validation per AI | `llm.py` (`_local_vision`, `run_json_content`) | Size <5MB, dim <2048px, strip EXIF, resize `MAX_LONG_SIDE=1568` |
| Log Redaction Filter | `logging` config | Redact API keys, tokens, transcript >100 chars |
| `pip-audit` / `npm audit` CI | `.github/workflows/` | Pipeline per dependency scanning |

---

## Priorità Bassa — Sprint 4 (Settimane 7-8): Polish, Test, Documentazione

### 🟢 Test Suite Completa
- **Backend**: Già 456/456 passano — mantenere coverage >90%
- **Frontend**: Aggiungere Vitest + Testing Library (zero test attuali)
  - Target: VideoPlayer, useGamification, api, command-palette, Studio phases
  - Coverage target: >60%
- **E2E**: Playwright (già in deps) per flussi critici:
  1. Login → Home → Corsi → CorsoDetail → Studio → completa sessione
  2. Lab → Flashcard → Quiz → Tutor
  3. Impostazioni → AI test → Sync → Backup

### 🟢 Documentazione
- `README.md` aggiornato con comandi corretti (`studyhub serve`, non `python -m studyhub`)
- `ARCHITECTURE.md` (da `ARCHITECTURE_CURRENT.md`)
- `API.md` (OpenAPI spec da FastAPI: `app.openapi()`)
- `PRIVACY.md` (data flow, providers, privacy filter)
- `DEPLOYMENT.md` (Windows client, Linux server, backup)

### 🟢 Bundle Optimization
- Rimuovere `@radix-ui/react-*` inutilizzati (6 pacchetti)
- Rimuovere `tailwindcss` duplicato (tenere solo `@tailwindcss/vite`)
- Verificare chunk splitting dopo lazy load (`vite build --mode analyze`)

---

## Matrice Dipendenze tra Sprint

```
Sprint 1 (Critici)
├── SEC-002 (Secrets) ──┐
├── SEC-008 (Key)       │→ Sblocca: SEC-027, SEC-003, FE-001 (API auth needed)
├── SEC-001/005 (CSRF)  │
├── SEC-003 (Auth)      │
├── FE-001 (Studio)     │→ Richiede: SEC-003, API endpoints pronti
└── BE-001 (Migration)  │→ Indipendente

Sprint 2 (Core Features)
├── FE-002 (CorsoDetail mappa)     ← Richiede: Sprint 1 completato
├── FE-003/UX-002/003 (Lab/Quiz)   ← Richiede: FSRS/Quiz endpoints pronti
├── UX-004 (Tutor)                 ← Richiede: Tutor endpoints pronti
├── UX-005 (Exam Sims)             ← Richiede: Exam endpoints pronti
├── SEC-010 (DB move)              ← Indipendente
├── SEC-012 (Privacy filter)       ← Richiede: Backend Agent per llm.py
├── SEC-017 (Path traversal)       ← Indipendente
└── SEC-027 (Llama bind)           ← Richiede: SEC-008 (key rotation)

Sprint 3 (Qualità)
├── Frontend refactor      ← Richiede: Sprint 2 stabile
├── Backend refactor       ← Richiede: Sprint 2 stabile
├── UX Polish              ← Richiede: Core features funzionanti
└── Security hardening     ← Richiede: Sprint 1 completato

Sprint 4 (Polish)
├── Test E2E               ← Richiede: Tutto funzionante
├── Documentazione         ← Richiede: Architettura finale
└── Bundle optimization    ← Richiede: Lazy load completato
```

---

## Assegnazione Agenti per Implementazione

| Sprint | Agente | Ruolo | Focus |
|--------|--------|-------|-------|
| 1 | **Security Agent** | Lead | SEC-002, SEC-008, SEC-010, SEC-017, SEC-027 |
| 1 | **Backend Agent** | Lead | SEC-001/005, SEC-003, BE-001, API endpoints per Studio |
| 1 | **UX Agent** | Lead | FE-001 (Studio.tsx major refactor) |
| 1 | **Frontend Agent** | Support | API layer fixes, types, Error Boundary prep |
| 2 | **UX Agent** | Lead | FE-002, FE-003, UX-004, UX-005 (tutte le feature core) |
| 2 | **Backend Agent** | Support | Endpoint tuning, FSRS/Quiz/Tutor/Exam fixes |
| 2 | **Frontend Agent** | Support | API integration, components extraction |
| 2 | **Security Agent** | Lead | SEC-012, SEC-027 (coordina fixed PC) |
| 3 | **Frontend Agent** | Lead | Refactoring, TS strict, Theme, Zustand, shadcn |
| 3 | **Backend Agent** | Lead | Lifespan, Pydantic, Job queue, GPU lock, Shuffle |
| 3 | **UX Agent** | Lead | Gamification backend, VideoPlayer verify, Analytics |
| 3 | **Security Agent** | Lead | CORS, ACLs, Image validation, Log redaction, Audits |
| 4 | **Tutti** | Parallel | Tests E2E, Docs, Bundle optimization |

---

## Quality Gates (Per Ogni Sprint)

| Gate | Criterio | Verifica |
|------|----------|----------|
| **Code Review** | Tutti i PR reviewati da almeno un altro agente | `gh pr create` + review |
| **Lint/Typecheck** | `npm run lint` (0 error), `npm run build` (success), `tsc --noEmit` (0 error) | CI pipeline |
| **Backend Tests** | `pytest tests/ -q` → 456 passed | CI pipeline |
| **Frontend Tests** | `npm run test` → coverage >60% (Sprint 4) | CI pipeline |
| **Security Scan** | `pip-audit`, `npm audit` → 0 critical/high | CI pipeline |
| **E2E Critical Paths** | Playwright: Studio, Lab, Exam, Settings | CI pipeline (Sprint 4) |
| **Performance** | Lighthouse: Performance >90, Accessibility >95, Best Practices >90 | Manual per release |

---

## Definizione di "Done" per Rilascio v3.0

- [ ] Backend: `studyhub serve` avvia correttamente, 456 test passano
- [ ] Frontend: `npm run build` OK, `npm run lint` 0 errori, `npm run test` >60% coverage
- [ ] Studio.tsx: Sessione completa 5 fasi con dati reali, XP/FSRS persistiti
- [ ] CorsoDetail: Tutte e 4 le tab con dati reali (no mock)
- [ ] Lab: Flashcard FSRS, Quiz adattivi, Tutor RAG funzionanti
- [ ] Exam: Profilo + Simulazioni end-to-end
- [ ] VideoPlayer: Tutte le feature verificate (PiP, speed, transcript, slide, note, keyboard, mobile)
- [ ] Security: CSRF, Auth, Secrets in keyring, DB fuori Drive, Path traversal fix, Privacy filter attivo
- [ ] Theme: OLED/Light/Dark/OS sync funzionanti
- [ ] Accessibilità: Axe 0 violations su pagine critiche
- [ ] Backup: `studyhub.db` in restic snapshot
- [ ] Docs: README, ARCHITECTURE, API, PRIVACY, DEPLOYMENT aggiornati
- [ ] CI: Pipeline completa (lint, test, audit, build, e2e)

---

## Prossimo Passo Immediato

**Avviare Sprint 1** con 3 agenti in parallelo:

1. **Security Agent** → `SEC-002` (secrets → keyring) + `SEC-008` (key rotation + .gitignore)
2. **Backend Agent** → `SEC-001/005` (CSRF) + `SEC-003` (API auth) + `BE-001` (migrazione)
3. **UX Agent** → `FE-001` (Studio.tsx refactor — iniziare estrazione phase components)

**Frontend Agent** in supporto: `api.ts` finalization, `ErrorBoundary`, `types.ts` cleanup per supportare UX Agent.

---

*Roadmap generata da consolidamento 4 audit specialistici. Ogni issue tracciabile a `ISSUES_REGISTER.md` e report singoli.*