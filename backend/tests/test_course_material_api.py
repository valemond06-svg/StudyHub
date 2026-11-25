"""Materiale del corso per categoria, avvisi Moodle e stato del corso (corsi.yaml) esposti alla UI React."""
from conftest import inserisci_corso


def _doc(db, doc_id, course_id, path, category, exam_date=None, duplicate_of=None, kind="pdf"):
    db.execute("""INSERT INTO documents (id, course_id, path, kind, sha256, title, n_pages, duplicate_of)
                  VALUES (?,?,?,?,?,?,?,?)""", (doc_id, course_id, path, kind, f"sha{doc_id}", None, 3, duplicate_of))
    db.execute("INSERT INTO doc_tags (doc_id, category, exam_date) VALUES (?,?,?)", (doc_id, category, exam_date))


def test_documents_by_category_skip_duplicates_and_other_courses(client, db):
    inserisci_corso(db, 1)
    inserisci_corso(db, 2, "Fisica")
    _doc(db, 10, 1, "corso1/moodle/Appello_2025-06-12.pdf", "appello", "2025-06-12")
    _doc(db, 11, 1, "corso1/moodle/Appello_2026-01-20.pdf", "appello", "2026-01-20")
    _doc(db, 12, 1, "corso1/moodle/Soluzioni_gennaio.pdf", "soluzione", "2026-01-20")
    _doc(db, 13, 1, "corso1/moodle/copia/Appello_2026-01-20.pdf", "appello", "2026-01-20", duplicate_of=11)
    _doc(db, 14, 2, "corso2/moodle/Formulario.pdf", "formulario")
    db.commit()

    full = client.get("/api/courses/1/documents").json()
    assert full["categories"] == [{"category": "appello", "count": 2}, {"category": "soluzione", "count": 1}]
    assert [d["id"] for d in full["documents"]] == [11, 10, 12]
    assert full["documents"][0] == {"id": 11, "title": None, "kind": "pdf", "n_pages": 3, "category": "appello",
                                    "exam_date": "2026-01-20", "name": "Appello_2026-01-20.pdf"}

    only = client.get("/api/courses/1/documents", params={"category": "soluzione"}).json()
    assert [d["id"] for d in only["documents"]] == [12]
    assert len(only["categories"]) == 2  # i conteggi restano quelli di tutto il corso
    assert client.get("/api/courses/99/documents").status_code == 404


def test_announcements_read_latest_first_and_tolerate_missing_file(client, db, ambiente):
    inserisci_corso(db, 1)
    inserisci_corso(db, 2, "Fisica")
    db.commit()
    moodle = ambiente / "uni" / "corso1" / "moodle"
    moodle.mkdir(parents=True)
    (moodle / "_avvisi.md").write_text("## Aula cambiata\nDa lunedì in aula B.\n\n---\n\n## Appello\nIl 20/01.\n\n---\n\n",
                                       encoding="utf-8")

    assert client.get("/api/courses/1/announcements").json() == {
        "items": ["## Aula cambiata\nDa lunedì in aula B.", "## Appello\nIl 20/01."]}
    assert client.get("/api/courses/1/announcements", params={"last": 1}).json()["items"] == ["## Aula cambiata\nDa lunedì in aula B."]
    assert client.get("/api/courses/2/announcements").json() == {"items": []}
    assert client.get("/api/courses/99/announcements").status_code == 404


def test_course_stage_from_catalog_is_exposed(client, db):
    inserisci_corso(db, 1, stage="corrente")
    inserisci_corso(db, 2, "Algebra", stage="arretrato")
    inserisci_corso(db, 3, "Smart contract", active=0, stage="futuro")
    db.commit()

    stages = {c["id"]: c["stage"] for c in client.get("/api/courses").json()}
    assert stages == {1: "corrente", 2: "arretrato", 3: "futuro"}
    assert client.get("/api/courses/2").json()["stage"] == "arretrato"
    study = {c["id"]: c for c in client.get("/api/study").json()}
    assert set(study) == {1, 2}
    assert study[1]["stage"] == "corrente" and study[2]["stage"] == "arretrato"
    assert study[1]["tried_items"] == 0 and study[1]["coverage"] == 0
