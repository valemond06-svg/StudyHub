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
import time
from pathlib import Path

from .gpu import gpu_lock

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


def transcribe(audio: Path, out: Path, prompt: str | None = None, on_progress=None) -> dict:
    cmd = [sys.executable, "-m", "studyhub.media.transcribe", str(audio), str(out)]
    if prompt:
        cmd += ["--prompt", prompt]
    def attempt(dev: str) -> tuple[int, str]:
        env = {**os.environ, "STUDYHUB_WHISPER_DEVICE": dev}
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                                encoding="utf-8", errors="replace", env=env, stdin=subprocess.DEVNULL)
        for line in proc.stdout:
            if line.startswith("PROGRESS") and on_progress:
                on_progress(float(line.split()[1]))
        err = proc.stderr.read()
        return proc.wait(), err

    with gpu_lock(f"whisper {audio.name}"):
        dev = device()
        code, err = attempt(dev)
        if code != 0 and dev == "cuda":
            # Crash nativo di CUDA (es. 0xC0000409 con la VRAM contesa): la lezione si trascrive lo stesso, su CPU.
            print(f"    Whisper su GPU terminato con codice {code & 0xFFFFFFFF:#x}: riprovo su CPU…", flush=True)
            code, err = attempt("cpu")
        if code != 0:
            raise RuntimeError(f"Whisper fallito (codice {code & 0xFFFFFFFF:#x}): {err[-1500:].strip() or 'nessun messaggio'}")
    return json.loads(out.read_text(encoding="utf-8"))


if __name__ == "__main__":
    args = sys.argv[1:]
    prompt = None
    if "--prompt" in args:
        i = args.index("--prompt")
        prompt = args[i + 1]
        del args[i:i + 2]
    _worker(args[0], args[1], prompt)
