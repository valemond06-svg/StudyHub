# StudyHub: backend

Python 3.12, pacchetto `studyhub` in `src/studyhub` (FastAPI per il server, Typer per la riga di comando). Documentazione per
l'utente, installazione e dove gira cosa: README nella cartella principale del progetto. Turno di notte e unità systemd: `../scripts/linux/README.md`.

| Modulo | Cosa fa |
|---|---|
| `sync/` | login e client Moodle, sync completo di un corso, catalogo dei corsi |
| `media/` | registrazioni (Moodle e Panopto), pipeline atomica, trascrizione Whisper in sottoprocesso con lock GPU |
| `ingest/` | lettura dei documenti, indice di ricerca, embedding (Ollama `bge-m3`) a blocchi |
| `ai/` | coda dei job (appunti solo con Sonnet, OCR), Claude e modello locale, pannello «Coda AI e turno di notte» |
| `study/` | unità di studio, banca domande, sessioni, esami, FSRS, riprese con backoff |
| `autosync.py`, `fullrun.py`, `notte.py`, `turno.py` | sync automatico, elaborazione completa, turno di notte nativo e relativo lock |
| `brain_events.py` | eventi verso il Second Brain (nessuna copia del database) |

Test (database e cartella università temporanei, mai rete, Whisper o browser veri):

```bash
cd backend && PYTHONPATH=src python -m pytest -q
```
