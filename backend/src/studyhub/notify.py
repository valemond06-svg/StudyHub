"""Novità (nel DB, mostrate nella vista "Oggi") e notifiche toast di Windows."""
from __future__ import annotations

import subprocess
from datetime import datetime
from xml.sax.saxutils import escape

from .db import session

# AppUserModelID di PowerShell: permette i toast senza installare nulla.
_APP_ID = "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe"


def add(kind: str, title: str, body: str = "", course_id: int | None = None, ref: str | None = None) -> None:
    with session() as db:
        db.execute("INSERT INTO notifications (created_at, kind, course_id, title, body, ref) VALUES (?,?,?,?,?,?)",
                   (datetime.now().isoformat(timespec="seconds"), kind, course_id, title, body, ref))


def unread(limit: int = 50) -> list[dict]:
    with session() as db:
        return [dict(r) for r in db.execute(
            """SELECT n.*, c.fullname AS course FROM notifications n LEFT JOIN courses c ON c.id=n.course_id
               WHERE n.read=0 ORDER BY n.id DESC LIMIT ?""", (limit,))]


def mark_read(ids: list[int] | None = None) -> None:
    with session() as db:
        if ids:
            db.executemany("UPDATE notifications SET read=1 WHERE id=?", [(i,) for i in ids])
        else:
            db.execute("UPDATE notifications SET read=1")


def toast(title: str, body: str) -> bool:
    """Notifica di Windows. Se non riesce (es. sessione senza desktop) si ignora: le novità restano nel DB."""
    xml = (f"<toast><visual><binding template='ToastGeneric'><text>{escape(title)}</text>"
           f"<text>{escape(body[:300])}</text></binding></visual></toast>").replace("'", "''")
    ps = ("[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null;"
          "[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > $null;"
          f"$x = New-Object Windows.Data.Xml.Dom.XmlDocument; $x.LoadXml('{xml}');"
          f"[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{_APP_ID}')"
          ".Show([Windows.UI.Notifications.ToastNotification]::new($x))")
    try:
        r = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps],
                           capture_output=True, timeout=30)
        return r.returncode == 0
    except Exception:
        return False
