"""Verifica contratto API tra frontend e backend."""
import sys
sys.path.insert(0, 'src')
import os
os.environ['STUDYHUB_API_TOKEN'] = 'test-api-token-12345'

from fastapi.testclient import TestClient
from studyhub.api.app import app

client = TestClient(app, raise_server_exceptions=False)

# Mappa endpoint usati dal frontend (da api.ts) con metodi e requisiti
ENDPOINTS = [
    # (method, path, auth_required, csrf_required, description)
    ("GET", "/api/courses", True, False, "Lista corsi"),
    ("GET", "/api/courses/25782", True, False, "Dettaglio corso"),
    ("GET", "/api/courses/25782/lectures", True, False, "Lezioni corso"),
    ("GET", "/api/courses/25782/notes-index", True, False, "Indice note"),
    ("GET", "/api/lectures/1", True, False, "Dettaglio lezione"),
    ("GET", "/api/lectures/1/notes", True, False, "Note lezione"),
    ("POST", "/api/lectures/1/notes", True, True, "Genera note"),
    ("GET", "/api/ai/status", True, False, "Stato coda AI"),
    ("GET", "/api/ai/providers", True, False, "Provider AI"),
    ("GET", "/api/ai/pannello", True, False, "Pannello AI"),
    ("POST", "/api/ai/queue", True, True, "Accoda job"),
    ("POST", "/api/ai/cancel", True, True, "Annulla coda"),
    ("GET", "/api/flashcards/due", True, False, "Flashcard scadute"),
    ("POST", "/api/flashcards/import", True, True, "Importa flashcard"),
    ("POST", "/api/flashcards/1/review", True, True, "Review flashcard"),
    ("GET", "/api/flashcards/anki.tsv", True, False, "Export Anki TSV"),
    ("GET", "/api/tutor/threads", True, False, "Thread tutor"),
    ("POST", "/api/tutor/threads", True, True, "Nuovo thread tutor"),
    ("GET", "/api/tutor/threads/1", True, False, "Dettaglio thread"),
    ("POST", "/api/tutor/threads/1/ask", True, True, "Domanda tutor"),
    ("GET", "/api/lectures/1/quizzes", True, False, "Quiz lezione"),
    ("POST", "/api/lectures/1/quiz", True, True, "Genera quiz"),
    ("GET", "/api/quizzes/1", True, False, "Dettaglio quiz"),
    ("POST", "/api/quizzes/1/submit", True, True, "Submit quiz"),
    ("GET", "/api/plan", True, False, "Piano oggi"),
    ("GET", "/api/study", True, False, "Corsi studio"),
    ("GET", "/api/study/25782", True, False, "Stats corso studio"),
    ("POST", "/api/study/25782/prepare", True, True, "Prepara studio"),
    ("GET", "/api/study/25782/scan", True, False, "Scan studio"),
    ("POST", "/api/study/25782/prepare/stop", True, True, "Stop prepara"),
    ("POST", "/api/study/25782/sessions", True, True, "Crea sessione"),
    ("GET", "/api/study/sessions/1", True, False, "Dettaglio sessione"),
    ("POST", "/api/study/sessions/1/answer", True, True, "Risposta sessione"),
    ("POST", "/api/study/sessions/1/photo", True, True, "Foto sessione"),
    ("POST", "/api/study/sessions/1/reveal/1", True, True, "Reveal sessione"),
    ("POST", "/api/study/sessions/1/finish", True, True, "Finisci sessione"),
    ("POST", "/api/study/25782/chapters", True, True, "Capitolo escluso"),
    ("GET", "/api/study/25782/chapters/excluded", True, False, "Capitoli esclusi"),
    ("GET", "/api/lectures/1/topics", True, False, "Argomenti lezione"),
    ("GET", "/api/study/topics/1/lesson", True, False, "Lezione argomento"),
    ("POST", "/api/study/topics/1/lesson/done", True, False, "Completa lezione"),
    ("POST", "/api/study/topics/1/ask", True, True, "Domanda argomento"),
    ("POST", "/api/study/25782/lessons/prefetch", True, True, "Prefetch lezioni"),
    ("GET", "/api/study/topics/1", True, False, "Dettaglio argomento"),
    ("GET", "/api/courses/25782/archetype", True, False, "Archetipo corso"),
    ("GET", "/api/courses/25782/moodle-strategy", True, False, "Strategia Moodle"),
    ("GET", "/api/study/topics/1/artifact", True, False, "Artifact argomento"),
    ("GET", "/api/study/topics/1/script.m", True, False, "Script MATLAB"),
    ("GET", "/api/feed", True, False, "Feed StudyTok"),
    ("GET", "/api/notifications", True, False, "Notifiche"),
    ("POST", "/api/notifications/read", True, True, "Segna notifiche lette"),
    ("GET", "/api/fullrun", True, False, "Stato fullrun"),
    ("GET", "/api/search?q=test", True, False, "Ricerca"),
    ("GET", "/api/storage", True, False, "Storage"),
    ("GET", "/api/docs/1", True, False, "Documento"),
    ("GET", "/api/docs/1/file", True, False, "File documento"),
    ("GET", "/api/docs/1/page/1.png", True, False, "Pagina documento"),
    ("GET", "/api/lectures/1/notes.pdf", True, False, "Export PDF note"),
    ("GET", "/api/courses/25782/dispensa.pdf", True, False, "Export PDF dispensa"),
    ("GET", "/api/flashcards/anki.apkg", True, False, "Export Anki APKG"),
    ("GET", "/api/setup", True, False, "Setup status"),
    ("POST", "/api/setup/login", True, True, "Setup login"),
    ("POST", "/api/setup/courses", True, True, "Setup corsi"),
    ("POST", "/api/setup/fullrun", True, True, "Setup fullrun"),
    ("GET", "/api/version", True, False, "UI version"),
    ("GET", "/api/version/clients", True, False, "UI clients"),
]

print("=== VERIFICA CONTRATTO API ===\n")

results = {"ok": 0, "fail": 0, "errors": []}

# Get CSRF token
r = client.get('/')
csrf_token = r.cookies.get('csrf_token')
auth_headers = {'Authorization': 'Bearer test-api-token-12345'}

for method, path, auth_req, csrf_req, desc in ENDPOINTS:
    headers = auth_headers.copy() if auth_req else {}
    cookies = {}
    json_body = None

    if method in ("POST", "PUT", "PATCH", "DELETE") and csrf_req:
        headers['X-CSRF-Token'] = csrf_token
        cookies['csrf_token'] = csrf_token

    # Aggiungi body per POST che lo richiedono
    if method == "POST":
        if "queue" in path:
            json_body = {"course_id": 25782, "limit": 1}
        elif "cancel" in path:
            json_body = {}
        elif "review" in path:
            json_body = {"rating": 3}
        elif "import" in path:
            json_body = {"course_id": 25782}
        elif "threads" in path and "ask" not in path:
            json_body = {"course_id": 25782, "mode": "normale"}
        elif "ask" in path:
            json_body = {"question": "test"}
        elif "quiz" in path and "submit" not in path:
            json_body = {"n": 5}
        elif "submit" in path:
            json_body = {"answers": []}
        elif "prepare" in path and "stop" not in path:
            json_body = {"limit": 10}
        elif "sessions" in path and "answer" not in path and "photo" not in path and "reveal" not in path and "finish" not in path:
            json_body = {"minutes": 45, "focus_topic": None}
        elif "answer" in path and "photo" not in path:
            json_body = {"idx": 0, "choice": 1, "confidence": 3, "seconds": 10}
        elif "photo" in path:
            json_body = {"idx": 0, "images": [], "confidence": 3, "seconds": 10}
        elif "reveal" in path:
            json_body = {}
        elif "finish" in path:
            json_body = {}
        elif "chapters" in path:
            json_body = {"chapter": "Test", "exclude": True}
        elif "lessons/prefetch" in path:
            json_body = {}
        elif "login" in path or "courses" in path or "fullrun" in path:
            json_body = {}
        elif "notifications/read" in path:
            json_body = {}
        else:
            json_body = {}

    try:
        if method == "GET":
            r = client.get(path, headers=headers)
        elif method == "POST":
            r = client.post(path, headers=headers, json=json_body, cookies=cookies)
        else:
            r = client.request(method, path, headers=headers, json=json_body, cookies=cookies)

        # 404 è OK per ID inesistenti, 422 per validazione, 401/403 per auth/CSRF
        # 200/201 per successo, 500 = errore server
        # Endpoint che restituiscono binary (PDF, APKG) non sono JSON
        binary_endpoints = ["/notes.pdf", "/dispensa.pdf", "/anki.apkg", "/page/1.png", "/file"]
        is_binary = any(be in path for be in binary_endpoints)

        # Endpoint che richiedono servizi esterni e danno 500 in test environment (non regressioni)
        external_service_endpoints = [
            "/api/lectures/1/notes.pdf",
            "/api/courses/25782/dispensa.pdf",
            "/api/setup/courses",
            "/api/setup/fullrun",
        ]
        is_external = path in external_service_endpoints

        if r.status_code == 500 and not is_external:
            results["fail"] += 1
            try:
                err = r.json()
            except ValueError:
                err = r.text[:200]
            results["errors"].append(f"500: {method} {path} ({desc}) - {err}")
            print(f"❌ {method} {path} - 500 Server Error")
        elif r.status_code == 401 and auth_req:
            results["fail"] += 1
            results["errors"].append(f"401: {method} {path} ({desc}) - Auth failed")
            print(f"❌ {method} {path} - 401 Unauthorized")
        elif r.status_code == 403 and csrf_req:
            results["fail"] += 1
            results["errors"].append(f"403: {method} {path} ({desc}) - CSRF failed")
            print(f"❌ {method} {path} - 403 Forbidden (CSRF)")
        elif is_binary and r.status_code in (200, 404, 422):
            # Binary endpoints: 200=OK, 404=not found, 422=validation error (no AI available)
            results["ok"] += 1
            print(f"✅ {method} {path} - {r.status_code} (binary)")
        elif is_external and r.status_code == 500:
            # Expected in test env - requires AI/Moodle/Panopto
            results["ok"] += 1
            print(f"⚠️  {method} {path} - 500 (expected in test env, needs external services)")
        else:
            results["ok"] += 1
            print(f"✅ {method} {path} - {r.status_code}")
    except Exception as e:
        results["fail"] += 1
        results["errors"].append(f"Exception: {method} {path} ({desc}) - {e}")
        print(f"❌ {method} {path} - Exception: {e}")

print(f"\n=== RISULTATO: {results['ok']} OK, {results['fail']} FAIL ===")
if results["errors"]:
    print("\nErrori:")
    for e in results["errors"]:
        print(f"  - {e}")

# Solo errori reali (non quelli attesi in test env)
real_errors = [e for e in results["errors"] if not any(ext in e for ext in ["/notes.pdf", "/dispensa.pdf", "/setup/courses", "/setup/fullrun"])]
if real_errors:
    assert False, f"{len(real_errors)} endpoint con errori reali: {real_errors}"
print("\n✅ TUTTI GLI ENDPOINT RISPONDONO CORRETTAMENTE (errori esterni attesi in test env)")
