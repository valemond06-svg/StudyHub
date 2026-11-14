"""P0.6: un solo thread alla volta verso il llama-server (1 slot), timeout locale configurabile."""
import io
import json
import threading
import time

import pytest

from studyhub.ai import llm
from studyhub.ai.claude_runner import ClaudeError
from studyhub.config import settings


@pytest.fixture
def pulito(ambiente, monkeypatch, tmp_path):
    monkeypatch.setattr(llm, "LOCAL_DIR", tmp_path)
    monkeypatch.delenv("STUDYHUB_LOCAL_LLM_TIMEOUT", raising=False)
    monkeypatch.setattr(llm, "LOCAL_TIMEOUT_S", 600)


class _Resp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def test_due_thread_non_si_sovrappongono(pulito, monkeypatch):
    attivi, massimo = [0], [0]
    g = threading.Lock()

    def finto(req, timeout=None):
        with g:
            attivi[0] += 1
            massimo[0] = max(massimo[0], attivi[0])
        time.sleep(0.15)
        with g:
            attivi[0] -= 1
        return _Resp(json.dumps({"choices": []}).encode())

    monkeypatch.setattr(llm.urllib.request, "urlopen", finto)
    ts = [threading.Thread(target=llm._post_chat, args=("http://x:8080", {})) for _ in range(3)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert massimo[0] == 1


def test_lock_timeout_diventa_claude_error(pulito, monkeypatch):
    visti = {}

    def lock(path, owner, timeout=None, poll_s=2.0):
        visti["timeout"] = timeout
        raise llm.LockTimeout("lock occupato")

    monkeypatch.setattr(llm, "file_lock", lock)
    monkeypatch.setattr(llm, "LOCAL_TIMEOUT_S", 50)
    with pytest.raises(ClaudeError, match="server locale occupato"):
        llm._post_chat("http://x:8080", {})
    assert visti["timeout"] == 150


def test_un_file_per_server(pulito):
    a, b = llm._server_lock_path("http://a:1"), llm._server_lock_path("http://b:1")
    assert a != b and a == llm._server_lock_path("http://a:1/")


def test_precedenza_timeout(pulito, monkeypatch):
    assert llm.local_timeout_s() == 1200                       # default
    monkeypatch.setitem(settings.extra, "local_llm_timeout_s", 900)
    assert llm.local_timeout_s() == 900                        # settings
    monkeypatch.setattr(llm, "LOCAL_TIMEOUT_S", 1500)
    assert llm.local_timeout_s() == 1500                       # costante riassegnata
    monkeypatch.setenv("STUDYHUB_LOCAL_LLM_TIMEOUT", "77")
    assert llm.local_timeout_s() == 77                         # env vince
    monkeypatch.setenv("STUDYHUB_LOCAL_LLM_TIMEOUT", "boh")
    assert llm.local_timeout_s() == 1500                       # env non valida: si ignora


def test_timeout_usato_nella_post(pulito, monkeypatch):
    visti = []
    monkeypatch.setitem(settings.extra, "local_llm_timeout_s", 321)
    monkeypatch.setattr(llm.urllib.request, "urlopen",
                        lambda req, timeout=None: visti.append(timeout) or _Resp(b"{}"))
    llm._post_chat("http://x:8080", {})
    assert visti == [321.0]


def test_workers_uno_con_provider_locale(pulito, monkeypatch):
    monkeypatch.setitem(settings.extra, "ai_provider", "local")
    assert llm.effective_workers() == 1
    monkeypatch.setitem(settings.extra, "ai_provider", "claude")
    assert llm.effective_workers() == 2
    monkeypatch.setitem(settings.extra, "ai_provider", "auto")
    monkeypatch.setattr(llm, "_check_local", lambda: True)
    monkeypatch.setattr(llm, "_agy_exe", lambda: None)
    assert llm.effective_workers() == 1
    monkeypatch.setattr(llm, "_check_local", lambda: False)
    assert llm.effective_workers() == 2
