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

`studyhub-notte.service` non ha un timer qui: in produzione il turno parte da `brain-notte.timer` del Brain, ogni notte alle 22:30,
tramite `notte.sh` (sotto). Questa unita serve solo per lanciarlo da solo, con `brain-worker` fermo e il 35B libero.

## Il turno nativo

`studyhub notte --solo-locale [--fino 04:15] [--max-unita N] [--max-trascrizioni 4] [--fine-fase-gpu 00:30]`

1. Whisper sulle lezioni gia scaricate (`media_ok`), poi indice ed embedding, fino alle 00:30;
2. scarico di Ollama dalla memoria;
3. unita di studio `nuova` col 35B (`127.0.0.1:8081`), fino all'ora limite.

Tiene `~/.studyhub/notte.lock` (`turno.NOTTE_LOCK`): un secondo turno esce subito con codice 0 e `auto-sync`
salta finche il turno gira. Esce con codice 1 se il 35B non risponde. A fine turno scrive `~/.studyhub/notte_ultimo.json`
(lo legge il pannello «Coda AI e turno di notte») e manda l'evento `studyhub.notte` al Brain.

`studyhub notte --conta` stampa in JSON il lavoro in attesa (`trascrizioni`, `unita`) senza fare nulla: `notte.sh` lo chiama per primo
e, se non c'e lavoro, esce subito senza fermare `brain-worker`.

## Come lo chiama `notte.sh` del Brain

Dopo `--conta`, la pausa di `brain-worker`, lo scarico di Ollama e l'avvio del monitor RAM
(il comando fa gia da se lo scarico di Ollama, nella fase 2):

```bash
cd $HOME/StudyHub/backend && STUDYHUB_ROOT=$HOME/StudyHub timeout 6h .venv/bin/studyhub notte --solo-locale --fino 04:15 --max-unita $MAXU
```

Il monitor RAM di `notte.sh` ferma il turno con `pkill -f "studyhub notte"`.
`notte.sh` scrive il proprio PID in `~/brain-riordino/notte.lock`: il comando nativo non lo controlla (il padre e proprio
`notte.sh`), mentre `auto-sync` lo vede ancora come turno in corso.
