# SECURITY_AUDIT.md — StudioHub Sprint 1.5

**Data**: 2026-11-17  
**Branch**: `ai/studyhub-frontend-v3`  
**Commit**: `f02e2f8` + fix test_pannello_ai.py

---

## Riepilogo Sicurezza Sprint 1.5

| Controllo | Stato | Note |
|-----------|-------|------|
| **API Token Authentication** | ✅ COMPLETATO | Bearer token su tutti `/api/*`, 401 senza, cookie HttpOnly per browser |
| **CSRF Protection (Double-Submit)** | ✅ COMPLETATO | Cookie `HttpOnly`, `SameSite=Strict`, `Secure` + header `X-CSRF-Token` |
| **CORS Configuration** | ✅ COMPLETATO | `allow_origins` esplicito, `allow_credentials=true`, header esposti |
| **Keyring / Secrets Management** | ✅ COMPLETATO | Windows Credential Manager / Linux Secret Service + fallback file |
| **Path Traversal Protection** | ✅ COMPLETATO | `uni_path()` con `is_relative_to()`, endpoint `/media/` doppio check |
| **Migrazioni DB Sicure** | ✅ COMPLETATO | Indice unico parziale v14 previene race condition |
| **Input Validation** | ⚠️ PARZIALE | Pydantic su request models, manca `extra='forbid'` |
| **Privacy Filter** | ❌ DA FARE | Integrazione `privacy.py` in `llm.py` (Sprint 2) |
| **Network Bind** | ⚠️ DA VERIFICARE | Verificare `uvicorn --host 127.0.0.1` in produzione |
| **Dependency Audit** | ❌ DA FARE | `pip-audit`, `npm audit` (Sprint 3) |

---

## Dettaglio Implementazioni

### 1. API Token Authentication (`backend/src/studyhub/config.py`, `api/app.py`)

**Implementazione**:
- `get_or_create_api_token()`: genera token URL-safe 32 bytes se non esiste in `LOCAL_DIR/api_token` o env `STUDYHUB_API_TOKEN`
- `get_current_token` dependency: valida `Authorization: Bearer <token>` header o cookie `api_token`
- `secrets.compare_digest()` per timing-attack resistance

**Test**:
```bash
# Senza token
curl http://127.0.0.1:8765/api/courses
# → 401 {"detail": "Authentication required..."}

# Con token sbagliato
curl -H "Authorization: Bearer wrong" http://127.0.0.1:8765/api/courses
# → 401

# Con token corretto
curl -H "Authorization: Bearer test-api-token-12345" http://127.0.0.1:8765/api/courses
# → 200 [...]
```

### 2. CSRF Protection (`backend/src/studyhub/api/csrf.py`, `api/app.py`)

**Implementazione**: Double-Submit Cookie Pattern
- Cookie: `csrf_token` (32 bytes hex, `HttpOnly`, `SameSite=Strict`, `Secure`, `Max-Age=30d`)
- Header: `X-CSRF-Token` (inviato dal client su POST/PUT/DELETE/PATCH)
- Validazione: `secrets.compare_digest(cookie_token, header_token)`
- Middleware `CSRFMiddleware` imposta cookie su prima GET
- Dependency `csrf_protect` su endpoint mutanti

**Test**:
```bash
# Ottieni CSRF cookie
curl -c cookies.txt http://127.0.0.1:8765/
# Cookie: csrf_token=abc123...; HttpOnly; SameSite=Strict; Secure

# POST senza CSRF
curl -b cookies.txt -H "Authorization: Bearer token" -X POST -d '{}' http://127.0.0.1:8765/api/ai/queue
# → 403 {"detail": "CSRF token missing or invalid..."}

# POST con CSRF corretto
curl -b cookies.txt -H "Authorization: Bearer token" -H "X-CSRF-Token: abc123..." -X POST -d '{"course_id":1}' http://127.0.0.1:8765/api/ai/queue
# → 200/422 (validazione body)
```

### 3. CORS Configuration (`backend/src/studyhub/api/app.py`)

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "http://127.0.0.1:8765",
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-CSRF-Token", "X-Requested-With"],
    expose_headers=["X-CSRF-Token"],
)
```

### 4. Keyring / Secrets (`backend/src/studyhub/config.py`, `sync/auth.py`, `media/panopto.py`)

**Architettura**:
```
┌─────────────────────────────────────────────────────────────┐
│                    Secrets Priority                          │
├─────────────────────────────────────────────────────────────┤
│  1. OS Keyring (Windows Credential Manager / Linux Secret)  │
│  2. Fallback file (~/.studyhub/secrets/)                    │
│  3. config.yaml (deprecated, warning)                        │
│  4. Environment variables                                    │
│  5. In-memory override (tests)                               │
└─────────────────────────────────────────────────────────────┘
```

**File gestiti**:
- `~/.studyhub/secrets/session.json` — Moodle cookies + sesskey
- `~/.studyhub/secrets/token.json` — Moodle mobile token
- `~/.studyhub/secrets/panopto.json` — Panopto cookies (`.ASPXAUTH`)
- `~/.studyhub/api_token` — API token generato automaticamente
- `~/.studyhub/usage.json` — Claude usage stats

**Migrazione automatica**: Scrive in keyring prima, fallback a file. Legge da keyring prima, poi file.

### 5. Path Traversal (`backend/src/studyhub/paths.py`, `api/app.py`)

**`uni_path()` implementation**:
```python
def uni_path(rel: str | Path) -> Path:
    uni_root = settings.uni_root.resolve()
    target = (uni_root / rel).resolve()
    if not target.is_relative_to(uni_root):
        raise ValueError(f"Path traversal attempt blocked: {rel} resolves outside uni_root")
    return target
```

**Endpoint `/media/` doppio check**:
```python
@app.get("/media/{lecture_id}/{rel:path}")
def media(lecture_id: int, rel: str, token: str = Depends(get_current_token)):
    base = uni_path(_lecture(lecture_id)["folder"]).resolve()
    target = (base / rel).resolve()
    if not target.is_relative_to(base) or not target.is_file():
        raise HTTPException(404)
    return FileResponse(target)
```

**Test traversal bloccati**:
- `course1/../../etc/passwd` → `ValueError`
- `course1\..\..\etc\passwd` → `ValueError`
- `/etc/passwd` → `ValueError`
- `/media/1/../../etc/passwd` → 404

### 6. Database Security (Migrazione 14)

**Indice unico parziale previene race condition**:
```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_jobs_unique
ON ai_jobs(kind, target_id)
WHERE status IN ('in_coda', 'in_corso');
```

- Blocca duplicazione job concorrenti (server + fullrun + CLI)
- Permette retry: job `fatto`/`errore`/`annullato` possono esistere più volte
- Testato: tentativi concorrenti → solo uno riesce

---

## Checklist Sicurezza Pre-Rilascio

| Item | Stato | Note |
|------|-------|------|
| HTTPS in produzione | ⚠️ DA FARE | `Secure` cookie richiede HTTPS; localhost conta come secure in dev |
| `config.yaml` in `.gitignore` | ✅ | Verificato |
| `LOCAL_DIR` fuori da Google Drive | ✅ | `~/.studyhub/` non sincronizzato |
| Token rotation procedure | ✅ | `get_or_create_api_token()` rigenera se file mancante |
| Log sanitization | ❌ DA FARE | Sprint 3: filtro redazione API key, token, transcript |
| Rate limiting su `/api/setup/*` | ✅ | 1 req/min per IP |
| `uvicorn --host 127.0.0.1` | ⚠️ DA VERIFICARE | Verificare in `studyhub.bat` / systemd |
| `pip-audit` / `npm audit` | ❌ DA FARE | Sprint 3 |

---

## Problemi Noti / Debito Tecnico

1. **`keyring` non installato** — In dev usa fallback file. In produzione installare `pip install keyring` per usare Windows Credential Manager.

2. **Input validation non strict** — Pydantic models non hanno `extra='forbid'`. Aggiungere in Sprint 3.

3. **Privacy filter non integrato** — `privacy.py` esiste in Brain ma non chiamato da `llm.py`. Sprint 2.

4. **Network bind** — Verificare che `studyhub.bat` / systemd usino `--host 127.0.0.1`.

5. **FreeLLMAPI dead code** — Rimuovere o isolare dietro feature flag verificato.

---

## Conclusione

**Sicurezza Sprint 1.5: COMPLETATA** ✅

Tutti i controlli critici (SEC-001, SEC-002, SEC-003, SEC-005, BE-001) sono **RISOLTI E VERIFICATI**.

Prossimi passi sicurezza in Sprint 2/3:
- SEC-004: Pydantic `extra='forbid'` + validatori custom
- SEC-006: Privacy filter integration in `llm.py`
- SEC-007: Network bind restriction + Tailscale ACLs
- SEC-008: Log redaction filter
- SEC-009: `pip-audit` / `npm audit` CI pipeline