"""Trascrizione con faster-whisper su GPU NVIDIA (su CPU se non c'è: molto più lenta).

Gira in un sottoprocesso dedicato: quando termina, la VRAM è liberata con certezza
(più affidabile di torch.cuda.empty_cache). Il processo padre tiene il lock GPU.

    python -m studyhub.media.transcribe <audio> <out.json> [--prompt "glossario"]
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import threading
import time
from collections import deque
from pathlib import Path

from .gpu import LockTimeout, gpu_lock

MODEL = "large-v3-turbo"
COMPUTE_TYPE = {"cuda": "int8_float16", "cpu": "int8"}  # su GPU entra in 4 GB di VRAM


def device() -> str:
    """config.yaml → whisper_device: auto | cuda | cpu. auto = GPU NVIDIA se il driver c'è."""
    from ..config import settings
    pref = (os.environ.get("STUDYHUB_WHISPER_DEVICE") or settings.whisper_device or "auto").lower()
    if pref in ("cuda", "cpu"):
        return pref
    return "cuda" if shutil.which("nvidia-smi") else "cpu"


def _add_cuda_dlls() -> None:
    """Le DLL di cuBLAS/cuDNN arrivano dai pacchetti pip nvidia-*: vanno rese visibili su Windows."""
    import site
    for base in site.getsitepackages():
        for sub in ("nvidia/cublas/bin", "nvidia/cudnn/bin"):
            d = Path(base) / sub
            if d.is_dir():
                os.add_dll_directory(str(d))
                os.environ["PATH"] = str(d) + os.pathsep + os.environ["PATH"]


def _worker(audio: str, out: str, prompt: str | None) -> None:
    _add_cuda_dlls()
    from faster_whisper import WhisperModel

    import numpy as np

    from . import ff

    t0 = time.time()
    # Decodifica con ffmpeg (16 kHz mono float32): evita il decoder PyAV di faster-whisper,
    # incompatibile con alcune versioni di `av`.
    raw = subprocess.run([ff.ffmpeg(), "-nostdin", "-i", audio, "-f", "f32le", "-ac", "1", "-ar", "16000", "-"],
                         capture_output=True, check=True).stdout
    samples = np.frombuffer(raw, np.float32)
    dev = device()
    try:
        model = WhisperModel(MODEL, device=dev, compute_type=COMPUTE_TYPE[dev])
    except Exception:
        if dev == "cpu":
            raise
        dev = "cpu"  # GPU senza CUDA utilizzabile (driver vecchio, VRAM piena): meglio lenta che ferma
        model = WhisperModel(MODEL, device=dev, compute_type=COMPUTE_TYPE[dev])
    # A lotti: la GPU elabora più pezzi di audio insieme invece di uno alla volta (2-4 volte più veloce su 4 GB).
    # STUDYHUB_WHISPER_BATCH=0 torna al modo sequenziale.
    batch = int(os.environ.get("STUDYHUB_WHISPER_BATCH", "8")) if dev == "cuda" else 0
    if batch:
        from faster_whisper import BatchedInferencePipeline
        segments, info = BatchedInferencePipeline(model=model).transcribe(
            samples, language="it", beam_size=5, batch_size=batch, vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 700}, initial_prompt=prompt,
        )
    else:
        segments, info = model.transcribe(
            samples, language="it", beam_size=5, vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 700},
            initial_prompt=prompt, condition_on_previous_text=False,
        )
    result = []
    for seg in segments:
        result.append({"start": round(seg.start, 2), "end": round(seg.end, 2), "text": seg.text.strip()})
        print(f"PROGRESS {seg.end / info.duration:.3f}", flush=True)
    payload = {"source": "whisper", "model": MODEL, "device": dev, "language": info.language,
               "duration": info.duration, "elapsed_s": round(time.time() - t0, 1), "segments": result}
    tmp = Path(out).with_suffix(".part")
    tmp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    tmp.replace(out)


GPU_LOCK_TIMEOUT_S = 2 * 3600
IDLE_TIMEOUT_S = 20 * 60          # nessuna riga PROGRESS per tanto: Whisper è bloccato
DEFAULT_TIMEOUT_S = 4 * 3600      # durata audio ignota


def total_timeout(duration_s: float | None) -> float:
    return max(1800.0, 3 * duration_s) if duration_s and duration_s > 0 else float(DEFAULT_TIMEOUT_S)


def transcribe(audio: Path, out: Path, prompt: str | None = None, on_progress=None,
               duration_s: float | None = None, timeout_s: float | None = None,
               idle_timeout_s: float | None = None) -> dict:
    cmd = [sys.executable, "-m", "studyhub.media.transcribe", str(audio), str(out)]
    if prompt:
        cmd += ["--prompt", prompt]
    limit = float(timeout_s) if timeout_s else total_timeout(duration_s)
    idle = float(idle_timeout_s) if idle_timeout_s else IDLE_TIMEOUT_S

    def attempt(dev: str) -> tuple[int, str]:
        env = {**os.environ, "STUDYHUB_WHISPER_DEVICE": dev}
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                                encoding="utf-8", errors="replace", env=env, stdin=subprocess.DEVNULL)
        tail: deque[str] = deque(maxlen=200)

        def drain_err() -> None:  # stderr svuotata di continuo: una pipe piena bloccherebbe il figlio
            try:
                for line in proc.stderr:
                    tail.append(line)
            except (OSError, ValueError):
                pass

        et = threading.Thread(target=drain_err, daemon=True)
        et.start()
        t0 = time.monotonic()
        last = [t0]
        reason: list[str] = []

        def watchdog() -> None:
            while proc.poll() is None:
                now = time.monotonic()
                if now - t0 > limit:
                    reason.append(f"timeout totale di {limit / 60:.0f} minuti")
                elif now - last[0] > idle:
                    reason.append(f"nessun avanzamento da {idle / 60:.0f} minuti")
                if reason:
                    proc.kill()
                    return
                time.sleep(min(1.0, max(0.02, limit / 20, idle / 20)))

        wd = threading.Thread(target=watchdog, daemon=True)
        wd.start()
        try:
            for line in proc.stdout:
                if line.startswith("PROGRESS"):
                    last[0] = time.monotonic()
                    if on_progress:
                        try:
                            on_progress(float(line.split()[1]))
                        except (ValueError, IndexError):
                            pass
            code = proc.wait()
        finally:
            if proc.poll() is None:
                proc.kill()
                proc.wait()
            wd.join(timeout=5)
            et.join(timeout=5)
        if reason:
            raise RuntimeError(f"Whisper interrotto: {reason[0]} (processo terminato, nessun ripiego su CPU)")
        return code, "".join(tail)

    try:
        with gpu_lock(f"whisper {audio.name}", timeout=GPU_LOCK_TIMEOUT_S):
            dev = device()
            code, err = attempt(dev)
            if code != 0 and dev == "cuda":
                # Crash nativo di CUDA (es. 0xC0000409 con la VRAM contesa): la lezione si trascrive lo stesso, su CPU.
                print(f"    Whisper su GPU terminato con codice {code & 0xFFFFFFFF:#x}: riprovo su CPU…", flush=True)
                code, err = attempt("cpu")
            if code != 0:
                raise RuntimeError(f"Whisper fallito (codice {code & 0xFFFFFFFF:#x}): {err[-1500:].strip() or 'nessun messaggio'}")
    except LockTimeout as e:
        raise RuntimeError(f"GPU occupata da {str(e).split('occupato da ', 1)[-1]}: attesa oltre {GPU_LOCK_TIMEOUT_S // 60} minuti")
    return json.loads(out.read_text(encoding="utf-8"))


if __name__ == "__main__":
    args = sys.argv[1:]
    prompt = None
    if "--prompt" in args:
        i = args.index("--prompt")
        prompt = args[i + 1]
        del args[i:i + 2]
    _worker(args[0], args[1], prompt)
