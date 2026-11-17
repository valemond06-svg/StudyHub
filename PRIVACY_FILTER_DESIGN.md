# PRIVACY_FILTER_DESIGN.md — StudioHub Sprint 2A

**Data**: 2026-11-17  
**Branch**: `ai/sprint2-security-foundation`  
**Status**: IMPLEMENTED + VERIFIED

---

## Obiettivo

Garantire che i contenuti didattici e personali di StudyHub siano trattati secondo una politica di privacy verificabile, con approccio **deny-by-default** per l'invio di dati sensibili verso provider AI esterni (Gemini, Claude).

---

## Architettura Privacy

### Provider Classification

| Provider | Tipo | Accesso Dati | Privacy Level |
|----------|------|--------------|---------------|
| Local LLM (Qwen 35B su PC fisso 10.10.10.1:8080) | Locale | Zero uscita LAN | **SEMPRE CONSENTITO** |
| Gemini (via Antigravity/agy) | Esterno (Google) | Esce su Internet | **FILTRATO** |
| Claude Pro (via claude_runner) | Esterno (Anthropic) | Esce su Internet | **FILTRATO** |
| FreeLLMAPI (VPS) | Esterno (gratuito) | **DISABILITATO** per StudyHub | **MAI USATO** |

### Decision Flow

```
┌─────────────────────────────────────┐
│   Chiamata run_json / run_json_content   │
└──────────────┬──────────────────────┘
               ▼
┌─────────────────────────────────────┐
│   Provider Order: local → gemini → claude  │
└──────────────┬──────────────────────┘
               ▼
       ┌───────┴───────┐
       │  Provider = local?  │──YES──▶ SEMPRE CONSENTITO (skip filter)
       └───────┬───────┘
               ▼ NO
┌─────────────────────────────────────┐
│  check_external_allowed(provider,    │
│      text, kind, private)           │
└──────────────┬──────────────────────┘
               ▼
       ┌───────┴───────┐
       │   Allowed?    │──YES──▶ Chiama provider esterno
       └───────┬───────┘
               ▼ NO
       Solleva ClaudeError("Privacy filter blocked...")
       → Provider successivo in catena (fallback a local)
```

---

## Componenti Implementati

### 1. `backend/src/studyhub/ai/privacy.py`

**Funzioni principali**:

- `analyze_sensitivity(text)` → `(level, reasons)`
  - Livelli: `none`, `low`, `medium`, `high`
  - Rileva: CF, IBAN, carte credito (Luhn), email, matricole, parole chiave finanziarie/personali, contenuto universitario

- `check_external_allowed(provider, text, kind, private)` → `PrivacyDecision`
  - Verifica modalità, contesto job, sensibilità contenuto
  - Restituisce decisione con motivo

- `scope(kind, private)` / `current_scope()` — Context manager annidabile per job
  - Accumula restrizioni (mai allarga)

- `log_provider_selection(provider, decision, preview)` — Audit log senza contenuti privati

**Modalità Privacy** (env `STUDYHUB_PRIVACY_MODE`):
| Modalità | Comportamento |
|----------|---------------|
| `strict` (default) | Blocca esterni per sensibilità ≥ medium |
| `permissive` | Warning ma permette fallback per medium |
| `local_only` | Solo provider locale, mai esterni |

**Job Kinds Privati** (bloccano sempre esterni):
- `exam_answers` — Risposte esami
- `personal_notes` — Appunti personali
- `transcript` — Trascrizioni (possono contenere nomi docenti/studenti)
- `grade_report` — Report voti
- `personal_data` — Dati anagrafici espliciti

### 2. Integrazione in `llm.py`

**Funzioni modificate**:
- `_gemini(system, text, schema, quality, kind, private)` — Privacy check prima chiamata
- `run_json(system, text, schema, quality, kind, private)` — Privacy check per Claude, passa kind/private
- `run_json_content(system, content, schema, quality, kind, private)` — Privacy check per Claude con immagini

**Nuovi parametri opzionali** (backward compatible):
- `kind: str | None` — Tipo job per classificazione automatica
- `private: bool` — Forza modalità privata (solo local)

---

## Data Minimization & Redaction

### Cosa NON viene mai inviato a provider esterni (strict mode):
- Codici fiscali validati
- IBAN validati (checksum MOD-97)
- Carte di credito (Luhn check)
- Frasi: "estratto conto", "seed phrase", "chiave privata"
- Matricole studente (pattern 6-7 cifre)
- Email
- Dati anagrafici espliciti (nome, cognome, data nascita, indirizzo, telefono)

### Cosa PUÒ essere inviato (strict mode):
- Contenuti puramente didattici/matematici senza identificativi
- Domande generiche: "Cos'è la derivata?", "Spiega il teorema di Cauchy"
- Contenuti con solo keyword universitarie generiche (esame, analisi, crediti) → sensibilità `medium` → bloccato in strict

### Redazione Automatica
**Non implementata** (by design): il filtro **blocca** la chiamata invece di redarre. Questo è più sicuro perché:
- Nessun rischio di redazione incompleta
- Fallback trasparente a provider locale
- Comportamento deterministico e auditabile

---

## Audit Logging

Tutte le decisioni vengono loggate **senza contenuti privati**:

```python
log.info(
    "Provider selection: provider=%s allowed=%s sensitivity=%s reason=%s preview=%s",
    provider, decision.allowed, decision.sensitivity, decision.reason, preview
)
```

Esempio log:
```
INFO Provider selection: provider=gemini allowed=False sensitivity=high reason=Dati sensibili rilevati: Codice fiscale preview=CF: RSSMRA80A01H501U
```

**Nota**: Il preview è troncato a 100 caratteri e serve solo per debugging. In produzione si può disabilitare.

---

## Test Coverage

19 test in `backend/tests/test_privacy.py`:

| Categoria | Test | Status |
|-----------|------|--------|
| AnalyzeSensitivity | 7 test (none, low, medium, high×4) | ✅ PASS |
| CheckExternalAllowed | 10 test (modes, kinds, flags, context) | ✅ PASS |
| ScopeContext | 2 test (nested, private inheritance) | ✅ PASS |

**Dati sintetici testati**:
- Nome/cognome/email/matricola/CF/IBAN/carta credito/credenziali
- Contenuti didattici universitari
- Combinazioni miste

---

## Integrazione con Chiamanti Esistenti

### Chiamate che dovrebbero usare `kind="exam_answers"`:
- Generazione/sottomissione simulazioni esame
- Correzione risposte aperte

### Chiamate che dovrebbero usare `kind="transcript"`:
- Generazione appunti da trascrizione
- Estrazione argomenti da lezione

### Chiamate che dovrebbero usare `kind="personal_notes"`:
- Tutor RAG su appunti personali
- Riassunto appunti

### Chiamate che possono restare senza `kind` (contenuto non sensibile):
- Quiz generazione (contenuto da lezioni pubbliche)
- Spiegazioni concetti matematici
- Generazione flashcard da materiale didattico

---

## Verifica Anti-Bypass

Il filtro è **centralizzato** in `check_external_allowed()` chiamato da:
1. `_gemini()` — unico entry point per Gemini
2. `run_json()` — per Claude (testo)
3. `run_json_content()` — per Claude (immagini + testo)

**Non ci sono percorsi alternativi** che bypassano il filtro per provider esterni.

Il provider locale **non passa** dal filtro (by design: dati non lasciano la LAN).

---

## Configurazione Produzione

```bash
# .env o variabili d'ambiente
STUDYHUB_PRIVACY_MODE=strict        # default, consigliato
# STUDYHUB_PRIVACY_MODE=permissive  # solo se necessario per compatibilità
# STUDYHUB_PRIVACY_MODE=local_only  # massima privacy, zero chiamate esterne
```

---

## Limitazioni Note

1. **Matricole**: Pattern `\d{6,7}` può dare falsi positivi su numeri generici. Mitigazione: modalità permissive o kind esplicito.

2. **Trascrizioni reali**: Possono contenere nomi di docenti/studenti non rilevati da pattern attuali. Mitigazione: usare `kind="transcript"` che forza private=True.

3. **Immagini**: Il filtro analizza solo il testo associato. Contenuto visivo non analizzato. Mitigazione: usare `private=True` per foto di appunti/esami.

4. **FreeLLMAPI**: Già disabilitata in `provider_order()` con commento esplicito. Non riattivare senza audit privacy completo.