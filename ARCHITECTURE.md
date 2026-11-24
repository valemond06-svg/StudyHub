# Architettura di StudyHub

Questa pagina aggiorna la fotografia del 17 novembre 2026 descritta in [ARCHITECTURE_CURRENT.md](ARCHITECTURE_CURRENT.md).

## Backend e dati

- `cli.py` espone i comandi Typer per server, login, sincronizzazione, elaborazione completa e turno di notte. `api/app.py` espone API FastAPI, risorse delle lezioni e l’interfaccia integrata da `api/static/index.html`. Le route applicative sono elencate in [API.md](API.md).
- `sync/` usa Playwright e un profilo Chromium persistente per il login UniVR. La sincronizzazione usa il token mobile di Moodle e rinnova i cookie Panopto nello stesso profilo. `corsi.yaml` contiene la classificazione dei corsi.
- `media/` gestisce download e trascrizione con faster-whisper. `ingest/` estrae testo, indicizza i frammenti e calcola embedding tramite Ollama. `search.py` combina ricerca lessicale FTS5/BM25 con ricerca vettoriale quando disponibile. La ricerca vettoriale usa sqlite-vec con fallback NumPy elaborato a blocchi.
- `db.py` apre SQLite in modalità WAL e applica le migrazioni all’apertura tramite `PRAGMA user_version` (schema 14). Il database locale contiene corsi, lezioni, documenti, indice dei frammenti, sessioni, tentativi, flashcard, quiz, esami, conversazioni tutor e job AI.
- `study/` compone il piano giornaliero, le lezioni interattive, le sessioni guidate, il ripasso FSRS, i quiz, il tutor e le simulazioni. I tentativi alimentano la stima di padronanza. I quiz rimescolano le risposte in modo deterministico a parità di seed.

## Elaborazioni in background

- Il worker della coda AI parte con FastAPI e prende in carico atomicamente un job alla volta. La coda gestisce appunti delle lezioni e OCR degli arretrati tramite Claude. L’indice univoco parziale evita job attivi duplicati. I job passano da `in_coda` a `in_corso`, poi a `fatto` o `errore`. La cancellazione riguarda i job ancora in coda, che passano ad `annullato`.
- `auto-sync` aggiorna Moodle e l’indice in modo incrementale. Salta se il turno notturno o `fullrun` sono in corso. Le lezioni e le unità idonee vengono riprese dopo 1, 6 e 24 ore.
- `notte --solo-locale` esegue in sequenza trascrizione e indicizzazione con embedding, scarico di Ollama dalla memoria ed elaborazione delle unità di studio tramite llama-server. Il pannello AI legge lo stato della coda e il riepilogo del turno.
- L’integrazione opzionale con Second Brain invia gli eventi `studyhub.sync`, `studyhub.notte` e `studyhub.ai_job_fallito`. Quando la consegna fallisce, gli eventi restano in una coda locale limitata a 200 righe.

## Frontend React

Il frontend usa React 19, React Router 7, TypeScript in modalità strict, Vite 8 e Tailwind 4. TanStack Query gestisce i dati del server. Zustand gestisce lo stato dell’interfaccia e della sessione. L’hook di gamification salva i dati nel browser con `localStorage`.

| Route | Vista |
| --- | --- |
| `/` | Home |
| `/corsi`, `/corsi/:id` | Elenco e dettaglio dei corsi |
| `/studio/:courseId` | Sessione guidata con API reali per avvio, risposte, foto, soluzione e chiusura |
| `/feed`, `/simulazione/:id` | Feed e simulazione d’esame |
| `/lab`, `/impostazioni` | Strumenti di studio e impostazioni |

`src/lib/api.ts` usa URL relativi e invia cookie e header CSRF per le mutazioni. Vite fa da proxy in sviluppo. La build React genera `studyhub-frontend/dist/` e FastAPI serve la propria interfaccia integrata.

Per il trattamento dei dati e i provider AI, vedi [Privacy](PRIVACY.md). Per i ruoli del client Windows e del server Linux, vedi [Deployment](DEPLOYMENT.md).
