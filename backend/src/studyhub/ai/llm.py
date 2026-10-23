"""Un'unica funzione per le chiamate AI "da studio", con due abbonamenti:

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
import shutil
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path

from ..config import LOCAL_DIR, settings
from .claude_runner import ClaudeError, RateLimited, run as claude_run

AGY_CWD = LOCAL_DIR / "agy-cwd"
AGY_TIMEOUT_S = 8 * 60
GEMINI_MODELS = {"veloce": "gemini-3.8-flash-low", "accurato": "gemini-3.8-flash-high"}
CLAUDE_MODELS = {"veloce": "haiku", "accurato": "sonnet"}


@dataclass
class LLMResult:
    data: dict
    provider: str      # gemini | claude
    model: str
    duration_s: float


def _agy_exe() -> str | None:
    exe = shutil.which("agy")
    if exe:
        return exe
    p = Path.home() / "AppData" / "Local" / "agy" / "bin" / "agy.exe"
    return str(p) if p.exists() else None


def provider_order() -> list[str]:
    """config.yaml → ai_provider: auto | gemini | claude. auto = Gemini se c'è, poi Claude."""
    pref = (settings.extra.get("ai_provider") or "auto").lower()
    if pref == "claude":
        return ["claude"]
    if pref == "gemini":
        return ["gemini"]
    return ["gemini", "claude"] if _agy_exe() else ["claude"]


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
            if prov == "gemini":
                return _gemini(system, text, schema, quality)
            res = claude_run(system, [{"type": "text", "text": text}], schema, model=CLAUDE_MODELS[quality])
            return LLMResult(res.data, "claude", res.model, res.duration_s)
        except (ClaudeError, RateLimited, OSError) as e:
            errors.append(f"{prov}: {e}")
    raise ClaudeError(" · ".join(errors))
