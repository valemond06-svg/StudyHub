# StudyHub

StudyHub è un’app per studiare i corsi UniVR. Sincronizza materiali e registrazioni da Moodle e Panopto, trascrive le lezioni e offre ricerca, appunti, sessioni guidate, flashcard con ripasso FSRS e simulazioni d’esame. Il backend conserva dati e progressi sul computer che lo esegue. Alcune funzioni AI possono inviare contenuti ai provider indicati in [Privacy](PRIVACY.md).

## Requisiti

- Python 3.12 o superiore e uv per il backend. Su Windows `installa.ps1` installa uv se manca.
- [Node.js](https://nodejs.org/) con npm. Per la build serve Node.js 20.19+ della serie 20 oppure 22.12+. Per sviluppo e test usa Node.js 22.22.2 o una versione successiva della serie 22.
- Account UniVR e Chromium per la sincronizzazione con Moodle e Panopto.
- Spazio per materiali, registrazioni e trascrizioni. Whisper può usare CPU o GPU NVIDIA. Ollama con `bge-m3` serve per gli embedding della ricerca semantica. Le funzioni generative richiedono un provider configurato.

## Installazione e aggiornamento

Su Windows, dalla radice del repo, esegui:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\installa.ps1 -Anno 2
```

Indica il tuo anno di corso con `-Anno`. Puoi impostare la cartella dei corsi con `-Cartella` e saltare la creazione del collegamento con `-NoCollegamento`. Per aggiornare il checkout e l'installazione usa `aggiorna.bat`.

Su Linux, installa prima uv e Node.js con npm, poi esegui dalla radice:

```sh
./studyhub.sh setup
```

Per aggiornare su Linux, esegui `git pull --ff-only` e rilancia `./studyhub.sh setup`. Su entrambi i sistemi il setup sincronizza il venv in `~/.studyhub/venv`, prepara Chromium per Playwright e compila l'interfaccia React in `studyhub-frontend/dist` quando manca la build o cambiano gli input.

## Uso quotidiano

Su Windows apri il collegamento **StudyHub** sul desktop. Apre la finestra dell'app all'indirizzo `http://127.0.0.1:8765`. Puoi usare anche `start.bat` per avviare il server locale e aprire l'interfaccia nel browser. Su Linux usa `./studyhub.sh serve`. Per il primo accesso, segui il percorso di configurazione nell'app e accedi con l'account UniVR per sincronizzare i corsi.

## Avvio in sviluppo

Dal repo, prepara il backend e avvialo dal suo ambiente virtuale. Su Windows con PowerShell:

```powershell
cd backend
uv sync --locked --python 3.12
. .\.venv\Scripts\Activate.ps1
studyhub serve --no-open
```

Su Linux, dopo `uv sync`, attiva il venv con `source .venv/bin/activate` e avvia `studyhub serve --no-open`. Per usare la sincronizzazione, imposta `PLAYWRIGHT_BROWSERS_PATH` su `~/.studyhub/ms-playwright`, installa Chromium con `python -m playwright install chromium` e avvia `studyhub login` dal venv.

In un secondo terminale, dalla radice del repo:

```sh
cd studyhub-frontend
npm ci
npm run dev
```

Apri `http://localhost:5173` per usare il frontend React. Vite inoltra `/api`, `/media` e `/video` al backend sulla porta 8765.

## Test e build

| Cartella | Comandi |
| --- | --- |
| `backend/` (venv attivo) | `pytest` · `ruff check src tests` |
| `studyhub-frontend/` | `npm test` · `npm run lint` · `npm run build` |

## Struttura

| Percorso | Contenuto |
| --- | --- |
| `backend/src/studyhub/` | CLI, API FastAPI, SQLite, sincronizzazione, acquisizione e funzioni di studio |
| `backend/tests/` | Suite pytest |
| `studyhub-frontend/src/` | Pagine React, client API, componenti e test Vitest |
| `scripts/linux/` | Esempi di unità systemd per sync e turno notturno |
| `.github/workflows/` | Controlli CI |

[Architettura](ARCHITECTURE.md) · [API](API.md) · [Privacy](PRIVACY.md) · [Deployment](DEPLOYMENT.md) · [Changelog](CHANGELOG.md)
