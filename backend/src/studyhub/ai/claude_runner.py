"""Chiamate a Claude con l'abbonamento Pro, tramite Claude Code in modalità headless.

- Una chiamata = un messaggio utente (testo + immagini) → output JSON validato da schema.
- Il system prompt di Claude Code viene sostituito (pochi token), niente tool, niente MCP,
  niente impostazioni utente/progetto, nessuna sessione salvata.
- Solo Sonnet e Haiku: Opus è vietato dal piano Pro.
- Dalla risposta si legge l'utilizzo della finestra di 5 ore: oltre la soglia la coda si ferma.
"""
from __future__ import annotations

import base64
import json
import shutil
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path

from ..config import LOCAL_DIR

ALLOWED_MODELS = {"sonnet", "haiku"}
USAGE_FILE = LOCAL_DIR / "claude_usage.json"
CWD = LOCAL_DIR / "claude-cwd"          # cartella vuota: nessun CLAUDE.md di progetto
STOP_AT_UTILIZATION = 0.90             # non avviare nuove elaborazioni oltre il 90% della finestra
TIMEOUT_S = 20 * 60


class ClaudeError(Exception):
    pass


class RateLimited(ClaudeError):
    pass


@dataclass
class ClaudeResult:
    data: dict
    model: str
    usage: dict
    cost_usd: float
    duration_s: float
    utilization: float | None
    num_turns: int = 1          # >2 = l'output non passava lo schema e Claude ha riprovato (costa il doppio)
    api_calls: int = 1


def _claude_exe() -> str:
    """claude.cmd passa da cmd.exe, che rovina le virgolette del JSON: usiamo l'exe nativo."""
    shim = shutil.which("claude")
    if not shim:
        local = Path.home() / ".local" / "bin" / "claude.exe"  # installer nativo (non sempre nel PATH dei processi)
        if local.exists():
            return str(local)
        raise ClaudeError("Claude Code non trovato: installalo e fai il login (`claude`).")
    native = Path(shim).parent / "node_modules" / "@anthropic-ai" / "claude-code" / "bin" / "claude.exe"
    return str(native) if native.exists() else shim


def last_usage() -> dict:
    try:
        return json.loads(USAGE_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def check_budget() -> None:
    u = last_usage()
    util, resets = u.get("utilization"), u.get("resets_at")
    if util is not None and util >= STOP_AT_UTILIZATION and resets and resets > time.time():
        when = time.strftime("%H:%M", time.localtime(resets))
        raise RateLimited(f"Finestra Claude Pro al {util:.0%}: riprova dopo le {when}.")


def image_block(path: Path, media_type: str = "image/png") -> dict:
    return {"type": "image", "source": {"type": "base64", "media_type": media_type,
                                         "data": base64.b64encode(path.read_bytes()).decode()}}


def run(system: str, content: list[dict], schema: dict, model: str = "sonnet") -> ClaudeResult:
    if model not in ALLOWED_MODELS:
        raise ClaudeError(f"Modello non consentito con Claude Pro: {model}")
    check_budget()
    CWD.mkdir(parents=True, exist_ok=True)
    cmd = [_claude_exe(), "-p", "--model", model,
           "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
           "--tools", "", "--strict-mcp-config", "--setting-sources", "", "--disable-slash-commands",
           "--no-session-persistence", "--system-prompt", system,
           "--json-schema", json.dumps(schema, ensure_ascii=False)]
    msg = json.dumps({"type": "user", "message": {"role": "user", "content": content}}, ensure_ascii=False)
    t0 = time.time()
    try:
        proc = subprocess.run(cmd, input=msg + "\n", capture_output=True, text=True, encoding="utf-8",
                              errors="replace", cwd=CWD, timeout=TIMEOUT_S)
    except subprocess.TimeoutExpired:
        raise ClaudeError("Claude non ha risposto entro il tempo massimo.")
    result, rate = None, None
    for line in proc.stdout.splitlines():
        try:
            ev = json.loads(line)
        except json.JSONDecodeError:
            continue
        if ev.get("type") == "rate_limit_event":
            rate = ev.get("rate_limit_info") or {}
        elif ev.get("type") == "result":
            result = ev
    util = None
    if rate:
        five = (rate.get("unifiedWindows") or {}).get("five_hour") or {}
        util = five.get("utilization")
        USAGE_FILE.write_text(json.dumps({"utilization": util, "resets_at": five.get("resetsAt") or rate.get("resetsAt"),
                                          "status": rate.get("status"), "checked_at": time.time()}), encoding="utf-8")
        if rate.get("status") not in (None, "allowed", "allowed_warning"):
            raise RateLimited("Limite della finestra Claude Pro raggiunto.")
    if not result:
        raise ClaudeError(f"Nessun risultato da Claude: {proc.stderr[-800:] or proc.stdout[-800:]}")
    if result.get("is_error") or result.get("subtype") != "success":
        text = str(result.get("result") or result.get("api_error_status") or result.get("subtype"))
        if "limit" in text.lower():
            raise RateLimited(text[:300])
        raise ClaudeError(text[:500])
    data = result.get("structured_output")
    if data is None:
        try:
            data = json.loads(result.get("result") or "")
        except json.JSONDecodeError:
            raise ClaudeError("Claude non ha restituito un JSON valido.")
    model_used = next(iter(result.get("modelUsage") or {}), model)
    usage = result.get("usage") or {}
    return ClaudeResult(data, model_used, usage, float(result.get("total_cost_usd") or 0),
                        round(time.time() - t0, 1), util, int(result.get("num_turns") or 1),
                        len(usage.get("iterations") or []) or 1)
