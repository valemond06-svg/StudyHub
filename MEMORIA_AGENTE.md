# 🧠 Memoria Agente — StudyHub Modifiche

> **Ultimo aggiornamento**: 2026-11-09 (Antigravity)
> **Traguardo**: StudyHub 3.0 — Da "Contatore di Debiti" a "Robotics Engineering Lab" (Motori grafici dichiarativi, Lezioni a 3 livelli, Ponte Carta e Penna, Sniper da Sbarramento, Sparring Partner Socratico).

---

## 📋 Cosa è stato fatto (Nov 2026 — StudyHub 3.0)

### 🚀 1. Nuova Architettura di Lezione a 3 Livelli (`lesson.py` & `index.html`)
- **Problema**: L'app si comportava come un rigido esaminatore, basato su quiz mnemonici $A, B, C, D$ e calcoli aridi, allontanando lo studente e creando procrastinazione.
- **Risoluzione**:
  1. **⚡ 1. Hook & Laboratorio Visivo (2 min)**: Connessione immediata ad applicazioni reali di *Ingegneria dei Sistemi Robotici e Intelligenti* (droni, bracci manipolatori, SLAM, filtri Kalman, sensori) + Widget interattivo.
  2. **⚙️ 2. Sotto il Cofano (Il Rigore)**: 3-5 passi sintetici e rigorosi con scomposizione delle formule e significato fisico/geometrico dei singoli termini.
  3. **🎯 3. Come cade all'Esame & Ponte Carta e Penna (3 min)**:
     - **Archetipo d'Esame UniVR**: decodifica dei pattern ricorrenti dei docenti di Verona.
     - **Ponte Carta e Penna**: micro-sfida secca a mano libera con soluzione a scomparsa per consolidare l'automatismo procedurale sul foglio bianco.
     - **Sniper da Sbarramento**: quesito di "Caccia al Bug" o caso limite bastardo per blindare la soglia d'ammissione.

### 🧪 2. I 4 Motori Grafici Dichiarativi Pre-assemblati (`StudyHubEngines`)
Per azzerare il debito tecnico e le allucinazioni grafiche dei modelli LLM, l'LLM emette solo JSON dichiarativo e `index.html` renderizza nativamente su Canvas/SVG:
- **Engine 1: `linear_2d`** (Algebra Lineare): deformazione reticolo $\mathbb{R}^2$, basi $\hat{i}, \hat{j}$, autovettori, determinante live (area) con alert collasso dimensionale $\det=0$.
- **Engine 2: `pole_zero`** (Sistemi e Segnali): piano complesso $s = -\sigma \pm j\omega$ e risposta nel tempo $y(t)$ al gradino live con feedback di stabilità/oscillazione/crash.
- **Engine 3: `vector_field`** (Analisi 2): campi vettoriali, gradienti, evitamento ostacoli e traiettoria interattiva del robot.
- **Engine 4: `circuit_sim`** (Elettronica): operazionale invertente/non-invertente, potenziometri slider, guadagno $A_v$, calcolo $V_{out}$ e alert saturazione rails.

### 🥊 3. Sparring Partner Socratico Anti-Muro di Testo (`tutor.py` & `ASK_SYSTEM`)
- Imparato il vincolo rigido: **massimo 4-5 righe per risposta**, zero fuffa o lezioni prolisse.
- Tono da senior engineer: chiusura obbligatoria con contro-domanda progettuale o test di un caso limite.

### ⚡ 4. Pillola Eureka (2 min) nella Dashboard
- Aggiunto il pulsante per attivazione immediata a zero frizione mentale sul cruscotto del corso.
- Aggiornato Topic 85 (Algebra Lineare: Combinazioni lineari, Span e Spazio di Lavoro di un Robot) come prima lezione dimostrativa completa.

### 📱 5. StudyTok: Feed Verticale dei Micro-Concetti con Correttivi Anti-Trappola
- **Risoluzione & Correttivi applicati**:
  - Aggiunto endpoint backend `@app.get("/api/feed")` che estrae micro-card dinamiche con audio-clip al minuto esatto del docente, slide, widget interattivi e tranelli d'esame.
  - **Anti-Zapping**: di default il feed si focalizza su **una singola materia** (quella attiva), con chip rapidi numerati `[1]..[N]` e tasti `1..9` / `0` per switch istantaneo.
  - **Anti-Doomscrolling ("Dosso Artificiale")**: ogni 5 card consecutive senza svolgere un esercizio, il feed si arresta con un dosso che invita a fare una micro-sfida Carta e Penna da 3 minuti.
  - **Zero Sovraccarico Visivo**: ogni card ospita **un solo elemento visivo dominante** (*o* widget interattivo *o* slide con audio-snippet di 25s del docente), tenendo il tranello d'esame compresso dietro `Spazio`.

### 🎯 6. Nuova Modalità "Exam X-Ray" (La Radiografia degli Appelli Reali UniVR)
- **Problema**: Navigare tra decine di PDF di compiti passati genera smarrimento e ansia da ignoto.
- **Risoluzione**:
  - Aggiunta la vista `🎯 Exam X-Ray` (`v-xray`) collegata a `@app.get("/api/courses/{course_id}/exam")`.
  - Dashboard ad alto contrasto per materia con le **regole ufficiali del compito** (durata, parti, sbarramento, orale, calcolatrice) e la lista ordinata di **tutti gli Archetipi d'Esame Ricorrenti** (7 per Algebra Lineare, 9 per Elettronica, 12 per Analisi 2).
  - Ogni archetipo riporta la **frequenza negli appelli** (es. "Tutti gli appelli Parte I", "14 appelli su 16"), i punti, lo **Schema Risolutivo Passo-Passo**, i **Tranelli del Docente** e il tasto per allenarsi subito sul caso concreto.

---

## 📋 Storico Precedente

### 1. 🔀 Randomizzazione delle Risposte a Scelta Multipla (FIX CRITICO)
- **Problema rilevato dall'utente**: Nelle domande a scelta multipla e nelle verifiche dei passi, la risposta corretta tendeva ad essere sistematicamente la prima opzione ($A$ / indice $0$).
  - *Verifica statistica nel DB prima della fix*: su 994 domande in `study_items`, ben **649** avevano `correct = 0` (65%) e 225 avevano `correct = 1`! Nelle lezioni `study_lessons`, oltre il 90% delle verifiche aveva risposta $0$ o $1$.
- **Fix applicata**:
  - Script di migrazione `shuffle_all.py`: rimescolate tutte le opzioni esistenti nel database `studyhub.db` (`study_items` e `study_lessons`) e ricalcolato l'indice `correct` / `corretta` su ciascun record.
  - *Nuova distribuzione bilanciata*: `[(0, 214), (1, 240), (2, 285), (3, 255)]` per le domande e `{3: 101, 1: 83, 0: 81, 2: 73}` per le lezioni.
  - **Prevenzione per il futuro**:
    - Aggiornato `backend/src/studyhub/study/bank.py`: quando la pipeline genera nuove domande `multipla`, le opzioni vengono automaticamente rimescolate con `random.shuffle` prima del salvataggio nel DB.
    - Aggiornato `backend/src/studyhub/study/lesson.py`: quando viene generata una lezione interattiva, le opzioni di ogni `verifica` vengono automaticamente rimescolate prima del salvataggio.

---

### 2. 🖼️ Schemi Circuitali & Media Immersivi Direttamente nell'Applicazione (NO TESTO A PAROLE)
- **Problema rilevato dall'utente**: Gli schemi e le figure non erano visibili direttamente (erano nascosti dietro pulsanti toggle o spiegati solo a parole nel testo). Negli argomenti circuitali (es. Elettronica, nodi e maglie), spiegare un circuito a parole è lungo e incomprensibile.
- **Miglioramenti nell'Infrastruttura**:
  1. **Nelle Esercitazioni / Sessioni di Studio (`renderRun` in `index.html`)**:
     - `qMediaBoxHtml(q)` ora mostra la cornice `.q-visual-frame` con l'immagine della slide o lavagna d'esame **DIRETTAMENTE VISIBILE PER DEFAULT** (non più nascosta).
     - Pulsanti per ingrandire a schermo intero (`🔍 Schermo intero`) o comprimere se si desidera più spazio verticale.
     - Se la domanda è legata a una registrazione, mostra il banner immersivo `.q-video-pill` con salto diretto al minuto esatto.
  2. **Nelle Lezioni Interattive ("Impara" - `renderLesson` in `index.html`)**:
     - Intro: visualizza direttamente la slide / schema d'apertura dell'argomento.
     - Passi: ogni passo visualizza la slide del docente (`.lsn-slide-box`) con pulsante di zoom E il mini-player audio/video (`.lsn-media-player`) per ascoltare la spiegazione del docente al secondo esatto (`inizio_s`) senza lasciare la lezione!
     - Esempio: mostra lo schema circuitale in testata prima dello svolgimento guidato.
  3. **Supporto Blocchi Circuito (`md` function + CSS)**:
     - I blocchi di codice ````circuit ... ```` vengono renderizzati con la classe `.circuit-box` e `.circuit`, con tema scuro ad alto contrasto (stile terminale/CAD elettronico, colore `#38bdf8`, font monospace pulito) e badge `⚡ SCHEMA DEL CIRCUITO`.
  4. **Aggiornamento Topic 252 (Nodi, Maglie e Sovrapposizione)**:
     - Collegato alla lezione 161 (`EAD lezione 9-10-2026 Cap2`, secondo `819` / 13:39) e al documento 277 (pagg. 10, 13, 16).
     - Riscritto il contenuto della lezione con schemi circuitali ASCII chiari per:
       - Topologia della rete (nodi, rami, maglie indipendenti)
       - KCL ai nodi ($V_a, V_b, V_0$)
       - KVL alle maglie ($i_{M1}, i_{M2}$)
       - Sovrapposizione degli effetti con schemi dei sottocircuiti (generatore $j$ aperto e generatore $e$ in corto)
       - Esempio da esame numerico completo.
  5. **Aggiornati Item di Elettronica**:
     - Aggiornati i prompt degli item `4010`, `2630`, `2631` con schemi circuitali completi.

---

### 3. 🍅 Pomodoro Timer Integrato
- Timer circolare SVG con 25 min di studio e 5 min di pausa (15 min ogni 4 cicli).
- Feedback sonoro (Web Audio API) e notifiche push browser quando il tab è in background.
- Statistiche giornaliere (pomodori completati, minuti di studio, barra obiettivo 8 pomodori/giorno).
- Scorciatoie: `Spazio` (Avvia/Pausa), `R` (Reset), `S` (Salta fase).

---

## 🔮 Roadmap per Claude (Nucleod) giovedì

1. **Persistenza DB Pomodoro**: Creare tabella `study_pomodoro` in SQLite se si desidera salvare la cronologia su più dispositivi oltre al `localStorage`.
2. **Generatore SVG circuitali**: Se si desidera passare da ASCII box a veri SVG vettoriali con simboli IEEE/IEC (zigzag resistori, cerchi generatori).
3. **Estensione ad altri corsi**: Applicare lo stesso pattern di schemi visivi anche a *Sistemi e Segnali* (grafici di segnali, diagrammi a blocchi) e *Sistemi Operativi* (diagrammi di stato dei processi).

---

## 📌 Riferimenti per Elettronica
- **Cap. 2 Reti resistive DC (Prof. Petri)**: Doc ID 277.
  - Pag. 5: Elementi topologici ($r=6, n=3, m=3$)
  - Pag. 10: Metodo dei nodi
  - Pag. 13: Metodo delle maglie
  - Pag. 16: Sovrapposizione degli effetti
- **Esercitazione 26-10-2026 (Prof.ssa Barchi)**: Doc ID 821.
  - Pag. 2-4: Esercizio 1 (Nodi $V_a, V_b$)
  - Pag. 10-12: Esercizio 3 (Sovrapposizione)
- **Lezione Registrata**: ID 161, minuti [13:39], [17:43], [39:21], [41:04].
