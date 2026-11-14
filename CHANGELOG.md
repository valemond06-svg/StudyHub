# Changelog — StudyHub

## 2026-11-14 — P1 e P2: coda arretrati, turno di notte nativo, eventi al Brain

**P1** (su main, merge `2ae4539`)
- **P1.1 appunti solo con Sonnet**: arretrati in coda da soli (`claude_backlog`), prima i corsi «corrente»; partono solo sotto la soglia
  `claude_backlog_stop_at` (70% della finestra Pro). Il 35B non scrive più gli appunti: solo domande ed esercizi a valle.
- **P1.2 `studyhub notte --solo-locale`**: Whisper/embedding, scarico di Ollama, unità col 35B; `turno.NOTTE_LOCK` tiene fuori `auto-sync`.
  `studyhub notte --conta` stampa in JSON il lavoro in attesa: `notte.sh` esce subito se non c'è niente da fare.
- **P1.3 riprese con backoff**: lezioni in errore e unità vuote/in errore tornano in coda dopo 1 h, 6 h, 24 h (3 riprese al massimo).
- **P1.4 OCR in coda**: i PDF scansionati entrano nella coda AI con priorità sotto le lezioni; dopo l'OCR nascono le unità di studio.
- **P1.5 embedding a blocchi**: il lock GPU si libera tra un blocco e l'altro; il lavoro già fatto resta salvato.

**P2** (ramo `ai/studyhub-p2-20261114`)
- **P2.1 eventi al Brain**: tolti `brain_export`, `brain-export` e la copia del DB su Drive. Nuovo `brain_events.send` (solo libreria standard,
  mai eccezioni, coda locale di 200 righe): eventi `studyhub.sync`, `studyhub.notte`, `studyhub.ai_job_fallito`.
- **P2.2 correzione da foto nelle sessioni di studio**: `POST /api/study/sessions/{sid}/photo`; l'esito entra in `study_attempts` (FSRS, XP, padronanza).
- **P2.3 pannello «Coda AI e turno di notte»**: `/api/ai/pannello` e `notte_ultimo.json` scritto a fine turno; UI nella vista Oggi.
- **P2.4 test e documentazione**: 51 test nuovi (sync Moodle, `autosync.run`, `fullrun`, trascrizione, pipeline delle lezioni), suite a 452.
  **Fix**: `fullrun.is_running` su Linux diceva sempre «non in corso» (`os.remove` riesce anche su un file aperto), quindi un secondo
  `elabora-tutto` partiva sopra il primo; ora usa `file_lock`. README (radice e backend) e docstring allineati: StudyHub gira sul fisso Linux,
  Windows è un client.

## 2026-11-12 (secondo giro) — foto nella correzione, chiave, riparazione crocette

- **Foto dei compiti**: `exam.grade_sim` allega le foto (1600 px, JPEG, max 6) a un server locale con vista o a Claude;
  senza vista la correzione avviene sul solo testo e lo dice chiaramente (campo `foto` e avviso nel commento).
- **Chiave del modello locale fuori dal codice**: STUDYHUB_LOCAL_LLM_KEY, config, LOCAL_LLM_API_KEY, file
  ~/.config/brain-llm/api-key. **ATTENZIONE: la vecchia chiave resta nella storia di git e va ruotata
  (decisione di Valentino).**
- **`studyhub ripara-crocette`**: elenca le unità preparate senza domande a scelta multipla; con `--applica` backup
  del DB e rimessa in coda. **`ai/jobs.py`**: l'indicizzazione fallita non trasforma più il job in errore.

## 2026-11-12 — Notte di lavoro: test, modello locale, diagnostica

- **Test**: prima suite pytest (`cd backend && uv run pytest`): schema DB, FSRS, padronanza, piano, banca domande,
  sessioni di studio, quiz, esami, ricerca, chunking, modello locale, doctor, smoke test degli endpoint. Database
  temporanei, nessuna rete.
- **Fix**: le domande a scelta multipla non venivano più salvate in `bank._store` (un `continue` rimasto dopo lo
  shuffle del 27/10): le unità preparate da allora non hanno crocette e vanno rigenerate. I capitoli esclusi
  (`hidden=2`) facevano cadere `build_queue`. Endpoint con id inesistente: 404 invece di 500. Indice domanda
  negativo in sessione. Ricerca senza archivio vettoriale. Risposta senza JSON dal modello locale.
- **Modello locale** (`ai/llm.py`): candidati in ordine (questa macchina, cavo, Tailscale, LAN), controllo di salute
  in parallelo con timeout 1 s, cache 5 minuti invalidata sull'errore, ripiego sul server successivo se uno cade a
  metà, `model: "local"` per il router Windows.
- **Diagnostica**: `studyhub doctor` e `/api/setup` controllano database, modello locale, ffmpeg e cartelle dei corsi.

## 2026-10-27 — Aggiornamento v2.3 (Randomizzazione Risposte & Schemi Immersivi)

### 🔀 Risoluzione Bias Opzioni Multiple (FIX CRITICO)
- **Randomizzazione globale delle risposte**:
  - Nel database, su 994 domande esistenti, il 65% aveva la prima opzione come corretta per via del formato di generazione dei modelli LLM.
  - Eseguito script di rimescolamento `shuffle_all.py` che ha redistribuito uniformemente le opzioni su tutte le domande del DB: nuova distribuzione bilanciata `[214, 240, 285, 255]`.
  - Stesso rimescolamento applicato a tutte le verifiche delle lezioni interattive (`study_lessons`).
  - Aggiornati `bank.py` e `lesson.py` con shuffling automatico (`random.shuffle`) durante l'ingestione e la generazione di nuovo materiale.

### 🖼️ Studio Immersivo: Schemi e Video Visibili Direttamente
- **Schemi e figure d'esame direttamente visibili**:
  - Nelle sessioni e negli esercizi (`renderRun`), lo schema o la pagina del documento non è più nascosto dietro un pulsante, ma è **visibile per default** in una cornice dedicata `.q-visual-frame` ad alta leggibilità, con pulsante di zoom a schermo intero.
  - Aggiunto banner interattivo per le lezioni video (`.q-video-pill`) con collegamento diretto al minuto esatto in cui il docente spiega l'esercizio.
- **Supporto Blocchi Circuito (`circuit`)**:
  - Supporto per blocchi di codice ````circuit ... ```` che vengono formattati automaticamente come schemi circuitali ad alto contrasto (sfondo notte, testo azzurro `#38bdf8`, badge identificativo).
- **Lezioni Interattive ("Impara") Immersive**:
  - Ogni passo della lezione ora include direttamente la slide ufficiale del corso (`.lsn-slide-box`) e il mini-player audio/video (`.lsn-media-player`) per ascoltare la spiegazione del docente al secondo esatto (`inizio_s`) senza lasciare la pagina.
  - Aggiornata la lezione su *Metodi di analisi delle reti lineari: nodi, maglie e sovrapposizione* (Topic 252) con schemi grafici per ogni passo ed esercizio.

### 🍅 Pomodoro Timer & Interattività
- Pomodoro timer con cicli 25m/5m/15m, Web Audio API, notifiche browser, scorciatoie tastiera (`Spazio`, `R`, `S`).
- Sistema di notifiche toast (`toast()`) ed effetti visivi di hover su tutta l'interfaccia.

### 📝 Documentazione
- Aggiornato `MEMORIA_AGENTE.md` con tutti i dettagli per la ripresa del lavoro da parte di Claude giovedì.
