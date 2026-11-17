# PowerShell script to replace FreeLLMAPI code with security comment
$file = "C:\Users\valem\Desktop\02_Università\_StudyHub\backend\src\studyhub\ai\llm.py"

$old_code = @'
@dataclass
class LLMResult:
    dict
    provider: str      # local | gemini | claude
    model: str
    duration_s: float
    images_sent: int = 0   # foto davvero consegnate a un modello con vista (0 = nessuna letta)

# --- FreeLLMAPI (VPS / Brain) ----------------------------------------------------------------
# Provider gratuito OpenAI-compatible: catena curata di modelli pubblici (Qwen3.8, Nemotron...).
# Configurato tramite le variabili del Brain (secrets/.env o ambiente utente):
#   FREELLMAPI_URLS  - URL del server (piu istanze separate da virgola)
#   FREELLMAPI_API_KEY - chiave di accesso
# Non supporta le immagini: le richieste vision passano sempre a Claude.
_freellm_health: dict = {"ok": None, "at": -1e9, "ttl": 0.0}
_freellm_lock = threading.Lock()


def _freellm_key() -> str:
    """Chiave FreeLLMAPI: da variabile ambiente o dal .env del Brain."""
    return _freellm_env().get("key", "")


def _freellm_env() -> dict:
    """Legge FREELLMAPI_URLS e FREELLMAPI_API_KEY dall'ambiente o dal .env del Brain."""
    env_key = (os.environ.get("FREELLMAPI_API_KEY") or "").strip()
    env_urls = (os.environ.get("FREELLMAPI_URLS") or os.environ.get("FREELLMAPI_URL") or "").strip()
    if env_key and env_urls:
        return {"key": env_key, "urls": env_urls}
    # Fallback: leggi il .env del Brain
    for env_path in (r"C:\Brain\secrets\.env",):
        env_file = Path(env_path)
        if env_file.exists():
            try:
                dict = {}
                for line in env_file.read_text(encoding="utf-8").splitlines():
                    if line.startswith("FREELLMAPI_API_KEY=") and not data.get("key"):
                        data["key"] = line.split("=", 1)[1].strip()
                    elif line.startswith("FREELLMAPI_URLS=") and not data.get("urls"):
                        data["urls"] = line.split("=", 1)[1].strip()
                if data:
                    return data
            except OSError:
                pass
    return {"key": env_key, "urls": env_urls or "http://127.0.0.1:31415"}


def _freellm_base() -> str:
    """URL base del server FreeLLMAPI (primo nell'elenco)."""
    raw = _freellm_env().get("urls", "http://127.0.0.1:31415")
    return raw.split(",")[0].strip().rstrip("/")


def _freellm_up() -> bool:
    """Health check con cache 60s. Verifica /api/ping."""
    now = time.monotonic()
    with _freellm_lock:
        ok, at, ttl = _freellm_health["ok"], _freellm_health["at"], _freellm_health["ttl"]
    if ok is not None and now - at < ttl:
        return ok
    key = _freellm_key()
    if not key:
        with _freellm_lock:
            _freellm_health.update(ok=False, at=now, ttl=30.0)
        return False
    base = _freellm_base()
    try:
        req = urllib.request.Request(base + "/api/ping",
                                     headers={"Authorization": f"Bearer {key}"})
        with urllib.request.urlopen(req, timeout=3) as r:
            result = r.status == 200
    except Exception:
        result = False
    cache_ttl = 60.0 if result else 15.0
    with _freellm_lock:
        _freellm_health.update(ok=result, at=now, ttl=cache_ttl)
    return result


def _freellm(system: str, text: str, schema: dict, quality: str) -> "LLMResult":
    """Chiamata a FreeLLMAPI (OpenAI-compatible). Lancia ClaudeError se non risponde."""
    if not _freellm_up():
        raise ClaudeError("FreeLLMAPI non raggiungibile.")
    base = _freellm_base()
    key = _freellm_key()
    prompt = (
        f"{system}\n\nNON inserire tag  o ragionamenti preliminari. "
        f"Rispondi ESCLUSIVAMENTE con un oggetto JSON valido conforme a questo schema:\n"
        f"{json.dumps(schema, ensure_ascii=False)}\n\nTesto di partenza:\n{text}"
    )
    body = {
        "model": FREELLM_MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 5120,
        "temperature": 0.3,
        "response_format": {"type": "json_object"},
    }
    payload_bytes = json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        base + "/v1/chat/completions",
        data=payload_bytes,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=FREELLM_TIMEOUT_S) as r:
            resp = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        with _freellm_lock:
            _freellm_health.update(ok=False, at=-1e9, ttl=0.0)
        raise ClaudeError(f"FreeLLMAPI HTTP {e.code}: {e.reason}")
    except Exception as e:
        with _freellm_lock:
            _freellm_health.update(ok=False, at=-1e9, ttl=0.0)
        raise ClaudeError(f"FreeLLMAPI errore di rete: {e}")
    raw = (resp.get("choices") or [{}])[0].get("message", {}).get("content") or ""
    if not raw.strip():
        raise ClaudeError("FreeLLMAPI: risposta vuota")
    data_out = _extract_json(raw)
    model_name = resp.get("model", f"freellm:{FREELLM_MODEL}")
    return LLMResult(data_out, "freellm", model_name, round(time.time() - t0, 1))
'@

$new_code = @'
@dataclass
class LLMResult:
    dict
    provider: str      # local | gemini | claude
    model: str
    duration_s: float
    images_sent: int = 0   # foto davvero consegnate a un modello con vista (0 = nessuna letta)

# --- FreeLLMAPI (VPS / Brain) ----------------------------------------------------------------
# FRAGILE: provider gratuito OpenAI-compatible.
# ATTENZIONE: FreeLLMAPI NON VIENE USATO per StudyHub (security/hygiene:
# non inviare contenuto studente a provider gratuiti).
# IMPORTANTE: se mai si riattiva FreeLLMAPI, applicare il filtro privacy del Brain prima di chiamare.
# Fare riferimento a C:\Brain\core\brain\privacy.py per gli array e funzioni attuali.

# Costanti obsolescenti ma mantenute per compatibilità futura (non usate da StudyHub)
FREELLM_TIMEOUT_S = 180
FREELLM_MODEL = "auto"   # catena curata dal Brain: Qwen3.8, Nemotron...
'@

$content = [System.IO.File]::ReadAllText($file, [System.Text.Encoding]::UTF8)
$content = $content -replace [regex]::Escape($old_code), $new_code
[System.IO.File]::WriteAllText($file, $content, [System.Text.Encoding]::UTF8)
Write-Host "FREE LLMAPI CODE REPLACED SUCCESSFULLY"