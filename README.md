# StudyHub

StudyHub è un’app per studiare i corsi UniVR. Sincronizza materiali e registrazioni da Moodle e Panopto, trascrive le lezioni e offre ricerca, appunti, sessioni guidate, flashcard con ripasso FSRS e simulazioni d’esame. Il backend conserva dati e progressi sul computer che lo esegue. Alcune funzioni AI possono inviare contenuti ai provider indicati in [Privacy](PRIVACY.md).

## Requisiti

- Python 3.12 o superiore e uv per il backend.
- Node.js 22 (almeno 22.22.2 per la suite frontend) e npm.
- Account UniVR e Chromium per la sincronizzazione con Moodle e Panopto.
- Spazio per materiali, registrazioni e trascrizioni. Whisper può usare CPU o GPU NVIDIA. Ollama con `bge-m3` serve per gli embedding della ricerca semantica. Le funzioni generative richiedono un provider configurato.

## Avvio in sviluppo

Dal repo, prepara il backend e avvialo dal suo ambiente virtuale. Su Windows con PowerShell:

```powershell
cd backend
uv sync --locked --python 3.12
. .\.venv\Scripts\Activate.ps1
studyhub serve
```

Su Linux, dopo `uv sync`, attiva il venv con `source .venv/bin/activate`. Il backend apre l’interfaccia integrata su `http://localhost:8765`. Per usare la sincronizzazione, imposta `PLAYWRIGHT_BROWSERS_PATH` su `~/.studyhub/ms-playwright` (percorso predefinito di StudyHub), installa Chromium con `python -m playwright install chromium` e avvia `studyhub login` dal venv.

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
| `backend/` (venv attivo) | `pytest` |
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
