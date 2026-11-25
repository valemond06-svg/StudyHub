import type { ReactNode } from "react"
import { Link } from "react-router-dom"
import { ArrowUpRight } from "lucide-react"
import { describeError } from "@/lib/api"
import { formatTime } from "@/lib/lecture-media"
import { studySource, type SourceDraft } from "@/lib/study-navigation"
import type { Source } from "@/lib/api-study"
import type { Course, Lecture } from "@/types"
import { Input } from "@/components/ui/input"

export const studySelect = "h-10 w-full min-w-0 rounded-md border border-neutral-300 bg-white px-3 text-sm dark:border-neutral-700 dark:bg-neutral-900"
export const studyTextarea = "w-full rounded-md border border-neutral-300 bg-white p-3 text-sm dark:border-neutral-700 dark:bg-neutral-900"
export const studyMuted = "text-sm text-neutral-500 dark:text-neutral-400"

export function Field({ name, children }: { name: string; children: ReactNode }) {
  return <label className="grid min-w-0 gap-1.5 text-sm font-medium"><span>{name}</span>{children}</label>
}

export function CoursePicker({ courses, value, onChange, empty = "Scegli un corso", required = false }: {
  courses: Course[]; value: number | undefined; onChange: (id: number | undefined) => void; empty?: string; required?: boolean
}) {
  return (
    <select className={studySelect} value={value ?? ""} required={required} onChange={(event) => onChange(Number(event.target.value) || undefined)}>
      <option value="">{empty}</option>
      {courses.map((course) => <option key={course.id} value={course.id}>{course.fullname}</option>)}
    </select>
  )
}

export function StudyError({ error }: { error: unknown }) {
  return error ? <p role="alert" className="break-words text-sm text-error-600 dark:text-error-400">{describeError(error)}</p> : null
}

export function SourceLink({ courseId, source, seconds }: { courseId: number; source: Source; seconds?: number | null }) {
  const href = studySource(courseId, source, seconds)
  if (!href) return null
  const className = "inline-flex items-center gap-1 text-sm font-medium text-accent-600 hover:underline dark:text-accent-400"
  return (
    <Link to={href} className={className}>
      <ArrowUpRight className="size-4" />
      {source.lecture_id
        ? (seconds == null ? "Apri lezione" : `Lezione a ${formatTime(seconds)}`)
        : (source.page == null ? "Apri documento" : `Documento a pagina ${source.page}`)}
    </Link>
  )
}

export function SourceFields({ draft, onChange, lectures }: { draft: SourceDraft; onChange: (next: SourceDraft) => void; lectures?: Lecture[] }) {
  function setLecture(lecture: string) {
    onChange({ ...draft, lecture, seconds: "" })
  }
  return (
    <fieldset className="grid grid-cols-2 gap-3">
      <legend className="mb-2 text-sm font-medium">Fonte</legend>
      {lectures?.length ? (
        <Field name="Lezione collegata">
          <select className={studySelect} value={draft.lecture} onChange={(e) => setLecture(e.target.value)}>
            <option value="">Nessuna lezione</option>
            {draft.lecture && !lectures.some((lecture) => String(lecture.id) === draft.lecture) && <option value={draft.lecture}>Lezione {draft.lecture}</option>}
            {lectures.map((lecture) => <option key={lecture.id} value={lecture.id}>{lecture.title}</option>)}
          </select>
        </Field>
      ) : <Field name="ID lezione"><Input type="number" min={1} value={draft.lecture} onChange={(e) => setLecture(e.target.value)} /></Field>}
      <Field name="Secondi nel video"><Input type="number" min={0} step="any" disabled={!draft.lecture} value={draft.seconds} onChange={(e) => onChange({ ...draft, seconds: e.target.value })} /></Field>
      <Field name="ID documento"><Input type="number" min={1} value={draft.document} onChange={(e) => onChange({ ...draft, document: e.target.value, page: e.target.value ? draft.page : "" })} /></Field>
      <Field name="Pagina del documento"><Input type="number" min={1} disabled={!draft.document} value={draft.page} onChange={(e) => onChange({ ...draft, page: e.target.value })} /></Field>
    </fieldset>
  )
}

