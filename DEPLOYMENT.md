# Deployment di StudyHub

## Windows come client

Apri l’interfaccia del PC fisso nel browser usando la connessione predisposta su rete privata. Il launcher `collega_al_fisso.bat` prova i collegamenti configurati via cavo, Wi-Fi e Tailscale sulla porta 8765. Per usare StudyHub sul solo PC Windows, `installa.ps1` prepara Python, il venv e Chromium. `start.bat` avvia l’interfaccia locale dopo l’installazione.

## PC fisso Linux come server

1. Prepara il venv da `backend/` con `uv sync --locked --python 3.12`. Installa Chromium come indicato nel [README](README.md), completa `studyhub login` ed esegui `studyhub doctor` dal venv.
2. Esegui il backend con un servizio utente systemd. Imposta la directory di lavoro e il percorso del venv. Per un server locale usa `.venv/bin/studyhub serve --no-open`, che ascolta su loopback alla porta 8765. Per l’accesso da un altro computer usa l’inoltro sulla rete privata predisposta per il server. Proteggi l’accesso a monte perché la pagina iniziale distribuisce il cookie applicativo.
3. Per il sync periodico usa il timer di esempio `studyhub-sync.timer`. Per il turno di notte usa l’unità `studyhub-notte.service` o il timer del Brain, se già configurato. I file di esempio e i comandi systemd sono in [scripts/linux](scripts/linux/README.md).

Il servizio FastAPI presenta l’interfaccia integrata. Per l’interfaccia React in sviluppo usa Vite sulla porta 5173 come descritto nel [README](README.md).

## Backup e ripristino con restic

Il DB attivo si trova per impostazione predefinita in `~/.studyhub/studyhub.db`. Il modulo `studyhub.backup` include il DB e le directory locali `ocr` e `cache` se presenti. Per includere i media con restic, specifica esplicitamente il relativo percorso. Le destinazioni previste dal modulo sono il repository Windows `D:\Backup\restic-studyhub`, un repository remoto via SFTP e, se disponibile, Google Drive tramite rclone. Su Linux imposta il repository restic adatto alla macchina.

Il wrapper legge il file password dalla directory riservata sotto la directory locale di StudyHub e applica una retention di 14 copie giornaliere, 8 settimanali e 12 mensili. Tratta i backup come dati personali.

1. Prima del backup, ferma i processi che scrivono sul DB e assicurati che le modifiche in WAL siano confluite nel file principale. Il wrapper esclude i file `.db-wal` e `.db-shm`.
2. Esegui il backup sul repository configurato e controlla esito, snapshot e integrità con `restic snapshots` e `restic check`.
3. Per il ripristino, usa `restic restore latest --target <cartella-di-ripristino>`. Verifica il database ripristinato con `studyhub.backup.verify_restore` prima di sostituire quello attivo, a servizio fermo.

## Variabili d’ambiente

| Area | Nomi |
| --- | --- |
| Server e percorsi | `PORT`, `STUDYHUB_ROOT`, `STUDYHUB_LOCAL_DIR`, `STUDYHUB_MEDIA_ROOT`, `PLAYWRIGHT_BROWSERS_PATH` |
| Autenticazione e privacy | `STUDYHUB_API_TOKEN`, `STUDYHUB_PRIVACY_MODE` |
| Modello locale | `STUDYHUB_LOCAL_LLM`, `STUDYHUB_LOCAL_LLM_KEY`, `LOCAL_LLM_API_KEY`, `STUDYHUB_LLM_MODEL`, `STUDYHUB_LOCAL_LLM_TIMEOUT` |
| Turno notturno e Whisper | `STUDYHUB_LOCAL_LLM_URL`, `STUDYHUB_WHISPER_DEVICE`, `STUDYHUB_WHISPER_BATCH` |
| Eventi Second Brain | `BRAIN_EVENT_URL`, `BRAIN_EVENT_TOKEN`, `BRAIN_EVENT_FALLBACK_URL` |
| Restic | `RESTIC_REPOSITORY`, `RESTIC_PASSWORD_FILE` |
