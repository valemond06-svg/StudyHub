"""Download dei flussi: timeout di rete e tetto di tempo, così un HLS bloccato non ferma il giro."""
import subprocess

import pytest

from studyhub.media import ff


def _fake_run(calls, exc=None):
    def fake(cmd, **kw):
        calls.append((cmd, kw))
        if exc:
            raise exc
        out = cmd[cmd.index("mp4") + 1]
        open(out, "wb").write(b"x")
        return subprocess.CompletedProcess(cmd, 0, "", "")
    return fake


def test_download_http_ha_rw_timeout_e_tetto(tmp_path, monkeypatch):
    calls = []
    monkeypatch.setattr(ff, "ffmpeg", lambda: "ffmpeg")
    monkeypatch.setattr(ff.subprocess, "run", _fake_run(calls))
    dest = ff.download("https://cdn.example/x.m3u8", tmp_path / "camera.mp4")
    cmd, kw = calls[0]
    assert dest.exists()
    assert cmd[cmd.index("-rw_timeout") + 1] == str(ff.DOWNLOAD_STALL_US)
    assert cmd.index("-rw_timeout") < cmd.index("-i")
    assert kw["timeout"] == ff.DOWNLOAD_MAX_S


def test_download_file_locale_senza_rw_timeout(tmp_path, monkeypatch):
    calls = []
    monkeypatch.setattr(ff, "ffmpeg", lambda: "ffmpeg")
    monkeypatch.setattr(ff.subprocess, "run", _fake_run(calls))
    ff.download(str(tmp_path / "src.mp4"), tmp_path / "out.mp4")
    assert "-rw_timeout" not in calls[0][0]


def test_download_scaduto_alza_errore_e_pulisce(tmp_path, monkeypatch):
    monkeypatch.setattr(ff, "ffmpeg", lambda: "ffmpeg")
    part = tmp_path / "camera.part.mp4"
    part.write_bytes(b"mezzo")
    monkeypatch.setattr(ff.subprocess, "run", _fake_run([], subprocess.TimeoutExpired("ffmpeg", 1)))
    with pytest.raises(RuntimeError, match="fermato"):
        ff.download("https://cdn.example/x.m3u8", tmp_path / "camera.mp4")
    assert not part.exists()
    assert not (tmp_path / "camera.mp4").exists()
