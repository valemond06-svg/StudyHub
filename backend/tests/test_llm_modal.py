"""Provider «modal» (server vLLM nostro su GPU Modal, 27/11/2026): ordine, privacy da GPU privata, parallelismo, troncate."""
import io
import json

import pytest

from studyhub.ai import llm
from studyhub.ai.claude_runner import ClaudeError
from studyhub.ai.prompt import Prompt
from studyhub.config import settings

SCHEMA = {"type": "object", "properties": {"x": {"type": "integer"}}, "required": ["x"]}


class _Resp(io.BytesIO):
    status = 200

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def _risposta(content='{"x": 1}', finish="stop"):
    return _Resp(json.dumps({"model": "gptoss-120b", "usage": {"completion_tokens": 5},
                             "choices": [{"finish_reason": finish, "message": {"content": content}}]}).encode())


@pytest.fixture
def modal_on(ambiente, monkeypatch):
    monkeypatch.setenv("STUDYHUB_MODAL_URL", "https://esempio.modal.run/")
    monkeypatch.setenv("STUDYHUB_MODAL_KEY", "chiave-finta")
    monkeypatch.setattr(llm, "_check_local", lambda: True)
    monkeypatch.setattr(llm, "_agy_exe", lambda: None)
    inviati = []

    def finto_open(req, timeout=None):
        inviati.append({"url": req.full_url, "body": json.loads(req.data), "auth": req.get_header("Authorization")})
        return _risposta()

    monkeypatch.setattr(llm._modal_opener, "open", finto_open)
    return inviati


def test_non_configurato_senza_url_o_chiave(ambiente, monkeypatch):
    monkeypatch.delenv("STUDYHUB_MODAL_URL", raising=False)
    monkeypatch.delenv("STUDYHUB_MODAL_KEY", raising=False)
    monkeypatch.setattr(llm, "LOCAL_DIR", ambiente)
    assert not llm.modal_configured()
    settings.extra["ai_provider"] = "modal"
    assert llm.provider_order() == ["local"]   # forzato ma senza server: si resta a casa


def test_auto_non_spende_crediti_senza_permesso(modal_on):
    assert "modal" not in llm.provider_order()
    settings.extra["modal_in_auto"] = True
    assert llm.provider_order()[:2] == ["local", "modal"]


def test_forzato_e_parallelo(modal_on):
    settings.extra["ai_provider"] = "modal"
    assert llm.provider_order() == ["modal"]
    assert llm.effective_workers() == llm.MODAL_WORKERS_DEFAULT
    settings.extra["modal_workers"] = 20
    assert llm.effective_workers() == 20


def test_ocr_va_a_modal_ma_non_a_gemini(modal_on):
    settings.extra["ai_provider"] = "modal"
    res = llm.run_json("sys", Prompt("materiale del corso letto con OCR", True), SCHEMA)
    assert res.provider == "modal" and res.data == {"x": 1}
    corpo = modal_on[0]["body"]
    assert modal_on[0]["url"] == "https://esempio.modal.run/v1/chat/completions"
    assert modal_on[0]["auth"] == "Bearer chiave-finta"
    assert corpo["response_format"]["json_schema"]["strict"] is True
    assert corpo["reasoning_effort"] == "medium"


def test_trascrizioni_e_privati_restano_a_casa(modal_on, monkeypatch):
    settings.extra["ai_provider"] = "modal"
    locali = []
    monkeypatch.setattr(llm, "_local", lambda *a, **k: locali.append(1) or llm.LLMResult({"x": 2}, "local", "q", 0.1))
    assert llm.run_json("sys", "testo", SCHEMA, kind="transcript").provider == "local"
    assert llm.run_json("sys", "testo", SCHEMA, private=True).provider == "local"
    assert llm.run_json("sys", "IBAN IT60X0542811101000000123456", SCHEMA).provider == "local"
    assert modal_on == [] and len(locali) == 3


def test_troncata_si_riprova_col_tetto(modal_on, monkeypatch):
    risposte = [_risposta('{"x":', "length"), _risposta('{"x": 3}')]
    visti = []

    def finto(req, timeout=None):
        visti.append(json.loads(req.data)["max_tokens"])
        return risposte.pop(0)

    monkeypatch.setattr(llm._modal_opener, "open", finto)
    settings.extra["ai_provider"] = "modal"
    assert llm.run_json("sys", "x", SCHEMA).data == {"x": 3}
    assert visti == [10240, llm.MAX_TOKENS_CAP]


def test_troncata_due_volte_e_errore(modal_on, monkeypatch):
    monkeypatch.setattr(llm._modal_opener, "open", lambda req, timeout=None: _risposta('{"x":', "length"))
    with pytest.raises(ClaudeError, match="troncata"):
        llm._modal("sys", "x", SCHEMA, "accurato")


def test_qwen_senza_ragionamento(modal_on, monkeypatch):
    monkeypatch.setenv("STUDYHUB_MODAL_MODEL", "qwen38-27b")
    llm._modal("sys", "x", SCHEMA, "veloce")
    corpo = modal_on[0]["body"]
    assert corpo["model"] == "qwen38-27b"
    assert corpo["chat_template_kwargs"] == {"enable_thinking": False}
    assert "reasoning_effort" not in corpo


def test_redirect_303_seguiti_a_lungo():
    assert llm._Redirect303.max_redirections >= 20
