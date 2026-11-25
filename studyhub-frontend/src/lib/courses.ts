import type { Course } from "@/types"

export type CourseFilter = "attivi" | "altri" | "superati" | "tutti"

export function isCourseFilter(v: string | null): v is CourseFilter {
  return v === "attivi" || v === "altri" || v === "superati" || v === "tutti"
}

/** Attivo = corso dell'anno in corso (active=1) non ancora superato. Prioritari in testa. */
export function filterCourses(courses: Course[], filter: CourseFilter): Course[] {
  const sorted = [...courses].sort((a, b) => b.priority - a.priority || a.fullname.localeCompare(b.fullname))
  switch (filter) {
    case "attivi": return sorted.filter((c) => Boolean(c.active) && !c.passed)
    case "altri": return sorted.filter((c) => !c.active && !c.passed)
    case "superati": return sorted.filter((c) => c.passed)
    default: return sorted
  }
}
