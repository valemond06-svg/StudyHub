# Privacy e trattamento dei dati

## Flusso dei dati

1. StudyHub autentica l’utente tramite il login UniVR in Chromium. Il profilo locale conserva la sessione usata per Moodle e Panopto. Il backend scarica materiali e registrazioni, indicizza i documenti e salva i progressi in SQLite.
2. faster-whisper trascrive in locale. Ollama calcola gli embedding e llama-server può elaborare prompt e immagini sul computer che ospita il modello locale.
3. Per le chiamate instradate da `ai/llm.py`, la catena automatica prova il modello locale se disponibile, Gemini tramite Antigravity (`agy`) se installato e Claude tramite Claude Code. Gemini via `agy` riceve testo. Claude può ricevere anche immagini convalidate. Il filtro valuta il testo associato e il contesto del job. FreeLLMAPI è disabilitato nella catena.
4. Se configurato, Second Brain riceve eventi operativi via HTTP. Gli eventi in attesa di consegna rimangono in un file JSONL nella directory locale.

## Filtro dei provider AI

`backend/src/studyhub/ai/privacy.py` usa pattern per riconoscere possibili matricole, email, riferimenti anagrafici, codici fiscali e indicatori finanziari. Il contesto può dichiarare il job privato, ad esempio per risposte d’esame, appunti personali o trascrizioni. Il filtro decide se consentire l’invio del testo, che viene trasmesso senza anonimizzazione quando consentito.

| `STUDYHUB_PRIVACY_MODE` | Comportamento in `ai/llm.py` |
| --- | --- |
| `strict` (predefinita, anche per valori sconosciuti) | Blocca i provider esterni per i job privati e per sensibilità media o alta. |
| `permissive` | Consente sensibilità media con un avviso nei log. Mantiene il blocco per alta sensibilità e per job privati. |
| `local_only` | Esclude i provider esterni nelle chiamate instradate da questo modulo. |

La modalità agisce sui flussi che passano dal filtro. Gli appunti delle lezioni e l’OCR degli arretrati chiamano direttamente il runner Claude. Questi flussi possono inviare a Claude materiale didattico, trascrizioni o immagini anche con `local_only`.

## Database, backup e log

- Il database risiede in `~/.studyhub/studyhub.db` per impostazione predefinita, fuori dal checkout e dalla cartella dei corsi. `STUDYHUB_LOCAL_DIR` cambia la directory locale, che contiene anche il profilo Chromium.
- Restic crea backup cifrati. Il modulo prevede una destinazione locale su Windows, una remota SFTP e una opzionale tramite rclone verso Google Drive. Il database operativo rimane locale. Il wrapper include le directory locali di OCR e cache se presenti. Vedi [Deployment](DEPLOYMENT.md).
- All’avvio, FastAPI installa un filtro sugli handler di logging, inclusi quelli di Uvicorn. Maschera credenziali riconoscibili (Bearer, token e chiavi API) e trascrizioni oltre 100 caratteri nei campi riconosciuti. Si applica a messaggi, eccezioni, stack trace e campi del record. La selezione del provider può registrare fino a 100 caratteri del prompt anche quando l’invio viene bloccato.
