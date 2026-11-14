"""P2.4: `autosync.run` con Moodle, Panopto, indice ed embedding finti: conteggi, evento, corsi toccati, errori."""
from __future__ import annotations

import pytest

from conftest import inserisci_corso
from studyhub import autosync, brain_events, notify, turno
from studyhub.db import session
from studyhub.ingest.embed import EmbeddingError
from studyhub.paths import uni_path
from studyhub.sync.auth import LoginRequired


class Rep:
    def __init__(self, new_paths=()):
        self.new_paths = list(new_paths)


class Ctx:
    """Registra le chiamate e permette di programmare Moodle/Panopto per ogni test."""

    def __init__(self):
        self.indicizzati: list[int] = []
        self.embedding = 0
        self.eventi: list[tuple] = []
        self.corsi_sync: dict[int, object] = {}       # id corso -> Rep oppure Exception
        self.video: dict[int, list[dict]] = {}        # id corso -> lezioni Moodle da elaborare
        self.panopto: dict[int, list[dict]] = {}      # id corso -> lezioni Panopto
        self.elaborate: list[str] = []
        self.embed_exc: Exception | None = None
        self.login_ok = True


@pytest.fixture
def ctx(ambiente, db, monkeypatch):
    c = Ctx()
    inserisci_corso(db, 1, "Analisi 2", priority=2)
    inserisci_corso(db, 2, "Fisica", priority=1)
    db.commit()
    monkeypatch.setattr(turno, "LEGACY_LOCK", ambiente / "legacy.lock")
    monkeypatch.setattr(turno, "notte_attiva", lambda: False)
    import studyhub.fullrun as fullrun
    monkeypatch.setattr(fullrun, "is_running", lambda: False)
    monkeypatch.setattr("studyhub.study.riprese.riprendi_sicuro", lambda **k: {})
    monkeypatch.setattr(autosync, "apply_catalog", lambda: None)
    monkeypatch.setattr("studyhub.study.docclass.tag_all", lambda: {})

    class Sess:
        pass

    def get_session(interactive=False, token_only_ok=False):
        if not c.login_ok:
            raise LoginRequired("Sessione scaduta: esegui `studyhub login`.")
        return Sess()

    class MoodleF:
        def __init__(self, sess):
            pass

        def close(self):
            pass

    class CourseSyncF:
        def __init__(self, m, course):
            self.course = course

        def run(self):
            r = c.corsi_sync.get(self.course["id"], Rep())
            if isinstance(r, Exception):
                raise r
            return r

    monkeypatch.setattr(autosync, "get_session", get_session)
    monkeypatch.setattr(autosync, "Moodle", MoodleF)
    monkeypatch.setattr(autosync, "CourseSync", CourseSyncF)

    # Moodle video + Panopto (import locali dentro run)
    import studyhub.media.panopto as panopto_mod
    import studyhub.media.pipeline as pipeline

    class PanoptoF:
        def __init__(self, sess):
            pass

        def close(self):
            pass

    def elabora(lec, course, *_a, **_k):
        if lec.get("rotta"):
            raise RuntimeError("ffmpeg ha fallito")
        c.elaborate.append(lec["title"])

    monkeypatch.setattr(panopto_mod, "Panopto", PanoptoF)
    monkeypatch.setattr(pipeline, "discover_moodle_videos", lambda course: c.video.get(course["id"], []))
    monkeypatch.setattr(pipeline, "process_moodle_video", lambda lec, course, m, whisper=True: elabora(lec, course))
    monkeypatch.setattr(pipeline, "discover", lambda sess, course: c.panopto.get(course["id"], []))
    monkeypatch.setattr(pipeline, "process_lecture", lambda lec, course, p, whisper=True: elabora(lec, course))

    def index_course(course):
        c.indicizzati.append(course["id"])

    def embed_pending(*a, **k):
        c.embedding += 1
        if c.embed_exc:
            raise c.embed_exc
        return 0

    monkeypatch.setattr("studyhub.ingest.indexer.index_course", index_course)
    monkeypatch.setattr("studyhub.ingest.indexer.embed_pending", embed_pending)
    monkeypatch.setattr(brain_events, "send", lambda tipo, data, level="info", **k: c.eventi.append((tipo, data, level)))
    monkeypatch.setattr(notify, "toast", lambda *a, **k: True)
    return c


def _lez(titolo, stato="nuova", source="panopto", data="2026-10-01", **extra):
    return {"id": hash(titolo) % 10000, "title": titolo, "status": stato, "source": source, "date": data, **extra}


def _notifiche():
    with session() as d:
        return [dict(r) for r in d.execute("SELECT kind, title, course_id FROM notifications ORDER BY id")]


def test_salta_se_il_turno_di_notte_e_attivo(ctx, monkeypatch, capsys):
    monkeypatch.setattr(turno, "notte_attiva", lambda: True)
    monkeypatch.setattr(autosync, "apply_catalog", lambda: pytest.fail("non doveva partire"))
    s = autosync.run()
    assert s == {"file": 0, "lezioni": 0, "avvisi": 0, "errori": []}
    assert ctx.indicizzati == [] and ctx.embedding == 0 and ctx.eventi == []


def test_force_ignora_il_turno_di_notte(ctx, monkeypatch):
    monkeypatch.setattr(turno, "notte_attiva", lambda: True)
    s = autosync.run(force=True, toast=False)
    assert s["errori"] == [] and ctx.embedding == 1


def test_salta_se_la_elaborazione_completa_e_in_corso(ctx, monkeypatch):
    import studyhub.fullrun as fullrun
    monkeypatch.setattr(fullrun, "is_running", lambda: True)
    assert autosync.run()["file"] == 0 and ctx.eventi == [] and ctx.embedding == 0


def test_conteggi_riepilogo_e_indice_solo_dei_corsi_toccati(ctx):
    ctx.corsi_sync[1] = Rep(["corso1/moodle/a.pdf", "corso1/moodle/b.pdf"])
    ctx.panopto[2] = [_lez("Lez 1"), _lez("Lez 2", stato="trascritta"), _lez("Lez 3", source="moodle")]
    s = autosync.run(toast=False)
    assert s["file"] == 2 and s["lezioni"] == 1 and s["avvisi"] == 0 and s["errori"] == []
    assert ctx.elaborate == ["Lez 1"]           # solo "nuova" e solo Panopto
    assert sorted(ctx.indicizzati) == [1, 2]    # file nuovi nel corso 1, lezione nel corso 2
    assert ctx.embedding == 1
    notifiche = _notifiche()
    assert [n["kind"] for n in notifiche] == ["file", "lezione"]
    assert notifiche[0]["course_id"] == 1 and "2 nuovi file" in notifiche[0]["title"]


def test_nessuna_novita_nessun_indice_ma_embedding_si(ctx):
    s = autosync.run(toast=False)
    assert (s["file"], s["lezioni"], s["avvisi"], s["errori"]) == (0, 0, 0, [])
    assert ctx.indicizzati == [] and ctx.embedding == 1
    assert _notifiche() == []


def test_nuovi_avvisi_contati_solo_se_il_file_cambia(ctx, monkeypatch):
    for cid, folder in ((1, "corso1"), (2, "corso2")):
        av = uni_path(folder) / "moodle" / "_avvisi.md"
        av.parent.mkdir(parents=True, exist_ok=True)
        av.write_text("vecchio", encoding="utf-8")

    class CS:
        def __init__(self, m, course):
            self.course = course

        def run(self):
            if self.course["id"] == 1:  # solo il corso 1 riceve un nuovo avviso
                (uni_path("corso1") / "moodle" / "_avvisi.md").write_text("nuovo", encoding="utf-8")
            return Rep()

    monkeypatch.setattr(autosync, "CourseSync", CS)
    s = autosync.run(toast=False)
    assert s["avvisi"] == 1 and s["file"] == 0
    assert [n["kind"] for n in _notifiche()] == ["avviso"]


def test_budget_di_lezioni_nuove(ctx):
    ctx.panopto[1] = [_lez("L1"), _lez("L2"), _lez("L3")]
    s = autosync.run(max_new_lectures=2, toast=False)
    assert s["lezioni"] == 2 and ctx.elaborate == ["L1", "L2"]


def test_video_moodle_piu_recenti_per_primi(ctx):
    ctx.video[1] = [_lez("vecchia", source="moodle", data="2026-01-01"), _lez("nuova", source="moodle", data="2026-06-01"),
                    _lez("senza data", source="moodle", data=None)]
    s = autosync.run(max_new_lectures=2, toast=False)
    assert ctx.elaborate == ["nuova", "vecchia"] and s["lezioni"] == 2


def test_errore_su_un_corso_non_ferma_gli_altri(ctx):
    ctx.corsi_sync[1] = RuntimeError("timeout Moodle")
    ctx.corsi_sync[2] = Rep(["corso2/moodle/x.pdf"])
    s = autosync.run(toast=False)
    assert s["file"] == 1 and s["errori"] == ["Analisi 2: timeout Moodle"]
    assert ctx.indicizzati == [2]
    assert ctx.eventi[-1][2] == "warn" and ctx.eventi[-1][1]["errori"] == 1


def test_errore_su_una_lezione_non_ferma_le_altre(ctx):
    ctx.panopto[1] = [_lez("rotta", rotta=True), _lez("buona")]
    s = autosync.run(toast=False)
    assert s["lezioni"] == 1 and ctx.elaborate == ["buona"]
    assert len(s["errori"]) == 1 and "rotta" in s["errori"][0]


def test_login_scaduto_e_riconosciuto(ctx):
    ctx.login_ok = False
    s = autosync.run(toast=False)
    assert s["file"] == 0 and s["lezioni"] == 0
    assert len(s["errori"]) == 1 and "studyhub login" in s["errori"][0]
    tipo, data, livello = ctx.eventi[-1]
    assert tipo == "studyhub.sync" and livello == "error" and data["login_necessario"] is True
    kinds = [n["title"] for n in _notifiche()]
    assert "Sync Moodle non riuscito" in kinds and "Panopto: login necessario" in kinds
    assert ctx.embedding == 1  # il resto del giro (indice/embedding) prosegue


def test_evento_studyhub_sync_con_i_conteggi(ctx):
    ctx.corsi_sync[1] = Rep(["corso1/moodle/a.pdf"])
    autosync.run(toast=False)
    assert len(ctx.eventi) == 1
    tipo, data, livello = ctx.eventi[0]
    assert tipo == "studyhub.sync" and livello == "info"
    assert data == {"file": 1, "lezioni": 0, "avvisi": 0, "errori": 0, "errori_esempi": []}


def test_ollama_spento_non_e_fatale(ctx):
    ctx.corsi_sync[1] = Rep(["corso1/moodle/a.pdf"])
    ctx.embed_exc = EmbeddingError("Ollama spento")
    s = autosync.run(toast=False)
    assert s["errori"] == [] and s["file"] == 1
    assert ctx.indicizzati == [1] and ctx.embedding == 1
    assert ctx.eventi and ctx.eventi[0][2] == "info"  # l'evento parte comunque, senza errori


def test_toast_solo_se_ci_sono_novita(ctx, monkeypatch):
    visti = []
    monkeypatch.setattr(notify, "toast", lambda t, b: visti.append((t, b)))
    autosync.run()
    assert visti == []
    ctx.corsi_sync[1] = Rep(["corso1/moodle/a.pdf"])
    autosync.run()
    assert len(visti) == 1 and "1 file nuovi" in visti[0][1]
