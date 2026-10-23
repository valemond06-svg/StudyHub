# Installazione di StudyHub guidata da Claude

Queste istruzioni sono per **Claude**: Claude Code o la scheda Code di Claude Desktop, su Windows. Le segue per installare StudyHub sul PC dello studente. Parla con lo studente in italiano e chiedigli conferma prima di installare programmi.

## Regole

- **Credenziali**: non scrivere mai password o credenziali. Il login UniVR, Google e Claude lo fa lo studente, nelle finestre che si aprono.
- **Modelli Claude**: non usare né configurare Opus. StudyHub usa solo Sonnet e Haiku, ed è già impostato così.
- **AI automatica**: non avviare elaborazioni AI di nascosto. L'elaborazione completa (passo 7) parte solo dopo che lo studente ha detto sì.
- **File dello studente**: non cancellare né sovrascrivere suoi file. Se la cartella di destinazione esiste già e non è un clone di StudyHub, chiedi cosa fare.

## Passi

1. **Requisiti.** Controlla in PowerShell:
   - `git --version`. Se manca: `winget install --id Git.Git -e`, poi riapri il terminale.
   - `claude --version`. Se manca: `irm https://claude.ai/install.ps1 | iex`.
   - `agy --version` (CLI di Antigravity, per Gemini). Se manca, cerca sulla documentazione ufficiale di Google Antigravity come installare la CLI `agy` e installala con il metodo ufficiale. È facoltativa ma consigliata: senza, StudyHub usa solo Claude.
   - GPU NVIDIA: `nvidia-smi`. Serve solo a dire allo studente se la trascrizione sarà veloce (GPU) o lenta (CPU).

2. **Domande allo studente.** Chiedi:
   - l'anno di corso attuale (1, 2, 3…);
   - se ha corsi di anni precedenti non ancora superati, per esempio «Analisi 2». Ti servono al passo 4.

3. **Scarica e installa.**

   ```powershell
   git clone https://github.com/valemond06-svg/StudyHub.git "$env:USERPROFILE\Università\_StudyHub"
   cd "$env:USERPROFILE\Università\_StudyHub"
   powershell -ExecutionPolicy Bypass -File installa.ps1 -Anno <ANNO>
   ```

   La prima volta ci vogliono 5-15 minuti, perché scarica Python, le librerie e Chromium. Lancialo con un timeout lungo o in background. Lo script:
   - crea l'icona StudyHub sul desktop;
   - registra il server MCP `studyhub` in Claude Code;
   - alla fine esegue `studyhub.bat doctor`.

4. **Corsi non superati.** Se lo studente ne ha indicati al passo 2, aggiungi a `config.yaml` una regex per ciascuno sotto `extra_active_courses`. Vedi `config.example.yaml`.

5. **Login alle AI.**
   - Se `claude` non è ancora collegato all'abbonamento Pro, chiedi allo studente di eseguire `claude` in un terminale e fare il login.
   - Lo stesso per `agy`, con il login Google AI Pro.
   - Verifica con `agy models`: tra i modelli devono esserci `gemini-3.8-flash-low` e `gemini-3.8-flash-high`. Se i nomi sono diversi, aggiorna `GEMINI_MODELS` in `backend/src/studyhub/ai/llm.py` con i modelli Flash equivalenti e dillo allo studente.

6. **Ricerca per significato (facoltativa).**
   - Se lo studente vuole: `winget install Ollama.Ollama`, poi `ollama pull bge-m3`.
   - Poi rilancia `installa.ps1 -NoCollegamento`.

7. **Primo avvio.**
   - Di' allo studente di aprire **StudyHub** dall'icona sul desktop. La sezione **Studia** mostra 3 passi:
     1. **Accedi a Moodle**: login d'ateneo nella finestra che si apre, fatto da lui;
     2. **Trova i miei corsi**;
     3. **Scarica ed elabora tutto**.
   - Dopo il passo 2, apri con lo studente `corsi.yaml` e controlla la classificazione: `anno`, `superato`, `attivo`. Correggi quello che è sbagliato.
   - Avvisalo che il passo 3 dura ore, a volte un giorno, e usa la sua finestra di 5 ore di Claude: StudyHub si ferma da solo al 70%. Se Moodle è in manutenzione, StudyHub riprova da solo ogni 10 minuti.

8. **Controllo finale.**
   - Esegui `studyhub.bat doctor` e riferisci allo studente cosa è pronto e cosa no.
   - Ricordagli che per aggiornare basta un doppio clic su `aggiorna.bat`.

## Se qualcosa va storto

- **Log del server**: `%TEMP%\studyhub-server.log`.
- **Log dell'elaborazione completa**: `%TEMP%\studyhub-fullrun.log`.
- **Comandi utili**: `studyhub.bat doctor`, `studyhub.bat courses`, `studyhub.bat serve` (avvia l'app in primo piano e mostra gli errori).
