import pytest

from conftest import inserisci_corso
from studyhub import paths, search
from studyhub.db import session
from studyhub.ingest import chunking
from studyhub.ingest.embed import EmbeddingError


# --- ricerca -------------------------------------------------------------------------------

def test_fts_query_toglie_stopword_e_fa_prefisso_sull_ultima_parola():
    assert search._fts_query("che cos'è il determinante") == '"cos" OR "determinante"*'
    assert search._fts_query("la di e") is None
    assert search._fts_query("   ") is None
    # caratteri speciali di FTS5 non devono arrivare alla query
    assert search._fts_query('autovalori" OR (xy') == '"autovalori" OR "or" OR "xy"*'


def _indicizza(db, doc_id, corso, testo, titolo="Dispensa"):
    db.execute("INSERT INTO documents (id, course_id, path, kind, sha256, title) VALUES (?,?,?,?,?,?)",
               (doc_id, corso, f"d{doc_id}.pdf", "pdf", f"h{doc_id}", titolo))
    db.execute("INSERT INTO chunks (id, doc_id, course_id, kind, page, heading, text) VALUES (?,?,?,?,?,?,?)",
               (doc_id, doc_id, corso, "pdf", 3, titolo, testo))


def test_ricerca_testuale_senza_semantica(ambiente, db):
    inserisci_corso(db, 1, "Algebra")
    inserisci_corso(db, 2, "Fisica")
    _indicizza(db, 1, 1, "Gli autovalori di una matrice quadrata si trovano dal polinomio caratteristico")
    _indicizza(db, 2, 2, "Il campo elettrico generato da una carica puntiforme")
    db.commit()
    r = search.search("autovalori matrice", semantic=False)
    assert r["semantic"] is False
    assert [x["doc_id"] for x in r["results"]] == [1]
    assert r["results"][0]["course"] == "Algebra" and "[[" in r["results"][0]["snippet"]
    assert search.search("campo elettrico", course_ids=[1], semantic=False)["results"] == []
    assert len(search.search("campo elettrico", course_ids=[2], semantic=False)["results"]) == 1


def test_prefisso_sull_ultima_parola(ambiente, db):
    inserisci_corso(db, 1)
    _indicizza(db, 1, 1, "Il determinante di una matrice")
    db.commit()
    assert len(search.search("determ", semantic=False)["results"]) == 1


def test_query_vuota_o_solo_stopword(ambiente):
    assert search.search("   ") == {"results": [], "semantic": False}
    assert search.search("la di e", semantic=False)["results"] == []


def test_se_gli_embedding_non_ci_sono_la_ricerca_testuale_funziona_lo_stesso(ambiente, db, monkeypatch):
    inserisci_corso(db, 1)
    _indicizza(db, 1, 1, "teorema di Taylor con resto di Lagrange")
    db.commit()

    def giu(q):
        raise EmbeddingError("ollama spento")
    monkeypatch.setattr(search, "embed_query", giu)
    r = search.search("Taylor")
    assert r["semantic"] is False and len(r["results"]) == 1


def test_fusione_rrf_premia_chi_compare_in_entrambe_le_liste(ambiente, db, monkeypatch):
    inserisci_corso(db, 1)
    _indicizza(db, 1, 1, "serie di taylor e sviluppi")
    _indicizza(db, 2, 1, "altro argomento sulle serie")
    _indicizza(db, 3, 1, "serie numeriche e criteri di convergenza")
    db.commit()
    monkeypatch.setattr(search, "embed_query", lambda q: [0.0])
    # la semantica mette al primo posto il chunk 2 e al secondo l'1
    monkeypatch.setattr(search.vectors, "knn", lambda db_, qv, n, ids: [(2, 0.9), (1, 0.8)])
    r = search.search("serie taylor", semantic=True)
    assert r["semantic"] is True
    ids = [x["id"] for x in r["results"]]
    assert ids[0] == 1            # primo nel testo (match su 'taylor') e secondo nella semantica
    assert set(ids) == {1, 2, 3} and ids.index(2) < ids.index(3)  # 2 e' solo semantico ma batte il solo-testuale 3


# --- chunking ------------------------------------------------------------------------------

def test_testo_corto_un_solo_chunk_e_troppo_corto_nessuno():
    assert chunking.split_text("x" * 100) == ["x" * 100]
    assert chunking.split_text("poco") == []


def test_testo_lungo_diviso_senza_perdere_parole():
    paragrafi = [f"Paragrafo {i}: " + ("parola " * 40).strip() + "." for i in range(30)]
    testo = "\n\n".join(paragrafi)
    pezzi = chunking.split_text(testo)
    assert len(pezzi) > 1
    assert all(len(p) <= chunking.TARGET * 1.5 for p in pezzi)
    unito = "\n".join(pezzi)
    for i in range(30):
        assert f"Paragrafo {i}:" in unito


def test_paragrafo_enorme_tagliato_a_fine_frase():
    frase = "Questa è una frase di prova abbastanza lunga. "
    pezzi = chunking.split_text(frase * 200)
    assert len(pezzi) > 3
    assert all(p.endswith(".") for p in pezzi[:-1])


def test_pulizia_parole_spezzate_e_accenti_latex():
    assert chunking._clean("de-\nterminante e `e vero") == "determinante e è vero"
    assert chunking._clean("a\n\n\n\n\nb") == "a\n\nb"


def test_chunk_markdown_usa_i_titoli_come_intestazione():
    md = "# Uno\n" + "alfa " * 20 + "\n## Due\n" + "beta " * 20
    cs = chunking.chunk_markdown(md, "Doc")
    assert [c.heading for c in cs] == ["Doc · Uno", "Doc · Due"]


def test_chunk_pagine_porta_il_numero_di_pagina():
    from types import SimpleNamespace
    pagine = [SimpleNamespace(number=1, text=""), SimpleNamespace(number=2, text="Titolo pagina\n" + "testo " * 30)]
    cs = chunking.chunk_pages(pagine, "Slide")
    assert len(cs) == 1 and cs[0].page == 2 and cs[0].heading.startswith("Slide · p. 2 · Titolo pagina")


def test_trascrizione_a_finestre_di_75_secondi_con_minuti():
    seg = [{"start": i * 10.0, "end": i * 10.0 + 10, "text": f"t{i}"} for i in range(20)]
    cs = chunking.chunk_transcript(seg, "Lez")
    assert cs[0].t_start == 0.0 and cs[0].t_end == 80.0   # la finestra si chiude al primo segmento che supera i 75 s
    assert cs[-1].t_end == 200.0
    assert sum(len(c.text.split()) for c in cs) == 20      # nessun segmento perso


def test_chunk_codice_con_sovrapposizione():
    codice = "\n".join(f"riga numero {i} del programma" for i in range(200))
    cs = chunking.chunk_code(codice, "f.py")
    assert cs[0].heading.endswith("righe 1-80") and cs[1].heading.endswith("righe 71-150")


# --- nomi di file ----------------------------------------------------------------------------

@pytest.mark.parametrize("nome,atteso", [
    ("a/b:c*d?.pdf", "a_b_c_d_.pdf"),
    ("  spazi   multipli  ", "spazi multipli"),
    ("fine.", "fine"),
    ("", "senza_nome"),
    ("CON", "_CON"),
    ("nul.txt", "_nul.txt"),
])
def test_safe_name(nome, atteso):
    assert paths.safe_name(nome) == atteso


def test_safe_name_lungo_conserva_l_estensione():
    n = paths.safe_name("x" * 200 + ".pdf", 40)
    assert len(n) <= 40 and n.endswith(".pdf")


def test_folder_name():
    assert paths.folder_name("Metodi statistici per l'ingegneria [A1B2] (2026)") == "Metodi_Statistici_per_l_Ingegneria"
    assert paths.folder_name("[solo codice]") == "senza_nome"


def test_ensure_course_dirs_e_percorsi_relativi(ambiente):
    from studyhub.config import settings
    cartella = settings.uni_root / "1_Anno" / "Algebra"
    paths.ensure_course_dirs(cartella)
    assert all((cartella / s).is_dir() for s in paths.COURSE_SUBDIRS)
    assert paths.rel_to_uni(cartella / "moodle") == "1_Anno/Algebra/moodle"
    assert paths.uni_path("1_Anno/Algebra/moodle") == cartella / "moodle"


def test_archivio_vettoriale_mai_creato_non_rompe_la_ricerca(ambiente, db, monkeypatch):
    """Difetto reale: con sqlite-vec caricato e nessun documento indicizzato, knn() cadeva con
    'no such table: vec_chunks' e /api/search rispondeva 500 invece dei soli risultati testuali."""
    import numpy as np
    from studyhub import db as dbmod
    if not dbmod.VEC_AVAILABLE:
        pytest.skip("sqlite-vec non caricabile su questa macchina")
    inserisci_corso(db, 1)
    _indicizza(db, 1, 1, "autovalori e autovettori")
    db.commit()
    monkeypatch.setattr(search, "embed_query", lambda q: np.ones(1024, np.float32))
    r = search.search("autovalori")
    assert r["semantic"] is False and len(r["results"]) == 1
