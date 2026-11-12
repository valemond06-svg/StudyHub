"""Scelta e uso del modello locale, con la rete simulata (nessuna connessione vera)."""
import io
import json
import threading
import time
import urllib.error

import pytest

from studyhub.ai import llm
from studyhub.ai.claude_runner import ClaudeError

LAPTOP = "http://127.0.0.1:8080"
CAVO = "http://10.10.10.1:8080"
CAVO_BACKEND = "http://10.10.10.1:8081"
TAILSCALE = "http://100.83.194.37:8080"

RISPOSTA_OK = {"model": "qwen-test", "choices": [{"message": {"content": '{"x": 1}'}}]}


class _Risposta:
    def __init__(self, corpo: bytes = b"{}", status: int = 200):
        self.status, self._corpo = status, corpo

    def read(self):
        return self._corpo

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class RetePulita:
    """Server finti: per ognuno si dice come reagiscono a /health, /v1/models e alla chat."""

    def __init__(self):
        self.host: dict[str, dict] = {}
        self.json_get: dict = {}   # (base, percorso) -> corpo JSON (per /props e /v1/models)
        self.chiamate: list[tuple[str, str, str | None, dict]] = []   # (base, percorso, Authorization, payload)
        self.lock = threading.Lock()

    def su(self, base, health=200, models=200, chat=None, ritardo=0.0):
        """health/models: codice HTTP, oppure 'giu' per rete irraggiungibile. chat: dict risposta, int (HTTP) o eccezione."""
        self.host[base] = {"health": health, "models": models, "chat": RISPOSTA_OK if chat is None else chat,
                           "ritardo": ritardo}
        return self

    def sonde(self, base=None):
        return [c for c in self.chiamate if c[1] in ("/health", "/v1/models") and (base is None or c[0] == base)]

    def chat(self, base=None):
        return [c for c in self.chiamate if c[1] == "/v1/chat/completions" and (base is None or c[0] == base)]

    def urlopen(self, req, timeout=None):
        url = req.full_url
        base, _, resto = url.partition("//")[2].partition("/")
        base, percorso = "http://" + base, "/" + resto
        payload = json.loads(req.data) if req.data else None
        with self.lock:
            self.chiamate.append((base, percorso, req.get_header("Authorization"), payload))
        cfg = self.host.get(base)
        if cfg is None:
            raise urllib.error.URLError("irraggiungibile")
        if cfg["ritardo"]:
            time.sleep(cfg["ritardo"])
        if (base, percorso) in self.json_get:
            return _Risposta(json.dumps(self.json_get[(base, percorso)]).encode())
        if percorso == "/props":
            raise urllib.error.HTTPError(url, 404, "no", {}, io.BytesIO(b"{}"))
        if percorso == "/health":
            esito = cfg["health"]
        elif percorso == "/v1/models":
            esito = cfg["models"]
        else:
            esito = cfg["chat"]
        if esito == "giu":
            raise urllib.error.URLError("connessione rifiutata")
        if isinstance(esito, BaseException):
            raise esito
        if isinstance(esito, int):
            if esito == 200:
                return _Risposta(b'{"status":"ok"}')
            raise urllib.error.HTTPError(url, esito, "errore", {}, io.BytesIO(b"{}"))
        return _Risposta(json.dumps(esito).encode())


@pytest.fixture
def rete(monkeypatch, ambiente):
    llm.invalidate_local_llm()
    r = RetePulita()
    monkeypatch.setattr(llm.urllib.request, "urlopen", r.urlopen)
    yield r
    llm.invalidate_local_llm()


@pytest.fixture
def orologio(monkeypatch):
    t = {"v": 1000.0}
    monkeypatch.setattr(llm, "_now", lambda: t["v"])
    return t


# --- candidati ---------------------------------------------------------------------------

def test_ordine_dei_candidati_questa_macchina_poi_cavo_poi_tailscale(ambiente):
    c = llm.local_llm_candidates()
    assert c[0] == LAPTOP
    assert c.index(CAVO) < c.index(TAILSCALE)
    assert c.index(LAPTOP) < c.index("http://127.0.0.1:8081")
    assert len(c) == len(set(c))
    # su ogni host il router (8080, con chiave) precede il backend 8081 solo dove serve: nessun 8081 prima del suo 8080
    assert c.index(CAVO) < c.index(CAVO_BACKEND)


def test_indirizzo_personalizzato_ha_la_precedenza_e_accetta_v1(ambiente, monkeypatch):
    from studyhub.config import settings
    settings.extra["local_llm_url"] = "http://192.168.1.50:9000/v1/"
    assert llm.local_llm_candidates()[0] == "http://192.168.1.50:9000"
    monkeypatch.setenv("STUDYHUB_LOCAL_LLM", "http://127.0.0.1:8080/v1")   # la variabile d'ambiente vince e si deduplica
    c = llm.local_llm_candidates()
    assert c[0] == LAPTOP and c.count(LAPTOP) == 1


# --- controllo di salute e scelta ---------------------------------------------------------

def test_sceglie_il_primo_sano_in_ordine_di_priorita(rete):
    rete.su(TAILSCALE).su(CAVO).su(LAPTOP, health="giu", models="giu")
    assert llm.get_local_llm_url() == CAVO


def test_laptop_con_router_locale_vince_anche_se_il_fisso_risponde(rete):
    rete.su(LAPTOP).su(TAILSCALE)
    assert llm.get_local_llm_url() == LAPTOP


def test_nessuno_risponde(rete):
    assert llm.get_local_llm_url() is None


def test_senza_health_si_ripiega_su_v1_models(rete):
    rete.su(LAPTOP, health=404, models=200)
    assert llm.get_local_llm_url() == LAPTOP
    assert [c[1] for c in rete.sonde(LAPTOP)] == ["/health", "/v1/models"]


def test_health_503_non_e_sano_e_non_si_prova_models(rete):
    rete.su(LAPTOP, health=503, models=200).su(CAVO)
    assert llm.get_local_llm_url() == CAVO
    assert [c[1] for c in rete.sonde(LAPTOP)] == ["/health"]


def test_candidati_controllati_in_parallelo_non_in_serie(rete):
    # tutti i primi candidati "appesi" 0,4 s: in serie sarebbero >1,6 s
    for base in llm.local_llm_candidates()[:5]:
        rete.su(base, health="giu", ritardo=0.4)
    rete.su(llm.local_llm_candidates()[5])
    t0 = time.monotonic()
    assert llm.get_local_llm_url() == llm.local_llm_candidates()[5]
    assert time.monotonic() - t0 < 1.2


def test_la_chiave_va_solo_alle_porte_8080(rete, monkeypatch):
    monkeypatch.setenv("STUDYHUB_LOCAL_LLM_KEY", "chiave-di-prova")
    rete.su(LAPTOP).su(CAVO_BACKEND)
    llm.get_local_llm_url()
    assert rete.sonde(LAPTOP)[0][2] == f"Bearer {llm.get_local_llm_key()}"
    llm.invalidate_local_llm()
    rete.su(LAPTOP, health="giu", models="giu")
    llm.get_local_llm_url()
    assert all(c[2] is None for c in rete.sonde(CAVO_BACKEND))


# --- cache -----------------------------------------------------------------------------------

def test_risultato_in_cache_per_cinque_minuti(rete, orologio):
    rete.su(LAPTOP)
    assert llm.get_local_llm_url() == LAPTOP
    n = len(rete.sonde())
    orologio["v"] += llm.CACHE_OK_S - 1
    assert llm.get_local_llm_url() == LAPTOP
    assert len(rete.sonde()) == n                   # nessun nuovo controllo
    orologio["v"] += 2                               # scaduta
    llm.get_local_llm_url()
    assert len(rete.sonde()) > n


def test_cache_si_aggiorna_se_il_server_cambia(rete, orologio):
    rete.su(CAVO)
    assert llm.get_local_llm_url() == CAVO
    rete.su(LAPTOP)                                  # il router locale si accende
    assert llm.get_local_llm_url() == CAVO           # finché la cache vale non si ricontrolla
    orologio["v"] += llm.CACHE_OK_S + 1
    assert llm.get_local_llm_url() == LAPTOP


def test_nessun_server_ricontrollato_presto(rete, orologio):
    assert llm.get_local_llm_url() is None
    rete.su(LAPTOP)
    assert llm.get_local_llm_url() is None           # ancora dentro i 15 s: non si martella la rete
    orologio["v"] += llm.CACHE_NONE_S + 1
    assert llm.get_local_llm_url() == LAPTOP


def test_invalidate_cancella_solo_il_candidato_indicato(rete):
    rete.su(LAPTOP)
    llm.get_local_llm_url()
    llm.invalidate_local_llm(CAVO)                   # un altro server: la cache resta
    n = len(rete.sonde())
    llm.get_local_llm_url()
    assert len(rete.sonde()) == n
    llm.invalidate_local_llm(LAPTOP + "/v1")
    llm.get_local_llm_url()
    assert len(rete.sonde()) > n


# --- chiamata al modello ---------------------------------------------------------------------

def _chiama():
    return llm._local("sistema", "testo", {"type": "object"}, "veloce")


def test_la_richiesta_usa_v1_chat_e_il_modello_local(rete):
    rete.su(LAPTOP)
    r = _chiama()
    base, percorso, auth, payload = rete.chat()[0]
    assert (base, percorso) == (LAPTOP, "/v1/chat/completions")
    assert payload["model"] == "local"
    assert payload["response_format"] == {"type": "json_object"}
    assert "sistema" in payload["messages"][0]["content"] and "testo" in payload["messages"][0]["content"]
    assert (r.data, r.provider, r.model) == ({"x": 1}, "local", "qwen-test")


def test_modello_configurabile(rete, monkeypatch):
    rete.su(LAPTOP)
    monkeypatch.setenv("STUDYHUB_LLM_MODEL", "altro")
    _chiama()
    assert rete.chat()[0][3]["model"] == "altro"


def test_server_che_cade_a_meta_passa_al_candidato_successivo(rete):
    rete.su(LAPTOP, chat="giu").su(CAVO)
    assert _chiama().data == {"x": 1}
    assert [c[0] for c in rete.chat()] == [LAPTOP, CAVO]
    # il guasto è ricordato: la chiamata dopo va dritta al server buono, senza ripassare dal rotto
    _chiama()
    assert [c[0] for c in rete.chat()] == [LAPTOP, CAVO, CAVO]
    assert llm.get_local_llm_url() == CAVO


def test_http_503_e_connessione_resettata_valgono_come_caduta(rete):
    rete.su(LAPTOP, chat=503).su(CAVO, chat=ConnectionResetError("reset")).su(TAILSCALE)
    assert _chiama().data == {"x": 1}
    assert [c[0] for c in rete.chat()] == [LAPTOP, CAVO, TAILSCALE]


def test_corpo_non_json_da_un_server_guasto_e_una_caduta(rete):
    class Sporco(_Risposta):
        def read(self):
            return b"<html>gateway</html>"
    rete.su(LAPTOP).su(CAVO)
    original = rete.urlopen

    def urlopen(req, timeout=None):
        if req.full_url.startswith(LAPTOP) and req.full_url.endswith("/chat/completions"):
            return Sporco()
        return original(req, timeout)
    llm.urllib.request.urlopen = urlopen
    try:
        assert _chiama().data == {"x": 1}
    finally:
        llm.urllib.request.urlopen = original


def test_timeout_di_lettura_non_ripete_su_un_altra_macchina_ma_invalida(rete):
    rete.su(LAPTOP, chat=TimeoutError("lento")).su(CAVO)
    with pytest.raises(ClaudeError, match="nessuna risposta"):
        _chiama()
    assert [c[0] for c in rete.chat()] == [LAPTOP]
    assert llm.get_local_llm_url() == LAPTOP   # ri-controllato (la macchina è viva), non rimasto in cache come "guasto"


def test_errore_di_richiesta_400_non_fa_giri_inutili(rete):
    rete.su(LAPTOP, chat=400).su(CAVO)
    with pytest.raises(ClaudeError, match="HTTP 400"):
        _chiama()
    assert [c[0] for c in rete.chat()] == [LAPTOP]


def test_chiave_rifiutata_401_prova_il_successivo(rete):
    rete.su(CAVO, chat=401).su(TAILSCALE)
    assert _chiama().data == {"x": 1}
    assert [c[0] for c in rete.chat()] == [CAVO, TAILSCALE]


def test_tutti_caduti_errore_con_il_dettaglio_e_numero_massimo_di_tentativi(rete):
    for base in (LAPTOP, CAVO, TAILSCALE, CAVO_BACKEND):
        rete.su(base, chat="giu")
    with pytest.raises(ClaudeError) as e:
        _chiama()
    assert len(rete.chat()) == llm.MAX_LOCAL_ATTEMPTS == 3
    assert LAPTOP in str(e.value) and CAVO in str(e.value)


def test_nessun_server_sano_ultimo_tentativo_sul_fisso_via_tailscale(rete, monkeypatch):
    monkeypatch.setenv("STUDYHUB_LOCAL_LLM_KEY", "chiave-di-prova")
    # i controlli di salute falliscono ma la chat risponde (server occupato che tarda sull'health)
    rete.su(TAILSCALE, health=503, models=503)
    assert _chiama().data == {"x": 1}
    assert rete.chat()[0][0] == llm.FALLBACK_LOCAL_URL == TAILSCALE
    assert rete.chat()[0][2] == f"Bearer {llm.get_local_llm_key()}"


def test_nessun_server_in_assoluto_errore_chiaro(rete):
    with pytest.raises(ClaudeError, match="Local LLM error"):
        _chiama()


def test_prima_risposta_lenta_non_e_un_errore(rete):
    """Il router carica il modello alla prima richiesta: 20-30 s sono normali. Qui un ritardo breve, nessun errore."""
    rete.su(LAPTOP, ritardo=0.3)
    assert _chiama().data == {"x": 1}


# --- estrazione del JSON ---------------------------------------------------------------------

def test_json_con_blocco_think_e_graffe_nel_ragionamento():
    raw = '<think>provo {a: 1} e poi {b}</think>\nEcco: {"ok": true, "n": 2}'
    assert llm._extract_json(raw) == {"ok": True, "n": 2}


def test_json_con_think_aperto_dal_template():
    assert llm._extract_json('ragiono {x}...</think>{"ok": 1}') == {"ok": 1}


def test_json_in_blocco_markdown_e_riparabile():
    assert llm._extract_json('```json\n{"a": [1, 2,]}\n```') == {"a": [1, 2]}


def test_json_irrecuperabile_solleva_claudeerror():
    with pytest.raises(ClaudeError):
        llm._extract_json("niente json qui")


def test_reasoning_content_usato_se_il_contenuto_e_vuoto(rete):
    rete.su(LAPTOP, chat={"choices": [{"message": {"content": "", "reasoning_content": '{"da": "ragionamento"}'}}]})
    assert _chiama().data == {"da": "ragionamento"}


def test_risposta_senza_choices_e_un_errore_pulito(rete):
    rete.su(LAPTOP, chat={"choices": []})
    with pytest.raises(ClaudeError):
        _chiama()


# --- integrazione con la catena dei provider ------------------------------------------------

def test_provider_order_mette_il_locale_solo_se_sano(rete, monkeypatch):
    monkeypatch.setattr(llm, "_agy_exe", lambda: None)
    assert llm.provider_order() == ["claude"]
    llm.invalidate_local_llm()
    rete.su(LAPTOP)
    # la cache "nessuno" dura 15 s ma è stata invalidata a mano
    assert llm.provider_order() == ["local", "claude"]


def test_run_json_cade_su_claude_se_il_locale_muore_e_invalida(rete, monkeypatch):
    from types import SimpleNamespace
    monkeypatch.setattr(llm, "_agy_exe", lambda: None)
    rete.su(LAPTOP, chat="giu")
    monkeypatch.setattr(llm, "claude_run", lambda *a, **k: SimpleNamespace(data={"da": "claude"}, model="sonnet", duration_s=1))
    r = llm.run_json("s", "t", {})
    assert r.provider == "claude" and r.data == {"da": "claude"}
    assert llm.get_local_llm_url() is None   # il locale guasto non resta in cache come sano
