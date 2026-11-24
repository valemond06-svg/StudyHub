# API HTTP di StudyHub

La tabella elenca le route applicative dichiarate in `backend/src/studyhub/api/app.py`. FastAPI espone anche `/docs`, `/redoc`, `/openapi.json` e `/docs/oauth2-redirect`.

- **Auth** richiede `Authorization: Bearer <token>` oppure il cookie `api_token`. `GET /` imposta il cookie di autenticazione. `GET /api/csrf` può impostarlo per i client su loopback.
- **CSRF** richiede che `X-CSRF-Token` corrisponda al cookie `csrf_token`. Un Bearer valido soddisfa anche il controllo CSRF. Il simbolo «—» indica l’assenza della relativa dipendenza sulla route.
- CORS ammette le origini HTTP di loopback sulle porte 5173 e 8765. Gli endpoint sotto `/api/setup/` hanno un limite di una richiesta al minuto per indirizzo.

| Metodo | Percorso | Auth | CSRF | Scopo |
| --- | --- | --- | --- | --- |
| GET | `/api/courses` | Sì | — | Elenca i corsi. |
| GET | `/api/courses/{course_id}` | Sì | — | Legge il dettaglio di un corso. |
| GET | `/api/courses/{course_id}/lectures` | Sì | — | Elenca le lezioni del corso. |
| GET | `/api/courses/{course_id}/notes-index` | Sì | — | Legge l’indice degli appunti del corso. |
| GET | `/api/lectures/{lecture_id}` | Sì | — | Legge dettagli, trascrizione e riferimenti ai media della lezione. |
| GET | `/video/{lecture_id}/{kind}` | Sì | — | Serve il video della lezione. |
| GET | `/api/storage` | Sì | — | Indica il percorso dei media e lo spazio libero. |
| GET | `/media/{lecture_id}/{rel:path}` | Sì | — | Serve una risorsa locale della lezione. |
| GET | `/api/search` | Sì | — | Cerca nei materiali indicizzati. |
| GET | `/api/docs/{doc_id}` | Sì | — | Legge i metadati del documento. |
| GET | `/api/docs/{doc_id}/file` | Sì | — | Serve il file originale. |
| GET | `/api/docs/{doc_id}/page/{page}.png` | Sì | — | Rende una pagina del documento in PNG. |
| GET | `/api/lectures/{lecture_id}/notes` | Sì | — | Legge gli appunti della lezione. |
| POST | `/api/lectures/{lecture_id}/notes` | Sì | Sì | Accoda la generazione degli appunti. |
| POST | `/api/ai/queue` | Sì | Sì | Accoda appunti per le lezioni di un corso. |
| GET | `/api/ai/status` | Sì | — | Legge lo stato della coda AI. |
| GET | `/api/ai/providers` | Sì | — | Riepiloga i provider AI e la loro disponibilità. |
| GET | `/api/ai/pannello` | Sì | — | Riepiloga coda AI, quota Claude e turno notturno. |
| POST | `/api/ai/cancel` | Sì | Sì | Annulla i job ancora in coda. |
| GET | `/api/flashcards/due` | Sì | — | Elenca le flashcard da ripassare. |
| GET | `/api/flashcards/stats` | Sì | — | Legge le statistiche delle flashcard. |
| POST | `/api/flashcards/import` | Sì | Sì | Importa flashcard dagli appunti. |
| POST | `/api/flashcards/{card_id}/review` | Sì | Sì | Registra un ripasso e aggiorna FSRS. |
| GET | `/api/flashcards/anki.tsv` | Sì | — | Esporta flashcard in TSV per Anki. |
| GET | `/api/tutor/threads` | Sì | — | Elenca le conversazioni del tutor. |
| POST | `/api/tutor/threads` | Sì | Sì | Crea una conversazione con il tutor. |
| GET | `/api/tutor/threads/{thread_id}` | Sì | — | Legge una conversazione e i suoi messaggi. |
| POST | `/api/tutor/threads/{thread_id}/ask` | Sì | Sì | Invia una domanda al tutor. |
| DELETE | `/api/tutor/threads/{thread_id}` | Sì | Sì | Elimina una conversazione. |
| GET | `/api/lectures/{lecture_id}/quizzes` | Sì | — | Elenca i quiz di una lezione. |
| POST | `/api/lectures/{lecture_id}/quiz` | Sì | Sì | Genera un quiz per la lezione. |
| GET | `/api/quizzes/{quiz_id}` | Sì | — | Legge un quiz. |
| GET | `/api/quizzes/history/list` | Sì | — | Elenca i tentativi recenti dei quiz. |
| POST | `/api/quizzes/{quiz_id}/submit` | Sì | Sì | Corregge e registra un tentativo. |
| GET | `/api/plan` | Sì | — | Restituisce il piano di studio giornaliero. |
| POST | `/api/exams` | Sì | Sì | Aggiunge un appello. |
| DELETE | `/api/exams/{exam_id}` | Sì | Sì | Elimina un appello. |
| GET | `/api/courses/{course_id}/exam` | Sì | — | Legge appelli, profilo e riepilogo d’esame del corso. |
| POST | `/api/courses/{course_id}/exam/profile` | Sì | Sì | Genera o aggiorna il profilo d’esame. |
| POST | `/api/courses/{course_id}/exam/sims` | Sì | Sì | Genera una simulazione d’esame. |
| GET | `/api/courses/{course_id}/exam/sims` | Sì | — | Elenca le simulazioni del corso. |
| GET | `/api/sims/{sim_id}` | Sì | — | Legge una simulazione. |
| POST | `/api/sims/{sim_id}/submit` | Sì | Sì | Consegna le risposte per la correzione. |
| GET | `/api/feed` | Sì | — | Restituisce le schede del feed StudyTok. |
| GET | `/api/study` | Sì | — | Elenca i corsi attivi con i progressi di studio. |
| GET | `/api/fullrun` | Sì | — | Legge lo stato dell’elaborazione completa. |
| GET | `/api/setup` | Sì | — | Legge lo stato dei prerequisiti e delle procedure in corso. |
| POST | `/api/setup/login` | Sì | Sì | Avvia Chromium per il login UniVR. |
| POST | `/api/setup/courses` | Sì | Sì | Aggiorna il catalogo Moodle. |
| POST | `/api/setup/fullrun` | Sì | Sì | Avvia o riprende l’elaborazione completa tramite launcher Windows. |
| GET | `/favicon.png` | — | — | Serve l’icona dell’interfaccia. |
| GET | `/api/study/{course_id}` | Sì | — | Legge padronanza e preparazione del corso. |
| POST | `/api/study/{course_id}/prepare` | Sì | Sì | Avvia la preparazione del materiale di studio. |
| GET | `/api/study/{course_id}/scan` | Sì | — | Scansiona le fonti del corso per aggiornare le unità di studio. |
| POST | `/api/study/{course_id}/prepare/stop` | Sì | Sì | Chiede di fermare la preparazione. |
| POST | `/api/study/{course_id}/sessions` | Sì | Sì | Crea una sessione di studio. |
| GET | `/api/study/sessions/{sid}` | Sì | — | Legge stato e contenuto della sessione. |
| POST | `/api/study/sessions/{sid}/answer` | Sì | Sì | Registra e valuta una risposta. |
| POST | `/api/study/sessions/{sid}/photo` | Sì | Sì | Corregge una risposta inviata come foto. |
| POST | `/api/study/sessions/{sid}/reveal/{idx}` | Sì | Sì | Mostra la soluzione di un quesito. |
| POST | `/api/study/sessions/{sid}/finish` | Sì | Sì | Chiude la sessione e restituisce il riepilogo. |
| POST | `/api/study/{course_id}/chapters` | Sì | Sì | Aggiorna l’esclusione di un capitolo. |
| GET | `/api/study/{course_id}/chapters` | Sì | — | Elenca i capitoli del corso. |
| GET | `/api/study/{course_id}/chapters/excluded` | Sì | — | Elenca i capitoli esclusi. |
| GET | `/api/lectures/{lecture_id}/topics` | Sì | — | Elenca gli argomenti associati alla lezione registrata. |
| GET | `/api/study/topics/{topic_id}/lesson` | — | — | Legge la lezione interattiva. Se manca o è in errore, accoda la preparazione salvo `prepare=false`. |
| POST | `/api/study/topics/{topic_id}/lesson/done` | — | — | Segna la lezione interattiva come completata. |
| POST | `/api/study/topics/{topic_id}/ask` | Sì | Sì | Invia una domanda sull’argomento. |
| POST | `/api/study/{course_id}/lessons/prefetch` | Sì | Sì | Accoda in anticipo lezioni interattive del corso. |
| GET | `/api/study/topics/{topic_id}` | Sì | — | Legge l’argomento e le unità collegate. |
| GET | `/api/courses/{course_id}/archetype` | Sì | — | Restituisce l’archetipo didattico del corso. |
| GET | `/api/courses/{course_id}/moodle-strategy` | Sì | — | Restituisce la strategia Moodle del corso. |
| GET | `/api/study/topics/{topic_id}/artifact` | Sì | — | Scarica il file del laboratorio pratico. |
| GET | `/api/study/topics/{topic_id}/script.m` | Sì | — | Scarica lo script MATLAB dell’argomento. |
| GET | `/api/lectures/{lecture_id}/notes.pdf` | Sì | — | Esporta gli appunti della lezione in PDF. |
| GET | `/api/courses/{course_id}/dispensa.pdf` | Sì | — | Esporta la dispensa del corso in PDF. |
| GET | `/api/flashcards/anki.apkg` | Sì | — | Esporta le flashcard in un pacchetto Anki. |
| GET | `/api/notifications` | Sì | — | Elenca le notifiche. |
| POST | `/api/notifications/read` | Sì | Sì | Segna le notifiche come lette. |
| GET | `/vendor/{rel:path}` | — | — | Serve le risorse statiche di terze parti. |
| GET | `/api/csrf` | — | — | Restituisce il token CSRF e può inizializzare la sessione locale. |
| GET | `/api/version` | Sì | — | Legge la versione dell’interfaccia e registra la versione client se fornita. |
| GET | `/api/version/clients` | Sì | — | Elenca le versioni dei client osservati. |
| GET | `/` | — | — | Serve l’interfaccia integrata e imposta i cookie. |
