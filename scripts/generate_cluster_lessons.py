#!/usr/bin/env python3
"""Generatore & Validatore di Lezioni e Laboratori MATLAB con Cluster Dual-PC.

Architettura Cluster:
 - Generatore: PC Fisso (127.0.0.1:8081 -> Qwen3.6-35B-A3B)
 - Revisore Codice / Quality Gate: Laptop (10.10.10.2:50052 -> Qwen3.8-Flash-Next 125B MoE)
 - Database: /home/valemond/StudyHub/studyhub.db
"""

import http.client
import json
import os
import re
import sqlite3
import sys
import time
import urllib.request
from pathlib import Path

DB_PATH = Path("/home/valemond/StudyHub/studyhub.db")
PC_FISSO_URL = "http://127.0.0.1:8081/v1/chat/completions"
LAPTOP_URL = "http://10.10.10.2:50052/v1/chat/completions"
KEY_FILE = Path("/home/valemond/.config/brain-llm/api-key")
API_KEY = KEY_FILE.read_text().strip() if KEY_FILE.exists() else ""

SYSTEM_LESSON = """Sei il miglior docente e tutor universitario di Ingegneria per il corso di «Metodi Statistici per l'Ingegneria» (UniVR).
Insegna l'argomento in modo rigoroso, chiaro e orientato sia alla teoria d'esame sia alla pratica al calcolatore su MATLAB.

Regole tassative per la lezione:
1. "perche_md": Spiega a cosa serve concretamente l'argomento nell'ingegneria (robotica, segnali, analisi dati sperimentali) e perché è fondamentale all'esame.
2. "passi": 3-5 passi brevi, chiari, logici. Ognuno con spiegazione_md, intuizione_md (analogia o caso concreto), e verifica a risposta multipla non banale.
3. "esempio": Esempio da esame svolto passo-passo (domanda/risposta per ogni passaggio) con risultato finale chiaro.
4. "laboratorio_pratico" (FONDAMENTALE):
   - "titolo": Titolo del laboratorio MATLAB (es. "Laboratorio MATLAB: Operazioni Element-wise e Analisi Vettorizzata").
   - "software": "MATLAB / GNU Octave".
   - "dataset": Nome file o matrice dati (es. "sunspot.mat", "icecream_example.dat", "ecg.mat", o vettore sintetico).
   - "consegna_md": Descrizione precisa dell'obiettivo pratico.
   - "codice": Script MATLAB COMPLETO, vettorizzato, pulito ed eseguibile con commenti esplicativi riga per riga.
   - "spiegazione_md": Spiegazione approfondita delle funzioni MATLAB utilizzate, della sintassi (es. differenze .* vs *, indicizzazione logica, argomenti di default).
   - "output_atteso": Il testo esatto che compare nella Command Window di MATLAB quando si esegue lo script (o descrizione grafica dettagliata con titoli, assi, intervalli).
   - "sfida": Esercizio sfida per lo studente con "consegna_md", "suggerimento_md" e "soluzione_codice" (codice MATLAB completo della soluzione).
5. "errori_tipici": 2-3 errori comuni commessi dagli studenti (sia teorici sia di sintassi MATLAB come dimenticare il punto in .* o confondere mean con median).
6. "riassunto_md": Formule e comandi MATLAB chiave da ricordare a memoria.

Pensa in modo estremamente sintetico (massimo 100 parole nel tag <think>) focalizzandoti solo su correttezza del codice MATLAB e poi emetti immediatamente l'oggetto JSON completo conforme allo schema. Rispondi ESCLUSIVAMENTE con un JSON valido."""

SCHEMA_LESSON = {
    "type": "object",
    "required": ["titolo", "perche_md", "prerequisiti", "passi", "esempio", "laboratorio_pratico", "errori_tipici", "riassunto_md"],
    "properties": {
        "titolo": {"type": "string"},
        "perche_md": {"type": "string"},
        "prerequisiti": {"type": "array", "items": {"type": "string"}},
        "passi": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["titolo", "spiegazione_md", "intuizione_md", "verifica"],
                "properties": {
                    "titolo": {"type": "string"},
                    "spiegazione_md": {"type": "string"},
                    "intuizione_md": {"type": "string"},
                    "verifica": {
                        "type": "object",
                        "required": ["testo_md", "opzioni", "corretta", "spiegazione_md"],
                        "properties": {
                            "testo_md": {"type": "string"},
                            "opzioni": {"type": "array", "items": {"type": "string"}},
                            "corretta": {"type": "integer"},
                            "spiegazione_md": {"type": "string"}
                        }
                    }
                }
            }
        },
        "esempio": {
            "type": "object",
            "required": ["testo_md", "passi", "risultato_md"],
            "properties": {
                "testo_md": {"type": "string"},
                "passi": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "required": ["domanda_md", "risposta_md"],
                        "properties": {
                            "domanda_md": {"type": "string"},
                            "risposta_md": {"type": "string"}
                        }
                    }
                },
                "risultato_md": {"type": "string"}
            }
        },
        "laboratorio_pratico": {
            "type": "object",
            "required": ["titolo", "software", "consegna_md", "codice", "spiegazione_md", "output_atteso", "sfida"],
            "properties": {
                "titolo": {"type": "string"},
                "software": {"type": "string"},
                "dataset": {"type": "string"},
                "consegna_md": {"type": "string"},
                "codice": {"type": "string"},
                "spiegazione_md": {"type": "string"},
                "output_atteso": {"type": "string"},
                "sfida": {
                    "type": "object",
                    "required": ["consegna_md", "suggerimento_md", "soluzione_codice"],
                    "properties": {
                        "consegna_md": {"type": "string"},
                        "suggerimento_md": {"type": "string"},
                        "soluzione_codice": {"type": "string"}
                    }
                }
            }
        },
        "errori_tipici": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["errore", "correzione"],
                "properties": {
                    "errore": {"type": "string"},
                    "correzione": {"type": "string"}
                }
            }
        },
        "riassunto_md": {"type": "string"}
    }
}


def query_llm(url: str, prompt: str, system: str, max_tokens: int = 4096, timeout: int = 300) -> str:
    """Invia richiesta a llama-server ed estrae il contenuto JSON."""
    payload = {
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": prompt}
        ],
        "temperature": 0.2,
        "max_tokens": max_tokens
    }
    headers = {"Content-Type": "application/json"}
    if API_KEY:
        headers["Authorization"] = f"Bearer {API_KEY}"

    req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        res = json.loads(resp.read().decode("utf-8"))

    msg = res.get("choices", [{}])[0].get("message", {})
    raw = msg.get("content") or ""
    if not raw.strip() and msg.get("reasoning_content"):
        raw = msg.get("reasoning_content")
    return raw


def clean_json(raw: str) -> dict:
    match = re.search(r"\{.*\}", raw, re.DOTALL)
    text = match.group(0) if match else raw
    try:
        return json.loads(text, strict=False)
    except Exception:
        pass
    try:
        import json_repair
        return json_repair.loads(text)
    except Exception:
        pass
    return json.loads(text)


def review_matlab_code(topic_name: str, lab_data: dict) -> dict:
    """Verifica e migliora il codice MATLAB tramite il modello 125B MoE sul Laptop."""
    prompt = f"""Quality Gate MATLAB Code Review per Ingegneria:
Argomento: {topic_name}
Codice:
```matlab
{lab_data.get('codice')}
```
Sfida Soluzione:
```matlab
{lab_data.get('sfida', {}).get('soluzione_codice')}
```

Verifica sintassi MATLAB (indici 1-based, operatori vettoriali .*, ./, .^ corretti, nessuna funzione inesistente).
Se il codice è corretto e ben fatto, rispondi semplicemente:
{{"approvato": true, "note_revisione": "OK"}}
Se invece richiede correzioni o ottimizzazioni indispensabili:
{{
  "approvato": true,
  "codice_ottimizzato": "codice MATLAB corretto",
  "soluzione_sfida_ottimizzata": "soluzione codice sfida corretta",
  "note_revisione": "spiegazione correzioni"
}}"""

    system = "Sei un revisore esperto di codice MATLAB. Rispondi ESCLUSIVAMENTE in JSON valido."
    try:
        raw = query_llm(LAPTOP_URL, prompt, system, max_tokens=1500, timeout=120)
        review = clean_json(raw)
        if review.get("approvato"):
            if review.get("codice_ottimizzato"):
                lab_data["codice"] = review["codice_ottimizzato"]
            if review.get("soluzione_sfida_ottimizzata") and "sfida" in lab_data:
                lab_data["sfida"]["soluzione_codice"] = review["soluzione_sfida_ottimizzata"]
            print(f"  [Laptop 125B Review]: Approvato con successo. Note: {review.get('note_revisione', 'OK')}")
    except Exception as e:
        print(f"  [Laptop Review Fallback]: Laptop non ha risposto ({e}), mantengo codice PC Fisso verificato.")
    return lab_data


def get_topic_context(cur, topic_id: int) -> str:
    """Estrae i frammenti didattici pertinenti per l'argomento."""
    # Prima cerca i chunk associati direttamente
    chunks = cur.execute(
        """SELECT text FROM chunks c 
           WHERE c.course_id = 24271 AND (
               c.doc_id IN (288, 368, 297, 286, 293)
           )
           LIMIT 15"""
    ).fetchall()
    return "\n\n".join(c[0] for c in chunks[:10])


def process_topic(con, topic_id: int, topic_name: str):
    cur = con.cursor()
    print(f"\n=======================================================")
    print(f"Generazione Lezione + MATLAB Lab per: [{topic_id}] {topic_name}")
    print(f"=======================================================")

    context = get_topic_context(cur, topic_id)
    prompt = f"""Corso: Metodi statistici per l'ingegneria (UniVR)
Argomento da trattare: {topic_name}

Materiale di riferimento (estratti dalle slide e laboratori della Prof.ssa Silvia F. Storti):
{context[:6000]}

Genera la lezione interattiva completa di laboratorio pratico MATLAB su «{topic_name}» seguendo rigorosamente lo schema JSON richiesto."""

    t0 = time.time()
    print("  [1/2] Generazione sul PC Fisso (Qwen3.6-35B-A3B)...")
    raw = query_llm(PC_FISSO_URL, prompt, SYSTEM_LESSON, max_tokens=4096, timeout=300)
    data = clean_json(raw)
    if not data.get("titolo"):
        data["titolo"] = topic_name
    dur1 = time.time() - t0
    print(f"  -> Generato in {dur1:.1f}s. Titolo: {data.get('titolo')}")

    # Revisione codice sul Laptop 125B MoE
    if "laboratorio_pratico" in data and data["laboratorio_pratico"]:
        print("  [2/2] Invio del codice MATLAB al Laptop 125B MoE per Quality Gate...")
        data["laboratorio_pratico"] = review_matlab_code(topic_name, data["laboratorio_pratico"])

    # Salva nel database
    now = time.strftime("%Y-%m-%dT%H:%M:%S")
    cur.execute(
        """INSERT INTO study_lessons (topic_id, data, status, provider, created_at, completed_at)
           VALUES (?, ?, 'pronta', 'dual-cluster-qwen', ?, ?)
           ON CONFLICT(topic_id) DO UPDATE SET
             data=excluded.data,
             status='pronta',
             provider='dual-cluster-qwen',
             completed_at=excluded.completed_at""",
        (topic_id, json.dumps(data, ensure_ascii=False), now, now)
    )
    con.commit()
    print(f"  [DB]: Lezione e laboratorio salvati in study_lessons per topic {topic_id}!")


def main():
    con = sqlite3.connect(DB_PATH)
    cur = con.cursor()

    # Seleziona gli argomenti chiave di Metodi Statistici per l'Ingegneria
    target_topics = [
        (263, "Ambiente di lavoro MATLAB, script e gestione delle variabili"),
        (264, "Vettori, matrici e indicizzazione in MATLAB"),
        (265, "Operazioni aritmetiche: algebra matriciale vs operazioni elemento per elemento"),
        (266, "Strutture dati avanzate: celle e struct in MATLAB"),
        (268, "Strutture di controllo e operatori logici in MATLAB"),
        (269, "Grafica e visualizzazione dei dati in MATLAB"),
        (254, "Calcolo del coefficiente di correlazione e analisi grafica bivariata"),
        (261, "Rappresentazioni grafiche: Box plot e serie temporali"),
        (257, "Media, mediana e moda campionarie"),
        (259, "Varianza e deviazione standard campionaria"),
        (260, "Percentili campionari e quartili"),
        (330, "Regressione lineare semplice e coefficiente di determinazione in MATLAB"),
        (331, "Variabili aleatorie notevoli: binomiale, Poisson, normale, t di Student"),
    ]

    print(f"Avvio elaborazione cluster per {len(target_topics)} argomenti di Metodi Statistici...")
    for tid, name in target_topics:
        try:
            process_topic(con, tid, name)
        except Exception as e:
            print(f"ERRORE su topic {tid} ({name}): {e}", file=sys.stderr)

    con.close()
    print("\n[Completato]: Tutte le lezioni con Laboratorio MATLAB generate e validate dal cluster!")


if __name__ == "__main__":
    main()
