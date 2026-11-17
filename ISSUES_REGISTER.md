# ISSUES_REGISTER.md — StudioHub (Fase Zero)

## Problemi bloccanti risolti in Fase Zero

| ID | Titolo | Gravità | Stato | Risoluzione |
|----|--------|---------|-------|-------------|
| BLOCK-001 | `python -m studyhub` fallisce con `No module named studyhub.__main__` | Critical | ✅ RISOLTO | Comando corretto: `python -m studyhub.cli serve` o `studyhub serve` (entrypoint `studyhub.exe` nel venv). Documentato in README e installa.ps1. |
| BLOCK-002 | Schermata bianca su `/corsi/:id` (CorsoDetail) | Critical | ✅ RISOLTO | 5 fix applicati: (1) `api.ts` deduplicato, (2) `request<T>` generico, (3) `enhanceLectures` block body, (4) `Brain` import duplicato rimosso, (5) `enhanceCourse()` per campi frontend-only. Build OK, proxy funziona. |

---

## Problemi confermati (da audit precedenti + verifica Fase Zero)

### Backend & Data Architecture

| ID | Titolo | Gravità | File/Linee | Evidenza | Conseguenza | Fix consigliato |
|----|--------|---------|------------|----------|-------------|-----------------|
| BE-001 | Migrazione duplicata in `db.py` (idx_ai_jobs_unique x2) | Medium | `backend/src/studyhub/db.py` ~line 380-420 | Due blocchi identici in `MIGRATIONS` array (working tree = 15 vs committed = 14) | Confusione, possibile errore se una fallisce | Rimuovere duplicato, tenere una sola migrazione unica |
| BE-002 | `on_event("startup")` deprecato in FastAPI | Low | `backend/src/studyhub/api/app.py:74` | Warning pytest: `on_event is deprecated, use lifespan event handlers` | Tech debt, futuro breaking change | Migrare a `lifespan` async context manager |
| BE-003 | FreeLLMAPI disabilitata ma codice presente | Medium | `backend/src/studyhub/ai/llm.py`, `jobs.py` | Privacy filter non verificato; FreeLLMAPI rimossa ma import/resti | Rischio leak dati se riattivata per errore | Rimuovere codice morto o isolare dietro feature flag verificato |
| BE-004 | Cookie/token Moodle-Panopto in chiaro | High | `config.yaml`, `sync/auth.py`, `media/panopto.py` | File system non cifrato, `config.yaml` in repo working dir | Esposizione credenziali se repo compromesso | Cifrare secrets, usare keyring OS, non committare config.yaml |
| BE-005 | `study/exam.py` — `get_profile` ritorna `dict` non tipizzato | Medium | `backend/src/studyhub/study/exam.py:152` | Ritorno `dict \| None` ma schema complesso | Type safety, refactoring difficile | Definire `ExamProfileData` TypedDict/Pydantic model |
| BE-006 | `study/quiz.py` — validazione/shuffle risposte fragile | High | `backend/src/studyhub/study/quiz.py` | Test `test_bank.py` coprono alcuni casi ma logica complessa | Quiz con risposte corrotte, shuffle non deterministico | Refactor con validazione Pydantic, test property-based |
| BE-007 | `study/session.py` — gestione stato sessione complessa | Medium | `backend/src/studyhub/study/session.py` | 5 fasi (warmup→learn→practice→boss→cooldown) ma state machine implicita | Bug transizioni, perdita progresso | Formalizzare state machine, aggiungere test E2E |

### Frontend & Application Engineering

| ID | Titolo | Gravità | File/Linee | Evidenza | Conseguenza | Fix consigliato |
|----|--------|---------|------------|----------|-------------|-----------------|
| FE-001 | `Studio.tsx` usa **dati mock prevalenti** | Critical | `studyhub-frontend/src/pages/Studio.tsx` | Warmup/Learn/Practice/Boss/Cooldown hardcoded, non chiama API reali | Funzionalità core non funzionante | Collegare a `/api/study/{courseId}/sessions`, `/api/study/sessions/{id}/answer`, ecc. |
| FE-002 | `CorsoDetail.tsx` — tab "Studia" ha **mock data** (capitoli, mastery, prossimo argomento) | High | `CorsoDetail.tsx:226-288` | Array hardcoded 6 capitoli, mastery fittizie | UX ingannevole, non riflette realtà | Usare `/api/study/{courseId}` (planner) + `/api/study/{courseId}/chapters` |
| FE-003 | `CorsoDetail.tsx` — tab "Lab" ha **mock data** (flashcard counts, quiz counts) | High | `CorsoDetail.tsx:595-643` | Numeri hardcoded (127, 43, 18), `Math.random()` per quiz | UI non riflette dati reali | Collegare a `/api/flashcards/due?course_id=`, `/api/lectures/{id}/quizzes` |
| FE-004 | `Home.tsx` — `Date.now()` in render (impure function) | Medium | `Home.tsx:243` | oxlint warning: `Cannot call impure function during render` | Re-render instabili, hydration mismatch | Spostare in `useMemo` o calcolare fuori render |
| FE-005 | `api.ts` — 17 tipi importati ma non usati | Low | `api.ts:3-21` | oxlint warnings: `Flashcard`, `Quiz`, `Exam`, `ExamProfile`, `Simulation`, `TutorThread`, `AIPanelData`, `PlanData`, `NotificationItem`, `DueFlashcardsResponse`, `FeedResponse`, `StudyCourseStats`, `AIJobStatus`, `AIProvidersStatus`, `StorageStatus`, `FullrunStatus` | Bundle size, noise | Rimuovere import inutilizzati |
| FE-006 | `Lab.tsx` — 12+ icone/import non usati | Low | `Lab.tsx:4-9` | oxlint warnings: `Filter`, `ChevronRight`, `Clock`, `TrendingUp`, `Volume2`, `SkipForward`, `RotateCw`, `Progress`, `Separator`, `Quiz` type | Bundle size | Pulire import |
| FE-007 | `Header.tsx`, `Sidebar.tsx` — variabili/componenti non usati | Low | `Header.tsx:1,6,9`, `Sidebar.tsx:2,15` | `Command`, `Separator`, `commandPaletteOpen`, `Menu`, `location` | Dead code | Rimuovere |
| FE-008 | Nessun **Error Boundary** in `App.tsx` | High | `App.tsx` | Crash React → schermata bianca totale, nessun fallback | UX rotta, debug difficile | Aggiungere `<ErrorBoundary>` wrapper per route lazy |
| FE-009 | Nessuna gestione errori API centralizzata (toast, retry, offline) | Medium | `api.ts`, `App.tsx` | Errori fetch → throw non gestiti, utente non informato | Errori silenti, frustrazione | Aggiungere interceptor TanStack Query `onError` + toast globale |
| FE-010 | `CorsoDetail.tsx` — `VideoPlayer` modal senza cleanup su unmount | Medium | `CorsoDetail.tsx:667-673` | `playerLecture` state ma video continua in background | Audio perdite, memoria | `useEffect` cleanup: `playerRef.current?.pause()` |

### Study UX & Pedagogical Engine

| ID | Titolo | Gravità | Area | Evidenza | Conseguenza | Fix consigliato |
|----|--------|---------|------|----------|-------------|-----------------|
| UX-001 | **Sessione Studio non funzionale** — mock only | Critical | Studio.tsx | 5 fasi UI ma nessuna chiamata API reale | Core feature inutilizzabile | Priorità #1: implementare flusso reale con backend |
| UX-002 | **FSRS non integrato in UI** | High | Lab.tsx, Flashcard | `getDueFlashcards` esiste ma `Lab.tsx` usa mock counts | Ripetizione spaziata non usabile | Collegare `/api/flashcards/due` + review endpoint |
| UX-003 | **Quiz adattivi non collegati** | High | Lab.tsx, CorsoDetail.tsx | `generateQuiz`, `submitQuiz` API esistono ma UI mock | Verifica apprendimento assente | Implementare flusso quiz reale per lezione |
| UX-004 | **Tutor RAG — solo UI, no backend call** | High | Lab.tsx, CorsoDetail.tsx | Button "Apri Tutor" → navigate ma `/lab?tab=tutor` non implementato | Domande su materiale impossibili | Implementare pagina Tutor + `/api/tutor/threads` |
| UX-005 | **Exam X-Ray / Profilo esame** — generazione funziona ma UI parziale | Medium | CorsoDetail.tsx tab "Esame" | `generateExamProfile` chiama API, ma simulazioni mock | Studente non può fare simulazioni reali | Collegare `generateSimulations`, `getSimulation`, `submitSimulation` |
| UX-006 | **Video Player** — funzionalità dichiarate non verificate | Medium | `components/player/VideoPlayer.tsx` | PiP, velocità, trascrizione sincronizzata, slide, note timestamp, keyboard | Gap tra spec e realtà | Test manuale + automatizzato per ogni feature |
| UX-007 | **Gamification** — XP/streak/badge solo UI, no backend events | Medium | `hooks/use-gamification.ts`, `components/gamification/` | `xp`, `streak`, `level` calcolati localmente, non persistiti | Progresso perso al refresh, non sincronizzato | Definire eventi backend (`study_session_completed`, `flashcard_reviewed`) + persistenza |
| UX-008 | **Command Palette** — implementata ma non testata | Low | `components/command-palette.tsx` | ⌘K apre, cerca corsi/lezioni/appunti | Funzionalità power-user non verificata | Test E2E, accessibility (keyboard only) |

### Security & Privacy

| ID | Titolo | Gravità | Area | Evidenza | Rischio | Fix consigliato |
|----|--------|---------|------|----------|---------|-----------------|
| SEC-001 | **Nessun CSRF protection** su endpoint mutanti | High | `api/app.py` POST/PUT/DELETE | FastAPI non ha CSRF built-in; cookie same-site non configurato | CSRF su login, exam creation, session answer | Aggiungere `fastapi-csrf-protect` o double-submit cookie |
| SEC-002 | **CORS permissivo** (non verificato) | Medium | `api/app.py` | `CORSMiddleware` non visibile in routes | Esposizione API a origini non autorizzate | Configurare `allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"]` |
| SEC-003 | **Cookie/token in chiaro** (vedi BE-004) | High | `config.yaml`, file system | `session.json` con token Moodle, cookie Panopto | Furto credenziali se laptop compromesso | OS keyring (Windows Credential Manager, Linux Secret Service) |
| SEC-004 | **Input validation** — endpoint usano `Body(...)` ma no Pydantic strict | Medium | `api/app.py` | `ProfileRequest`, `NewExam` usati ma validazione limitata | Injection, malformed data | `BaseModel` con `extra='forbid'`, validatori custom |
| SEC-005 | **Path traversal** — `/media/{lecture_id}/{rel:path}` | Medium | `api/app.py:231` | `rel:path` servito staticamente | Accesso file arbitrari se `uni_path` non valida | Normalizzare path, verificare `is_relative_to(course_folder)` |
| SEC-006 | **FreeLLMAPI / privacy filter** — codice presente ma disabilitato | Medium | `ai/llm.py`, `freellm/chat` | `privacy.py` menzionato ma non integrato in flusso AI | Leak contenuti didattici se riattivato | Audit completo `privacy.py` + test integrazione prima di riattivare |
| SEC-007 | **Esposizione rete** — backend su `0.0.0.0:8765` (non verificato) | Medium | `studyhub.bat`, `studyhub.sh` | `uvicorn --host 0.0.0.0` di default | Accesso da LAN/Tailscale non autorizzato | Bind su `127.0.0.1` solo, Tailscale via SSH tunnel |
| SEC-008 | **Log sensibili** — `ai/llm.py` logga prompt/response? | Low | `ai/llm.py` | Non verificato | Leak prompt/contesto in log | Sanitizzare log, no PII/contenuti didattici |
| SEC-009 | **Dipendenze** — audit `pip-audit` / `npm audit` non fatto | Low | `pyproject.toml`, `package.json` | 456 test passano ma vuln note non controllate | Supply chain attack | Eseguire `pip-audit`, `npm audit fix` |

---

## Riepilogo per priorità

### 🔴 Critical (bloccano rilascio)
1. **FE-001** — Studio.tsx mock only (core feature)
2. **UX-001** — Sessione Studio non funzionale
3. **SEC-001** — Nessun CSRF protection
4. **SEC-003** — Cookie/token in chiaro

### 🟠 High (degradano gravemente UX/sicurezza)
5. **FE-002** — CorsoDetail tab Studia mock
6. **FE-003** — CorsoDetail tab Lab mock
7. **FE-008** — Nessun Error Boundary
8. **UX-002/003/004** — FSRS, Quiz, Tutor non collegati
9. **SEC-002/005** — CORS, Path traversal
10. **BE-006** — Quiz validation fragile

### 🟡 Medium (tech debt, qualità)
11. **BE-001** — Migrazione duplicata
12. **BE-003/005** — FreeLLMAPI dead code, ExamProfile typing
13. **FE-004/009/010** — Impure function, error handling, VideoPlayer cleanup
14. **UX-005/006/007** — Exam X-Ray, Video Player, Gamification backend
15. **SEC-004/006/007** — Input validation, privacy filter, network bind

### 🟢 Low (pulizia)
16. **FE-005/006/007** — Import inutilizzati
17. **BE-002** — on_event deprecato
18. **UX-008** — Command Palette test
19. **SEC-008/009** — Log sanitization, dependency audit

---

## Test di regressione richiesti per ogni fix

| Fix | Test |
|-----|------|
| Studio.tsx → API reale | E2E: avvia sessione → rispondi domanda → completa → verifica persistenza DB |
| FSRS integration | Unit: `reviewFlashcard` aggiorna `due_date`, `interval`, `ease_factor` correttamente |
| Quiz flow | E2E: genera quiz → rispondi → submit → score salvato |
| Tutor RAG | E2E: crea thread → domanda → risposta con citazioni |
| Exam simulations | E2E: genera profilo → genera simulazione → completa → score/grade |
| CSRF protection | Security: POST senza token → 403; con token → 200 |
| Path traversal | Security: `/media/1/../../etc/passwd` → 404/403 |
| Error Boundary | E2E: forza errore in CorsoDetail → fallback UI visibile, app non crasha |
| Video Player | Manual: play, pause, PiP, speed, transcript sync, keyboard, mobile |

---

## Note per Fase Uno (4 Audit)

Ogni agente auditor deve:
1. **Leggere** questo register come baseline
2. **Verificare** ogni issue con evidenza codice (file:line)
3. **Aggiungere** nuovi issue scoperti
4. **Classificare** gravità con criteri oggettivi
5. **Proporre** fix concreti con test di regressione
6. **Non modificare** codice — solo report

Il consolidamento in Fase Due assegnerà ownership per file condivisi.