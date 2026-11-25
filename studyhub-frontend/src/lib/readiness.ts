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

export function readinessVariant(pct: number | null | undefined): "success" | "warning" | "default" {
  if (pct == null) return "default"
  return pct >= READY_THRESHOLD ? "success" : pct >= 50 ? "warning" : "default"
}
