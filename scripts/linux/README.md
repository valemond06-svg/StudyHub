# Unit systemd di esempio (PC fisso, Linux)

Esempi versionati: non vengono installati da nessuno script. I percorsi usano `%h` (home) e il venv
`~/StudyHub/backend/.venv` (lo stesso del sync attuale); `studyhub.sh` non va bene di notte perche
fa `uv sync` e puo toccare la rete.

## Installazione (a mano)

```bash
mkdir -p ~/.config/systemd/user
cp studyhub-notte.service studyhub-sync.service studyhub-sync.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now studyhub-sync.timer      # sync alle 06:15
# il turno di notte parte dal wrapper del Brain (sotto) o a mano:
systemctl --user start studyhub-notte.service
```

`studyhub-notte.service` non ha un timer: ha senso solo se il 35B e libero e `brain-worker` e fermo.
Se vuoi usarlo da solo, aggiungi un timer che lo avvii alle 22:30.

## Il turno nativo

`studyhub notte --solo-locale [--fino 04:15] [--max-unita N] [--max-trascrizioni 4] [--fine-fase-gpu 00:30]`

1. Whisper sulle lezioni gia scaricate (`media_ok`), poi indice ed embedding, fino alle 00:30;
2. scarico di Ollama dalla memoria;
3. unita di studio `nuova` col 35B (`127.0.0.1:8081`), fino all'ora limite.

Tiene `~/.studyhub/notte.lock` (`turno.NOTTE_LOCK`): un secondo turno esce subito con codice 0 e `auto-sync`
salta finche il turno gira. Esce con codice 1 se il 35B non risponde.

## Come lo chiama `notte.sh` del Brain

Al posto di `studyhub_locale.py` (dopo la pausa di `brain-worker`, lo scarico di Ollama e l'avvio del monitor RAM;
questi ultimi due passaggi li fa gia il comando, lo scarico di Ollama nella fase 2):

```bash
cd $HOME/StudyHub/backend && STUDYHUB_ROOT=$HOME/StudyHub timeout 6h .venv/bin/studyhub notte --solo-locale --fino 04:15 --max-unita $MAXU
```

Il monitor RAM di `notte.sh` puo continuare a fare `pkill -f "studyhub notte"` al posto del vecchio nome dello script.
`notte.sh` scrive il proprio PID in `~/brain-riordino/notte.lock`: il comando nativo non lo controlla (il padre e proprio
`notte.sh`), mentre `auto-sync` lo vede ancora come turno in corso.
