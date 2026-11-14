"""Eventi di StudyHub verso il Second Brain (Ada): POST JSON con token, coda locale se il Brain non risponde.

Solo libreria standard. `send` non solleva mai eccezioni e non scrive mai il token in log o messaggi.
Privacy: nei `data` vanno solo conteggi, nomi dei corsi, stati e messaggi d'errore troncati; mai testo delle
lezioni o degli avvisi, cookie, percorsi con dati personali.

Config: variabili d'ambiente BRAIN_EVENT_URL, BRAIN_EVENT_TOKEN, BRAIN_EVENT_FALLBACK_URL; se mancano, il file
`brain_event_env` del config (righe KEY=VALUE). `brain_events: false` nel config spegne tutto.
"""
from __future__ import annotations

import json
import logging
import os
import threading
import urllib.error
import urllib.request
from pathlib import Path

from . import config

log = logging.getLogger(__name__)

TIMEOUT_S = 10
MAX_PENDING = 200
DRAIN_BATCH = 20
LEVELS = ("info", "warn", "error")
_KEYS = ("BRAIN_EVENT_URL", "BRAIN_EVENT_TOKEN", "BRAIN_EVENT_FALLBACK_URL")
_lock = threading.Lock()


def _pending_path() -> Path:
    return config.LOCAL_DIR / "brain_events_pending.jsonl"


def _read_env_file(path: str) -> dict[str, str]:
    out: dict[str, str] = {}
    try:
        text = Path(path).expanduser().read_text(encoding="utf-8")
    except OSError:
        return out
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        k = k.strip()
        if k.startswith("export "):
            k = k[7:].strip()
        v = v.strip()
        if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
            v = v[1:-1]
        out[k] = v
    return out


def _load_config() -> dict[str, str] | None:
    """None se spento o non configurato; altrimenti url, token, fallback (stringa vuota se assente)."""
    extra = config.settings.extra
    if extra.get("brain_events") is False:
        return None
    vals = {k: os.environ.get(k, "").strip() for k in _KEYS}
    envfile = extra.get("brain_event_env")
    if envfile and not all(vals.values()):
        f = _read_env_file(str(envfile))
        for k in _KEYS:
            if not vals[k]:
                vals[k] = f.get(k, "").strip()
    if not vals["BRAIN_EVENT_URL"] or not vals["BRAIN_EVENT_TOKEN"]:
        return None
    return {"url": vals["BRAIN_EVENT_URL"], "token": vals["BRAIN_EVENT_TOKEN"],
            "fallback": vals["BRAIN_EVENT_FALLBACK_URL"]}


def _post(url: str, token: str, payload: dict) -> str:
    """'ok' | 'rifiutato' (4xx: inutile ritentare) | 'riprova' (rete o 5xx)."""
    try:
        req = urllib.request.Request(
            url, data=json.dumps(payload, ensure_ascii=False).encode("utf-8"), method="POST",
            headers={"Content-Type": "application/json", "X-Brain-Token": token})
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:
            return "ok" if 200 <= r.status < 300 else ("rifiutato" if 400 <= r.status < 500 else "riprova")
    except urllib.error.HTTPError as e:
        return "rifiutato" if 400 <= e.code < 500 else "riprova"
    except Exception:
        return "riprova"


def _deliver(cfg: dict[str, str], payload: dict) -> str:
    res = _post(cfg["url"], cfg["token"], payload)
    if res == "riprova" and cfg["fallback"]:
        res = _post(cfg["fallback"], cfg["token"], payload)
    return res


def _read_queue() -> list[str]:
    try:
        return [x for x in _pending_path().read_text(encoding="utf-8").splitlines() if x.strip()]
    except OSError:
        return []


def _write_queue(lines: list[str]) -> None:
    p = _pending_path()
    try:
        if not lines:
            p.unlink(missing_ok=True)
            return
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("\n".join(lines[-MAX_PENDING:]) + "\n", encoding="utf-8")
    except OSError:
        log.warning("coda eventi Brain non scrivibile")


def _enqueue(payload: dict) -> None:
    _write_queue(_read_queue() + [json.dumps(payload, ensure_ascii=False)])


def _drain(cfg: dict[str, str]) -> None:
    lines = _read_queue()
    if not lines:
        return
    sent = 0
    for line in lines[:DRAIN_BATCH]:
        try:
            payload = json.loads(line)
        except ValueError:
            sent += 1  # riga rovinata: si scarta
            continue
        if _deliver(cfg, payload) == "riprova":
            break  # Brain di nuovo giu: si smette, il resto resta in coda
        sent += 1  # ok oppure rifiutato (4xx): non ha senso tenerlo
    if sent:
        _write_queue(lines[sent:])


def send(type: str, data: dict | None = None, level: str = "info", id: str | None = None) -> bool:
    """Manda un evento al Brain. True solo se consegnato. Non solleva mai."""
    try:
        cfg = _load_config()
        if cfg is None:
            return False
        if level not in LEVELS:
            level = "info"
        payload = {"type": type, "level": level, "data": data or {}}
        if id is not None:  # come il client del Brain: niente campi nulli
            payload["id"] = id
        with _lock:
            _drain(cfg)
            res = _deliver(cfg, payload)
            if res == "riprova":
                _enqueue(payload)
        return res == "ok"
    except Exception:
        log.warning("evento Brain %s non inviato", type)
        return False
