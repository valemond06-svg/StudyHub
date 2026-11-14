"""P2.4: sync Moodle di un corso (CourseSync) e client HTTP, tutto con Moodle finto: niente rete."""
from __future__ import annotations

import httpx
import pytest

from conftest import inserisci_corso
from studyhub.db import session
from studyhub.paths import uni_path
from studyhub.sync import course as course_mod
from studyhub.sync.auth import MoodleSession
from studyhub.sync.course import CourseSync
from studyhub.sync.moodle import Moodle, MoodleError

URL = "https://moodle.test/pluginfile.php/1/mod_resource/content/0/{}"


class _Risposta:
    headers = {"content-type": "application/pdf"}


class MoodleFinto:
    """Sostituisce `Moodle`: contenuti del corso in memoria, download che scrive byte finti."""

    def __init__(self, sezioni, rotti=()):
        self.sezioni = sezioni
        self.rotti = set(rotti)
        self.scaricati: list[str] = []

    def course_contents(self, course_id):
        return self.sezioni

    def ws(self, function, **params):
        return {"courses": []} if function == "mod_assign_get_assignments" else []

    def news_discussions(self, forum_id):
        return []

    def get_text(self, url):
        return "<p>testo</p>"

    def download(self, url, dest, attempts=3):
        if any(r in url for r in self.rotti):
            raise MoodleError("500 dal server")
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(b"contenuto " + url.encode())
        self.scaricati.append(url)
        return _Risposta()


def _file(nome, tm=100, size=None):
    contenuto = b"contenuto " + URL.format(nome).encode()
    return {"type": "file", "filename": nome, "filepath": "/", "fileurl": URL.format(nome),
            "filesize": size if size is not None else len(contenuto), "timemodified": tm, "mimetype": "application/pdf"}


def _sezioni(*nomi, tm=100):
    mods = [{"id": 10 + i, "modname": "resource", "name": n, "contents": [_file(n, tm)]} for i, n in enumerate(nomi)]
    return [{"id": 1, "section": 1, "name": "Teoria", "summary": "", "modules": mods}]


@pytest.fixture
def corso(ambiente, db):
    inserisci_corso(db)
    db.commit()
    with session() as d:
        return dict(d.execute("SELECT * FROM courses WHERE id=1").fetchone())


def _righe_files():
    with session() as d:
        return [dict(r) for r in d.execute("SELECT * FROM files ORDER BY id")]


def test_file_nuovi_scaricati_e_registrati(corso):
    m = MoodleFinto(_sezioni("a.pdf", "b.pdf"))
    rep = CourseSync(m, corso).run()
    assert rep.new_files == 2 and rep.updated_files == 0 and rep.errors == []
    assert len(rep.new_paths) == 2 and len(m.scaricati) == 2
    righe = _righe_files()
    assert len(righe) == 2
    for r in righe:
        assert uni_path(r["path"]).exists() and r["sha256"] and r["course_id"] == 1 and r["module_id"] in (10, 11)
    with session() as d:
        assert d.execute("SELECT last_sync FROM courses WHERE id=1").fetchone()[0]
        assert d.execute("SELECT COUNT(*) FROM sync_runs WHERE new_files=2").fetchone()[0] == 1
    assert (uni_path(corso["folder"]) / "moodle" / "INDICE.md").exists()


def test_file_gia_presenti_non_riscaricati(corso):
    CourseSync(MoodleFinto(_sezioni("a.pdf")), corso).run()
    m2 = MoodleFinto(_sezioni("a.pdf"))
    rep = CourseSync(m2, corso).run()
    assert m2.scaricati == []
    assert rep.new_files == 0 and rep.skipped_files == 1 and rep.new_paths == []
    assert len(_righe_files()) == 1


def test_file_aggiornato_su_moodle_viene_riscaricato_al_suo_posto(corso):
    CourseSync(MoodleFinto(_sezioni("a.pdf", tm=100)), corso).run()
    path = _righe_files()[0]["path"]
    m2 = MoodleFinto(_sezioni("a.pdf", tm=200))
    rep = CourseSync(m2, corso).run()
    assert rep.updated_files == 1 and rep.new_files == 0 and len(m2.scaricati) == 1
    righe = _righe_files()
    assert len(righe) == 1 and righe[0]["path"] == path and righe[0]["timemodified"] == 200


def test_file_gia_sul_disco_ma_non_nel_db_viene_adottato(corso):
    CourseSync(MoodleFinto(_sezioni("a.pdf")), corso).run()
    with session() as d:
        d.execute("DELETE FROM files")  # sync interrotto prima della registrazione
    m2 = MoodleFinto(_sezioni("a.pdf"))
    rep = CourseSync(m2, corso).run()
    assert m2.scaricati == [] and rep.skipped_files == 1
    assert len(_righe_files()) == 1  # niente copia "a (2).pdf"


def test_download_rotto_non_ferma_gli_altri_file(corso):
    m = MoodleFinto(_sezioni("rotto.pdf", "buono.pdf"), rotti=("rotto.pdf",))
    rep = CourseSync(m, corso).run()
    assert rep.new_files == 1
    assert len(rep.errors) == 1 and "rotto.pdf" in rep.errors[0]
    righe = _righe_files()
    assert len(righe) == 1 and righe[0]["path"].endswith("buono.pdf")


def test_modulo_che_esplode_non_ferma_il_corso(corso, monkeypatch):
    orig = CourseSync._module

    def module(self, mod, sdir, section_id, lines):
        if mod["name"] == "x.pdf":
            raise RuntimeError("modulo rotto")
        return orig(self, mod, sdir, section_id, lines)

    monkeypatch.setattr(CourseSync, "_module", module)
    rep = CourseSync(MoodleFinto(_sezioni("x.pdf", "y.pdf")), corso).run()
    assert rep.new_files == 1 and any("modulo rotto" in e for e in rep.errors)


def test_video_moodle_non_si_scarica_ma_diventa_sorgente_media(corso):
    sez = [{"id": 1, "section": 1, "name": "Reg", "summary": "", "modules": [
        {"id": 20, "modname": "resource", "name": "Lezione 1 2026.03.05", "contents": [_file("lez1.mp4")]}]}]
    m = MoodleFinto(sez)
    rep = CourseSync(m, corso).run()
    assert m.scaricati == [] and rep.new_files == 0 and rep.media_found == 1
    with session() as d:
        r = d.execute("SELECT kind, url FROM media_sources").fetchone()
    assert r["kind"] == "moodle_video" and "lez1.mp4" in r["url"] and "token=" not in r["url"]


# --- client HTTP ---------------------------------------------------------------------------------------------

def _client(handler, token="tok"):
    m = Moodle(MoodleSession({}, "sk", token))
    m.http = httpx.Client(base_url="https://moodle.test", transport=httpx.MockTransport(handler))
    return m


@pytest.fixture(autouse=True)
def _senza_pausa(monkeypatch):
    from studyhub.config import settings
    monkeypatch.setattr(settings, "request_delay_s", 0, raising=False)


def test_download_html_al_posto_del_file_e_un_errore(tmp_path):
    m = _client(lambda req: httpx.Response(200, headers={"content-type": "text/html"}, content=b"<html>login</html>"))
    with pytest.raises(MoodleError, match="HTML inattesa"):
        m.download("https://moodle.test/pluginfile.php/1/x.pdf", tmp_path / "x.pdf", attempts=1)
    assert not (tmp_path / "x.pdf").exists()


def test_download_ok_scrive_il_file_e_toglie_il_part(tmp_path):
    visti = []

    def handler(req):
        visti.append(str(req.url))
        return httpx.Response(200, headers={"content-type": "application/pdf"}, content=b"PDF!")

    m = _client(handler)
    m.download("https://moodle.test/pluginfile.php/1/x.pdf", tmp_path / "x.pdf")
    assert (tmp_path / "x.pdf").read_bytes() == b"PDF!" and not (tmp_path / "x.pdf.part").exists()
    assert "/webservice/pluginfile.php" in visti[0] and "token=tok" in visti[0]  # il token va nell'URL, non nel DB


def test_ws_errore_moodle_diventa_moodle_error():
    m = _client(lambda req: httpx.Response(200, json={"exception": "x", "errorcode": "invalidtoken", "message": "scaduto"}))
    with pytest.raises(MoodleError, match="invalidtoken"):
        m.ws("core_course_get_contents", courseid=1)


def test_clean_url_toglie_token_e_normalizza_webservice():
    u = course_mod._clean_url("https://m.test/webservice/pluginfile.php/1/a.pdf?forcedownload=1&token=segreto&x=2")
    assert "token" not in u and "forcedownload" not in u and "/webservice/" not in u and u.endswith("?x=2")
