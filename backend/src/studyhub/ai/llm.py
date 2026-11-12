"""Un'unica funzione per le chiamate AI "da studio", con tre provider in cascata:

- Local LLM Cluster (PC Fisso Linux Qwen3.6-35B-A3B / Laptop via Cavo Diretto, LAN, Tailscale o Proxy):
  zero costi, 100% offline, privacy totale e velocità locale (~13 tok/s).
- Gemini (Google AI Pro) tramite la CLI di Antigravity (`agy`): domande, correzioni, schede.
  Ha una quota ampia, quindi si usa per i lavori frequenti e lascia libera la finestra di Claude.
- Claude (Pro) tramite claude_runner: Sonnet/Haiku, mai Opus. Fa da riserva se Gemini non risponde
  e resta il motore degli appunti delle lezioni (lì servono le immagini delle pagine scritte a mano).

`agy` è un agente con strumenti: gira in una cartella vuota, in sandbox, e il prompt gli dice di
rispondere direttamente. Il testo arriva da stdin (stream-json), non dalla riga di comando: gli
appunti superano il limite di 32 KB di Windows.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

from ..config import LOCAL_DIR, settings
from .claude_runner import ClaudeError, RateLimited, run as claude_run

AGY_CWD = LOCAL_DIR / "agy-cwd"
AGY_TIMEOUT_S = 8 * 60
GEMINI_MODELS = {"veloce": "gemini-3.8-flash-low", "accurato": "gemini-3.8-flash-high"}
CLAUDE_MODELS = {"veloce": "haiku", "accurato": "sonnet"}

# Default Key per il PC Fisso Linux (Desktop-vale)
DEFAULT_API_KEY = "qIlpO0Z0yxd5mYSiF7cjnB5s1WRxXrSHC5XKlnZhIY4"

# --- Scoperta dell'LLM locale -------------------------------------------------------------------
# Due macchine possono servire il modello:
#  - il laptop Windows: router llama.cpp su 127.0.0.1:8080 (API OpenAI su /v1, modello "local", niente
#    chiave; il modello si carica alla prima richiesta, quindi la prima risposta può tardare 20-30 s);
#  - il PC fisso: 100.83.194.37 (Tailscale) o 10.10.10.1 (cavo diretto), porta 8080 con chiave
#    e 8081 (backend senza router).
# Ordine: l'indirizzo scelto da te (config/variabile d'ambiente), poi questa stessa macchina, poi il cavo,
# poi Tailscale e LAN. Su ogni macchina quindi vince il modello più vicino; se cade si passa al successivo.
LOCAL_CANDIDATES = (
    "http://127.0.0.1:8080",
    "http://10.10.10.1:8080",
    "http://10.10.10.1:8081",
    "http://100.83.194.37:8080",
    "http://192.168.10.89:8080",
    "http://127.0.0.1:8081",
    "http://100.83.194.37:8081",
    "http://192.168.10.89:8081",
)
FALLBACK_LOCAL_URL = "http://100.83.194.37:8080"   # ultima spiaggia se nessun controllo di salute risponde
LOCAL_MODEL = "local"                              # alias del router Windows; il router Linux lo mappa su Qwen 35B
HEALTH_TIMEOUT_S = 1.0                             # controllo di salute: breve, i candidati si provano in parallelo
CACHE_OK_S = 300.0                                 # un candidato sano resta valido 5 minuti (o fino al primo errore)
CACHE_NONE_S = 15.0                                # "nessuno risponde" si ricontrolla presto
LOCAL_TIMEOUT_S = 600                              # generazioni lunghe: timeout di lettura
MAX_LOCAL_ATTEMPTS = 3

_cache: dict = {"url": None, "at": -1e9, "ttl": 0.0}
_cache_lock = threading.Lock()


def _now() -> float:
    return time.monotonic()


def get_local_llm_key() -> str:
    return os.environ.get("STUDYHUB_LLM_KEY") or str(settings.extra.get("local_llm_key") or DEFAULT_API_KEY)


def get_local_llm_model() -> str:
    return os.environ.get("STUDYHUB_LLM_MODEL") or str(settings.extra.get("local_llm_model") or LOCAL_MODEL)


def _norm(url: str) -> str:
    """'http://host:8080/v1/' e 'http://host:8080' sono lo stesso server."""
    url = url.strip().rstrip("/")
    if url.endswith("/v1"):
        url = url[:-3].rstrip("/")
    return url


def local_llm_candidates() -> list[str]:
    custom = os.environ.get("STUDYHUB_LOCAL_LLM") or settings.extra.get("local_llm_url")
    out: list[str] = []
    for cand in ([custom] if custom else []) + list(LOCAL_CANDIDATES):
        if cand and _norm(str(cand)) not in out:
            out.append(_norm(str(cand)))
    return out


def _auth_headers(base: str) -> dict:
    """La chiave vale per le porte 8080 (router con chiave); il backend 8081 non la vuole."""
    key = get_local_llm_key()
    return {"Authorization": f"Bearer {key}"} if key and base.endswith(":8080") else {}


def _probe(base: str) -> bool:
    """Controllo di salute: /health, e se il server non lo espone /v1/models. Timeout breve."""
    for path in ("/health", "/v1/models"):
        try:
            req = urllib.request.Request(base + path, headers=_auth_headers(base))
            with urllib.request.urlopen(req, timeout=HEALTH_TIMEOUT_S) as r:
                if r.status == 200:
                    return True
        except urllib.error.HTTPError as e:
            if e.code == 404:
                continue  # niente /health: provo /v1/models
            return False
        except Exception:
            return False
    return False


def invalidate_local_llm(url: str | None = None) -> None:
    """Dimentica il candidato in cache (se `url` è dato, solo se è proprio quello)."""
    with _cache_lock:
        if url is None or _cache["url"] == _norm(url):
            _cache.update(url=None, at=-1e9, ttl=0.0)


def get_local_llm_url(exclude: tuple | list = ()) -> str | None:
    """Primo server sano nell'ordine di priorità, con risultato in cache.

    I candidati si controllano in parallelo (attesa massima ~HEALTH_TIMEOUT_S anche con più macchine spente),
    poi si sceglie in ordine di priorità. `exclude`: server appena caduti durante una richiesta.
    """
    skip = {_norm(u) for u in exclude}
    with _cache_lock:
        url, fresh = _cache["url"], _now() - _cache["at"] < _cache["ttl"]
    if fresh and (url is None or url not in skip):
        return url
    cands = [c for c in local_llm_candidates() if c not in skip]
    found = None
    if cands:
        pool = ThreadPoolExecutor(max_workers=len(cands), thread_name_prefix="llm-health")
        try:
            futures = [pool.submit(_probe, c) for c in cands]
            for cand, fut in zip(cands, futures):
                if fut.result():
                    found = cand
                    break
        finally:
            pool.shutdown(wait=False, cancel_futures=True)
    with _cache_lock:
        _cache.update(url=found, at=_now(), ttl=CACHE_OK_S if found else CACHE_NONE_S)
    return found


@dataclass
class LLMResult:
    data: dict
    provider: str      # local | gemini | claude
    model: str
    duration_s: float


def _check_local() -> bool:
    return get_local_llm_url() is not None


def _agy_exe() -> str | None:
    exe = shutil.which("agy")
    if exe:
        return exe
    p = Path.home() / "AppData" / "Local" / "agy" / "bin" / "agy.exe"
    return str(p) if p.exists() else None


def provider_order() -> list[str]:
    """config.yaml → ai_provider: auto | local | gemini | claude. auto = local (se cluster attivo), poi Gemini se c'è, poi Claude."""
    pref = (settings.extra.get("ai_provider") or "auto").lower()
    if pref == "local":
        return ["local"]
    if pref == "claude":
        return ["claude"]
    if pref == "gemini":
        return ["gemini"]

    chain = []
    if _check_local():
        chain.append("local")
    if _agy_exe():
        chain.append("gemini")
    chain.append("claude")
    return chain


class _HostDown(Exception):
    """Il server non risponde (rete, 5xx, chiave rifiutata): vale la pena provare un'altra macchina."""


def _post_chat(base: str, payload: dict) -> dict:
    headers = {"Content-Type": "application/json", **_auth_headers(base)}
    req = urllib.request.Request(f"{base}/v1/chat/completions", data=json.dumps(payload).encode("utf-8"),
                                 headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=LOCAL_TIMEOUT_S) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        # 5xx e chiave/percorso rifiutati: è la macchina; altri 4xx (richiesta sbagliata) falliscono ovunque.
        if e.code >= 500 or e.code in (401, 403, 404):
            raise _HostDown(f"{base}: HTTP {e.code}")
        raise ClaudeError(f"Local LLM error: HTTP {e.code} da {base}")
    except TimeoutError:
        # Il server è vivo ma lento (o la generazione è lunga): non si ricomincia da capo su un'altra macchina.
        invalidate_local_llm(base)
        raise ClaudeError(f"Local LLM error: nessuna risposta da {base} entro {LOCAL_TIMEOUT_S}s")
    except (urllib.error.URLError, OSError, json.JSONDecodeError, UnicodeDecodeError) as e:
        raise _HostDown(f"{base}: {e}")


def _extract_json(raw: str):
    """JSON dalla risposta del modello: toglie i blocchi <think>, prende il primo {...} e ripara se serve."""
    raw = re.sub(r"<think>.*?</think>", "", raw, flags=re.DOTALL)
    raw = re.sub(r"^.*?</think>", "", raw, flags=re.DOTALL)  # <think> aperto dal template, chiuso nella risposta
    match = re.search(r"\{.*\}", raw, re.DOTALL)
    text_json = match.group(0) if match else raw
    try:
        data = json.loads(text_json, strict=False)
    except Exception:
        try:
            import json_repair
            data = json_repair.loads(text_json)
        except Exception as e:
            raise ClaudeError(f"Local LLM JSON parse error: {e}")
    # json_repair restituisce "" o una stringa per un testo senza JSON: non è una risposta valida, e chi
    # chiama indicizza data["..."]. Meglio un ClaudeError, che fa passare al provider successivo.
    if not isinstance(data, dict):
        raise ClaudeError("Local LLM JSON parse error: la risposta non contiene un oggetto JSON")
    return data


def _local(system: str, text: str, schema: dict, quality: str) -> LLMResult:
    t0 = time.time()
    prompt = (
        f"{system}\n\nNON inserire tag <think> o ragionamenti preliminari. "
        f"Rispondi ESCLUSIVAMENTE con un oggetto JSON valido conforme a questo schema:\n"
        f"{json.dumps(schema, ensure_ascii=False)}\n\nTesto di partenza:\n{text}"
    )
    payload = {
        "model": get_local_llm_model(),
        "messages": [
            {"role": "user", "content": prompt}
        ],
        "response_format": {"type": "json_object"},
        "temperature": 0.2,
        "max_tokens": 5120,
    }
    tried: list[str] = []
    errors: list[str] = []
    res = None
    for _ in range(MAX_LOCAL_ATTEMPTS):
        base = get_local_llm_url(exclude=tried)
        if base is None:
            if tried:
                break
            base = FALLBACK_LOCAL_URL  # nessun controllo di salute ha risposto: ultimo tentativo alla cieca
        try:
            res = _post_chat(base, payload)
            break
        except _HostDown as e:
            errors.append(str(e))
            invalidate_local_llm(base)  # il prossimo giro sceglie un'altra macchina (o ricontrolla tutte)
            tried.append(base)
    if res is None:
        raise ClaudeError("Local LLM error: " + " · ".join(errors or ["nessun server raggiungibile"]))

    msg = (res.get("choices") or [{}])[0].get("message", {})
    raw = msg.get("content") or ""
    if not raw.strip() and msg.get("reasoning_content"):
        raw = msg.get("reasoning_content")
    data = _extract_json(raw)
    model_name = res.get("model", "local-qwen3.6-35b")
    return LLMResult(data, "local", model_name, round(time.time() - t0, 1))


def _gemini(system: str, text: str, schema: dict, quality: str) -> LLMResult:
    exe = _agy_exe()
    if not exe:
        raise ClaudeError("Antigravity (agy) non trovato.")
    AGY_CWD.mkdir(parents=True, exist_ok=True)
    model = GEMINI_MODELS[quality]
    prompt = (f"{system}\n\nNON usare strumenti, file, terminale o web: rispondi direttamente con il JSON "
              f"richiesto, basandoti solo sul testo qui sotto.\n\n{text}")
    msg = json.dumps({"event": "user", "message": {"role": "user", "content": prompt}}, ensure_ascii=False)
    cmd = [exe, "--input-format", "stream-json", "--output-format", "stream-json", "--model", model,
           "--sandbox", "--disable-slash-commands", "--json-schema", json.dumps(schema, ensure_ascii=False), "-p="]
    t0 = time.time()
    try:
        proc = subprocess.run(cmd, input=msg + "\n", capture_output=True, text=True, encoding="utf-8",
                              errors="replace", cwd=AGY_CWD, timeout=AGY_TIMEOUT_S,
                              creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except subprocess.TimeoutExpired:
        raise ClaudeError("Gemini non ha risposto entro il tempo massimo.")
    result = None
    for line in proc.stdout.splitlines():
        try:
            ev = json.loads(line)
        except json.JSONDecodeError:
            continue
        if ev.get("event") == "result":
            result = ev.get("result") or {}
    if not result or result.get("status") != "SUCCESS":
        err = (result or {}).get("error") or proc.stderr[-500:] or "nessuna risposta"
        if "quota" in err.lower() or "limit" in err.lower():
            raise RateLimited(f"Gemini: {err[:300]}")
        raise ClaudeError(f"Gemini: {err[:500]}")
    data = result.get("structured_output")
    if not isinstance(data, dict):
        raise ClaudeError("Gemini non ha restituito un JSON valido.")
    return LLMResult(data, "gemini", model, round(time.time() - t0, 1))


def run_json(system: str, text: str, schema: dict, quality: str = "accurato") -> LLMResult:
    """Chiamata con output JSON (schema). quality: veloce (correzioni) | accurato (generazione)."""
    errors = []
    for prov in provider_order():
        try:
            if prov == "local":
                return _local(system, text, schema, quality)
            if prov == "gemini":
                return _gemini(system, text, schema, quality)
            res = claude_run(system, [{"type": "text", "text": text}], schema, model=CLAUDE_MODELS[quality])
            return LLMResult(res.data, "claude", res.model, res.duration_s)
        except (ClaudeError, RateLimited, OSError) as e:
            errors.append(f"{prov}: {e}")
    raise ClaudeError(" · ".join(errors))
