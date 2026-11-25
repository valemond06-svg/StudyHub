import { create } from "zustand"
import { persist } from "zustand/middleware"
import type { BlockKind, PlanBlock, Source } from "@/lib/api-study"
import { documentHref } from "@/lib/documents"

export const blockLabels: Record<BlockKind, string> = {
  theory: "Lettura appunti",
  exercises: "Esercizi",
  simulation: "Simulazione",
  fsrs: "Ripasso flashcard",
}

export function blockHref(block: PlanBlock) {
  const course = `/corsi/${block.course_id}`
  switch (block.kind) {
    case "theory":
      return block.topic_id ? `/impara/${block.topic_id}?lettura=appunti` : `${course}?tab=lezioni`
    case "exercises":
      return `/studio/${block.course_id}?duration=${block.minutes <= 25 ? 25 : block.minutes <= 45 ? 45 : 90}${block.topic_id ? `&topic=${block.topic_id}` : ""}`
    case "simulation":
      return `${course}?tab=esame#simulazioni`
    case "fsrs":
      return `/flashcard?corso=${block.course_id}&ripasso=1`
  }
}

export function studySource(courseId: number, source: Source, seconds?: number | null) {
  if (source.lecture_id) return `/corsi/${courseId}?lezione=${source.lecture_id}${seconds != null ? `&t=${seconds}` : ""}`
  if (source.doc_id) return documentHref(source.doc_id, source.page)
  return null
}

export interface SourceDraft {
  lecture: string
  seconds: string
  document: string
  page: string
}

export function sourceDraft(source?: Source, seconds?: number | null): SourceDraft {
  return {
    lecture: String(source?.lecture_id ?? ""),
    seconds: String(seconds ?? ""),
    document: String(source?.doc_id ?? ""),
    page: String(source?.page ?? ""),
  }
}

export function sourcePayload(draft: SourceDraft) {
  return {
    lecture_id: draft.lecture ? Number(draft.lecture) : null,
    timestamp_s: draft.lecture && draft.seconds !== "" ? Number(draft.seconds) : null,
    doc_id: draft.document ? Number(draft.document) : null,
    page: draft.document && draft.page ? Number(draft.page) : null,
  }
}

export function formatStudyDate(day: string) {
  return new Intl.DateTimeFormat("it-IT", { weekday: "short", day: "numeric", month: "short" })
    .format(new Date(`${day}T12:00:00`))
}

export function shiftStudyDate(day: string, offset: number) {
  const date = new Date(`${day}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10)
}

export const useStudyPlan = create<{ missedDay?: string; setMissedDay: (day: string) => void }>()(
  persist((set) => ({ setMissedDay: (missedDay) => set({ missedDay }) }), { name: "studyhub-plan" }),
)

export const useFocusDraft = create<{
  draft: { courseId: number; task?: string; minutes?: number } | null
  openFocus: (draft: { courseId: number; task?: string; minutes?: number }) => void
}>((set) => ({ draft: null, openFocus: (draft) => set({ draft }) }))
