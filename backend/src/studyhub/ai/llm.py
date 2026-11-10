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
import time
import urllib.request
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

# Discovery automatico dell'LLM locale / cluster Dual-PC
_ACTIVE_LOCAL_URL: str | None = None
_LAST_LOCAL_CHECK: float = 0.0


def get_local_llm_key() -> str:
    return os.environ.get("STUDYHUB_LLM_KEY") or str(settings.extra.get("local_llm_key") or DEFAULT_API_KEY)


def get_local_llm_url() -> str | None:
    global _ACTIVE_LOCAL_URL, _LAST_LOCAL_CHECK
    now = time.time()
    if _ACTIVE_LOCAL_URL and (now - _LAST_LOCAL_CHECK < 15.0):
        return _ACTIVE_LOCAL_URL

    custom = os.environ.get("STUDYHUB_LOCAL_LLM") or settings.extra.get("local_llm_url")
    candidates = [custom] if custom else []
    # Ordine di priorità:
    # 1. Cavo Ethernet Diretto tra i due PC (10.10.10.1)
    # 2. Tailscale VPN (100.83.194.37)
    # 3. LAN Wi-Fi (192.168.10.89)
    # 4. Proxy Locale (127.0.0.1:8081)
    candidates.extend([
        "http://10.10.10.1:8081",
        "http://10.10.10.1:8080",
        "http://100.83.194.37:8080",
        "http://192.168.10.89:8080",
        "http://127.0.0.1:8081",
        "http://100.83.194.37:8081",
        "http://192.168.10.89:8081",
    ])
    key = get_local_llm_key()
    for cand in candidates:
        if not cand:
            continue
        try:
            req = urllib.request.Request(f"{cand.rstrip('/')}/health")
            if ":8080" in cand and key:
                req.add_header("Authorization", f"Bearer {key}")
            with urllib.request.urlopen(req, timeout=0.8) as r:
                if r.status == 200:
                    _ACTIVE_LOCAL_URL = cand.rstrip("/")
                    _LAST_LOCAL_CHECK = now
                    return _ACTIVE_LOCAL_URL
        except Exception:
            continue

    _ACTIVE_LOCAL_URL = None
    _LAST_LOCAL_CHECK = now
    return None


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


def _local(system: str, text: str, schema: dict, quality: str) -> LLMResult:
    t0 = time.time()
    base_url = get_local_llm_url() or "http://100.83.194.37:8080"
    url = f"{base_url}/v1/chat/completions"
    key = get_local_llm_key()
    prompt = (
        f"{system}\n\nNON inserire tag <think> o ragionamenti preliminari. "
        f"Rispondi ESCLUSIVAMENTE con un oggetto JSON valido conforme a questo schema:\n"
        f"{json.dumps(schema, ensure_ascii=False)}\n\nTesto di partenza:\n{text}"
    )
    payload = {
        "messages": [
            {"role": "user", "content": prompt}
        ],
        "response_format": {"type": "json_object"},
        "temperature": 0.2,
        "max_tokens": 5120,
    }
    headers = {"Content-Type": "application/json"}
    if ":8080" in base_url and key:
        headers["Authorization"] = f"Bearer {key}"

    try:
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers=headers
        )
        with urllib.request.urlopen(req, timeout=600) as r:
            res = json.loads(r.read().decode("utf-8"))
    except Exception as e:
        raise ClaudeError(f"Local LLM error: {e}")

    msg = res.get("choices", [{}])[0].get("message", {})
    raw = msg.get("content") or ""
    if not raw.strip() and msg.get("reasoning_content"):
        raw = msg.get("reasoning_content")

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
