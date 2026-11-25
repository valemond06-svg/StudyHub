/**
 * Prontezza = padronanza reale misurata dal backend (mastery.overview → `ready_exam`, 0-1, in GET /api/study),
 * NON la quota di lezioni scaricate/trascritte di /api/courses (`ready/lectures`), che è solo "materiale elaborato".
 */
import type { Course, StudyCourseOverview } from "@/types"

/** % di prontezza all'esame per corso (solo corsi presenti in /api/study). */
export function readinessByCourse(study: StudyCourseOverview[] | undefined): Map<number, number> {
  const out = new Map<number, number>()
  for (const c of study ?? []) {
    if (typeof c.ready_exam === "number" && Number.isFinite(c.ready_exam)) {
      out.set(c.id, Math.round(Math.max(0, Math.min(1, c.ready_exam)) * 100))
    }
  }
  return out
}

/** Quota di lezioni con media o trascrizione: utile come "materiale elaborato", non come preparazione. */
export function processedMaterial(course: Pick<Course, "lectures" | "ready">): { done: number; total: number; pct: number } {
  const total = course.lectures || 0
  const done = Math.min(course.ready || 0, total)
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 }
}

/** Media delle prontezze note (null se nessun corso ha dati di padronanza). */
export function averageReadiness(values: number[]): number | null {
  if (!values.length) return null
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length)
}

export const READY_THRESHOLD = 80

/** Sotto questo numero di domande provate la prontezza è solo un indizio, non una misura. */
export const MIN_TRIED_ITEMS = 10

export interface ReadinessInfo {
  /** percentuale stimata (0-100) se c'è una banca di domande, altrimenti null */
  pct: number | null
  /** true solo con abbastanza risposte date: altrimenti la UI dice "dati insufficienti" */
  reliable: boolean
  tried: number
  items: number
  /** testo breve per badge: "42%", "dati insufficienti", "nessuna domanda", "n.d." */
  label: string
  /** spiegazione dell'incertezza, per title/aria e testo secondario */
  hint: string
}

/** Prontezza onesta: mai un numero pieno quando le risposte date sono troppo poche per misurarla. */
export function readinessInfo(s: Pick<StudyCourseOverview, "ready_exam" | "tried_items" | "n_items" | "coverage"> | undefined | null): ReadinessInfo {
  if (!s || typeof s.ready_exam !== "number" || !Number.isFinite(s.ready_exam)) {
    return { pct: null, reliable: false, tried: 0, items: 0, label: "n.d.", hint: "Nessun dato di studio per questo corso." }
  }
  const items = s.n_items ?? 0
  const tried = s.tried_items ?? 0
  const pct = Math.round(Math.max(0, Math.min(1, s.ready_exam)) * 100)
  if (items === 0) {
    return { pct: null, reliable: false, tried, items, label: "nessuna domanda", hint: "Il materiale non è ancora stato analizzato: non ci sono domande per misurarti." }
  }
  if (tried < MIN_TRIED_ITEMS) {
    return {
      pct, reliable: false, tried, items, label: "dati insufficienti",
      hint: `Hai provato ${tried} domande su ${items}: servono almeno ${MIN_TRIED_ITEMS} risposte perché la stima (ora ${pct}%) voglia dire qualcosa.`,
    }
  }
  const cov = Math.round((s.coverage ?? tried / items) * 100)
  return {
    pct, reliable: true, tried, items, label: `${pct}%`,
    hint: `Stima su ${tried} domande provate (${cov}% della banca). Le domande mai provate contano come non sapute.`,
  }
}

export function readinessVariant(pct: number | null | undefined): "success" | "warning" | "default" {
  if (pct == null) return "default"
  return pct >= READY_THRESHOLD ? "success" : pct >= 50 ? "warning" : "default"
}
