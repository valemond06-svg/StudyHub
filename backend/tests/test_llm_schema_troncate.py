"""Schema JSON vincolato a llama-server e risposte troncate (rete simulata, nessuna connessione vera)."""
import json
from types import SimpleNamespace

import pytest

from studyhub.ai import llm
from studyhub.ai.claude_runner import ClaudeError

SCHEMA = {"type": "object", "properties": {"x": {"type": "integer"}}, "required": ["x"]}
BASE = "http://127.0.0.1:8080"


def _ok(finish="stop", content='{"x": 1}'):
    return {"model": "m", "choices": [{"message": {"content": content}, "finish_reason": finish}]}


@pytest.fixture(autouse=True)
def pulito():
    llm._schema_rifiutati.clear()
    yield
    llm._schema_rifiutati.clear()


def _finta_post(monkeypatch, risposte):
    """risposte: lista di dict (risposta) o eccezioni; registra i payload ricevuti."""
    visti = []

    def finta(base, payload, has_images=False):
        visti.append(json.loads(json.dumps(payload)))
        r = risposte[len(visti) - 1]
        if isinstance(r, Exception):
            raise r
        return r
    monkeypatch.setattr(llm, "_post_chat", finta)
    return visti


def _payload():
    return {"model": "m", "messages": [], "temperature": 0.2, "max_tokens": 5120}


def test_payload_con_json_schema(monkeypatch):
    visti = _finta_post(monkeypatch, [_ok()])
    llm._post_json(BASE, _payload(), SCHEMA)
    assert visti[0]["response_format"] == {"type": "json_schema",
                                           "json_schema": {"name": "risposta", "schema": SCHEMA, "strict": True}}


def test_local_invia_lo_schema(monkeypatch):
    visti = _finta_post(monkeypatch, [_ok()])
    monkeypatch.setattr(llm, "get_local_llm_url", lambda exclude=(): BASE)
    r = llm._local("sys", "testo", SCHEMA, "veloce")
    assert r.data == {"x": 1}
    assert visti[0]["response_format"]["type"] == "json_schema"
    assert visti[0]["response_format"]["json_schema"]["schema"] == SCHEMA


def test_400_ripiega_su_json_object_e_lo_ricorda(monkeypatch):
    visti = _finta_post(monkeypatch, [llm._BadRequest("HTTP 400"), _ok(), _ok()])
    llm._post_json(BASE, _payload(), SCHEMA)
    assert [v["response_format"]["type"] for v in visti] == ["json_schema", "json_object"]
    llm._post_json(BASE, _payload(), SCHEMA)  # stesso schema: non riprova la grammatica
    assert visti[2]["response_format"] == {"type": "json_object"}
    altro = {"type": "object", "properties": {"y": {"type": "string"}}}
    visti2 = _finta_post(monkeypatch, [_ok()])
    llm._post_json(BASE, _payload(), altro)
    assert visti2[0]["response_format"]["type"] == "json_schema"


def test_400_anche_con_json_object_propaga(monkeypatch):
    _finta_post(monkeypatch, [llm._BadRequest("HTTP 400"), llm._BadRequest("HTTP 400")])
    with pytest.raises(ClaudeError):
        llm._post_json(BASE, _payload(), SCHEMA)


def test_troncata_riprova_con_tetto_doppio(monkeypatch):
    visti = _finta_post(monkeypatch, [_ok("length", '{"x": '), _ok()])
    res = llm._post_json(BASE, _payload(), SCHEMA)
    assert [v["max_tokens"] for v in visti] == [5120, 10240]
    assert res["choices"][0]["finish_reason"] == "stop"


def test_tetto_massimo_16384(monkeypatch):
    visti = _finta_post(monkeypatch, [_ok("length"), _ok()])
    p = _payload()
    p["max_tokens"] = 12000
    llm._post_json(BASE, p, SCHEMA)
    assert visti[1]["max_tokens"] == 16384


def test_seconda_troncatura_solleva_e_non_ripara(monkeypatch):
    visti = _finta_post(monkeypatch, [_ok("length", '{"x": 1'), _ok("length", '{"x": 1')])
    monkeypatch.setattr(llm, "get_local_llm_url", lambda exclude=(): BASE)
    with pytest.raises(ClaudeError, match="troncata"):
        llm._local("sys", "testo", SCHEMA, "veloce")
    assert len(visti) == 2


def test_run_json_passa_al_provider_successivo_se_troncata(monkeypatch):
    _finta_post(monkeypatch, [_ok("length"), _ok("length")])
    monkeypatch.setattr(llm, "get_local_llm_url", lambda exclude=(): BASE)
    monkeypatch.setattr(llm, "provider_order", lambda: ["local", "claude"])
    monkeypatch.setattr(llm, "claude_run", lambda *a, **k: SimpleNamespace(data={"x": 2}, model="c", duration_s=0))
    r = llm.run_json("sys", "t", SCHEMA)
    assert r.provider == "claude" and r.data == {"x": 2}
