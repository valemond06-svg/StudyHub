import type { Course, CourseStage } from "@/types"

/**
 * Lo stato dei corsi viene da corsi.yaml (campo `stato`, colonna `courses.stage`):
 *  - corrente: i corsi in orario adesso, quelli da seguire;
 *  - arretrato: esami da recuperare, in secondo piano;
 *  - futuro / archivio: nascosti di default.
 */
export type CourseFilter = "seguo" | "arretrati" | "altri" | "superati" | "tutti"

export function isCourseFilter(v: string | null): v is CourseFilter {
  return v === "seguo" || v === "arretrati" || v === "altri" || v === "superati" || v === "tutti"
}

/** Vecchi link (?filtro=attivi) portano ai corsi da seguire. */
export function parseCourseFilter(v: string | null): CourseFilter {
  if (isCourseFilter(v)) return v
  return "seguo"
}

export function courseStage(c: Pick<Course, "stage" | "active" | "passed">): CourseStage {
  if (c.stage === "corrente" || c.stage === "arretrato" || c.stage === "futuro" || c.stage === "archivio") return c.stage
  return c.active && !c.passed ? "corrente" : "archivio"
}

export const STAGE_LABEL: Record<CourseStage, string> = {
  corrente: "Da seguire",
  arretrato: "Arretrato",
  futuro: "Futuro",
  archivio: "Archivio",
}

const STAGE_RANK: Record<CourseStage, number> = { corrente: 0, arretrato: 1, futuro: 2, archivio: 3 }

/**
 * Ordine: prima i corsi correnti, poi gli arretrati, poi il resto; dentro ogni gruppo l'appello più vicino
 * (giorni al prossimo appello, se noti), poi i prioritari, poi il nome.
 */
export function sortCourses<T extends Pick<Course, "id" | "stage" | "active" | "passed" | "priority" | "fullname">>(
  courses: T[],
  daysToExam: ReadonlyMap<number, number | null | undefined> = new Map(),
): T[] {
  const days = (id: number) => {
    const d = daysToExam.get(id)
    return typeof d === "number" && d >= 0 ? d : Number.POSITIVE_INFINITY
  }
  return [...courses].sort((a, b) =>
    STAGE_RANK[courseStage(a)] - STAGE_RANK[courseStage(b)] ||
    days(a.id) - days(b.id) ||
    b.priority - a.priority ||
    a.fullname.localeCompare(b.fullname))
}

export function filterCourses<T extends Course>(courses: T[], filter: CourseFilter, daysToExam?: ReadonlyMap<number, number | null | undefined>): T[] {
  const sorted = sortCourses(courses, daysToExam)
  switch (filter) {
    case "seguo": return sorted.filter((c) => !c.passed && courseStage(c) === "corrente")
    case "arretrati": return sorted.filter((c) => !c.passed && courseStage(c) === "arretrato")
    case "altri": return sorted.filter((c) => !c.passed && (courseStage(c) === "futuro" || courseStage(c) === "archivio"))
    case "superati": return sorted.filter((c) => Boolean(c.passed))
    default: return sorted
  }
}
