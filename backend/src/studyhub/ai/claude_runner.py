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
import os
import shutil
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path

from ..config import LOCAL_DIR
from ..filelock import LockTimeout, file_lock

ALLOWED_MODELS = {"sonnet", "haiku"}
USAGE_FILE = LOCAL_DIR / "claude_usage.json"
CWD = LOCAL_DIR / "claude-cwd"          # cartella vuota: nessun CLAUDE.md di progetto
STOP_AT_UTILIZATION = 0.90             # non avviare nuove elaborazioni oltre il 90% della finestra
TIMEOUT_S = 20 * 60
LOCK_FILE = LOCAL_DIR / "claude.lock"  # una sola chiamata a Claude alla volta su tutta la macchina (server, fullrun, CLI)
LOCK_WAIT_S = TIMEOUT_S + 5 * 60       # chi aspetta più di una chiamata intera rinuncia (e riprova dopo)


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
        # installer nativo: ~/.local/bin non è sempre nel PATH dei processi (servizio systemd, attività pianificate)
        for name in ("claude.exe", "claude"):
            local = Path.home() / ".local" / "bin" / name
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


def _save_usage(data: dict) -> None:
    """Scrittura atomica: un altro processo non legge mai un JSON a metà."""
    USAGE_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = USAGE_FILE.with_name(f"{USAGE_FILE.name}.{os.getpid()}.tmp")
    tmp.write_text(json.dumps(data), encoding="utf-8")
    os.replace(tmp, USAGE_FILE)


def paused_until() -> float | None:
    """Fino a quando la finestra Pro è piena (epoch), o None se si può lavorare."""
    u = last_usage()
    util, resets = u.get("utilization"), u.get("resets_at")
    if util is not None and util >= STOP_AT_UTILIZATION and resets and resets > time.time():
        return float(resets)
    return None


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
    try:
        with file_lock(LOCK_FILE, f"claude {model} pid {os.getpid()}", timeout=LOCK_WAIT_S):
            # il budget si controlla dentro il lock: chi aspettava vede l'utilizzo aggiornato da chi ha finito
            check_budget()
            return _run_locked(system, content, schema, model)
    except LockTimeout as e:
        raise RateLimited(f"Claude occupato da un'altra elaborazione ({e}): riprovo più tardi.")


def _run_locked(system: str, content: list[dict], schema: dict, model: str) -> ClaudeResult:
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
        resets = five.get("resetsAt") or rate.get("resetsAt")
        blocked = rate.get("status") not in (None, "allowed", "allowed_warning")
        if blocked:  # finestra chiusa: anche gli altri processi devono fermarsi fino al reset
            util = max(util or 0.0, 1.0)
            resets = resets or time.time() + 30 * 60
        _save_usage({"utilization": util, "resets_at": resets, "status": rate.get("status"), "checked_at": time.time()})
        if blocked:
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
