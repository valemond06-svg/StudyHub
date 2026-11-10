"""Lezione interattiva di un argomento: il modo principale per IMPARARE (le domande servono a verificarsi).

Una chiamata (Gemini, Claude di riserva) legge il materiale dove l'argomento compare (appunti delle
lezioni, quindi anche quello che è stato detto a voce nei video, e pagine dei PDF) e lo trasforma in:
  - perché serve (aggancio con l'esame e con quello che sai già);
  - 3-7 passi brevi, ognuno con una spiegazione semplice, un'intuizione/analogia e una mini-verifica
    da fare subito (scelta multipla o vero/falso, con spiegazione della risposta);
  - un esempio svolto "a indovinare il passo dopo";
  - errori tipici e un riassunto da sapere a memoria.
Le lezioni si preparano in anticipo per i prossimi argomenti del corso (in ordine), così sono pronte
quando studi. In ogni passo puoi chiedere "spiegamelo in un altro modo" o fare una domanda libera.
"""
from __future__ import annotations

import json
import queue
import threading
from dataclasses import asdict
from datetime import datetime

from ..ai.llm import run_json
from ..db import session
from .archetype import get_course_archetype
from .bank import _unit_text

MAX_SOURCE_CHARS = 45_000

BASE_SYSTEM = """Sei il miglior docente e tutor universitario di Ingegneria (UniVR).
Insegna l'argomento in modo rigoroso, chiaro e orientato sia alla teoria d'esame sia alla pratica applicativa.

Regole tassative per la lezione:
1. "perche_md": Spiega a cosa serve concretamente l'argomento nell'ingegneria e perché è fondamentale all'esame.
2. "passi": 3-5 passi brevi, chiari, logici. Ognuno con spiegazione_md, intuizione_md (analogia o caso concreto), e verifica a risposta multipla non banale.
3. "esempio": Esempio da esame svolto passo-passo (domanda/risposta per ogni passaggio) con risultato finale chiaro.
4. "laboratorio_pratico" (FONDAMENTALE per Ingegneria):
   - "titolo": Titolo del laboratorio pratico / palestra di calcolo / analisi.
   - "software": Software o ambiente di riferimento (es. MATLAB, GCC/POSIX C, Python/OpenCV, KaTeX/Analisi).
   - "dataset": Dataset, circuito, o matrice dati di partenza.
   - "consegna_md": Descrizione precisa dell'obiettivo pratico.
   - "codice": Codice sorgente completo, commentato riga per riga, pulito ed eseguibile (o schema circuitale ASCII completo, o passaggi di dimostrazione formale).
   - "spiegazione_md": Spiegazione approfondita dei comandi chiave, della sintassi o delle regole matematiche/circuitali utilizzate.
   - "output_atteso": Output esatto della console, del terminale o verifica numerica.
   - "sfida": Esercizio sfida per lo studente con "consegna_md", "suggerimento_md" e "soluzione_codice" (codice o calcolo completo della soluzione).
5. "errori_tipici": 2-3 errori comuni commessi dagli studenti (sia concettuali sia di sintassi/calcolo).
6. "riassunto_md": Formule, teoremi e comandi chiave da ricordare a memoria."""


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
    "required": ["titolo", "perche_md", "prerequisiti", "passi", "esempio", "errori_tipici", "riassunto_md"],
    "properties": {
        "titolo": {"type": "string"},
        "perche_md": {"type": "string", "description": "2-4 frasi: a cosa serve e perché conta all'esame"},
        "prerequisiti": {"type": "array", "items": {"type": "string"}},
        "passi": {"type": "array", "items": {
            "type": "object", "additionalProperties": False,
            "required": ["titolo", "spiegazione_md", "intuizione_md", "verifica"],
            "properties": {
                "titolo": {"type": "string"},
                "spiegazione_md": {"type": "string"},
                "intuizione_md": {"type": "string"},
                "inizio_s": {"type": "number"},
                "verifica": {"type": "object", "additionalProperties": False,
                             "required": ["testo_md", "opzioni", "corretta", "spiegazione_md"],
                             "properties": {"testo_md": {"type": "string"},
                                            "opzioni": {"type": "array", "items": {"type": "string"}},
                                            "corretta": {"type": "integer", "description": "indice dell'opzione giusta"},
                                            "spiegazione_md": {"type": "string"}}}}}},
        "esempio": {"type": "object", "additionalProperties": False, "required": ["testo_md", "passi", "risultato_md"],
                    "properties": {"testo_md": {"type": "string"},
                                   "passi": {"type": "array", "items": {
                                       "type": "object", "additionalProperties": False,
                                       "required": ["domanda_md", "risposta_md"],
                                       "properties": {"domanda_md": {"type": "string"},
                                                      "risposta_md": {"type": "string"}}}},
                                   "risultato_md": {"type": "string"}}},
        "laboratorio_pratico": {
            "type": "object", "additionalProperties": False,
            "required": ["titolo", "software", "consegna_md", "codice", "spiegazione_md", "output_atteso", "sfida"],
            "properties": {
                "titolo": {"type": "string"},
                "software": {"type": "string", "description": "es. MATLAB, GNU Octave, Python, C"},
                "dataset": {"type": "string", "description": "nome dataset es. icecream_example.dat o vettore campionario"},
                "consegna_md": {"type": "string"},
                "codice": {"type": "string", "description": "script MATLAB completo ed eseguibile con commenti"},
                "spiegazione_md": {"type": "string", "description": "spiegazione dei comandi chiave e sintassi"},
                "output_atteso": {"type": "string", "description": "output testuale della command window o descrizione del grafico"},
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
        "errori_tipici": {"type": "array", "items": {
            "type": "object", "additionalProperties": False, "required": ["errore", "correzione"],
            "properties": {"errore": {"type": "string"}, "correzione": {"type": "string"}}}},
        "riassunto_md": {"type": "string", "description": "elenco puntato: cosa sapere a memoria"},
    },
}

ASK_SYSTEM = """Sei un tutor universitario paziente. Lo studente sta studiando un argomento e ti chiede qualcosa.
Rispondi in italiano, con il tu, in modo semplice e concreto (max 250 parole), con un esempio e schema visivo se aiuta.
Se la domanda riguarda circuiti (nodi, maglie, correnti, componenti), disegna sempre lo schema in ASCII o SVG.
Formule in LaTeX ($...). Basati sul contesto fornito; se serve aggiungere qualcosa che non c'è, dillo."""
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
    if data.get("laboratorio_pratico"):
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
    for p in data.get("passi", []):
        v = p.get("verifica")
        if v and "opzioni" in v and "corretta" in v and isinstance(v["opzioni"], list):
            _opts = list(v["opzioni"])
            _c = v["corretta"]
            if len(_opts) >= 2 and 0 <= _c < len(_opts):
                _val = _opts[_c]
                random.shuffle(_opts)
                v["opzioni"] = _opts
                v["corretta"] = _opts.index(_val)
    for p in data.get("passi", []):  # verifiche malformate: meglio un passo senza verifica che una sbagliata
        v = p.get("verifica") or {}
        if not (len(v.get("opzioni") or []) >= 2 and 0 <= int(v.get("corretta", -1)) < len(v["opzioni"])):
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
    return run_json(ASK_SYSTEM, text, ASK_SCHEMA, quality="veloce").data["risposta_md"]
