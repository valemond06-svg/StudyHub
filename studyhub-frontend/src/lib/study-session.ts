// Logica pura della sessione di studio guidata, allineata a backend/src/studyhub/study/session.py.
// La coda è quella del server, nell'ordine del server: niente bucket a tempo, si avanza per voce.
import { documentHref } from "@/lib/documents"

export type QuestionKind = "multipla" | "vero_falso" | "richiamo" | "aperta" | "esercizio"

export interface PublicQuestion {
  id: number
  kind: QuestionKind | string
  difficulty: number
  prompt_md: string
  topic_id: number
  doc_id: number | null
  page: number | null
  lecture_id: number | null
  t_start: number | null
  options: string[] | null
  n_criteria: number
}

export interface SessionEntry {
  idx: number
  t: "domanda" | "scheda" | string
  item?: number
  topic?: number
  boss?: boolean
  retry?: boolean
  done: boolean
  revealed?: boolean
  score?: number
  question?: PublicQuestion
}

export interface SessionTopic {
  id: number
  name: string
  weight?: number
  summary_md?: string | null
  lecture_id?: number | null
  t_start?: number | null
  doc_id?: number | null
  page?: number | null
}

export interface StudySessionData {
  id: number
  course_id: number
  minutes: number
  started_at: string
  ended_at: string | null
  xp: number
  entries: SessionEntry[]
  topics: Record<string, SessionTopic>
  resume_index: number | null
  phase: string
  errors: Array<{ attempt_id: number; item_id: number; score: number; prompt_md: string }>
}

export interface SourceRef {
  lecture_id: number | null
  lecture: string | null
  t_start: number | null
  doc_id: number | null
  doc: string | null
  page: number | null
}

export interface RevealResult {
  answer_md: string
  rubric: string[]
  source?: SourceRef
  /** sicurezza dichiarata al momento del reveal (1-3), se salvata */
  confidence?: number | null
  revealed_at?: string | null
}

export interface AnswerResult {
  attempt_id: number
  score: number
  correct: number | null
  answer_md: string
  rubric: string[]
  criteria_ok: boolean[]
  feedback_md: string | null
  graded_by: "auto" | "ai" | "io" | string
  xp: number
  retry: boolean
  requeued: (Omit<SessionEntry, "idx"> & { idx: number }) | null
  next_due?: string
  source?: SourceRef
}

export interface FinishResult {
  answered: number
  correct: number
  xp: number
  ready_before: number | null
  ready_after: number | null
  topics_up: Array<{ name: string; from: number; to: number; level_name: string }>
  wrong: Array<{
    id: number
    attempt_id: number
    prompt_md: string
    topic: string
    lecture_id: number | null
    t_start: number | null
    doc_id: number | null
    page: number | null
  }>
  verdict?: { tone?: string; title?: string; text?: string; gaps?: Array<{ id: number; name: string; level_name: string }> }
  streak?: number
}

/** Corpo di POST /api/study/sessions/{sid}/answer. */
export interface AnswerPayload {
  idx: number
  choice?: number
  text?: string
  self_criteria?: boolean[]
  self_score?: number
  confidence: 1 | 2 | 3
  seconds: number
}

export interface PhotoPayload {
  idx: number
  images: string[]
  text?: string
  confidence: 1 | 2 | 3
  seconds: number
}

export const CONFIDENCE_LEVELS = [
  { value: 1, label: "Tiro a indovinare" },
  { value: 2, label: "Credo" },
  { value: 3, label: "Sicuro" },
] as const

export const SELF_VERDICTS = [
  { key: "no", label: "No", score: 0 },
  { key: "parziale", label: "Parziale", score: 0.5 },
  { key: "si", label: "Sì", score: 1 },
] as const
export type SelfVerdict = (typeof SELF_VERDICTS)[number]["key"]

/** Normalizza la risposta di GET/POST sessione: idx espliciti e `done` booleano. */
export function normalizeSession(raw: any): StudySessionData {
  const entries: SessionEntry[] = (raw?.entries ?? []).map((e: any, i: number) => ({
    ...e,
    idx: typeof e?.idx === "number" ? e.idx : i,
    done: Boolean(e?.done),
  }))
  return {
    id: raw.id,
    course_id: raw.course_id,
    minutes: raw.minutes ?? 45,
    started_at: raw.started_at ?? "",
    ended_at: raw.ended_at ?? null,
    xp: raw.xp ?? 0,
    entries,
    topics: raw.topics ?? {},
    resume_index: typeof raw.resume_index === "number" ? raw.resume_index : null,
    phase: raw.phase ?? "",
    errors: raw.errors ?? [],
  }
}

/** Prima voce non completata a partire da `from`. Le schede lette in locale contano come fatte. */
export function firstPending(entries: SessionEntry[], localDone: ReadonlySet<number> = new Set(), from = 0): number | null {
  for (let i = Math.max(0, from); i < entries.length; i++) {
    if (!entries[i].done && !localDone.has(entries[i].idx)) return entries[i].idx
  }
  return null
}

/** Indice da cui riprendere dopo una ricarica: quello del server, se non è una scheda già letta qui. */
export function resumeIndex(session: StudySessionData, localDone: ReadonlySet<number> = new Set()): number | null {
  if (session.ended_at) return null
  const r = session.resume_index
  if (r !== null && session.entries[r] && !session.entries[r].done && !localDone.has(r)) return r
  return firstPending(session.entries, localDone)
}

/** Applica l'esito del server: voce fatta e, se c'è, la domanda rimessa in coda in fondo (idempotente). */
export function applyAnswer(session: StudySessionData, idx: number, result: AnswerResult): StudySessionData {
  const entries = session.entries.map((e) => (e.idx === idx ? { ...e, done: true, score: result.score } : e))
  const rq = result.requeued
  if (rq && !entries.some((e) => e.idx === rq.idx)) {
    const current = session.entries.find((e) => e.idx === idx)
    entries.push({ ...rq, idx: rq.idx, done: Boolean(rq.done), question: rq.question ?? current?.question })
    entries.sort((a, b) => a.idx - b.idx)
  }
  return { ...session, entries, xp: session.xp + (result.xp ?? 0) }
}

export function markRevealed(session: StudySessionData, idx: number): StudySessionData {
  return { ...session, entries: session.entries.map((e) => (e.idx === idx ? { ...e, revealed: true } : e)) }
}

/** Nome dell'argomento (mai "Topic N"); stringa vuota se il server non lo manda. */
export function topicName(session: Pick<StudySessionData, "topics">, topicId: number | null | undefined): string {
  if (topicId === null || topicId === undefined) return ""
  return session.topics?.[String(topicId)]?.name ?? ""
}

// ---------------------------------------------------------------------------------------------
// Fasi e tempi (solo informativi: nessun avanzamento automatico)
// ---------------------------------------------------------------------------------------------

/** Secondi stimati per voce: gli stessi di session.py (SECONDS, SCHEDA_S). */
export const ENTRY_SECONDS: Record<string, number> = {
  vero_falso: 45, multipla: 60, richiamo: 75, aperta: 240, esercizio: 480, scheda: 480,
}

export type PhaseKey = "ripasso" | "boss" | "riprova"
export const PHASE_LABELS: Record<PhaseKey, string> = {
  ripasso: "Ripasso e argomenti nuovi",
  boss: "Boss finale",
  riprova: "Riprova gli errori",
}

export function phaseOf(entry: SessionEntry): PhaseKey {
  if (entry.retry) return "riprova"
  if (entry.boss) return "boss"
  return "ripasso"
}

export function entrySeconds(entry: SessionEntry): number {
  if (entry.t === "scheda") return ENTRY_SECONDS.scheda
  return ENTRY_SECONDS[entry.question?.kind ?? ""] ?? 90
}

export interface PhasePlan {
  key: PhaseKey
  label: string
  /** Secondi assegnati, scalati sulla durata scelta (25/45/90 min). */
  budget: number
  total: number
  done: number
}

/** Le fasi della coda con il tempo previsto, proporzionato alla durata scelta dall'utente. */
export function planPhases(entries: SessionEntry[], minutes: number, localDone: ReadonlySet<number> = new Set()): PhasePlan[] {
  const raw = entries.reduce((s, e) => s + entrySeconds(e), 0) || 1
  const scale = (Math.max(1, minutes) * 60) / raw
  const order: PhaseKey[] = ["ripasso", "boss", "riprova"]
  return order
    .map((key) => {
      const list = entries.filter((e) => phaseOf(e) === key)
      return {
        key,
        label: PHASE_LABELS[key],
        budget: Math.round(list.reduce((s, e) => s + entrySeconds(e), 0) * scale),
        total: list.length,
        done: list.filter((e) => e.done || localDone.has(e.idx)).length,
      }
    })
    .filter((p) => p.total > 0)
}

export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, "0")}`
}

/** Tempo di risposta misurato, in secondi (arrotondato al decimo, tetto un'ora). */
export function measuredSeconds(startedAtMs: number, nowMs: number): number {
  const s = (nowMs - startedAtMs) / 1000
  if (!Number.isFinite(s) || s < 0) return 0
  return Math.min(3600, Math.round(s * 10) / 10)
}

// ---------------------------------------------------------------------------------------------
// Risposte
// ---------------------------------------------------------------------------------------------

export function isChoiceKind(kind: string | undefined): boolean {
  return kind === "multipla" || kind === "vero_falso"
}

/** Vero/falso: il backend confronta int(choice) con `correct`, dove Vero=1 e Falso=0. */
export const TRUE_FALSE = [
  { label: "Vero", choice: 1, key: "v" },
  { label: "Falso", choice: 0, key: "f" },
] as const

/**
 * Autovalutazione: se hai spuntato i criteri si mandano le spunte (il server calcola la quota e la limita a 0,85),
 * altrimenti il giudizio complessivo No/Parziale/Sì. `checks` è null finché non tocchi i criteri.
 */
export function selfAssessmentPayload(
  rubric: string[],
  checks: boolean[] | null,
  verdict: SelfVerdict | null,
): Pick<AnswerPayload, "self_criteria" | "self_score"> | null {
  if (rubric.length > 0 && checks && checks.length === rubric.length) {
    return { self_criteria: checks.map(Boolean) }
  }
  if (verdict !== null) {
    const v = SELF_VERDICTS.find((x) => x.key === verdict)!
    return { self_score: v.score }
  }
  return null
}

/** Dalle spunte ai criteri un giudizio suggerito (vero/parziale/no). */
export function verdictFromChecks(checks: boolean[]): SelfVerdict | null {
  if (checks.length === 0) return null
  const ok = checks.filter(Boolean).length
  if (ok === checks.length) return "si"
  if (ok === 0) return "no"
  return "parziale"
}

export function scoreLabel(score: number): { label: string; tone: "ok" | "partial" | "bad" } {
  if (score >= 0.7) return { label: "Corretta", tone: "ok" }
  if (score >= 0.5) return { label: "Parziale", tone: "partial" }
  return { label: "Da rivedere", tone: "bad" }
}

/** Link alla fonte: lezione al secondo giusto nel player del corso, oppure PDF alla pagina. */
export function sourceHref(courseId: number, src: Partial<SourceRef> | undefined | null): string | null {
  if (!src) return null
  if (src.lecture_id) {
    const t = src.t_start ? `&t=${Math.floor(src.t_start)}` : ""
    return `/corsi/${courseId}?lezione=${src.lecture_id}${t}`
  }
  if (src.doc_id) return documentHref(src.doc_id, src.page)
  return null
}

/** Argomenti da rivedere: quelli delle risposte sbagliate, dal più sbagliato. */
export function topicsToReview(wrong: FinishResult["wrong"]): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>()
  for (const w of wrong) if (w.topic) counts.set(w.topic, (counts.get(w.topic) ?? 0) + 1)
  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
}
