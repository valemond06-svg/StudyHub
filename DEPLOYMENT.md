# Deployment di StudyHub

FastAPI serve l'interfaccia React alla radice `/` dalla build in `studyhub-frontend/dist`, con fallback a `index.html` per le rotte della SPA. La vecchia interfaccia statica viene ritirata. Il server Vite su porta 5173 è riservato allo sviluppo, come descritto nel [README](README.md).

## Windows

Per un'installazione locale prepara Node.js con npm ed esegui `installa.ps1`. Lo script sincronizza il venv in `%USERPROFILE%\.studyhub\venv`, installa Chromium per Playwright, prepara la build React e crea o aggiorna `StudyHub.lnk` sul desktop. Il collegamento esegue `apri_studyhub.vbs`, che avvia `studyhub.bat serve --no-open` in background e apre `http://127.0.0.1:8765` in una finestra app. `start.bat` offre anche l'avvio nel browser. Usa `aggiorna.bat` per il pull e il setup, con una nuova build quando cambiano gli input del frontend o manca la build.

Dal 27/11/2026 il server StudyHub (DB, interfaccia, Whisper su GPU) gira sul laptop Windows; il PC fisso (`100.69.165.69` su Tailscale, `10.10.10.1` sul cavo diretto) fa solo da motore AI: serve il Qwen 35B sulla porta 8080 con chiave (`LOCAL_LLM_API_KEY`). Il backend sceglie da solo il primo server sano tra i candidati di `ai/llm.py` (laptop, cavo, Tailscale, LAN); per forzarne uno usa `STUDYHUB_LOCAL_LLM` o `local_llm_url` in `config.yaml`. La sezione seguente resta valida solo se si vuole di nuovo il server sul fisso.

## PC fisso Linux come server

1. Installa uv e Node.js con npm secondo i requisiti del [README](README.md). Dalla radice del repo esegui `./studyhub.sh setup` per preparare il venv, Chromium e la build React. Completa l'accesso con `./studyhub.sh login` ed esegui `./studyhub.sh doctor`.
2. Configura un servizio utente systemd con la radice del repo come directory di lavoro e il percorso assoluto di `studyhub.sh serve --no-open` in `ExecStart`. Il server ascolta su loopback alla porta 8765. Per l'accesso remoto usa l'inoltro sulla rete privata predisposta per il server. Proteggi l'accesso a monte perché la pagina iniziale distribuisce il cookie applicativo.
3. Per il sync periodico usa il timer di esempio `studyhub-sync.timer`. Per il turno di notte usa l'unità `studyhub-notte.service` o il timer del Brain, se già configurato. Nei file di esempio sostituisci il venv `backend/.venv` con `~/.studyhub/venv` se hai usato il percorso predefinito del setup. I file e i comandi systemd sono in [scripts/linux](scripts/linux/README.md).
4. Per aggiornare il server, esegui `git pull --ff-only` e `./studyhub.sh setup` dalla radice del repo. Riavvia il servizio dopo che il setup è terminato con successo.

## Backup e ripristino con restic

Il DB attivo si trova per impostazione predefinita in `~/.studyhub/studyhub.db`. Il modulo `studyhub.backup` include il DB e le directory locali `ocr` e `cache` se presenti. Per includere i media con restic, specifica esplicitamente il relativo percorso. Le destinazioni previste dal modulo sono il repository Windows `D:\Backup\restic-studyhub`, un repository remoto via SFTP e, se disponibile, Google Drive tramite rclone. Su Linux imposta il repository restic adatto alla macchina.

Il wrapper legge il file password dalla directory riservata sotto la directory locale di StudyHub e applica una retention di 14 copie giornaliere, 8 settimanali e 12 mensili. Tratta i backup come dati personali.

1. Per il backup del DB attivo, usa il wrapper `studyhub.backup`. Crea uno snapshot coerente tramite SQLite prima di passarlo a restic.
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
