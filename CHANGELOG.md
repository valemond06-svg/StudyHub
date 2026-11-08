# Changelog — StudyHub

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
