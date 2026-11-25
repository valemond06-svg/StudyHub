import { ApiError, ensureCsrfToken, errorMessageFromBody } from "@/lib/api"
import type { Flashcard } from "@/types"

export interface Source {
  lecture_id?: number | null
  doc_id?: number | null
  page?: number | null
}

export interface NoteEdit extends Source {
  body: string
  tags: string[]
  timestamp_s?: number | null
}

export interface StudyNote extends NoteEdit {
  id: number
  course_id: number
  topic_id: number | null
  created_at: string
  updated_at: string
}

export interface CardEdit extends Source {
  front: string
  back: string
  t_start?: number | null
}

export interface StudyCard extends CardEdit {
  id: number
  course_id: number
  origin: "ai" | "manuale" | "errore"
  suspended: boolean
  due: string
  created_at: string
  url_hint: string | null
  attempt_id: number | null
}

export interface ReviewToday {
  day: string
  course_id: number | null
  cards: (StudyCard & { review_bucket: "scheduled" | "backlog" | "new" })[]
  due_count: number
  new_count: number
  overdue_count: number
  overdue_review_count: number
  estimated_minutes: number
  proposal: {
    scheduled_today: number
    backlog_today: number
    new_today: number
    estimated_minutes: number
    remaining_backlog: number
    remaining_new: number
    remaining_days: number
  }
}

export interface ExamInput {
  course_id: number
  date: string
  kind: string
  note: string | null
}

export interface Appello extends ExamInput {
  id: number
  course: string
  days_left: number
  done: number
  created_at: string
}

export interface Availability {
  hours_by_weekday: number[]
  days_off: string[]
}

export type BlockKind = "theory" | "exercises" | "simulation" | "fsrs"

export interface PlanBlock {
  id: string
  kind: BlockKind
  minutes: number
  exam_id: number
  exam_date: string
  course_id: number
  course: string
  topic_id: number | null
  topic: string | null
  mastery: number | null
  due_count?: number
  day: string | null
}

export interface PlanWeek {
  start: string
  days: { day: string; available_minutes: number; planned_minutes: number; blocks: PlanBlock[] }[]
  exams: Appello[]
  unscheduled: (PlanBlock & { reason: "no_slot_before_exam" })[]
  changes: {
    block_id: string; kind: BlockKind; exam_id: number; course_id: number; topic_id: number | null
    minutes: number; from_day: string; to_day: string | null; reason: "missed_day" | "no_slot_before_exam"
  }[]
}

export interface FocusStart {
  course_id: number
  task?: string | null
  kind: "focus" | "pausa"
  planned_seconds: number
}

export interface FocusSession extends FocusStart {
  id: number
  status: "running" | "stopped"
  started_at: string
  ends_at: string
  stopped_at: string | null
  actual_seconds: number
}

export interface FocusSummary {
  day: string
  course_id: number | null
  focus_seconds: number
  break_seconds: number
  focus_count: number
  break_count: number
}

export interface LessonStep {
  titolo: string
  spiegazione_md: string
  intuizione_md: string
  inizio_s?: number
  verifica?: { testo_md: string; opzioni: string[]; corretta: number; spiegazione_md: string }
}

export interface InteractiveLesson {
  topic: Source & {
    id: number; course_id: number; name: string; summary_md: string | null; lecture: string | null; t_start: number | null
  }
  status: "da preparare" | "pronta" | "in_coda" | "in_corso" | "errore" | null
  message: string | null
  completed_at: string | null
  lesson?: {
    titolo: string
    hook_robotica_md?: string
    widget?: { tipo: string; titolo: string; istruzioni: string; config_json: string | Record<string, unknown> }
    passi: LessonStep[]
    laboratorio_pratico?: {
      titolo: string; software: string; dataset?: string; consegna_md: string; codice: string
      spiegazione_md: string; output_atteso: string; sfida?: { consegna_md: string; suggerimento_md: string; soluzione_codice: string }
    }
    archetipo_esame?: { nome_archetipo: string; come_appare_all_esame_md: string; trucco_del_docente_md: string }
    ponte_carta_penna?: { sfida_testo_md: string; tempo_stimato_min: number; soluzione_passo_passo_md: string; risultato_finale_md: string }
    sniper_sbarramento?: { testo_md: string; opzioni: string[]; corretta: number; perche_trabocchetto_md: string }
    errori_tipici?: { errore: string; correzione: string }[]
    riassunto_md?: string
  }
}

export type LectureNotes = { exists: false } | {
  exists: true; md: string; model: string; created_at: string
}

export interface QuizListItem {
  id: number
  title: string
  created_at: string
  best: number | null
}

export type QuizAnswer = number | string | null

export interface LectureQuiz {
  id: number
  course_id: number
  lecture_id: number
  title: string
  created_at: string
  attempts: { id: number; score: number; max_score: number; created_at: string }[]
  questions: { tipo: "multipla" | "vero_falso" | "aperta" | "esercizio"; testo_md: string; opzioni: string[]; inizio_s?: number }[]
}

export interface QuizCorrection {
  attempt_id: number
  score: number
  max_score: number
  results: { indice: number; risposta: QuizAnswer; soluzione_md: string; corretta: number; punteggio: number; feedback_md?: string }[]
  utilization: number | null
}

export interface SystemStatus {
  checked_at: string
  providers: Record<string, { available: boolean | null; status: string; error: string | null; checked_at: string | null; retry_at: number | null }>
  login: Record<string, { status: string }>
  last_sync: { finished_at: string; course_id?: number; new_files?: number; updated_files?: number; error_count?: number | null } | null
  restic: { status: string; repository_bytes: number | null; free_bytes: number | null; capacity_bytes: number | null }
}

function query(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value))
  }
  return search.size ? `?${search}` : ""
}

async function request<T>(path: string, method = "GET", body?: object): Promise<T> {
  const headers = new Headers()
  if (body !== undefined) headers.set("Content-Type", "application/json")
  if (method !== "GET") {
    const token = await ensureCsrfToken()
    if (token) headers.set("X-CSRF-Token", token)
  }
  const response = await fetch(`/api${path}`, { method, headers, credentials: "include", body: JSON.stringify(body) })
  const data: unknown = response.status === 204 ? undefined : await response.json().catch(() => undefined)
  if (!response.ok) {
    const detail = data && typeof data === "object" && "detail" in data ? data.detail : undefined
    throw new ApiError(response.status, errorMessageFromBody(response.status, data), detail)
  }
  if (response.status !== 204 && data === undefined) throw new Error("Risposta del server non valida.")
  return data as T
}

export function toReviewCard(card: StudyCard): Flashcard {
  return {
    id: card.id,
    course_id: card.course_id,
    lecture_id: card.lecture_id ?? 0,
    fronte: card.front,
    retro: card.back,
    due_date: card.due,
    t_start: card.t_start,
    origin: card.origin,
  }
}

export const studyApi = {
  notes: (filters: { course_id?: number; lecture_id?: number; q?: string; tag?: string; limit?: number; offset?: number }) =>
    request<{ notes: StudyNote[] }>(`/notes${query(filters)}`),
  getNote: (id: number) => request<StudyNote>(`/notes/${id}`),
  createNote: (body: NoteEdit & { course_id: number }) => request<StudyNote>("/notes", "POST", body),
  editNote: (id: number, body: Partial<NoteEdit>) => request<StudyNote>(`/notes/${id}`, "PATCH", body),
  deleteNote: (id: number) => request<void>(`/notes/${id}`, "DELETE"),
  cards: (course_id?: number, limit?: number, offset?: number) => request<{ cards: StudyCard[] }>(`/flashcards${query({ course_id, limit, offset })}`),
  createCard: (body: CardEdit & { course_id: number }) => request<StudyCard>("/flashcards", "POST", body),
  editCard: (id: number, body: Partial<CardEdit> & { suspended?: boolean }) => request<StudyCard>(`/flashcards/${id}`, "PATCH", body),
  deleteCard: (id: number) => request<void>(`/flashcards/${id}`, "DELETE"),
  review: (course_id?: number, limit = 50) => request<ReviewToday>(`/review/today${query({ course_id, limit })}`),
  week: (start?: string, missed_day?: string) => request<PlanWeek>(`/plan/week${query({ start, missed_day })}`),
  recompute: (missed_day: string, start: string) => request<PlanWeek>("/plan/recompute", "POST", { missed_day, start }),
  availability: () => request<Availability>("/settings/availability"),
  saveAvailability: (body: Availability) => request<Availability>("/settings/availability", "PUT", body),
  createExam: (body: ExamInput) => request<{ id: number }>("/exams", "POST", body),
  updateExam: (id: number, body: ExamInput) => request<{ id: number }>(`/exams/${id}`, "PUT", body),
  deleteExam: (id: number) => request<{ ok: boolean }>(`/exams/${id}`, "DELETE"),
  focus: () => request<{ sessions: FocusSession[] }>("/focus?limit=1"),
  startFocus: (body: FocusStart) => request<FocusSession>("/focus/start", "POST", body),
  stopFocus: (id: number) => request<FocusSession>(`/focus/${id}/stop`, "POST"),
  focusSummary: (course_id?: number, day?: string) => request<FocusSummary>(`/focus/summary${query({ course_id, day })}`),
  // Protegge anche i server preesistenti che accodavano le lezioni dal GET.
  lesson: (id: number) => request<InteractiveLesson>(`/study/topics/${id}/lesson?prepare=false`),
  prepareLesson: (id: number) => request<InteractiveLesson>(`/study/topics/${id}/lesson/prepare`, "POST"),
  completeLesson: (id: number) => request<{ ok: boolean }>(`/study/topics/${id}/lesson/done`, "POST"),
  askLesson: (id: number, body: { question: string; context: string; mode: "domanda" | "altro_modo" }) =>
    request<{ answer_md: string }>(`/study/topics/${id}/ask`, "POST", body),
  lectureNotes: (id: number) => request<LectureNotes>(`/lectures/${id}/notes`),
  queueLectureNotes: (id: number) => request<{ queued: number[] }>(`/lectures/${id}/notes`, "POST"),
  lectureNoteJobs: () => request<{ jobs: { id: number; kind: string; target_id: number; status: string; message: string | null }[]; paused_reason: string | null }>("/ai/status"),
  lectureTopics: (id: number) => request<{ id: number; name: string; learned: string | null; pos: number }[]>(`/lectures/${id}/topics`),
  lectureQuizzes: (id: number) => request<QuizListItem[]>(`/lectures/${id}/quizzes`),
  generateQuiz: (id: number) => request<{ id: number; cached: boolean }>(`/lectures/${id}/quiz?n=10`, "POST"),
  quiz: (id: number) => request<LectureQuiz>(`/quizzes/${id}`),
  submitQuiz: (id: number, answers: QuizAnswer[]) => request<QuizCorrection>(`/quizzes/${id}/submit`, "POST", { answers }),
  systemStatus: () => request<SystemStatus>("/system/status"),
}
