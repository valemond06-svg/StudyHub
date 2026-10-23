"""Login a Moodle UniVR tramite browser (SSO Shibboleth).

La password la inserisci tu nella finestra di Chromium: qui salviamo solo i cookie di sessione
Moodle, il sesskey e, se il sito lo consente, il token dell'app mobile (dura mesi e sblocca
l'API web service completa, es. core_course_get_contents).
"""
from __future__ import annotations

import base64
import json
import secrets
import time
from dataclasses import dataclass
from urllib.parse import unquote

import httpx
from playwright.sync_api import BrowserContext, Page, sync_playwright

from ..config import settings

SESSION_FILE = settings.secrets_dir / "session.json"
TOKEN_FILE = settings.secrets_dir / "token.json"
LOGIN_TIMEOUT_S = 600


class LoginRequired(Exception):
    pass


@dataclass
class MoodleSession:
    cookies: dict[str, str]
    sesskey: str
    token: str | None = None

    def http(self) -> httpx.Client:
        return httpx.Client(
            base_url=settings.moodle_url,
            cookies=self.cookies,
            follow_redirects=True,
            timeout=httpx.Timeout(30, read=120),
            headers={"User-Agent": "StudyHub/0.1 (uso personale)"},
        )


def _is_logged_in_url(url: str) -> bool:
    base = settings.moodle_url
    return url.startswith(base) and "/login/" not in url and "/auth/" not in url


def _sesskey(page: Page) -> str | None:
    try:
        return page.evaluate("() => (window.M && M.cfg && M.cfg.sesskey) || null")
    except Exception:
        return None


def _fetch_mobile_token(ctx: BrowserContext) -> str | None:
    """Flusso SSO dell'app Moodle: launch.php risponde con redirect a moodlemobile://token=<b64>."""
    passport = secrets.token_hex(8)
    url = (f"{settings.moodle_url}/admin/tool/mobile/launch.php"
           f"?service=moodle_mobile_app&passport={passport}&urlscheme=moodlemobile")
    try:
        resp = ctx.request.get(url, max_redirects=0)
    except Exception:
        return None
    location = resp.headers.get("location", "")
    if "token=" not in location:
        return None
    raw = unquote(location.split("token=", 1)[1]).split("#")[0]
    try:
        parts = base64.b64decode(raw + "=" * (-len(raw) % 4)).decode().split(":::")
    except Exception:
        return None
    return parts[1] if len(parts) >= 2 else None


def browser_login(interactive: bool) -> MoodleSession:
    """Apre il profilo persistente. Se l'IdP ricorda ancora la sessione basta headless;
    altrimenti (interactive=True) mostra la finestra e aspetta che tu faccia il login."""
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            str(settings.browser_profile), headless=not interactive, locale="it-IT",
            viewport={"width": 1100, "height": 800},
        )
        try:
            page = ctx.pages[0] if ctx.pages else ctx.new_page()
            page.goto(f"{settings.moodle_url}/auth/shibboleth/index.php", wait_until="domcontentloaded")
            deadline = time.time() + (LOGIN_TIMEOUT_S if interactive else 20)
            sesskey = None
            while time.time() < deadline:
                if _is_logged_in_url(page.url):
                    sesskey = _sesskey(page)
                    if sesskey:
                        break
                page.wait_for_timeout(1000)
            if not sesskey:
                raise LoginRequired("Login non completato.")
            token = _fetch_mobile_token(ctx)
            cookies = {c["name"]: c["value"] for c in ctx.cookies(settings.moodle_url)}
        finally:
            ctx.close()

    sess = MoodleSession(cookies=cookies, sesskey=sesskey, token=token or _load_token())
    SESSION_FILE.write_text(json.dumps({"cookies": cookies, "sesskey": sesskey}), encoding="utf-8")
    if token:
        TOKEN_FILE.write_text(json.dumps({"token": token, "saved": time.time()}), encoding="utf-8")
    return sess


def _load_token() -> str | None:
    if TOKEN_FILE.exists():
        return json.loads(TOKEN_FILE.read_text(encoding="utf-8")).get("token")
    return None


def _session_valid(sess: MoodleSession) -> bool:
    with sess.http() as c:
        r = c.get("/my/", follow_redirects=False)
    return r.status_code == 200


def _token_valid(token: str | None) -> bool:
    if not token:
        return False
    try:
        r = httpx.post(f"{settings.moodle_url}/webservice/rest/server.php", timeout=30, data={
            "wstoken": token, "wsfunction": "core_webservice_get_site_info", "moodlewsrestformat": "json"})
        return r.status_code == 200 and "userid" in r.json()
    except Exception:
        return False


def get_session(interactive: bool = False, token_only_ok: bool = False) -> MoodleSession:
    """Sessione valida: prima i cookie salvati, poi SSO silenzioso, infine (se permesso) login a mano.
    Con token_only_ok basta il token dell'app (dura mesi): sufficiente per il sync dei corsi,
    non per Panopto e le API AJAX, che vogliono i cookie della sessione web."""
    data = json.loads(SESSION_FILE.read_text(encoding="utf-8")) if SESSION_FILE.exists() else None
    if data:
        sess = MoodleSession(data["cookies"], data["sesskey"], _load_token())
        if _session_valid(sess):
            return sess
    try:
        return browser_login(interactive=False)
    except Exception:  # SSO scaduto, browser mancante, rete…: per il login silenzioso è uguale
        token = _load_token()
        if token_only_ok and _token_valid(token):
            return MoodleSession(data["cookies"] if data else {}, data["sesskey"] if data else "", token)
        if not interactive:
            raise LoginRequired("Sessione scaduta: esegui `studyhub login`.")
        return browser_login(interactive=True)
