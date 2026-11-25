# API Studio di StudyHub

Gli endpoint di questa pagina richiedono il token API tramite `Authorization: Bearer <token>` o cookie `api_token`. Per scrivere con autenticazione via cookie, inviare anche `X-CSRF-Token` con il valore del cookie `csrf_token`. `GET /api/csrf` inizializza il cookie CSRF e ne restituisce il valore. Le risposte di errore includono `detail`.

Le date di calendario hanno formato `YYYY-MM-DD`. I timestamp UTC riportano l'offset. I filtri per giorno usano il fuso locale del server. Nelle liste con paginazione `limit` vale 50 per impostazione predefinita e accetta 1–200. `offset` parte da zero.

## Setup, lezioni e quiz

| Metodo e percorso | Contratto |
| --- | --- |
| `GET /api/setup` | Stato del primo avvio. Può essere interrogato durante il login e l'elaborazione. |
| `POST /api/setup/login` | Avvia il login. Risponde con `{started}`. |
| `POST /api/setup/courses` | Aggiorna il catalogo. Risponde con `{courses, active}`. |
| `POST /api/setup/fullrun` | Avvia o riprende l'elaborazione. Risponde con `{started}`. |
| `GET /api/study/topics/{topic_id}/lesson` | Legge la lezione interattiva e il suo stato. Una lezione da generare ha `status: "da preparare"`. Il parametro storico `prepare` viene ignorato. |
| `POST /api/study/topics/{topic_id}/lesson/prepare` | Accoda una lezione mancante o in errore. Restituisce lo stato corrente, consultabile con il GET. |
| `POST /api/study/topics/{topic_id}/lesson/done` | Registra il primo completamento anche prima che venga generata la lezione. Risponde con `{ok: true}`. |
| `POST /api/lectures/{lecture_id}/quiz` | Accetta `{"n": 12}` nel JSON o `?n=12` nella query. Se sono presenti entrambi, prevale la query. Valore predefinito 10, intervallo effettivo 4–20. |

Ogni POST di setup accetta una richiesta autenticata ogni 60 secondi per indirizzo client e percorso. La risposta `429` include l'header `Retry-After` in secondi.

## Preparazione del corso e sessioni

| Metodo e percorso | Contratto |
| --- | --- |
| `GET /api/study/{course_id}` | Legge padronanza e preparazione. `prepare.status` vale `da preparare`, `in_corso` o `pronta`. `prepare.order_pending` indica che l'ordine didattico va aggiornato. |
| `POST /api/study/{course_id}/prepare` | Avvia in background la preparazione del materiale e l'aggiornamento dell'ordine didattico. Funziona anche quando è richiesto il solo ordinamento. Accetta `{"limit": 3}` oppure `?limit=3` per limitare le unità da analizzare. |
| `POST /api/study/{course_id}/sessions` | Avvia una sessione. Accetta `minutes` e `focus_topic` facoltativi. |
| `GET /api/study/{course_id}/sessions/open` | Restituisce la sessione aperta più recente del corso, nello stesso formato del GET per ID. Risposta `204` senza corpo quando il corso non ha sessioni aperte (caso normale), `404` se il corso non esiste. |
| `GET /api/study/sessions/{sid}` | Restituisce la coda con `entries`, `resume_index`, `phase`, `status` ed eventuali `errors`. |
| `POST /api/study/sessions/{sid}/seen/{idx}` | Segna la voce `scheda` come letta nella sessione. Risponde con `{"ok": true, "done": true}` anche sui retry. Un indice non valido o una voce di altro tipo restituiscono `400`. |
| `POST /api/study/sessions/{sid}/reveal/{idx}` | Restituisce soluzione, criteri, fonte, `confidence` e `revealed_at`. Accetta un corpo facoltativo con `confidence` da 1 a 3 e `seconds` per il tempo trascorso prima di vedere la soluzione. I retry conservano la prima rivelazione. |
| `POST /api/study/sessions/{sid}/answer` | Salva la risposta e restituisce `attempt_id`, `seconds` e `review_seconds` insieme alla correzione. Una correzione AI indisponibile restituisce `502` con `detail` in italiano. |
| `POST /api/study/sessions/{sid}/finish` | Chiude la sessione come `completata` e restituisce il riepilogo. Restituisce `409` se la sessione è stata abbandonata. |
| `POST /api/study/sessions/{sid}/abandon` | Chiude una sessione aperta come `abbandonata` e restituisce la sessione. I retry restituiscono lo stato di chiusura già salvato. |

Le sessioni aperte da più di 12 ore vengono abbandonate all'avvio del server e ogni minuto. Tentativi, XP e ripassi già registrati restano disponibili. Una sessione `abbandonata` è esclusa dal conteggio delle sessioni completate. Dopo la chiusura, le nuove operazioni sulla coda restituiscono `409`.

`revealed_at` è un timestamp UTC salvato nella voce della coda. La sicurezza dichiarata al reveal prevale sul valore inviato con la risposta. Per l'autovalutazione, `seconds` nel POST di risposta rappresenta il tempo complessivo fino all'invio. Il risultato conserva in `seconds` il tempo di risoluzione e in `review_seconds` il tempo di autovalutazione. Se il client omette i secondi al reveal, la separazione usa l'intervallo misurato dal server. Per risposte scritte, fotografiche e a scelta, inviare il tempo di risoluzione. I tempi non rilevati valgono `null`.

## Ricerca globale

`GET /api/search?q=laplace&course_id=1&limit=20` cerca per parole e risponde con `{results, semantic: false}`. `POST /api/search` accetta gli stessi campi nel JSON e calcola anche gli embedding per la ricerca semantica. Se gli embedding sono indisponibili, il POST restituisce i risultati per parole con `semantic: false`. La palette usa il POST e ripiega sul GET se il POST fallisce. Sono facoltativi `course_id` e `year`. Se vengono passati entrambi, prevale `course_id`. Il limite massimo è 50.

Ogni voce conserva i campi esistenti, tra cui `kind`, `snippet`, `doc_id`, `lecture_id`, `page` e `t_start`. Gli evidenziatori nello snippet sono `[[...]]`.

| `type` | Esempio di `url_hint` |
| --- | --- |
| `lecture` | `/api/lectures/10?t=125.5`. Il client usa `t` come posizione nel player, in secondi. |
| `document` | `/api/docs/31/file#page=7`. Le pagine iniziano da 1. |
| `note` | Puntatore alla fonte, se disponibile, oppure `/api/notes/8`. La palette apre `/quaderno?nota=8` usando `note_id`, anche con `doc_id: null` o con una lezione collegata. |

Quando la fonte è conosciuta senza posizione, il puntatore include il solo ID. Corpo e tag delle note entrano nella ricerca testuale locale.

## Note personali

| Metodo e percorso | Contratto |
| --- | --- |
| `GET /api/notes` | Restituisce `{notes}` ordinate per ultimo aggiornamento. Filtri `course_id`, `lecture_id`, `topic_id`, `doc_id`, `page`, `tag` esatto, ricerca testuale `q` su corpo e tag, `limit` e `offset`. |
| `POST /api/notes` | Crea una nota e la restituisce con stato `201`. Richiede `course_id` e `body` Markdown/LaTeX. Accetta `tags` come lista di stringhe e i campi facoltativi `lecture_id`, `topic_id`, `doc_id`, `timestamp_s` e `page`. |
| `GET /api/notes/{note_id}` | Restituisce la nota con `id`, `created_at`, `updated_at`, corpo, tag e riferimenti. |
| `PATCH /api/notes/{note_id}` | Aggiorna i campi passati. Inviare `null` per rimuovere un riferimento, `[]` per svuotare i tag. |
| `DELETE /api/notes/{note_id}` | Elimina la nota e la rimuove dalla ricerca. Stato `204`. |

Le fonti devono appartenere al corso della nota. Un corso o una nota inesistente restituisce `404`. Una fonte che non appartiene al corso restituisce `400`.

## Flashcard

| Metodo e percorso | Contratto |
| --- | --- |
| `GET /api/flashcards` | Restituisce `{cards}`. Filtri `course_id`, `suspended`, `origin` (`ai`, `manuale`, `errore`), `limit` e `offset`. |
| `POST /api/flashcards` | Richiede `course_id`, `front` e `back`. Accetta `lecture_id`, `doc_id`, `t_start` in secondi e `page` da 1. Crea una carta manuale già disponibile al ripasso FSRS e la restituisce con stato `201`. |
| `GET /api/flashcards/{card_id}` | Restituisce la carta con fonte, `url_hint`, `origin`, `suspended`, scadenza `due` e, quando disponibile, `attempt_id`. |
| `PATCH /api/flashcards/{card_id}` | Aggiorna fronte, retro o fonte preservando scadenza e stato FSRS. Inviare `{"suspended": true}` per sospendere, `false` per riattivare. |
| `DELETE /api/flashcards/{card_id}` | Elimina la carta e il suo storico di revisione. Stato `204`. |
| `POST /api/flashcards/from-error` | Accetta `{"attempt_id": 17}`. Copia domanda, soluzione e fonte dalla risposta di sessione con punteggio inferiore a 0,5. La stessa risposta restituisce la carta esistente. Esito `400` se la risposta è corretta, `404` se non esiste. |
| `GET /api/flashcards/due` | Restituisce `{cards, stats}` per le carte attive già dovute, comprese le manuali e quelle da errore. Accetta `course_id` e `limit`. |
| `POST /api/flashcards/{card_id}/review` | Salva un voto FSRS con `{"rating": 1}` fino a 4 e restituisce `{due, state}`. Una carta sospesa restituisce `409`. |

L'`attempt_id` è restituito dalla risposta di `POST /api/study/sessions/{sid}/answer` e `POST /api/study/sessions/{sid}/photo`. `GET /api/study/sessions/{sid}` restituisce anche `errors[]` con gli ID dei tentativi sbagliati, inclusi quelli precedenti alla migrazione. `POST /api/study/sessions/{sid}/finish` include un `attempt_id` rappresentativo per ogni domanda in `wrong[]`.

## Focus e Pomodoro

| Metodo e percorso | Contratto |
| --- | --- |
| `POST /api/focus/start` | Richiede `course_id` e `planned_seconds` (1–86.400). Accetta `task` come stringa e `kind` come `focus` (predefinito) o `pausa`. Restituisce la sessione con stato `201`, o `409` se un timer è già in corso. |
| `POST /api/focus/{session_id}/stop` | Ferma il timer e restituisce la sessione. Le ripetizioni restituiscono gli stessi tempi. |
| `GET /api/focus` | Restituisce `{sessions}`, dalle più recenti. Filtri facoltativi `course_id`, `day`, `limit` e `offset`. Una sessione a cavallo della mezzanotte è visibile in entrambi i giorni. |
| `GET /api/focus/summary` | Restituisce `day`, `course_id`, `focus_seconds`, `break_seconds`, `focus_count` e `break_count`. Filtri facoltativi `course_id` e `day`, che parte dal giorno corrente. I secondi sono conteggiati nella sola porzione sovrapposta al giorno. |

La sessione contiene `id`, `course_id`, `task`, `kind`, `status` (`running` o `stopped`), `started_at`, `ends_at`, `stopped_at`, `planned_seconds` e `actual_seconds`. Tutti i tempi derivano dall'orologio del server. Il timer scade a `ends_at`, anche se si ricarica la pagina.

## Piano settimanale verso gli appelli

| Metodo e percorso | Contratto |
| --- | --- |
| `GET /api/settings/availability` | Restituisce `hours_by_weekday` (lunedì–domenica) e `days_off` (date senza studio). Disponibilità iniziale `[2, 2, 2, 2, 2, 1, 0]`. |
| `PUT /api/settings/availability` | Sostituisce la disponibilità. Inviare sette valori tra 0 e 24 ore e, facoltativamente, `days_off`. Le ore frazionarie vengono arrotondate al minuto. |
| `GET /api/plan/week` | Restituisce la finestra di sette giorni a partire da `start`, il cui valore predefinito è oggi. Accetta anche `missed_day` per riprodurre un ricalcolo. |
| `POST /api/plan/recompute` | Accetta `{"missed_day": "2026-11-25", "start": "2026-11-25"}`, con `start` facoltativo. Ricalcola i blocchi del giorno saltato negli spazi successivi prima dell'appello. La disponibilità salvata resta quella di `/api/settings/availability`. |
| `PUT /api/exams/{exam_id}` | Aggiorna in una sola operazione `course_id`, `date`, `kind` e `note`. Richiede `course_id` e `date`, usa `"scritto"` e `null` come valori predefiniti per gli altri due campi e restituisce `{id}` con lo stesso ID. Restituisce `400` per una data non valida e `404` se l'appello o il corso è assente. |

Entrambi gli endpoint del piano restituiscono `{start, days, exams, unscheduled, changes}`. Ogni giorno contiene `day`, `available_minutes`, `planned_minutes` e `blocks`. Un blocco contiene un ID stabile, `kind` (`theory`, `exercises`, `simulation`, `fsrs`), `minutes`, `exam_id`, `exam_date`, `course_id`, `course`, `topic_id`, `topic`, `mastery` e `day`. I blocchi FSRS indicano il carico stimato con `due_count`.

Il piano parte dagli appelli futuri aperti, usa i minuti disponibili una volta sola anche tra corsi diversi e dimensiona teoria ed esercizi in base al peso e alla padronanza proiettata al giorno d'esame. I blocchi rispettano la capienza giornaliera e il giorno d'appello è escluso. Il calcolo è locale e deterministico.

`changes[]` elenca i blocchi del giorno saltato con `block_id`, `kind`, `exam_id`, `course_id`, `topic_id`, `minutes`, `from_day`, `to_day` e `reason`. `to_day: null` e `reason: "no_slot_before_exam"` indicano un blocco senza spazio. Questi blocchi compaiono anche in `unscheduled`.

## Consegna delle simulazioni

`POST /api/sims/{sim_id}/submit` accetta `answers` e i campi facoltativi `elapsed_min` e `submission_id`. Ogni risposta può contenere `testo`, `scelta` e `immagini`. La risposta include `attempt_id`, la correzione, `foto`, `soluzioni` e `utilization`.

`submission_id` è una stringa da 1 a 128 caratteri. Il client la salva nella bozza e la riusa per ogni consegna della stessa prova. Per la coppia `(sim_id, submission_id)`, il server esegue una sola correzione alla volta e restituisce il primo esito salvato alle richieste ripetute, incluse quelle concorrenti. Se la correzione fallisce prima del salvataggio, la consegna può essere ripetuta con lo stesso ID. Le richieste prive di ID continuano a creare un tentativo a ogni invio riuscito.

## Ripasso di oggi

`GET /api/review/today` accetta `course_id`, `limit`, `offset`, `daily_new` (predefinito 10) e `daily_backlog` (predefinito 20). Le ultime due soglie ammettono valori 1–200.

La risposta include `day`, `course_id`, `cards`, `due_count`, `new_count`, `overdue_count`, `overdue_review_count` e `estimated_minutes` (tre carte al minuto, arrotondate al minuto superiore). Le carte attive già dovute sono ordinate prima per ripassi in scadenza oggi, poi per ripassi arretrati, infine per nuove. `review_bucket` identifica il gruppo (`scheduled`, `backlog`, `new`). L'arretrato complessivo comprende anche le carte nuove dovute prima di oggi.

`proposal` contiene `scheduled_today`, `backlog_today`, `new_today`, `estimated_minutes`, `remaining_backlog`, `remaining_new` e `remaining_days` stimati applicando le stesse soglie. La proposta lascia intatte le scadenze FSRS.

## Stato del sistema

`GET /api/system/status` restituisce `{checked_at, providers, login, last_sync, restic}` con header `Cache-Control: no-store`.

- `providers.local` è verificato con i controlli di salute del server locale. `providers.gemini` e `providers.claude` combinano la disponibilità della CLI con l'ultimo esito osservato, inclusi gli errori classificabili già registrati nella coda e, per Claude, lo stato della finestra Pro. Una lettura dello stato non avvia generazioni. Ogni provider espone `available` (booleano o `null` in attesa di un esito), `status`, `error` (messaggio predefinito), `checked_at` e l'eventuale `retry_at` in secondi Unix. Tra gli stati sono previsti `available`, `unverified`, `not_configured`, `subscription_rejected`, `quota_exceeded`, `login_required`, `unreachable` ed `error`.
- `login.moodle.status` e `login.panopto.status` riportano lo stato dei login salvati dopo verifiche brevi. Gli stati includono `authenticated`, `missing`, `expired`, `unreachable`, `token_only` (Moodle) e `unverified` (Panopto senza una registrazione adatta al controllo).
- `last_sync` indica l'ultima sincronizzazione Moodle registrata con `finished_at`, `course_id`, `new_files`, `updated_files` ed `error_count`. Per i dati storici può contenere il solo timestamp. Vale `null` quando la cronologia è vuota.
- `restic` indica lo stato del repository **locale**, i byte occupati dai dati restic (`repository_bytes`), lo spazio libero sul volume (`free_bytes`) e la capacità del volume (`capacity_bytes`). Le misure non disponibili valgono `null`.

Il payload contiene solo dati diagnostici ammessi e omette credenziali, token, cookie, URL dei provider e testo grezzo degli errori.

`GET /api/ai/providers` restituisce `local`, `gemini` e `claude`. Lo stato dei provider cloud deriva dalla CLI configurata e dall'ultimo esito registrato. `available` e `healthy` valgono `null` quando manca un esito. Claude include anche `utilization` e `resets_at` quando disponibili. Il server locale espone l'URL verificato o quello configurato e il modello annunciato da `/v1/models` o `/props`. Il nome del modello è in cache, con scadenza di cinque minuti per gli esiti positivi. Le richieste di diagnostica non avviano generazioni.

`GET /api/ai/pannello` espone gli stessi dati in `providers`. `cluster` mantiene lo stato usato dal pannello e riporta URL e modello del provider locale.

`GET /api/setup` segnala il login Moodle salvato usando sessione e token dal keyring o dai file di ripiego. Il controllo di primo avvio rileva la presenza delle credenziali senza contattare Moodle.

## Corsi: stato, materiali e avvisi

| Metodo e percorso | Contratto |
| --- | --- |
| `GET /api/courses`, `GET /api/courses/{id}` | Includono `stage` da `corsi.yaml` (`corrente`, `arretrato`, `futuro`, `archivio`). |
| `GET /api/study` | Ogni corso include anche `stage`, `coverage` (quota di domande provate) e `tried_items` (domande provate almeno una volta): sotto 10 la UI mostra «dati insufficienti» invece della percentuale. |
| `GET /api/courses/{id}/documents` | Restituisce `{categories, documents, next_offset}` dalla classificazione `doc_tags`, senza duplicati. Filtro facoltativo `category`. `limit` va da 0 a 500 e vale 500 per impostazione predefinita. `offset` parte da 0. `limit=0` restituisce solo i conteggi. `next_offset` vale `null` a fine elenco. `404` se il corso non esiste. |
| `GET /api/courses/{id}/announcements` | `{items: [markdown]}` con gli ultimi avvisi Moodle (dal più recente), letti da `moodle/_avvisi.md`. `last` da 1 a 30, predefinito 10. |

`categories` contiene `{category, count}` per l'intero corso anche quando `category` è impostato. Ogni documento contiene `id`, `title`, `name`, `kind`, `n_pages`, `category` ed `exam_date`. Per caricare la pagina successiva, mantieni la categoria e passa `next_offset` come `offset`.

La provenienza OCR delle unità e degli argomenti viene salvata nel database. Le richieste che usano quel materiale per generare domande, generare lezioni o ordinare gli argomenti usano il provider locale.

## Interfaccia

La radice `/` e ogni rotta non API servono la build React (`studyhub-frontend/dist`, o `STUDYHUB_UI_DIST`). La vecchia UI statica e le rotte `/legacy` e `/vendor/*` sono state ritirate. Se manca la build, le rotte dell'interfaccia rispondono `503` con una pagina che chiede di eseguire `installa.ps1`.
