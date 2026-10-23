"""Client Moodle: web service REST (con token dell'app) oppure AJAX interno (con sesskey)."""
from __future__ import annotations

import time
from pathlib import Path
from typing import Any

import httpx

from ..config import settings
from .auth import MoodleSession


class MoodleError(Exception):
    pass


def _flatten(prefix: str, value: Any, out: dict[str, Any]) -> None:
    if isinstance(value, dict):
        for k, v in value.items():
            _flatten(f"{prefix}[{k}]" if prefix else k, v, out)
    elif isinstance(value, (list, tuple)):
        for i, v in enumerate(value):
            _flatten(f"{prefix}[{i}]", v, out)
    elif isinstance(value, bool):
        out[prefix] = int(value)
    else:
        out[prefix] = value


class Moodle:
    def __init__(self, sess: MoodleSession):
        self.sess = sess
        self.http = sess.http()
        self._last = 0.0

    def close(self) -> None:
        self.http.close()

    def _throttle(self) -> None:
        wait = settings.request_delay_s - (time.time() - self._last)
        if wait > 0:
            time.sleep(wait)
        self._last = time.time()

    @property
    def has_token(self) -> bool:
        return bool(self.sess.token)

    def ws(self, function: str, **params: Any) -> Any:
        if not self.sess.token:
            raise MoodleError("Token web service non disponibile")
        self._throttle()
        data: dict[str, Any] = {}
        _flatten("", params, data)
        data.update(wstoken=self.sess.token, wsfunction=function, moodlewsrestformat="json")
        r = self.http.post("/webservice/rest/server.php", data=data)
        r.raise_for_status()
        out = r.json()
        if isinstance(out, dict) and "exception" in out:
            raise MoodleError(f"{function}: {out.get('errorcode')} {out.get('message')}")
        return out

    def ajax(self, function: str, **args: Any) -> Any:
        self._throttle()
        r = self.http.post(
            f"/lib/ajax/service.php?sesskey={self.sess.sesskey}&info={function}",
            json=[{"index": 0, "methodname": function, "args": args}],
        )
        r.raise_for_status()
        out = r.json()[0]
        if out.get("error"):
            exc = out.get("exception") or {}
            raise MoodleError(f"{function}: {exc.get('errorcode')} {exc.get('message')}")
        return out["data"]

    def call(self, function: str, **args: Any) -> Any:
        """Prova il web service se c'è il token, altrimenti l'AJAX."""
        if self.has_token:
            try:
                return self.ws(function, **args)
            except MoodleError:
                pass
        return self.ajax(function, **args)

    # --- API usate da StudyHub -------------------------------------------------

    def enrolled_courses(self) -> list[dict]:
        data = self.call(
            "core_course_get_enrolled_courses_by_timeline_classification",
            classification="all", limit=0, offset=0, sort="fullname",
        )
        return data["courses"]

    def course_contents(self, course_id: int) -> list[dict]:
        return self.ws("core_course_get_contents", courseid=course_id)

    def news_discussions(self, forum_id: int) -> list[dict]:
        return self.ws("mod_forum_get_forum_discussions", forumid=forum_id, perpage=100)["discussions"]

    def file_url(self, url: str) -> str:
        """Gli URL pluginfile del web service vogliono il token come parametro."""
        if self.has_token and "/webservice/pluginfile.php" in url:
            return url + ("&" if "?" in url else "?") + f"token={self.sess.token}"
        if self.has_token and "/pluginfile.php" in url:
            url = url.replace("/pluginfile.php", "/webservice/pluginfile.php", 1)
            return url + ("&" if "?" in url else "?") + f"token={self.sess.token}"
        return url

    def download(self, url: str, dest: Path, attempts: int = 3) -> httpx.Response:
        for i in range(attempts):
            try:
                return self._download_once(url, dest)
            except (httpx.TimeoutException, httpx.RemoteProtocolError, httpx.ConnectError):
                if i == attempts - 1:
                    raise
                time.sleep(5 * (i + 1))  # file grandi (video): il server a volte si ferma, si riprova
        raise RuntimeError("unreachable")

    def _download_once(self, url: str, dest: Path) -> httpx.Response:
        self._throttle()
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_name(dest.name + ".part")
        with self.http.stream("GET", self.file_url(url), timeout=httpx.Timeout(30, read=600)) as r:
            r.raise_for_status()
            ctype = r.headers.get("content-type", "")
            if "text/html" in ctype and dest.suffix.lower() not in (".html", ".htm"):
                # Moodle ha risposto con una pagina (login/errore) invece del file.
                raise MoodleError(f"Risposta HTML inattesa per {dest.name}")
            with open(tmp, "wb") as f:
                for chunk in r.iter_bytes(1 << 16):
                    f.write(chunk)
        tmp.replace(dest)
        return r

    def get_text(self, url: str) -> str:
        self._throttle()
        r = self.http.get(self.file_url(url))
        r.raise_for_status()
        return r.text
