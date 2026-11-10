"""Sistema Adattivo Multi-Corso per StudyHub.

Definisce i profili didattici, la strategia di preparazione all'esame, la modalità di laboratorio pratico
e le regole di ingestione da Moodle specifiche per ciascun insegnamento universitario.
"""
from __future__ import annotations

import re
from dataclasses import asdict, dataclass


@dataclass
class CourseArchetype:
    archetype_id: str
    title: str
    badge: str
    accent_color: str
    software_default: str
    file_extension: str
    artifact_name: str
    mime_type: str
    lab_section_title: str
    lab_button_label: str
    console_title: str
    code_language: str
    exam_format_summary: str
    study_methodology_md: str
    moodle_download_priorities: list[str]
    moodle_ignored_patterns: list[str]
    system_prompt_addon: str


ARCHETYPES: dict[str, CourseArchetype] = {
    "NUMERICAL_LAB": CourseArchetype(
        archetype_id="NUMERICAL_LAB",
        title="Laboratorio Computazionale & Statistica",
        badge="🔬 Laboratorio MATLAB / Octave",
        accent_color="#00bcd4",  # Cyan
        software_default="MATLAB / GNU Octave",
        file_extension=".m",
        artifact_name="script_laboratorio.m",
        mime_type="text/x-matlab",
        lab_section_title="Laboratorio Pratico MATLAB / Analisi Dati",
        lab_button_label="Scarica Script (.m)",
        console_title="Command Window di MATLAB (Simulazione)",
        code_language="matlab",
        exam_format_summary="Prova scritta al calcolatore con dataset reali (.dat/.mat) e quesiti teorico-numerici di probabilità e statistica inferenziale (test d'ipotesi, regressione, IC, ANOVA).",
        study_methodology_md="""1. **Vettorizzazione**: Mai usare cicli `for` lenti; usare indicizzazione logica e operatori element-wise (`.*`, `./`, `.^`).
2. **Interpretazione Numerica & Grafica**: Collegare ogni grafico (`histogram`, `boxplot`, `scatter`) alle grandezze numeriche (mediana, quartili, p-value).
3. **Formule d'Esame**: Ricordare la correzione al denominatore $n-1$ per la varianza campionaria e la scelta tra distribuzione $Z$ (varianza nota) e $t$ di Student (varianza incognita).""",
        moodle_download_priorities=[
            "Fogli di laboratorio (Lab1, Lab2, ...)",
            "Dataset reali (.mat, .dat, .csv)",
            "Codici .m ed esempi forniti dal docente",
            "Temi d'esame passati e relative soluzioni numeriche",
            "Compiti per casa (HW / homework) con correzioni"
        ],
        moodle_ignored_patterns=[
            r"assemblea studenti", r"internazionalizzazione", r"avvisi organizzativi", r"\bzoom\b"
        ],
        system_prompt_addon="""Per questo corso di «Statistica Computazionale & MATLAB»:
- La sezione "laboratorio_pratico" deve contenere codice MATLAB pulito, vettorizzato ed eseguibile.
- Mostra sempre l'output esatto atteso nella Command Window di MATLAB (con valori numerici realistici).
- Proponi una sfida pratica sul dataset indicato (es. calcolo intervalli di confidenza, filtraggio dati o stima di parametri)."""
    ),

    "CIRCUIT_ELECTRONICS": CourseArchetype(
        archetype_id="CIRCUIT_ELECTRONICS",
        title="Elettronica Circuitale & Hardware",
        badge="⚡ Analisi Circuitale & Piccolo Segnale",
        accent_color="#f59e0b",  # Amber
        software_default="Analizzatore Circuitale / SPICE",
        file_extension=".cir",
        artifact_name="circuito.cir",
        mime_type="text/plain",
        lab_section_title="Laboratorio Circuitale: Punto di Lavoro & Piccolo Segnale",
        lab_button_label="Scarica Netlist / Schema (.cir)",
        console_title="Verifica Punti di Lavoro e Risoluzione Nodi/Maglie",
        code_language="circuit",
        exam_format_summary="Prova scritta impegnativa con risoluzione di circuiti con amplificatori operazionali, transistor BJT e MOSFET (regioni ON/OFF, triodo, saturazione), seguita da domande teoriche e diagrammi di Bode.",
        study_methodology_md="""1. **Verifica della Regione di Lavoro**: Prima calcola il punto di lavoro DC ($Q$), poi verifica SEMPRE l'ipotesi (es. $V_{CE} > V_{CE,sat}$ per BJT in zona attiva, $V_{DS} \\ge V_{GS} - V_{th}$ per MOSFET in saturazione).
2. **Modello per Piccolo Segnale**: Spegni i generatori DC, sostituisci transistor con modelli a parametri ibridi ($r_\\pi, g_m v_{be}$ o $g_m v_{gs}, r_o$) e applica partitori e KCL/KVL.
3. **Diagrammi di Bode**: Identifica poli e zeri, calcola frequenze di taglio a -3dB e guadagno in banda passante.""",
        moodle_download_priorities=[
            "Temi d'esame con risoluzione circuitale completa",
            "Esercizi di autovalutazione e fogli di esercizi svolti",
            "Schemi circuitali di laboratorio e netlist SPICE",
            "Appunti delle lezioni con passaggi dettagliati sui transistor",
            "Formulari e tabelle delle formule d'esame"
        ],
        moodle_ignored_patterns=[
            r"esiti compit", r"avvisi d'aula", r"turni di laboratorio"
        ],
        system_prompt_addon="""Per questo corso di «Elettronica Analogica e Digitale»:
- La sezione "laboratorio_pratico" deve includere SEMPRE:
  1. Uno schema circuitale chiaro in ASCII/Unicode con nodi etichettati [IN], [OUT], [VCC], [GND], [B], [C], [E].
  2. Tabella di polarizzazione (stato ipotizzato dei componenti attivi: diodi, BJT, MOS).
  3. Risoluzione passo-passo con KCL ai nodi o KVL alle maglie, con valori numerici reali (resistenze in kΩ, correnti in mA/μA).
  4. Verifica numerica dell'ipotesi iniziale e calcolo del guadagno di tensione $A_v = v_{out}/v_{in}$ o della resistenza d'ingresso/uscita."""
    ),

    "SYSTEMS_PROGRAMMING": CourseArchetype(
        archetype_id="SYSTEMS_PROGRAMMING",
        title="Sistemi Operativi & Concorrenza POSIX",
        badge="💻 Programmazione Concorrente in C (POSIX)",
        accent_color="#10b981",  # Emerald Green
        software_default="GCC / Linux POSIX C",
        file_extension=".c",
        artifact_name="concurrency_lab.c",
        mime_type="text/x-csrc",
        lab_section_title="Laboratorio di Sistema: Processi, Thread & Sincronizzazione in C",
        lab_button_label="Scarica Codice C (.c)",
        console_title="Terminale Bash: Compilazione & Traccia Esecuzione (PID / Thread)",
        code_language="c",
        exam_format_summary="Prova scritta con esercizi di programmazione concorrente in C (fork, pipe, pthread, semafori, mutex) con gestione degli errori (`perror`), affiancata da teoria su memoria virtuale (paginazione, TLB) e scheduling.",
        study_methodology_md="""1. **Controllo Errori Tassativo**: Ogni `fork()`, `pthread_create()`, `pipe()`, `malloc()` deve SEMPRE controllare il valore di ritorno (`if (pid < 0) { perror(\"...\"); exit(1); }`).
2. **Deadlock & Race Condition**: Identificare sezioni critiche, garantire ordine coerente di acquisizione dei lock ed evitare race condition tra thread e processi.
3. **Paginazione & TLB**: Calcolare dimensione pagine, numero di bit per offset e page number, e tempi effettivi di accesso alla memoria (EAT).""",
        moodle_download_priorities=[
            "Temi d'esame con tracce di programmazione C e soluzioni",
            "Slide su pthread, mutex, semafori, fork ed exec",
            "Esercizi di laboratorio svolti (.c, .h, Makefile)",
            "Guide ed esempi sulle syscall Linux"
        ],
        moodle_ignored_patterns=[
            r"calendario lezioni", r"avvisi ricevimento", r"orari tutorato"
        ],
        system_prompt_addon="""Per questo corso di «Sistemi Operativi»:
- La sezione "laboratorio_pratico" deve contenere codice C completo, rigoroso e compilabile senza warning (`#include <stdio.h>`, `<stdlib.h>`, `<pthread.h>`, `<unistd.h>`).
- Includi sempre i comandi esatti di compilazione (`gcc -Wall -Wextra -pthread file.c -o app && ./app`).
- Mostra l'output atteso della console simulata con i PID/TID dei processi/thread in esecuzione.
- Proponi una sfida pratica di sincronizzazione (es. produttore/consumatore, barriera, o gestione corretta di pipe tra processi)."""
    ),

    "RIGOROUS_MATH": CourseArchetype(
        archetype_id="RIGOROUS_MATH",
        title="Metodi Matematici & Analisi Rigorosa",
        badge="📐 Dimostrazione Formale & Calcolo Analitico",
        accent_color="#8b5cf6",  # Violet
        software_default="KaTeX / Calcolo Simbolico SymPy",
        file_extension=".tex",
        artifact_name="dimostrazione_e_calcolo.tex",
        mime_type="text/x-tex",
        lab_section_title="Palestra di Dimostrazione & Calcolo Formale",
        lab_button_label="Scarica Trascrizione TeX (.tex)",
        console_title="Verifica Formale delle Ipotesi & Controesempi",
        code_language="math",
        exam_format_summary="Prova scritta con esercizi analitici completi (integrali complessi, serie di Fourier, residui di Cauchy, trasformate di Laplace/Z) con richiesta di giustificazione teorica per ogni passaggio.",
        study_methodology_md="""1. **Verifica delle Ipotesi dei Teoremi**: Non applicare mai un teorema (es. Cauchy-Goursat, Jordan, Fubini-Tonelli) senza prima aver esplicitato le ipotesi (semplicemente connesso, olomorfo, convergenza uniforme).
2. **Calcolo dei Residui**: Scomporre le singolarità, determinarne l'ordine e applicare la formula corretta per i poli di ordine $m \\ge 1$.
3. **Controesempi Tipici**: Conoscere a memoria i casi in cui l'inversione di limiti o l'applicazione incauta di formule fallisce.""",
        moodle_download_priorities=[
            "Temi d'esame risolti con tutti i passaggi analitici",
            "Diario delle lezioni e programma ufficiale dettagliato",
            "Esercitazioni settimanali con svolgimento",
            "Approfondimenti teorici su primitive, olomorfia e residui"
        ],
        moodle_ignored_patterns=[
            r"avvisi", r"assemblea", r"ricevimento"
        ],
        system_prompt_addon="""Per questo corso di «Applicazioni e Metodi Matematici / Analisi»:
- La sezione "laboratorio_pratico" diventa la «Palestra di Dimostrazione & Calcolo Formale».
- Invece di semplice codice, fornisci una derivazione analitica passo-passo in KaTeX:
  1. Enunciato del problema d'esame.
  2. Verifica preliminare delle condizioni di applicabilità (dominio, olomorfia, convergenza).
  3. Passaggi intermedi espliciti senza salti logici.
  4. Analisi di un errore subdolo o controesempio classico da evitare all'esame.
  5. Sfida analitica con soluzione dettagliata a scomparsa."""
    ),

    "COMPUTER_VISION": CourseArchetype(
        archetype_id="COMPUTER_VISION",
        title="Visione Artificiale & Image Processing",
        badge="👁️ Pipeline di Computer Vision & OpenCV",
        accent_color="#06b6d4",  # Cyan Blue
        software_default="Python 3 / OpenCV / NumPy",
        file_extension=".py",
        artifact_name="cv_pipeline.py",
        mime_type="text/x-python",
        lab_section_title="Laboratorio di Computer Vision: Filtri & Feature Extraction",
        lab_button_label="Scarica Script Python (.py)",
        console_title="Output di Elaborazione Immagine & Matrici Kernel",
        code_language="python",
        exam_format_summary="Esame teorico-pratico su convoluzioni, trasformazioni geometriche (omografie, matrici affini), operatori di bordo (Canny, Sobel), feature matching (Harris, SIFT) e geometria epipolare.",
        study_methodology_md="""1. **Convoluzione Spaziale**: Comprendere l'effetto dei pesi del kernel (somma 1 = normalizzato, somma 0 = derivativo/bordo).
2. **Matrici di Trasformazione**: Padroneggiare le coordinate omogenee e la moltiplicazione di matrici 3x3 per rototraslazioni e proiezioni.
3. **Invarianza**: Sapere quali descrittori sono invarianti a scala, rotazione, illuminazione o affinità.""",
        moodle_download_priorities=[
            "Slide delle lezioni e dispense teoriche",
            "Script Python di laboratorio con OpenCV",
            "Esercizi numerici su filtri, matrici e convoluzioni",
            "Temi d'esame e domande tipiche di teoria"
        ],
        moodle_ignored_patterns=[
            r"avvisi", r"link zoom", r"orari"
        ],
        system_prompt_addon="""Per questo corso di «Visione Artificiale»:
- La sezione "laboratorio_pratico" deve contenere codice Python/NumPy/OpenCV pulito ed eseguibile.
- Mostra sempre la matrice del kernel (es. Sobel 3x3, Gaussiano) e spiega il calcolo dei gradienti $G_x, G_y$ e del modulo $\\sqrt{G_x^2 + G_y^2}$.
- Mostra la spiegazione dell'output visivo atteso e una sfida di elaborazione dell'immagine."""
    ),

    "ELECTROMAGNETIC_PHYSICS": CourseArchetype(
        archetype_id="ELECTROMAGNETIC_PHYSICS",
        title="Elettromagnetismo & Ottica Fisica",
        badge="🧲 Campi Elettromagnetici & Onde",
        accent_color="#ef4444",  # Red
        software_default="Analisi Vettoriale & Simulazione Campi",
        file_extension=".m",
        artifact_name="campi_elettromagnetici.m",
        mime_type="text/x-matlab",
        lab_section_title="Laboratorio Campi & Flussi: Analisi Vettoriale e Onde",
        lab_button_label="Scarica Script Analisi (.m)",
        console_title="Verifica Flusso, Circuitazione e Condizioni al Contorno",
        code_language="matlab",
        exam_format_summary="Prova scritta articolata in problemi di elettrostatica, magnetostatica, induzione elettromagnetica (legge di Faraday-Neumann-Lenz), circuiti AC e ottica geometrica/ondulatoria.",
        study_methodology_md="""1. **Simmetria e Superfici Gaussiane**: Scegliere sempre superfici o linee chiuse che sfruttano la simmetria del sistema per estrarre il campo dall'integrale.
2. **Condizioni al Contorno**: Ricordare la continuità della componente tangenziale di $\\vec{E}$ e della componente normale di $\\vec{B}$.
3. **Analisi Dimensionale**: Verificare sempre le unità di misura (Tesla, Weber, Volt/metro, Farad) alla fine di ogni problema.""",
        moodle_download_priorities=[
            "Temi d'esame completi di tutti gli appelli degli ultimi 3 anni",
            "Formulari ufficiali approvati per la consultazione durante l'esame",
            "Esercizi su induzione, onde piane e dielettrici con soluzioni",
            "Dispense teoriche sulle equazioni di Maxwell"
        ],
        moodle_ignored_patterns=[
            r"avvisi generici", r"risultati", r"esiti"
        ],
        system_prompt_addon="""Per questo corso di «Elettromagnetismo e Ottica»:
- La sezione "laboratorio_pratico" deve concentrarsi sul calcolo analitico e vettoriale:
  1. Definizione della geometria e delle simmetrie del sistema.
  2. Scelta rigorosa della linea di circuitazione o della superficie di Gauss.
  3. Calcolo dell'integrale di flusso o circuitazione con passaggi espliciti.
  4. Script MATLAB / Octave per tracciare l'andamento del campo in funzione della distanza $r$ o del tempo $t$.
  5. Sfida con soluzione e verifica dimensionale delle unità di misura."""
    )
}

COURSE_ARCHETYPE_MAP: dict[int, str] = {
    24271: "NUMERICAL_LAB",         # Metodi Statistici per l'Ingegneria
    24525: "NUMERICAL_LAB",         # Sistemi e Segnali con laboratorio
    25706: "CIRCUIT_ELECTRONICS",   # Elettronica analogica e digitale
    -117245374: "CIRCUIT_ELECTRONICS", # Architettura e Reti Logiche
    25713: "SYSTEMS_PROGRAMMING",   # Sistemi operativi
    -276948059: "SYSTEMS_PROGRAMMING", # Programmazione
    22822: "SYSTEMS_PROGRAMMING",   # Smart Contract Ethereum
    25782: "RIGOROUS_MATH",         # Applicazioni e metodi matematici
    21965: "RIGOROUS_MATH",         # Analisi matematica 2
    22495: "RIGOROUS_MATH",         # Algebra lineare e geometria
    25693: "RIGOROUS_MATH",         # Analisi 1
    25291: "COMPUTER_VISION",       # Visione artificiale
    23324: "COMPUTER_VISION",       # Sviluppo Realtà Virtuale
    25777: "ELECTROMAGNETIC_PHYSICS", # Elettromagnetismo e ottica
    22481: "ELECTROMAGNETIC_PHYSICS", # Elettromagnetismo, ottica e struttura della materia
}


def get_course_archetype(course_id: int, course_name: str = "") -> CourseArchetype:
    """Restituisce l'archetipo didattico adattivo per il corso specificato."""
    if course_id in COURSE_ARCHETYPE_MAP:
        return ARCHETYPES[COURSE_ARCHETYPE_MAP[course_id]]

    # Rilevamento euristico basato su regex se il course_id non è mappato
    lowered = course_name.lower()
    if re.search(r"elettron|circuit|transistor|hardware", lowered):
        return ARCHETYPES["CIRCUIT_ELECTRONICS"]
    if re.search(r"sistem.*operativ|programmaz|linux|posix|thread|concorr|c\b", lowered):
        return ARCHETYPES["SYSTEMS_PROGRAMMING"]
    if re.search(r"matemat|analis|algebra|geometria|metodi matemat", lowered):
        return ARCHETYPES["RIGOROUS_MATH"]
    if re.search(r"vision|immagin|image|realt[aà] virtual", lowered):
        return ARCHETYPES["COMPUTER_VISION"]
    if re.search(r"fisic|elettromagnet|ottic|campi", lowered):
        return ARCHETYPES["ELECTROMAGNETIC_PHYSICS"]
    if re.search(r"statist|probabilit|matlab|dati", lowered):
        return ARCHETYPES["NUMERICAL_LAB"]

    # Fallback predefinito di ingegneria
    return ARCHETYPES["NUMERICAL_LAB"]


def get_all_archetypes() -> list[dict]:
    """Elenco di tutti gli archetipi configurati in formato serializzabile."""
    return [asdict(a) for a in ARCHETYPES.values()]
