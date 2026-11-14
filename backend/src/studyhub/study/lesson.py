"""Lezione interattiva di un argomento: il modo principale per IMPARARE (le domande servono a verificarsi).

Una chiamata (Local LLM Qwen35B sul PC fisso, o Gemini/Claude di riserva) legge il materiale
e genera una lezione ad alto valore ingegneristico:
  - Hook & Intuizione: connessione ad applicazioni reali (Robotica, AI, Sensori) + Widget interattivo;
  - Rigore metodologico: 3-5 passi chiari, scomposizione formule, mini-verifiche;
  - Laboratorio Pratico: codice completo (.m per MATLAB, .c per POSIX C, .cir per SPICE, .py per OpenCV, .tex);
  - Profilo d'Esame UniVR: Ponte Carta e Penna, Sniper da Sbarramento, trabocchetti del docente;
  - Errori tipici e riassunto concettuale da sapere a memoria.
"""
from __future__ import annotations

import json
import queue
import threading
from dataclasses import asdict
from datetime import datetime

from ..ai.claude_runner import ClaudeError
from ..ai.llm import run_json
from ..db import session
from .archetype import get_course_archetype
from .bank import _unit_text

MAX_SOURCE_CHARS = 45_000

BASE_SYSTEM = """Sei il miglior docente di Robotica, Ingegneria e Sistemi Intelligenti e tutor universitario (UniVR).
Insegni a uno studente universitario che vuole CAPIRE DAVVERO e superare gli esami a pieni voti,
unendo rigore teorico formale, intuizione fisica e competenza pratica al calcolatore.

Insegna UN argomento partendo dal materiale del corso (appunti, trascrizioni, slide, dispense, esercitazioni).

I LIVELLI OBBLIGATORI DELLA LEZIONE:
1. ⚡ HOOK & INTUIZIONE (2 min):
   - Collega IMMEDIATAMENTE il concetto a un'applicazione concreta (robotica, droni, SLAM, filtri Kalman, circuiti, segnali, AI).
   - Definisci la configurazione per il widget interattivo dichiarativo se applicabile (linear_2d per matrici/vettori, pole_zero per sistemi/stabilità/Laplace, vector_field per gradienti/campi 2D, circuit_sim per circuiti, oppure none).
2. ⚙️ SOTTO IL COFANO (Il Rigore):
   - 3-5 passi brevi (60-120 parole), uno per idea fondamentale.
   - Scomponi le equazioni spiegando il significato fisico e geometrico dei singoli termini.
   - "intuizione_md": un'immagine mentale o analogia fisica fulminea.
   - Ogni passo ha una verifica rapida (non banale) per consolidare il concetto.
3. 🔬 LABORATORIO PRATICO AL CALCOLATORE:
   - "titolo": Titolo del laboratorio pratico / simulazione.
   - "software": Software o ambiente di riferimento (es. MATLAB, GCC/POSIX C, SPICE, Python/OpenCV, KaTeX/Analisi).
   - "dataset": Dataset o circuito di partenza.
   - "consegna_md": Descrizione precisa dell'obiettivo pratico.
   - "codice": Codice sorgente completo, commentato riga per riga, pulito ed eseguibile (o schema circuitale ASCII, o dimostrazione analitica).
   - "spiegazione_md": Spiegazione approfondita della sintassi e dei comandi chiave.
   - "output_atteso": Output esatto della console, del terminale o verifica numerica.
   - "sfida": Esercizio sfida con "consegna_md", "suggerimento_md" e "soluzione_codice".
4. 🎯 COME CADE ALL'ESAME & PONTE CARTA E PENNA (3 min):
   - "archetipo_esame": pattern ricorrente nei compiti UniVR, tranello del docente e strategia.
   - "ponte_carta_penna": micro-sfida calcolativa secca (2-3 passaggi) da fare subito a mano su foglio per allenare la mano.
   - "sniper_sbarramento": quesito insidioso su casi limite o "Caccia al Bug" in uno svolgimento finto.
5. ⚠️ ERRORI TIPICI & RIASSUNTO:
   - Errori frequenti che costano punti e formule da sapere a memoria.

Regole stilistiche:
- Dai del tu, stile incisivo, brillante, ingegneristico.
- Formule in LaTeX ($...$ e $$...$$).
- Circuiti e schemi: se riguarda circuiti elettrici o nodi/maglie, includi schemi chiari in ASCII/Unicode o SVG.
- Se nel materiale c'è il minuto della lezione (▶ mm:ss), indica "inizio_s" in secondi nei passi."""


def build_system_prompt(course_id: int, course_name: str) -> str:
    arch = get_course_archetype(course_id, course_name)
    return (
        f"{BASE_SYSTEM}\n\n"
        f"ARCHETIPO DIDATTICO ED ESAME PER QUESTO CORSO ({arch.title} - {arch.badge}):\n"
        f"{arch.system_prompt_addon}\n\n"
        f"METODOLOGIA DI STUDIO ED ESAME:\n{arch.study_methodology_md}\n\n"
        f"Rispondi ESCLUSIVAMENTE con un oggetto JSON valido conforme allo schema richiesto."
    )

SYSTEM = BASE_SYSTEM

SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": [
        "titolo", "hook_robotica_md", "widget", "passi",
        "archetipo_esame", "ponte_carta_penna", "sniper_sbarramento",
        "errori_tipici", "riassunto_md"
    ],
    "properties": {
        "titolo": {"type": "string"},
        "hook_robotica_md": {
            "type": "string",
            "description": "⚡ Hook & Intuizione (2 min): Connessione concreta con Robotica/AI/Sensori. Max 3-4 frasi incisive."
        },
        "widget": {
            "type": "object", "additionalProperties": False,
            "required": ["tipo", "titolo", "istruzioni", "config_json"],
            "properties": {
                "tipo": {"type": "string", "description": "Uno tra: linear_2d, pole_zero, vector_field, circuit_sim, none"},
                "titolo": {"type": "string"},
                "istruzioni": {"type": "string", "description": "Cosa muovere o osservare nello slider/widget"},
                "config_json": {"type": "string", "description": "JSON stringificato con parametri iniziali"}
            }
        },
        "passi": {
            "type": "array",
            "items": {
                "type": "object", "additionalProperties": False,
                "required": ["titolo", "spiegazione_md", "intuizione_md", "verifica"],
                "properties": {
                    "titolo": {"type": "string"},
                    "spiegazione_md": {"type": "string"},
                    "intuizione_md": {"type": "string"},
                    "inizio_s": {"type": "number"},
                    "verifica": {
                        "type": "object", "additionalProperties": False,
                        "required": ["testo_md", "opzioni", "corretta", "spiegazione_md"],
                        "properties": {
                            "testo_md": {"type": "string"},
                            "opzioni": {"type": "array", "items": {"type": "string"}},
                            "corretta": {"type": "integer", "description": "indice dell'opzione corretta"},
                            "spiegazione_md": {"type": "string"}
                        }
                    }
                }
            }
        },
        "laboratorio_pratico": {
            "type": "object", "additionalProperties": False,
            "required": ["titolo", "software", "consegna_md", "codice", "spiegazione_md", "output_atteso", "sfida"],
            "properties": {
                "titolo": {"type": "string"},
                "software": {"type": "string", "description": "es. MATLAB, GNU Octave, Python, GCC/POSIX C, SPICE"},
                "dataset": {"type": "string", "description": "nome dataset es. icecream_example.dat, o vettore campionario"},
                "consegna_md": {"type": "string"},
                "codice": {"type": "string", "description": "codice o schema completo ed eseguibile con commenti"},
                "spiegazione_md": {"type": "string", "description": "spiegazione dei comandi chiave e sintassi"},
                "output_atteso": {"type": "string", "description": "output testuale della console o verifica numerica"},
                "sfida": {
                    "type": "object", "additionalProperties": False,
                    "required": ["consegna_md", "suggerimento_md", "soluzione_codice"],
                    "properties": {
                        "consegna_md": {"type": "string"},
                        "suggerimento_md": {"type": "string"},
                        "soluzione_codice": {"type": "string"}
                    }
                }
            }
        },
        "archetipo_esame": {
            "type": "object", "additionalProperties": False,
            "required": ["nome_archetipo", "come_appare_all_esame_md", "trucco_del_docente_md"],
            "properties": {
                "nome_archetipo": {"type": "string", "description": "Pattern dell'esame UniVR coperto"},
                "come_appare_all_esame_md": {"type": "string", "description": "Come appare nei testi dei compiti"},
                "trucco_del_docente_md": {"type": "string", "description": "Tranello classico e strategia di risoluzione"}
            }
        },
        "ponte_carta_penna": {
            "type": "object", "additionalProperties": False,
            "required": ["sfida_testo_md", "tempo_stimato_min", "soluzione_passo_passo_md", "risultato_finale_md"],
            "properties": {
                "sfida_testo_md": {"type": "string", "description": "Micro-sfida calcolativa manuale da fare su foglio e penna (2-3 passaggi per allenare la mano)."},
                "tempo_stimato_min": {"type": "integer"},
                "soluzione_passo_passo_md": {"type": "string", "description": "Svolgimento completo per confrontare il foglio"},
                "risultato_finale_md": {"type": "string", "description": "Risultato secco di controllo"}
            }
        },
        "sniper_sbarramento": {
            "type": "object", "additionalProperties": False,
            "required": ["testo_md", "opzioni", "corretta", "perche_trabocchetto_md"],
            "properties": {
                "testo_md": {"type": "string", "description": "Quesito secco sui casi limite o Caccia al Bug in uno svolgimento errato"},
                "opzioni": {"type": "array", "items": {"type": "string"}},
                "corretta": {"type": "integer"},
                "perche_trabocchetto_md": {"type": "string", "description": "Spiegazione del trabocchetto logico"}
            }
        },
        "errori_tipici": {
            "type": "array",
            "items": {
                "type": "object", "additionalProperties": False, "required": ["errore", "correzione"],
                "properties": {"errore": {"type": "string"}, "correzione": {"type": "string"}}
            }
        },
        "riassunto_md": {"type": "string", "description": "elenco puntato: cosa sapere a memoria"}
    }
}

ASK_SYSTEM = """Sei uno Sparring Partner universitario e Senior Robotics Engineer. Lo studente ti fa una domanda mentre studia l'argomento.
REGOLE FERREE:
- MASSIMO 4-5 RIGHE per risposta. Sii ultra-incisivo, zero convenevoli, zero muri di testo.
- Spiega il nocciolo concettuale con un'analogia fisica o ingegneristica (robotica, sensori, circuiti, controlli).
- Formule essenziali in LaTeX ($...).
- Se la domanda riguarda circuiti, usa schemi circuitali ASCII/Unicode puliti.
- CONCLUDI SEMPRE la risposta con una contro-domanda progettuale o una verifica di un caso limite ("Cosa succederebbe se...?") per fargli accendere il cervello."""
ASK_SCHEMA = {"type": "object", "additionalProperties": False, "required": ["risposta_md"],
              "properties": {"risposta_md": {"type": "string"}}}


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _sources(db, topic_id: int) -> tuple[dict, str]:
    """Il materiale dove compare l'argomento, a partire dalla prima unità (in ordine di data)."""
    t = dict(db.execute("SELECT * FROM study_topics WHERE id=?", (topic_id,)).fetchone())
    units = [dict(r) for r in db.execute(
        """SELECT DISTINCT u.* FROM study_units u JOIN study_items i ON i.unit_id=u.id
           WHERE i.topic_id=? ORDER BY u.day, u.id""", (topic_id,))]
    texts, total = [], 0
    for u in units:
        try:
            text = _unit_text(db, u)[0]
        except Exception:
            continue
        texts.append(text[:MAX_SOURCE_CHARS - total])
        total += len(texts[-1])
        if total >= MAX_SOURCE_CHARS:
            break
    return t, "\n\n".join(texts)


def _passi(data: dict) -> list[dict]:
    """I passi della lezione, scartando quelli che non sono oggetti (risposta del modello malformata)."""
    passi = data.get("passi")
    if not isinstance(passi, list):
        return []
    passi[:] = [p for p in passi if isinstance(p, dict)]
    return passi


def generate(topic_id: int) -> dict:
    with session() as db:
        t, material = _sources(db, topic_id)
        course = db.execute("SELECT fullname FROM courses WHERE id=?", (t["course_id"],)).fetchone()[0]
        siblings = [r[0] for r in db.execute(
            """SELECT name FROM study_topics WHERE course_id=? AND id!=? AND hidden=0
               ORDER BY COALESCE(position, 1000000), day, id""", (t["course_id"], topic_id))]
    prompt = (f"Corso: {course}\nARGOMENTO DA INSEGNARE: {t['name']}\n\nScheda di partenza:\n{t['summary_md'] or ''}\n\n"
              f"Altri argomenti del corso (NON spiegarli qui, al massimo richiamali):\n"
              + "\n".join(f"- {s}" for s in siblings[:80])
              + f"\n\n=== Materiale del corso ===\n{material}\n\nScrivi la lezione interattiva su «{t['name']}».")
    arch = get_course_archetype(t["course_id"], course)
    sys_prompt = build_system_prompt(t["course_id"], course)
    res = run_json(sys_prompt, prompt, SCHEMA, quality="accurato")
    data = res.data
    if not isinstance(data, dict):
        raise ClaudeError("Il modello non ha restituito una lezione valida.")

    if isinstance(data.get("laboratorio_pratico"), dict):
        lab = data["laboratorio_pratico"]
        lab.setdefault("archetype_id", arch.archetype_id)
        lab.setdefault("badge", arch.badge)
        lab.setdefault("software", arch.software_default)
        lab.setdefault("file_extension", arch.file_extension)
        lab.setdefault("button_label", arch.lab_button_label)
        lab.setdefault("console_title", arch.console_title)
        lab.setdefault("code_language", arch.code_language)
        lab.setdefault("artifact_name", f"{arch.artifact_name.split('.')[0]}_{topic_id}{arch.file_extension}")

    import random
    for p in _passi(data):
        v = p.get("verifica")
        if isinstance(v, dict) and "opzioni" in v and "corretta" in v and isinstance(v["opzioni"], list):
            _opts = list(v["opzioni"])
            _c = v["corretta"]
            if len(_opts) >= 2 and isinstance(_c, int) and 0 <= _c < len(_opts):
                _val = _opts[_c]
                random.shuffle(_opts)
                v["opzioni"] = _opts
                v["corretta"] = _opts.index(_val)

    # Randomize sniper_sbarramento options if present
    sn = data.get("sniper_sbarramento")
    if isinstance(sn, dict) and "opzioni" in sn and "corretta" in sn and isinstance(sn["opzioni"], list):
        _opts = list(sn["opzioni"])
        _c = sn["corretta"]
        if len(_opts) >= 2 and isinstance(_c, int) and 0 <= _c < len(_opts):
            _val = _opts[_c]
            random.shuffle(_opts)
            sn["opzioni"] = _opts
            sn["corretta"] = _opts.index(_val)

    # Backward compatibility polyfills
    if "hook_robotica_md" in data and not data.get("perche_md"):
        data["perche_md"] = data["hook_robotica_md"]
    if not data.get("prerequisiti"):
        data["prerequisiti"] = []
    if isinstance(data.get("ponte_carta_penna"), dict) and not data.get("esempio"):
        pcp = data["ponte_carta_penna"]
        data["esempio"] = {
            "testo_md": pcp.get("sfida_testo_md", ""),
            "passi": [{"domanda_md": "Come impostare e svolgere il calcolo?", "risposta_md": pcp.get("soluzione_passo_passo_md", "")}],
            "risultato_md": pcp.get("risultato_finale_md", "")
        }
    for p in _passi(data):  # verifiche malformate: meglio un passo senza verifica che una sbagliata
        v = p.get("verifica")
        ops = v.get("opzioni") if isinstance(v, dict) else None
        c = v.get("corretta") if isinstance(v, dict) else None
        if not (isinstance(ops, list) and len(ops) >= 2 and isinstance(c, int) and not isinstance(c, bool)
                and 0 <= c < len(ops)):
            p["verifica"] = None
    with session() as db:
        db.execute("""UPDATE study_lessons SET data=?, status='pronta', provider=?, message=NULL, created_at=?
                      WHERE topic_id=?""", (json.dumps(data, ensure_ascii=False), res.model, _now(), topic_id))
    return data


# --- Coda di preparazione (un worker nel server, 2 lezioni alla volta) ---------------

_q: "queue.Queue[int]" = queue.Queue()
_workers: list[threading.Thread] = []
_wlock = threading.Lock()


def _worker() -> None:
    while True:
        tid = _q.get()
        with session() as db:
            ok = db.execute("UPDATE study_lessons SET status='in_corso' WHERE topic_id=? AND status='in_coda'",
                            (tid,)).rowcount
        if ok:
            try:
                generate(tid)
            except Exception as e:
                with session() as db:
                    db.execute("UPDATE study_lessons SET status='errore', message=? WHERE topic_id=?", (str(e)[:300], tid))
        _q.task_done()


def request(topic_ids: list[int]) -> None:
    """Mette in coda le lezioni mancanti (o finite in errore) di questi argomenti."""
    with _wlock:
        if not _workers:
            with session() as db:  # lezioni rimaste a metà da un server chiuso
                db.execute("UPDATE study_lessons SET status='in_coda' WHERE status='in_corso'")
                pending = [r[0] for r in db.execute("SELECT topic_id FROM study_lessons WHERE status='in_coda'")]
            for _ in range(2):
                th = threading.Thread(target=_worker, name="lezioni", daemon=True)
                th.start()
                _workers.append(th)
            for tid in pending:
                _q.put(tid)
    with session() as db:
        for tid in topic_ids:
            row = db.execute("SELECT status FROM study_lessons WHERE topic_id=?", (tid,)).fetchone()
            if row and row[0] in ("pronta", "in_coda", "in_corso"):
                continue
            db.execute("""INSERT INTO study_lessons (topic_id, status) VALUES (?, 'in_coda')
                          ON CONFLICT(topic_id) DO UPDATE SET status='in_coda', message=NULL""", (tid,))
            _q.put(tid)


def prefetch(course_id: int, n: int = 4) -> list[int]:
    """Prepara le lezioni dei prossimi argomenti da studiare (i primi non ancora completati, in ordine)."""
    with session() as db:
        ids = [r[0] for r in db.execute(
            """SELECT t.id FROM study_topics t LEFT JOIN study_lessons l ON l.topic_id=t.id
               WHERE t.course_id=? AND t.hidden=0 AND l.completed_at IS NULL
               ORDER BY COALESCE(t.position, 1000000), t.day, t.id LIMIT ?""", (course_id, n))]
    request(ids)
    return ids


def get(topic_id: int) -> dict:
    with session() as db:
        row = db.execute("SELECT * FROM study_lessons WHERE topic_id=?", (topic_id,)).fetchone()
        t = db.execute("SELECT id, course_id, name, weight, summary_md, lecture_id, t_start, doc_id, page "
                       "FROM study_topics WHERE id=?", (topic_id,)).fetchone()
        lec = db.execute("SELECT title FROM lectures WHERE id=?", (t["lecture_id"],)).fetchone() if t and t["lecture_id"] else None
    if not t:
        raise KeyError(topic_id)
    arch = get_course_archetype(t["course_id"])
    out = {"topic": {**dict(t), "lecture": lec[0] if lec else None}, "archetype": asdict(arch),
           "status": row["status"] if row else None,
           "message": row["message"] if row else None, "completed_at": row["completed_at"] if row else None}
    if row and row["status"] == "pronta":
        les_data = json.loads(row["data"])
        if les_data.get("laboratorio_pratico"):
            lab = les_data["laboratorio_pratico"]
            lab.setdefault("archetype_id", arch.archetype_id)
            lab.setdefault("badge", arch.badge)
            lab.setdefault("button_label", arch.lab_button_label)
            lab.setdefault("console_title", arch.console_title)
            lab.setdefault("code_language", arch.code_language)
            lab.setdefault("file_extension", arch.file_extension)
            lab.setdefault("artifact_name", f"{arch.artifact_name.split('.')[0]}_{topic_id}{arch.file_extension}")
        out["lesson"] = les_data
    return out


def complete(topic_id: int) -> None:
    with session() as db:
        db.execute("UPDATE study_lessons SET completed_at=COALESCE(completed_at, ?) WHERE topic_id=?", (_now(), topic_id))


def ask(topic_id: int, question: str, context: str = "", mode: str = "domanda") -> str:
    """Domanda libera o "spiegamelo in un altro modo" sul passo che stai leggendo (chiamata veloce)."""
    with session() as db:
        t = dict(db.execute("SELECT name, summary_md FROM study_topics WHERE id=?", (topic_id,)).fetchone())
    if mode == "altro_modo":
        question = ("Non ho capito bene questo passo. Rispiegamelo in modo diverso e più semplice: parti da un esempio "
                    "concreto con numeri, poi generalizza.")
    text = (f"Argomento: {t['name']}\nScheda:\n{t['summary_md'] or ''}\n\nPasso che lo studente sta leggendo:\n{context}\n\n"
            f"Domanda dello studente: {question}")
    data = run_json(ASK_SYSTEM, text, ASK_SCHEMA, quality="veloce").data
    risposta = data.get("risposta_md") if isinstance(data, dict) else None
    if not isinstance(risposta, str) or not risposta.strip():
        raise ClaudeError("Il modello non ha restituito una risposta valida.")
    return risposta
