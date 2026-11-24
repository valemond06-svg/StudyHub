"""Chiave fuori dal codice e foto verso i modelli con vista (rete simulata)."""
import base64
import io
import json
import sys
import urllib.error
from types import SimpleNamespace

import pytest
from PIL import Image

from studyhub.ai import llm
from studyhub.ai.claude_runner import ClaudeError
from test_llm_locale import CAVO, LAPTOP, RISPOSTA_OK, TAILSCALE, _Risposta
from test_llm_locale import rete as rete_fixture

rete = rete_fixture


def _immagine(size=(16, 16), exif=None):
    stream = io.BytesIO()
    with Image.new("RGB", size, "blue") as image:
        image.save(stream, "PNG", exif=exif)
    return {"type": "image", "media_type": "image/png", "data": base64.b64encode(stream.getvalue()).decode("ascii")}


IMG = _immagine()
CONTENUTO = [{"type": "text", "text": "Domanda 1"}, IMG, {"type": "text", "text": "Fine"}]
SCHEMA = {"type": "object"}


def _niente_claude(monkeypatch, msg="niente claude"):
    monkeypatch.setattr(llm, "_agy_exe", lambda: None)

    def boom(*a, **k):
        raise ClaudeError(msg)
    monkeypatch.setattr(llm, "claude_run", boom)


# --- chiave -------------------------------------------------------------------------------

def test_nessuna_chiave_nel_sorgente():
    import inspect
    src = inspect.getsource(llm)
    assert "DEFAULT_API_KEY" not in src and "qIlpO0" not in src


def test_chiave_vuota_se_non_configurata(ambiente):
    assert llm.get_local_llm_key() == ""


def test_ordine_di_lettura_della_chiave(ambiente, monkeypatch):
    from studyhub.config import settings

    # Use monkeypatch to redirect APPDATA to test temp directory
    test_config_dir = ambiente / "brain-llm"
    test_config_dir.mkdir()
    monkeypatch.setenv("APPDATA", str(ambiente))

    f = test_config_dir / "api-key"
    f.write_text("  dal-file \n", encoding="utf-8")
    # Need to clear env to test file
    for var in ("STUDYHUB_LOCAL_LLM_KEY", "LOCAL_LLM_API_KEY"):
        monkeypatch.delenv(var, raising=False)
    settings.extra.pop("local_llm_key", None)
    assert llm.get_local_llm_key() == "dal-file"

    # Test 2: env var LOCAL_LLM_API_KEY (should override file)
    monkeypatch.setenv("LOCAL_LLM_API_KEY", "env-generica")
    assert llm.get_local_llm_key() == "env-generica"

    # Test 3: config.yaml (deprecated) - env takes priority over config, but file takes priority over config
    monkeypatch.delenv("LOCAL_LLM_API_KEY", raising=False)
    settings.extra["local_llm_key"] = "config"
    # Need to remove the file too since it takes priority over config
    f.unlink()
    assert llm.get_local_llm_key() == "config"

    # Test 4: STUDYHUB_LOCAL_LLM_KEY (highest priority)
    monkeypatch.setenv("STUDYHUB_LOCAL_LLM_KEY", "env-studyhub")
    assert llm.get_local_llm_key() == "env-studyhub"


def test_istanza_senza_chiave_non_manda_authorization(rete):
    rete.su(LAPTOP)
    llm._local("s", "t", SCHEMA, "veloce")
    assert all(c[2] is None for c in rete.chiamate)


def test_server_401_saltato_e_segnalato(rete):
    rete.su(LAPTOP, health=401, models=401).su(CAVO)
    assert llm.get_local_llm_url() == CAVO
    assert llm.local_llm_auth_failures() == [LAPTOP]
    rete.su(LAPTOP)
    llm.invalidate_local_llm()
    assert llm.get_local_llm_url() == LAPTOP and llm.local_llm_auth_failures() == []


def test_doctor_segnala_la_chiave_senza_mostrarla(rete, monkeypatch):
    from studyhub import doctor
    monkeypatch.setenv("STUDYHUB_LOCAL_LLM_KEY", "segretissima")
    rete.su(TAILSCALE, health=401, models=401)
    ok, detail = doctor.check_modello_locale()
    assert not ok and "chiave" in detail and "100.83.194.37" in detail and "segretissima" not in detail


# --- rilevazione della vista ----------------------------------------------------------------

def test_vista_da_props(rete):
    rete.su(CAVO)
    rete.json_get[(CAVO, "/props")] = {"modalities": {"vision": False}}
    assert llm.server_vision(CAVO) is False
    llm._vision.clear()
    rete.json_get[(CAVO, "/props")] = {"modalities": {"vision": True}}
    assert llm.server_vision(CAVO) is True


def test_vista_dal_router_da_mmproj(rete):
    rete.su(LAPTOP)
    rete.json_get[(LAPTOP, "/props")] = {"role": "router"}
    rete.json_get[(LAPTOP, "/v1/models")] = {"data": [
        {"id": "altro", "status": {"args": ["--model", "x"]}},
        {"id": "qwen", "aliases": ["local"], "status": {"args": ["--no-mmproj-offload", "--mmproj", "m.gguf"]}}]}
    assert llm.server_vision(LAPTOP) is True
    llm._vision.clear()
    rete.json_get[(LAPTOP, "/v1/models")] = {"data": [
        {"id": "qwen", "aliases": ["local"], "status": {"args": ["--no-mmproj-offload", "--model", "x"]}}]}
    assert llm.server_vision(LAPTOP) is False   # --no-mmproj-offload non e' una vista


def test_vista_sconosciuta(rete):
    rete.su(LAPTOP)
    assert llm.server_vision(LAPTOP) is None


# --- invio delle foto -----------------------------------------------------------------------

def test_foto_al_server_con_vista_in_formato_openai(rete):
    rete.su(LAPTOP)
    rete.json_get[(LAPTOP, "/props")] = {"modalities": {"vision": True}}
    r = llm.run_json_content("sistema", CONTENUTO, SCHEMA)
    assert r.images_sent == 1 and r.provider == "local"
    parti = rete.chat(LAPTOP)[0][3]["messages"][0]["content"]
    assert [p["type"] for p in parti] == ["text", "text", "image_url", "text"]
    header, _, data = parti[2]["image_url"]["url"].partition(",")
    assert header == "data:image/jpeg;base64" and "sistema" in parti[0]["text"]
    with Image.open(io.BytesIO(base64.b64decode(data))) as image:
        assert image.format == "JPEG" and image.size == (16, 16)


def test_server_senza_vista_saltato_per_quello_con_vista(rete):
    rete.su(LAPTOP).su(CAVO)
    rete.json_get[(LAPTOP, "/props")] = {"modalities": {"vision": False}}
    rete.json_get[(CAVO, "/props")] = {"modalities": {"vision": True}}
    assert llm.run_json_content("s", CONTENUTO, SCHEMA).images_sent == 1
    assert [c[0] for c in rete.chat()] == [CAVO]


def test_vista_ignota_si_prova_poi_si_ripiega_e_si_ricorda(rete, monkeypatch):
    _niente_claude(monkeypatch)
    rete.su(LAPTOP)
    original = llm.urllib.request.urlopen

    def urlopen(req, timeout=None):
        if req.full_url.endswith("/chat/completions"):
            payload = json.loads(req.data)
            rete.chiamate.append((LAPTOP, "/v1/chat/completions", None, payload))
            if isinstance(payload["messages"][0]["content"], list):
                raise urllib.error.HTTPError(req.full_url, 500, "e", {},
                                             io.BytesIO(b'{"error":{"message":"image input is not supported - mmproj"}}'))
            return _Risposta(json.dumps(RISPOSTA_OK).encode())
        return original(req, timeout)
    monkeypatch.setattr(llm.urllib.request, "urlopen", urlopen)
    r = llm.run_json_content("s", CONTENUTO, SCHEMA)
    assert r.images_sent == 0 and r.data == {"x": 1}
    assert llm._vision[LAPTOP][1] is False
    n = len(rete.chat())
    llm.run_json_content("s", CONTENUTO, SCHEMA)
    assert len(rete.chat()) == n + 1   # niente nuovo tentativo con le foto


def test_senza_vista_locale_claude_riceve_le_immagini(rete, monkeypatch):
    rete.su(CAVO)
    rete.json_get[(CAVO, "/props")] = {"modalities": {"vision": False}}
    visto = {}

    def claude(system, content, schema, model="sonnet"):
        visto.update(content=content, model=model)
        return SimpleNamespace(data={"da": "claude"}, model="sonnet", duration_s=1)
    monkeypatch.setattr(llm, "claude_run", claude)
    monkeypatch.setattr(llm, "_agy_exe", lambda: None)
    r = llm.run_json_content("s", CONTENUTO, SCHEMA, quality="veloce")
    assert r.provider == "claude" and r.images_sent == 1 and visto["model"] == "haiku"
    block = visto["content"][1]
    assert block["type"] == "image" and block["source"]["type"] == "base64"
    assert block["source"]["media_type"] == "image/jpeg"
    with Image.open(io.BytesIO(base64.b64decode(block["source"]["data"]))) as image:
        assert image.format == "JPEG" and image.size == (16, 16)


def test_gemini_non_riceve_le_foto(rete, monkeypatch):
    monkeypatch.setattr(llm, "_agy_exe", lambda: "agy")

    def no(*a, **k):
        raise AssertionError("Gemini non legge le foto")
    monkeypatch.setattr(llm, "_gemini", no)
    monkeypatch.setattr(llm, "claude_run", lambda *a, **k: SimpleNamespace(data={"ok": 1}, model="s", duration_s=1))
    assert llm.run_json_content("s", CONTENUTO, SCHEMA).images_sent == 1


def test_nessun_provider_con_vista_solo_testo_e_zero_foto(rete, monkeypatch):
    rete.su(CAVO)
    rete.json_get[(CAVO, "/props")] = {"modalities": {"vision": False}}
    _niente_claude(monkeypatch, "quota")
    r = llm.run_json_content("s", CONTENUTO, SCHEMA)
    assert r.images_sent == 0 and r.provider == "local"
    contenuto = rete.chat(CAVO)[-1][3]["messages"][0]["content"]
    assert isinstance(contenuto, str) and "Domanda 1" in contenuto and IMG["data"] not in contenuto


def test_senza_foto_equivale_a_run_json(rete):
    rete.su(LAPTOP)
    r = llm.run_json_content("s", [{"type": "text", "text": "ciao"}], SCHEMA)
    assert r.images_sent == 0 and isinstance(rete.chat()[0][3]["messages"][0]["content"], str)


@pytest.mark.parametrize("entrypoint", [llm._local_vision, llm.run_json_content])
@pytest.mark.parametrize(("case", "message"), [
    ("base64", "base64"),
    ("file", "Immagine non valida"),
    ("dimensione", "2048 pixel"),
    ("peso", "5 MB"),
    ("mime", "Tipo MIME"),
    ("pillow", "Pillow"),
])
def test_immagine_non_valida_rifiutata_prima_dei_provider(monkeypatch, entrypoint, case, message):
    block = IMG.copy()
    if case == "base64":
        block["data"] = "!!!"
    elif case == "file":
        block["data"] = "QUJD"
    elif case == "dimensione":
        block = _immagine((2049, 1))
    elif case == "peso":
        block["data"] = base64.b64encode(b"x" * (5 * 1024 * 1024 + 1)).decode("ascii")
    elif case == "mime":
        block["media_type"] = "image/jpeg"
    elif case == "pillow":
        monkeypatch.setitem(sys.modules, "studyhub.ai.vision", None)

    def provider():
        pytest.fail("Provider contattato con un'immagine non valida")

    monkeypatch.setattr(llm, "provider_order", provider)
    monkeypatch.setattr(llm, "local_llm_healthy", provider)
    with pytest.raises(ValueError, match=message):
        entrypoint("s", [block], SCHEMA)


def test_local_vision_ridimensiona_e_rimuove_exif(rete):
    rete.su(LAPTOP)
    rete.json_get[(LAPTOP, "/props")] = {"modalities": {"vision": True}}
    exif = Image.Exif()
    exif[274] = 6
    exif[315] = "Autore test"
    photo = _immagine((2048, 1024), exif)

    llm._local_vision("s", [photo], SCHEMA)

    image_url = rete.chat(LAPTOP)[0][3]["messages"][0]["content"][1]["image_url"]["url"]
    with Image.open(io.BytesIO(base64.b64decode(image_url.split(",", 1)[1]))) as image:
        assert image.size == (784, 1568)  # orientamento EXIF applicato prima del ridimensionamento
        assert not image.getexif() and "exif" not in image.info
