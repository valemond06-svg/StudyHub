# StudyHub

App locale per studiare i corsi UniVR. Scarica da Moodle tutto il materiale dei tuoi corsi e trascrive le registrazioni delle lezioni (Moodle e Panopto). Poi, con Claude e Gemini, prepara:

- **Impara**: lezioni interattive in ordine di programma, a passi brevi, con verifiche immediate, un esempio d'esame da svolgere ed errori tipici.
- **Allenati**: domande su tutto il materiale fino a oggi, con ripetizione dilazionata (FSRS).
- **Prontezza**: una stima onesta per l'esame, cioè quello che hai dimostrato di sapere, non quello che hai letto.
- **Video lezioni**: player con trascrizione sincronizzata, slide e appunti AI di ogni lezione.

Tutto resta sul tuo PC. Il repository contiene solo il programma: nessun dato personale, nessun materiale dei corsi.

## Requisiti

- Windows 10 o 11, con circa 10 GB liberi (più lo spazio per i video).
- Account UniVR con accesso a Moodle (`moodledidattica.univr.it`).
- Almeno uno dei due abbonamenti AI (meglio entrambi):
  - **Google AI Pro** con **Antigravity** e la sua riga di comando `agy`: fa la maggior parte del lavoro (domande, lezioni, correzioni);
  - **Claude Pro** con **Claude Code** (`claude`): appunti delle lezioni e riserva se Gemini non risponde. Usa solo Sonnet e Haiku.
- Facoltativi:
  - scheda NVIDIA: la trascrizione è molto più veloce, ma senza funziona lo stesso su CPU;
  - [Ollama](https://ollama.com) con il modello `bge-m3`, per la ricerca per significato.

## Installazione

**Il modo più semplice**: scrivi a Claude (Claude Code o la scheda Code di Claude Desktop):

> Installa StudyHub sul mio PC seguendo le istruzioni in https://github.com/valemond06-svg/StudyHub/blob/main/SETUP_CON_CLAUDE.md

**A mano:**

1. Scarica il programma in una cartella dedicata. La cartella che contiene `_StudyHub` diventa la cartella dei corsi:

   ```powershell
   git clone https://github.com/valemond06-svg/StudyHub.git "$env:USERPROFILE\Università\_StudyHub"
   ```

2. Installa, indicando il tuo anno di corso:

   ```powershell
   cd "$env:USERPROFILE\Università\_StudyHub"
   powershell -ExecutionPolicy Bypass -File installa.ps1 -Anno 2
   ```

   Lo script installa uv, Python 3.12, le librerie e il browser per il login. Poi crea l'icona **StudyHub** sul desktop, registra il server MCP in Claude Code e controlla tutto. Puoi rilanciarlo quando vuoi.

3. Fai il login una volta nelle due AI: esegui `agy` e `claude` in un terminale.

4. Apri **StudyHub** dal desktop. La sezione **Studia** ti guida in tre passi:
   1. **Accedi a Moodle**: si apre una finestra del browser e fai il login d'ateneo. La password la scrivi solo lì.
   2. **Trova i miei corsi**: legge i corsi a cui sei iscritto. Se la classificazione per anno è sbagliata, correggila in `corsi.yaml`.
   3. **Scarica ed elabora tutto**: materiale, registrazioni, appunti e domande. Ci vogliono ore e va avanti anche se chiudi l'app.

## Uso quotidiano

- **Studia → corso → ① Impara**: la prossima lezione interattiva, nell'ordine del programma.
- **② Allenati**: sessione da 25 o 45 minuti, con ripasso di quello che stai per dimenticare, punti deboli e argomenti nuovi.
- Nella mappa degli argomenti, «escludi capitolo» toglie le parti che non porti all'esame.
- Ogni giorno alle 20 si può scaricare in automatico il materiale nuovo: `studyhub.bat schedule --time 20:00`.

## Aggiornare

Doppio clic su `aggiorna.bat`: scarica l'ultima versione e ricontrolla l'installazione. I tuoi dati non vengono toccati.

## Dove stanno i dati

| Cosa | Dove |
|---|---|
| Materiale dei corsi, trascrizioni, appunti | la cartella che contiene `_StudyHub` (es. `Università\2_Anno\...`) |
| Database (progressi, domande, lezioni) | `_StudyHub\studyhub.db` |
| Impostazioni | `_StudyHub\config.yaml`, `_StudyHub\corsi.yaml` |
| Sessione Moodle, browser, Python | `%USERPROFILE%\.studyhub` |

Tutti questi file sono esclusi da git.

## Problemi comuni

- **Controllo dell'installazione**: `studyhub.bat doctor` dice cosa manca e come sistemarlo.
- **«Login scaduto» o «Moodle non raggiungibile»**: premi «Accedi a Moodle» in Studia, o fai doppio clic su `accedi_moodle.bat`. Se Moodle è in manutenzione, l'elaborazione riprova da sola ogni 10 minuti.
- **L'app non si apre**: guarda il log in `%TEMP%\studyhub-server.log`.
- **Gemini o Claude non rispondono**: esegui `agy` o `claude` in un terminale e rifai il login.

## Uso responsabile

Il materiale dei corsi è dei docenti e di UniVR: tienilo per il tuo studio e non ridistribuirlo. StudyHub fa poche richieste a Moodle, con pause, e solo con il tuo account.
