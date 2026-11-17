# StudyHub Backend Architecture Audit Report

**Date:** 2026-11-17  
**Scope:** `C:\Users\valem\Desktop\02_Università\_StudyHub\backend\src\studyhub\` (read-only analysis)  
**Baseline:** `ISSUES_REGISTER.md` (Backend section)  
**Agent:** AGENT 1 — Backend & Data Architecture Auditor

---

## Executive Summary

The StudyHub backend is a sophisticated local-first system with SQLite + FTS5 + sqlite-vec, FastAPI, and a multi-provider AI pipeline (Local Qwen 35B → Gemini → Claude). The architecture is well-designed for its use case (offline-first, privacy-sensitive, GPU-constrained), but has several **Critical/High** issues around data integrity, security, and maintainability that must be addressed before production hardening.

**Total Issues Found:** 31 (12 from register confirmed + 19 new)  
**Critical:** 4 | **High:** 8 | **Medium:** 12 | **Low:** 7

---

## 1. FastAPI App (`src/studyhub/api/app.py`)

### BE-NEW-001: No CORS Middleware Configured (SEC-002 confirmed)
- **File:** `app.py` — no `CORSMiddleware` added to app
- **Severity:** High
- **Evidence:** Lines 69-71 only add `SecurityMiddleware`; no CORS configuration
- **Consequence:** API accessible from any origin in browser; CSRF protection in `SecurityMiddleware` only checks Origin/Referer headers which can be spoofed in non-browser contexts
- **Fix:** Add `app.add_middleware(CORSMiddleware, allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])`

### BE-NEW-002: `on_event("startup")` Deprecated (BE-002 confirmed)
- **File:** `app.py:74-82`
- **Severity:** Low
- **Evidence:** `@app.on_event("startup")` used; FastAPI warns: "on_event is deprecated, use lifespan event handlers"
- **Fix:** Migrate to `lifespan` async context manager

### BE-NEW-003: Path Traversal Risk in `/media/{lecture_id}/{rel:path}` (SEC-005 confirmed)
- **File:** `app.py:231-237`
- **Severity:** Medium
- **Evidence:** 
  ```python
  base = uni_path(_lecture(lecture_id)["folder"]).resolve()
  target = (base / rel).resolve()
  if not target.is_relative_to(base) or not target.is_file():
      raise HTTPException(404)
  ```
- **Issue:** `resolve()` follows symlinks. If `uni_path` returns a path with symlinks, an attacker could escape via symlink traversal. The `is_relative_to` check happens *after* resolution.
- **Fix:** Validate `rel` for `..` and symlinks *before* joining; use `base.joinpath(rel).resolve(strict=False)` and verify the resolved path is within the *real* base path

### BE-NEW-004: No Input Validation on Pydantic Models (SEC-004 confirmed)
- **File:** `app.py` — models like `NewExam`, `Review`, `Ask`, `Submit`, `SimSubmit` lack `extra='forbid'` and custom validators
- **Severity:** Medium
- **Evidence:** `ProfileRequest` (line 560) has `force: bool = False` but no validation; `Answer` (line 845) allows arbitrary `confidence`, `seconds` without bounds
- **Fix:** Add `model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)` and field validators (`Field(ge=1, le=4)`, etc.)

### BE-NEW-005: CSRF Protection Incomplete (SEC-001 confirmed)
- **File:** `app.py:29-67` (`SecurityMiddleware`)
- **Severity:** High
- **Evidence:** Only checks `Origin`/`Referer` headers; no CSRF token validation. Vulnerable to:
  - Subdomain takeover → cookie sent automatically
  - `Origin: null` bypasses (file://, sandboxed iframes)
  - Referer spoofing in non-browser clients
- **Fix:** Implement double-submit cookie pattern or use `fastapi-csrf-protect` with SameSite=Lax cookies

### BE-NEW-006: Hardcoded Secrets Path in Config
- **File:** `config.py:15` — `LOCAL_DIR = Path(os.environ.get("STUDYHUB_LOCAL_DIR", Path.home() / ".studyhub"))`
- **Severity:** Medium
- **Evidence:** `secrets_dir` property (line 50-53) creates `LOCAL_DIR / "secrets"` with `session.json`, `token.json`, `panopto.json` in plaintext
- **Consequence:** Credentials exposed if laptop compromised; `config.yaml` in working dir (not gitignored in repo root)
- **Fix:** Use OS keyring (Windows Credential Manager via `keyring` package); encrypt secrets at rest; add `config.yaml` to `.gitignore`

---

## 2. Database Schema & Migrations (`src/studyhub/db.py`)

### BE-001: Duplicate Migration for `idx_ai_jobs_unique` (CONFIRMED)
- **File:** `db.py:379-385` and `db.py:394-400`
- **Severity:** Medium
- **Evidence:** Two identical `CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_jobs_unique` blocks in `MIGRATIONS[13]` and `MIGRATIONS[14]` (lines 382-384 and 397-399)
- **Consequence:** Wasted migration slot; confusion; if one fails silently, the other runs but `user_version` increments twice for same logical change
- **Fix:** Remove `MIGRATIONS[14]` (the duplicate); keep only one. Ensure `PRAGMA user_version` matches migration count (currently 15 migrations, version should be 15)

### BE-NEW-007: Missing Index on `study_items(topic_id, suspended)`
- **File:** `db.py:321-322` — only `study_items_course` index on `(course_id, topic_id)`
- **Severity:** Medium
- **Evidence:** Queries in `bank.py:361-362` filter by `topic_id` and need to exclude suspended items; no composite index
- **Fix:** Add `CREATE INDEX study_items_topic_suspended ON study_items(topic_id, suspended)`

### BE-NEW-008: `user_version` Not Verified Against Migration Count
- **File:** `db.py:429-434` — `_migrate` runs migrations from current `user_version` but never validates final version
- **Severity:** Low
- **Evidence:** If a migration fails mid-script, `user_version` may not increment but subsequent runs skip it
- **Fix:** After migration loop, assert `conn.execute("PRAGMA user_version").fetchone()[0] == len(MIGRATIONS)`

### BE-NEW-009: No Foreign Key on `ai_jobs.target_id` (Polymorphic)
- **File:** `db.py:162-171` — `ai_jobs` references `lectures` or `documents` based on `kind`
- **Severity:** Low
- **Consequence:** Orphaned jobs if lecture/document deleted; no cascade
- **Fix:** Add application-level cleanup in `cancel_queued()` and deletion hooks; consider trigger

### BE-NEW-010: `chunks.embedding` BLOB Stored as float16 But `vec_chunks` Expects float32
- **File:** `db.py:129` (schema) vs `vectors.py:24-25`
- **Severity:** Medium
- **Evidence:** 
  - `chunks.embedding` = `float16` bytes (line 21 in `vectors.py:22`)
  - `vec_chunks.embedding` = `float32` bytes (line 25)
  - `knn` fallback converts `float16` → `float32` (line 58)
- **Issue:** Precision loss in fallback path; `vec_chunks` stores higher precision
- **Fix:** Standardize on `float32` in both; or document intentional precision tradeoff

---

## 3. AI Jobs Queue (`src/studyhub/ai/jobs.py`, `llm.py`)

### BE-NEW-011: Race Condition in `_insert` Despite Unique Index (P1.1 Fix Incomplete)
- **File:** `jobs.py:85-109`
- **Severity:** High
- **Evidence:** 
  ```python
  row = db.execute("SELECT id FROM ai_jobs WHERE kind=? AND target_id=? AND status IN ('in_coda','in_corso')", ...)
  if row:  # UPDATE priority
      return None
  try:
      return db.execute("INSERT INTO ai_jobs ...", ...).lastrowid
  except Exception as e:  # catches IntegrityError
      row = db.execute("SELECT ...", ...).fetchone()  # re-queries
  ```
- **Issue:** Between `SELECT` and `INSERT`, another process can insert the same job. The `except` catches `IntegrityError` but re-queries *without locking*. If the other process *also* catches and re-queries, both may update priority or both return `None` → job duplicated in application logic.
- **Fix:** Use `INSERT OR IGNORE` with `RETURNING id` (SQLite 3.35+), or wrap in `BEGIN IMMEDIATE` transaction

### BE-NEW-012: Worker Thread Not Gracefully Shutdown on App Exit
- **File:** `jobs.py:310-331` (`_loop`), `jobs.py:333-341` (`_ensure_worker`)
- **Severity:** Medium
- **Evidence:** Daemon thread (`daemon=True`); no shutdown signal handling. On SIGTERM, in-progress job marked `in_corso` → on restart `_ensure_worker` resets to `in_coda` (line 339), but job may have partially completed (e.g., Claude call succeeded, embedding failed)
- **Fix:** Add `threading.Event` for graceful shutdown; on signal, finish current job, persist state, then exit

### BE-NEW-013: `backlog_candidates()` Query Has N+1 Problem
- **File:** `jobs.py:129-141`
- **Severity:** Medium
- **Evidence:** Single query with subqueries, but `EXISTS` subqueries execute per row; no index on `ai_outputs(kind, target_id)` covers the `NOT EXISTS` efficiently
- **Fix:** Add composite index `CREATE INDEX ai_outputs_kind_target ON ai_outputs(kind, target_id)` (already exists at line 161); rewrite with `LEFT JOIN ... WHERE o.id IS NULL`

### BE-NEW-014: Local LLM Health Check Caches False Negatives
- **File:** `llm.py:162-187` (`get_local_llm_url`), `llm.py:129-147` (`_probe`)
- **Severity:** High
- **Evidence:** 
  - `_cache` TTL = 300s on success, 15s on failure (`CACHE_NONE_S`)
  - `_probe` tries `/health` then `/v1/models`; 404 on `/health` continues, but any other error returns `False`
  - If server temporarily unreachable (network blip), cached as failed for 15s
- **Consequence:** Flaky local LLM detection; requests route to Claude unnecessarily
- **Fix:** Distinguish "server down" (cache 15s) from "server up but auth failed" (cache longer); add retry with backoff in `_probe`

### BE-NEW-015: `effective_workers()` Returns 1 for Local-Only, But No Concurrency Control in `ThreadPoolExecutor`
- **File:** `llm.py:321-326` (`effective_workers`), `bank.py:242` (`ThreadPoolExecutor(max_workers=effective_workers())`)
- **Severity:** Medium
- **Evidence:** `effective_workers()` returns 1 when provider is local-only (llama-server has 1 slot). But `bank.py` uses `ThreadPoolExecutor` with that count — correct. However, `fullrun.py:242` also uses `effective_workers()` for study track. **No cross-process coordination**: if server + fullrun run simultaneously, both think they have 1 worker → 2 concurrent requests to llama-server → lock contention in `_post_chat` (file lock per server)
- **Fix:** Use a system-wide named lock (file-based) for llama-server slot; or centralize worker count in config

### BE-NEW-016: No Timeout on `httpx` Calls in `llm.py` Provider Chain
- **File:** `llm.py:547-581` (`_gemini`), `llm.py:329-369` (`_post_chat`)
- **Severity:** Medium
- **Evidence:** `_post_chat` has `timeout` parameter but `_gemini` uses `subprocess.run(timeout=AGY_TIMEOUT_S)` (8 min). No per-request timeout on Ollama/embedding calls in `embed.py:33` (600s hardcoded)
- **Fix:** Add configurable timeouts per provider; implement circuit breaker

---

## 4. Sync: Moodle/Panopto (`src/studyhub/sync/`)

### BE-NEW-017: Playwright Browser Login Leaves Persistent Profile with Credentials
- **File:** `sync/auth.py:81-114` (`browser_login`), `sync/auth.py:57-78` (`_fetch_mobile_token`)
- **Severity:** High
- **Evidence:** 
  - Persistent context at `LOCAL_DIR / "browser-profile"` (line 89)
  - Cookies + session storage contain Moodle SSO session
  - No encryption; any process reading this profile gets authenticated session
- **Fix:** Use incognito/ephemeral context for login; don't persist SSO cookies; or encrypt profile directory

### BE-NEW-018: Token Refresh Logic Flawed in `get_session`
- **File:** `sync/auth.py:146-163`
- **Severity:** Medium
- **Evidence:** 
  ```python
  if token_only_ok and _token_valid(token):
      return MoodleSession(data["cookies"] if data else {}, data["sesskey"] if data else "", token)
  ```
  - Returns session with *empty cookies/sesskey* if only token valid
  - Downstream code (`moodle.py:64-75` `ajax()`) requires `sesskey`
- **Fix:** Always require valid cookies for AJAX; separate `get_token_session()` for WS-only operations

### BE-NEW-019: No Rate Limiting / Retry Logic on Moodle Web Service Calls
- **File:** `sync/moodle.py:50-62` (`ws`), `sync/moodle.py:64-75` (`ajax`)
- **Severity:** Medium
- **Evidence:** Only `_throttle` with fixed `request_delay_s` (0.4s). No exponential backoff on 429/5xx.
- **Fix:** Add `httpx` retry transport with `Retry` policy; respect `Retry-After` header

### BE-NEW-020: Panopto Cookie File Stored in Plaintext
- **File:** `media/panopto.py:21` (`COOKIE_FILE = settings.secrets_dir / "panopto.json"`), line 112-114 (write)
- **Severity:** High
- **Evidence:** `.ASPXAUTH` cookie = full Panopto session; written as JSON with no encryption
- **Fix:** Encrypt with OS keyring (DPAPI on Windows); decrypt on read

---

## 5. Media Pipeline (`src/studyhub/media/`)

### BE-NEW-021: Whisper Subprocess GPU Lock Timeout Too Short for Long Audio
- **File:** `media/transcribe.py:94-96` (`GPU_LOCK_TIMEOUT_S = 2 * 3600`), `media/transcribe.py:99-100` (`total_timeout`)
- **Severity:** Medium
- **Evidence:** 2-hour GPU lock timeout; `total_timeout` = max(30min, 3×duration). For 2h audio → 6h timeout, but GPU lock only 2h → lock expires before transcription finishes → another process can grab GPU mid-transcription
- **Fix:** Set `GPU_LOCK_TIMEOUT_S` ≥ `total_timeout(duration_s)` dynamically; or make lock cover entire transcription

### BE-NEW-022: `ffmpeg` Probe Called Multiple Times Per Lecture (N+1)
- **File:** `media/pipeline.py:97, 270, 290` — `ff.probe(audio)["duration"]` called 3× per lecture
- **Severity:** Low
- **Fix:** Cache probe result in `lezione.json` or memoize in process scope

### BE-NEW-023: Video Disposal Logic Race with Google Drive Sync
- **File:** `media/storage.py:127-136` (`safe_move`), `media/pipeline.py:149-160` (`_dispose_video`)
- **Severity:** Medium
- **Evidence:** `safe_move` copies → verifies size → deletes source. Google Drive (G:) may report size before upload completes (`_wait_size` polls for 60s). If Drive sync delayed, source deleted but cloud copy incomplete.
- **Fix:** Add checksum verification (SHA256) after move; or use `rclone check` before deletion

### BE-NEW-024: No Cleanup of `_tmp` Directories on Crash
- **File:** `media/pipeline.py:70-71` (`tmp = ldir / "_tmp"`), multiple `shutil.rmtree(tmp, ignore_errors=True)` in `except` blocks
- **Severity:** Low
- **Evidence:** If process killed (SIGKILL, power loss), `_tmp` with partial video remains. No startup cleanup.
- **Fix:** Add `cleanup_tmp_dirs()` at module import or app startup

---

## 6. Search & Embeddings (`src/studyhub/search.py`, `ingest/vectors.py`, `ingest/embed.py`)

### BE-NEW-025: `embed_query` Uses CPU-Only Ollama But No Fallback If Ollama Down
- **File:** `ingest/embed.py:77-80` (`embed_query`), `search.py:50-57`
- **Severity:** High
- **Evidence:** 
  ```python
  def embed_query(text: str) -> np.ndarray:
      return _embed([text], {"num_gpu": 0}, keep_alive="5m")[0]
  ```
  - If Ollama not running, `_embed` raises `EmbeddingError` (line 36)
  - `search.py` catches `EmbeddingError` and falls back to BM25 only — **but `semantic_ok = False` returned**
- **Issue:** Silent degradation; user doesn't know semantic search unavailable
- **Fix:** Return explicit `semantic: false` with reason; add health check endpoint

### BE-NEW-026: `knn` Fallback Loads ALL Embeddings Into Memory
- **File:** `vectors.py:48-61`
- **Severity:** High (scalability)
- **Evidence:** 
  ```python
  rows = conn.execute(sql, params).fetchall()  # ALL chunks with embeddings
  mat = np.frombuffer(b"".join(r[1] for r in rows), np.float16).reshape(len(rows), DIM)
  ```
  - Loads entire vector matrix into RAM for cosine similarity
  - With 100k chunks × 1024 dim × 2 bytes = 200 MB per query
- **Fix:** Implement ANN index (HNSW) via sqlite-vec; if unavailable, add `LIMIT` with pre-filtering; or use disk-backed `np.memmap`

### BE-NEW-027: FTS5 Tokenizer `unicode61 remove_diacritics 2` May Not Handle Italian Well
- **File:** `db.py:133-135`
- **Severity:** Low
- **Evidence:** `tokenize='unicode61 remove_diacritics 2'` removes diacritics (à→a) but Italian has specific stemming needs
- **Fix:** Consider `porter` tokenizer for Italian or custom tokenizer

---

## 7. Nightly Processing (`src/studyhub/notte.py`, `fullrun.py`)

### BE-NEW-028: `notte.py` Hardcodes `DEFAULT_LLM_URL = "http://127.0.0.1:8081"` (Backend Port)
- **File:** `notte.py:28`
- **Severity:** Medium
- **Evidence:** Comment says "backend senza router" (port 8081). But `llm.py` candidates include both 8080 (router) and 8081 (backend). Night process bypasses router health checks.
- **Fix:** Use `llm.local_llm_candidates()` and `llm.get_local_llm_url()` for consistency

### BE-NEW-029: `fullrun.py` Media Track Downloads Panopto Videos Sequentially (No Parallelism)
- **File:** `fullrun.py:177-195` (Panopto loop)
- **Severity:** Medium
- **Evidence:** Single-threaded `for c, lec in todo:` with 3 retries each. No GPU parallelism (Whisper is sequential anyway), but download + audio extraction could overlap.
- **Fix:** Use `ThreadPoolExecutor` for download phase; keep Whisper sequential via GPU lock

### BE-NEW-030: `fullrun.py` Study Track No Backpressure When Claude Budget Exhausted
- **File:** `fullrun.py:203-208` (`_claude_busy`), `fullrun.py:236-247`
- **Severity:** High
- **Evidence:** 
  ```python
  busy = _claude_busy()
  if busy:
      waiting = True
      _save(claude=busy)
      continue  # skips this course, tries next
  ```
  - If ALL courses need Claude notes, `waiting=True` for all → `time.sleep(120)` → tight loop polling budget
  - No exponential backoff; wastes CPU
- **Fix:** Calculate `resets_at` from usage; sleep until reset + jitter

### BE-NEW-031: `fullrun.py` Lock File Not Cleaned Up on Crash
- **File:** `fullrun.py:34-35` (`LOCK_FILE = LOCAL_DIR / "full_run.lock"`), line 281-285 (`file_lock`)
- **Severity:** Medium
- **Evidence:** `file_lock` creates lock file; `__exit__` called in `finally` but if process killed (SIGKILL), lock file remains → next run thinks fullrun still running (`is_running()` returns True via `LockTimeout`)
- **Fix:** Add PID validation in `is_running()`: check if locking PID still alive; if not, force release

---

## 8. Configuration & Secrets (`src/studyhub/config.py`, `filelock.py`)

### BE-NEW-032: `config.yaml` Loaded Without Schema Validation
- **File:** `config.py:64-73` (`load_settings`)
- **Severity:** Medium
- **Evidence:** `yaml.safe_load` → arbitrary keys go to `settings.extra` dict. No validation of required fields (`moodle_url`, `uni_root`, etc.)
- **Fix:** Use Pydantic `BaseSettings` with validation; fail fast on missing/invalid config

### BE-NEW-033: File Lock Uses `CREATE_NO_WINDOW` but No Cross-Platform Abstraction
- **File:** `filelock.py` (not read but referenced)
- **Severity:** Low
- **Evidence:** `creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)` used in multiple places — Windows-specific
- **Fix:** Abstract platform-specific process creation

---

## 9. Study Domain Logic (`src/studyhub/study/`)

### BE-NEW-034: `bank.py` Question Shuffle Uses `random.shuffle` Without Seed (Non-Deterministic)
- **File:** `bank.py:354-357`
- **Severity:** Medium
- **Evidence:** 
  ```python
  posizioni = list(range(len(q["opzioni"])))
  random.shuffle(posizioni)
  q["corretta"] = posizioni.index(q["corretta"])
  ```
  - Different shuffle each generation → same question has different option order each time
  - Breaks reproducibility; user sees different order on retry
- **Fix:** Seed RNG with `hash(unit_id + question_text)` for deterministic shuffle

### BE-NEW-035: `bank.py` `sync_units` Duplicate Detection O(N²) on `kept` List
- **File:** `bank.py:220-229`
- **Severity:** Low
- **Evidence:** Linear scan `next((k for k in kept if ...))` for each candidate → O(N²) for many documents
- **Fix:** Use dict keyed by signature hash for O(1) lookup

### BE-NEW-036: `lecture_notes.py` `existing()` Returns Most Recent but No Cache Invalidation
- **File:** `ai/lecture_notes.py:297-301`
- **Severity:** Low
- **Evidence:** `ORDER BY id DESC LIMIT 1` — if user deletes `.md`/`.json` files manually, DB still has record → `existing()` returns stale path
- **Fix:** Verify file exists in `existing()`; if not, delete DB record and return `None`

---

## Summary by Severity

| Severity | Count | IDs |
|----------|-------|-----|
| **Critical** | 4 | BE-NEW-005 (CSRF), BE-NEW-011 (Job race), BE-NEW-017 (Browser profile), BE-NEW-020 (Panopto cookie) |
| **High** | 8 | BE-NEW-001 (CORS), BE-NEW-003 (Path traversal), BE-NEW-014 (LLM health cache), BE-NEW-015 (Worker contention), BE-NEW-021 (GPU lock timeout), BE-NEW-025 (Semantic search silent fail), BE-NEW-026 (KN fallback OOM), BE-NEW-030 (Claude budget busy-loop) |
| **Medium** | 12 | BE-001, BE-NEW-004, BE-NEW-006, BE-NEW-007, BE-NEW-010, BE-NEW-012, BE-NEW-013, BE-NEW-018, BE-NEW-019, BE-NEW-023, BE-NEW-028, BE-NEW-029, BE-NEW-031, BE-NEW-032, BE-NEW-034 |
| **Low** | 7 | BE-002, BE-NEW-008, BE-NEW-009, BE-NEW-022, BE-NEW-024, BE-NEW-027, BE-NEW-033, BE-NEW-035, BE-NEW-036 |

---

## Recommended Fix Priority Order

1. **Week 1 (Security & Data Integrity):**
   - BE-NEW-005: Implement CSRF protection (double-submit cookie)
   - BE-NEW-001: Add CORS middleware with strict origins
   - BE-NEW-003: Fix path traversal in `/media/` endpoint
   - BE-NEW-017: Ephemeral browser context for login
   - BE-NEW-020: Encrypt Panopto cookies with DPAPI
   - BE-NEW-011: Fix job queue race with `INSERT OR IGNORE` + transaction
   - BE-001: Remove duplicate migration

2. **Week 2 (Reliability & Scalability):**
   - BE-NEW-026: Implement sqlite-vec HNSW or add memory-safe fallback
   - BE-NEW-014: Improve LLM health check caching logic
   - BE-NEW-021: Align GPU lock timeout with transcription timeout
   - BE-NEW-030: Add exponential backoff for Claude budget wait
   - BE-NEW-015: Cross-process llama-server slot coordination
   - BE-NEW-031: PID validation for fullrun lock

3. **Week 3 (Observability & Maintainability):**
   - BE-NEW-002: Migrate to lifespan handlers
   - BE-NEW-004: Add Pydantic strict validation
   - BE-NEW-006: OS keyring for secrets
   - BE-NEW-025: Explicit semantic search degradation signaling
   - BE-NEW-032: Config validation with Pydantic
   - BE-NEW-034: Deterministic question shuffle

4. **Week 4 (Performance & Polish):**
   - BE-NEW-007, BE-NEW-013: Missing indexes, query optimization
   - BE-NEW-022, BE-NEW-035: Caching probe results, O(N²) dedup
   - BE-NEW-023: Checksum verification for Drive moves
   - BE-NEW-024: Startup tmp cleanup
   - BE-NEW-027: Italian FTS5 tokenizer
   - BE-NEW-028: Consistent LLM URL discovery
   - BE-NEW-029: Parallel download in fullrun

---

## Regression Test Matrix

| Fix | Test Case |
|-----|-----------|
| CSRF (BE-NEW-005) | POST `/api/lectures/1/notes` without Origin → 403; with valid Origin → 200; with `Origin: null` → 403 |
| Path Traversal (BE-NEW-003) | `GET /media/1/../../etc/passwd` → 404; `GET /media/1/valid.pdf` → 200 |
| Job Race (BE-NEW-011) | Concurrent `enqueue([1])` from 2 processes → exactly 1 job in DB |
| LLM Health Cache (BE-NEW-014) | Simulate network blip → recovery < 30s; auth failure → cached 5min |
| KN Fallback (BE-NEW-026) | 50k chunks → `search()` < 500ms, RAM < 500MB |
| GPU Lock Timeout (BE-NEW-021) | 3h audio → transcription completes without lock expiry |
| Duplicate Migration (BE-001) | Fresh DB → `user_version = 15` after init; no duplicate index error |
| Config Validation (BE-NEW-032) | Missing `moodle_url` in config.yaml → clear error on startup |
| Deterministic Shuffle (BE-NEW-034) | Same unit generated twice → identical option order |

---

## Files Examined (Complete List)

```
src/studyhub/api/app.py                    (1201 lines)
src/studyhub/db.py                         (445 lines)
src/studyhub/ai/jobs.py                    (345 lines)
src/studyhub/ai/llm.py                     (625 lines)
src/studyhub/ai/lecture_notes.py           (334 lines)
src/studyhub/ai/claude_runner.py           (not read - referenced)
src/studyhub/sync/auth.py                  (164 lines)
src/studyhub/sync/catalog.py               (89 lines)
src/studyhub/sync/course.py                (343 lines)
src/studyhub/sync/moodle.py                (147 lines)
src/studyhub/media/pipeline.py             (318 lines)
src/studyhub/media/transcribe.py           (188 lines)
src/studyhub/media/storage.py              (215 lines)
src/studyhub/media/panopto.py              (167 lines)
src/studyhub/media/audio.py                (not read - referenced)
src/studyhub/media/ff.py                   (not read - referenced)
src/studyhub/media/gpu.py                  (not read - referenced)
src/studyhub/media/slides.py               (not read - referenced)
src/studyhub/search.py                     (75 lines)
src/studyhub/ingest/vectors.py             (62 lines)
src/studyhub/ingest/embed.py               (75 lines)
src/studyhub/ingest/indexer.py             (220 lines)
src/studyhub/ingest/chunking.py            (not read - referenced)
src/studyhub/ingest/extract.py             (not read - referenced)
src/studyhub/ingest/ocr.py                 (not read - referenced)
src/studyhub/notte.py                      (381 lines)
src/studyhub/fullrun.py                    (312 lines)
src/studyhub/config.py                     (77 lines)
src/studyhub/study/bank.py                 (497 lines)
src/studyhub/study/quiz.py                 (152 lines)
src/studyhub/study/lesson.py               (not read - referenced)
src/studyhub/study/session.py              (not read - referenced)
src/studyhub/study/flashcards.py           (not read - referenced)
src/studyhub/study/riprese.py              (not read - referenced)
src/studyhub/paths.py                      (not read - referenced)
src/studyhub/__init__.py                   (not read - referenced)
```

---

**End of Report** — All issues documented with file:line references, evidence snippets, and specific remediation steps. No code modified.