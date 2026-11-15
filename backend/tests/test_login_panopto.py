"""`studyhub login` rinnova anche i cookie Panopto nello stesso profilo (contesto Playwright finto)."""
import json

from studyhub.media import panopto as P

VIEWER = "https://univr.cloud.panopto.eu/Panopto/Pages/Viewer.aspx?id=" + "0" * 8 + "-0000-0000-0000-" + "0" * 12


class _Resp:
    def __init__(self, testo, ok=True):
        self._t, self.ok = testo, ok

    def text(self):
        return self._t


class _Req:
    def __init__(self, per_corso):
        self.per_corso, self.chiesti = per_corso, []

    def post(self, url, form):
        self.chiesti.append(int(form["courseid"]))
        return _Resp(self.per_corso.get(int(form["courseid"]), ""))


class _Ctx:
    def __init__(self, per_corso, cookie):
        self.request, self._cookie = _Req(per_corso), cookie

    def cookies(self, url):
        return self._cookie


class _Page:
    def __init__(self):
        self.html = ""

    def set_content(self, h):
        self.html = h

    def evaluate(self, js):
        pass

    def wait_for_url(self, pat, timeout):
        pass


def test_login_nel_profilo_salva_i_cookie(tmp_path, monkeypatch):
    monkeypatch.setattr(P, "COOKIE_FILE", tmp_path / "panopto.json")
    ctx = _Ctx({7: f"<a href='{VIEWER}' x>Lezione 1</a>"}, [{"name": ".ASPXAUTH", "value": "v"}])
    page = _Page()
    assert P.login_nel_profilo(ctx, page, "sk", [3, 7, 9], attesa_s=1)
    assert ctx.request.chiesti == [3, 7]  # si ferma al primo corso con una registrazione
    assert VIEWER in page.html and P.INSTANCE in page.html
    assert json.loads((tmp_path / "panopto.json").read_text())[".ASPXAUTH"] == "v"


def test_login_nel_profilo_senza_cookie_non_scrive(tmp_path, monkeypatch):
    monkeypatch.setattr(P, "COOKIE_FILE", tmp_path / "panopto.json")
    ctx = _Ctx({1: f"<a href='{VIEWER}' x>L</a>"}, [])
    assert not P.login_nel_profilo(ctx, _Page(), "sk", [1], attesa_s=1)
    assert not (tmp_path / "panopto.json").exists()


def test_login_nel_profilo_senza_registrazioni(tmp_path, monkeypatch):
    monkeypatch.setattr(P, "COOKIE_FILE", tmp_path / "panopto.json")
    assert not P.login_nel_profilo(_Ctx({}, [{"name": ".ASPXAUTH", "value": "v"}]), _Page(), "sk", [1, 2], attesa_s=1)
