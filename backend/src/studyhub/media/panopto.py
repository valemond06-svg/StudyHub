"""Panopto UniVR: elenco registrazioni dal blocco Moodle, login SSO, info sui flussi.

Il login Panopto passa da Moodle (provider "MoodleDidattica"): lo facciamo fare a Chromium
headless con i cookie Moodle già salvati, poi riusiamo i cookie Panopto con httpx.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from html import unescape

import httpx
from playwright.sync_api import sync_playwright

from ..config import settings
from ..sync.auth import MoodleSession

PANOPTO = "https://univr.cloud.panopto.eu"
INSTANCE = "MoodleDidattica"
COOKIE_FILE = settings.secrets_dir / "panopto.json"
_LINK_RE = re.compile(r"<a href='(https://[^']*Viewer\.aspx\?id=([0-9a-f-]{36})[^']*)'[^>]*>([^<]+)</a>")


class PanoptoAuthError(Exception):
    pass


@dataclass
class PanoptoSession:
    id: str
    title: str
    viewer_url: str


@dataclass
class Stream:
    tag: str            # DV (camera), SCREEN, OBJECT…
    name: str
    url: str            # HLS m3u8
    start: float        # secondi rispetto all'inizio della sessione
    end: float


def list_course_sessions(sess: MoodleSession, course_id: int) -> list[PanoptoSession]:
    with sess.http() as c:
        r = c.post("/blocks/panopto/panopto_content.php", data={"sesskey": sess.sesskey, "courseid": course_id})
        r.raise_for_status()
    seen, out = set(), []
    for url, sid, title in _LINK_RE.findall(r.text):
        if sid not in seen:
            seen.add(sid)
            out.append(PanoptoSession(sid, unescape(title).strip(), unescape(url)))
    return out


def _login_with_browser(sess: MoodleSession, viewer_url: str) -> dict[str, str]:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(locale="it-IT")
        ctx.add_cookies([{"name": k, "value": v, "domain": "moodledidattica.univr.it", "path": "/",
                          "secure": True} for k, v in sess.cookies.items()])
        page = ctx.new_page()
        # Stesso POST che fa il blocco Moodle (panopto_startSSO).
        page.set_content(f"<form id=f method=post action='{viewer_url}'>"
                         f"<input type=hidden name=instance value='{INSTANCE}'></form>")
        page.evaluate("document.getElementById('f').submit()")
        try:
            page.wait_for_url(re.compile(r".*/Panopto/Pages/Viewer\.aspx.*"), timeout=45000)
        except Exception:
            pass
        cookies = {c["name"]: c["value"] for c in ctx.cookies(PANOPTO)}
        browser.close()
    if ".ASPXAUTH" not in cookies:
        raise PanoptoAuthError("Login Panopto non riuscito (sessione Moodle scaduta? esegui `studyhub login`).")
    return cookies


class Panopto:
    def __init__(self, sess: MoodleSession):
        self.sess = sess
        cookies = json.loads(COOKIE_FILE.read_text(encoding="utf-8")) if COOKIE_FILE.exists() else {}
        self.http = httpx.Client(base_url=PANOPTO, cookies=cookies, follow_redirects=True,
                                 timeout=httpx.Timeout(30, read=120))

    def close(self) -> None:
        self.http.close()

    def _relogin(self, viewer_url: str) -> None:
        cookies = _login_with_browser(self.sess, viewer_url)
        COOKIE_FILE.write_text(json.dumps(cookies), encoding="utf-8")
        self.http.cookies.clear()
        for k, v in cookies.items():
            self.http.cookies.set(k, v, domain="univr.cloud.panopto.eu")

    def delivery_info(self, s: PanoptoSession) -> dict:
        for attempt in range(2):
            r = self.http.post("/Panopto/Pages/Viewer/DeliveryInfo.aspx", data={
                "deliveryId": s.id, "responseType": "json", "isEmbed": "false", "refreshAuthCookie": "true"})
            data = r.json()
            if "Delivery" in data:
                return data
            if data.get("LoginRedirect") and attempt == 0:
                self._relogin(s.viewer_url)
                continue
            raise PanoptoAuthError(data.get("ErrorMessage", "DeliveryInfo fallita"))
        raise PanoptoAuthError("DeliveryInfo fallita")

    @staticmethod
    def streams(info: dict) -> list[Stream]:
        out = []
        for st in info["Delivery"].get("Streams", []):
            if st.get("StreamUrl"):
                out.append(Stream(st.get("Tag") or "", st.get("Name") or "", st["StreamUrl"],
                                  float(st.get("RelativeStart") or 0), float(st.get("RelativeEnd") or 0)))
        return out

    def cookie_header(self) -> str:
        return "; ".join(f"{c.name}={c.value}" for c in self.http.cookies.jar)

    def captions(self, s: PanoptoSession, languages: list[int] | None = None) -> str | None:
        """SRT dei sottotitoli Panopto, se esistono (altrimenti None). 21 = italiano su UniVR."""
        for lang in languages or [21, 0]:
            r = self.http.get("/Panopto/Pages/Transcription/GenerateSRT.ashx",
                              params={"id": s.id, "language": str(lang)})
            if r.status_code == 200 and "-->" in r.text:
                return r.text
        return None
