import { QueryClient } from "@tanstack/react-query"
import type {
  Course,
  Lecture,
  AIPanelData,
  AIStatusResponse,
  PlanData,
  StudyCourseOverview,
  AIProvidersStatus,
  SetupStatus,
  StorageStatus,
} from "@/types"
import { toSearchResponse, type SearchResponse } from "@/lib/search"
import type { CourseDocuments } from "@/lib/documents"
import {
  normalizeSession,
  type AnswerPayload,
  type AnswerResult,
  type FinishResult,
  type PhotoPayload,
  type RevealResult,
} from "@/lib/study-session"

const API_BASE = ""
const CSRF_COOKIE_NAME = "csrf_token"

let cachedCsrfToken: string | null = null
let csrfFetchPromise: Promise<string | null> | null = null

export function setCsrfToken(token: string | null) {
  cachedCsrfToken = token
}

export function getCsrfToken(): string | null {
  if (cachedCsrfToken) return cachedCsrfToken
  return getCsrfTokenFromCookie()
}

// Read CSRF token from cookie
export function getCsrfTokenFromCookie(): string | null {
  if (typeof document === "undefined") return null
  const cookies = document.cookie.split(";")
  for (const cookie of cookies) {
    const [name, value] = cookie.trim().split("=")
    if (name === CSRF_COOKIE_NAME && value) {
      return decodeURIComponent(value)
    }
  }
  return null
}

export async function ensureCsrfToken(): Promise<string | null> {
  const current = getCsrfToken()
  if (current) return current

  if (!csrfFetchPromise) {
    csrfFetchPromise = (async () => {
      try {
        const res = await fetch("/api/csrf", { credentials: "include" })
        if (res.ok) {
          const data = await res.json()
          if (data?.csrf_token) {
            setCsrfToken(data.csrf_token)
            return data.csrf_token as string
          }
        }
      } catch (e) {
        console.warn("CSRF token fetch warning:", e)
      } finally {
        csrfFetchPromise = null
      }
      return getCsrfTokenFromCookie()
    })()
  }
  return csrfFetchPromise
}

// ---------------------------------------------------------------------------------
// Errori: FastAPI risponde {"detail": "..."} (stringa) oppure, per la validazione 422,
// {"detail": [{"loc": [...], "msg": "..."}]}. Il messaggio del backend è già in italiano:
// lo mostriamo così com'è; altrimenti un testo italiano per codice di stato.
// ---------------------------------------------------------------------------------

export class ApiError extends Error {
  readonly status: number
  readonly detail: unknown

  constructor(status: number, message: string, detail?: unknown) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.detail = detail
  }
}

const STATUS_MESSAGES: Record<number, string> = {
  400: "Richiesta non valida.",
  401: "Accesso non autorizzato: riapri StudyHub dal suo avvio (manca il token locale).",
  403: "Richiesta rifiutata dal server (token di sicurezza scaduto?): ricarica la pagina.",
  404: "Elemento non trovato.",
  409: "Operazione già in corso.",
  413: "File troppo grande.",
  422: "Dati inviati non validi.",
  429: "Limite raggiunto: riprova più tardi.",
  500: "Errore interno del server StudyHub.",
  502: "Il servizio AI non ha risposto correttamente.",
  503: "Servizio non disponibile in questo momento.",
  504: "Il server ha impiegato troppo tempo a rispondere.",
}

export function messageForStatus(status: number): string {
  if (STATUS_MESSAGES[status]) return STATUS_MESSAGES[status]
  if (status >= 500) return `Errore del server (HTTP ${status}).`
  return `Richiesta non riuscita (HTTP ${status}).`
}

/** Estrae il messaggio leggibile dal corpo di errore di FastAPI. */
export function errorMessageFromBody(status: number, body: unknown): string {
  const detail = (body && typeof body === "object" && "detail" in body) ? (body as { detail: unknown }).detail : undefined
  if (typeof detail === "string" && detail.trim()) return detail.trim()
  if (Array.isArray(detail) && detail.length) {
    const parts = detail
      .map((d) => {
        if (!d || typeof d !== "object") return null
        const loc = Array.isArray((d as { loc?: unknown }).loc)
          ? ((d as { loc: unknown[] }).loc.filter((x) => x !== "body" && x !== "query").join("."))
          : ""
        const msg = (d as { msg?: unknown }).msg
        return typeof msg === "string" ? (loc ? `${loc}: ${msg}` : msg) : null
      })
      .filter(Boolean)
    if (parts.length) return `${messageForStatus(422)} ${parts.join("; ")}`
  }
  return messageForStatus(status)
}

/** Messaggio da mostrare all'utente per qualsiasi errore (ApiError, rete, altro). */
export function describeError(err: unknown, fallback = "Operazione non riuscita."): string {
  if (err instanceof ApiError) return err.message
  if (err instanceof TypeError) return "Il server StudyHub non risponde: controlla che sia avviato."
  if (err instanceof Error && err.message) return err.message
  return fallback
}

async function toApiError(res: Response): Promise<ApiError> {
  let body: unknown = null
  try {
    const text = await res.text()
    body = text ? JSON.parse(text) : null
  } catch {
    body = null
  }
  const detail = body && typeof body === "object" ? (body as { detail?: unknown }).detail : undefined
  return new ApiError(res.status, errorMessageFromBody(res.status, body), detail)
}

async function requestResponse(path: string, options: RequestInit = {}): Promise<Response> {
  const method = (options.method ?? "GET").toUpperCase()
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) || {}),
  }

  // Add CSRF token for mutating requests
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    const csrfToken = await ensureCsrfToken()
    if (csrfToken) {
      headers["X-CSRF-Token"] = csrfToken
    }
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: "include",
  })

  if (!res.ok) throw await toApiError(res)
  return res
}

async function request<T = any>(path: string, options?: RequestInit): Promise<T> {
  const res = await requestResponse(path, options)
  if (res.status === 204) return undefined as T
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

/** Risposta binaria (PDF, PNG, .apkg): mai res.json(). */
async function requestBlob(path: string): Promise<{ blob: Blob; filename: string | null }> {
  const response = await requestResponse(path)
  const disposition = response.headers.get("Content-Disposition") ?? ""
  const encodedName = /filename\*=utf-8''([^;]+)/i.exec(disposition)?.[1]
  const plainName = /filename="([^"]+)"/i.exec(disposition)?.[1]
  const filename = encodedName ? decodeURIComponent(encodedName) : plainName ?? null
  return { blob: await response.blob(), filename }
}

async function downloadFile(path: string, fallbackName: string) {
  const { blob, filename } = await requestBlob(path)
  const link = document.createElement("a")
  link.download = filename || fallbackName
  const url = URL.createObjectURL(blob)
  link.href = url
  document.body.append(link)
  try {
    link.click()
  } finally {
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}

function q(params: Record<string, string | number | boolean | null | undefined>): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") sp.set(k, String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ""
}

function enhanceFlashcard(card: any): any {
  return {
    ...card,
    // Normalize backend front/back → fronte/retro
    fronte: card.fronte ?? card.front ?? "",
    retro: card.retro ?? card.back ?? "",
    due_date: card.due_date ?? card.due ?? null,
    reps: card.reps ?? 0,
    interval: card.interval ?? 0,
  }
}

function enhanceLecture(lecture: any): Lecture {
  return {
    ...lecture,
    has_audio: Boolean(lecture.has_audio),
    has_slides: Boolean(lecture.n_slides && lecture.n_slides > 0),
    has_transcript: Boolean(lecture.transcript_source && lecture.transcript_source !== "none"),
    has_notes: Boolean(lecture.has_notes),
  }
}

function enhanceCourse(course: any): Course {
  return {
    ...course,
    shortname: course.fullname?.split("(")[0]?.trim() || course.fullname,
  }
}

export const api = {
  // Courses
  getCourses: () => request<any[]>(`/api/courses`).then((courses) => courses.map(enhanceCourse)),
  getCourse: (id: number) => request<any>(`/api/courses/${id}`).then(enhanceCourse),
  getCourseLectures: (id: number) =>
    request<any[]>(`/api/courses/${id}/lectures`).then((rows) => rows.map(enhanceLecture)),
  getNotesIndex: (id: number) => request<number[]>(`/api/courses/${id}/notes-index`),
  getCourseDocuments: (id: number, category?: string, limit?: number, offset?: number) =>
    request<CourseDocuments>(`/api/courses/${id}/documents${q({ category, limit, offset })}`),
  getCourseAnnouncements: (id: number, last = 10) =>
    request<{ items: string[] }>(`/api/courses/${id}/announcements${q({ last })}`),

  // Lectures (il JSON grezzo va passato a toLectureMedia in lib/lecture-media.ts)
  getLecture: (id: number) => request<any>(`/api/lectures/${id}`),
  getLectureNotes: (id: number) => request<any>(`/api/lectures/${id}/notes`),
  generateLectureNotes: (id: number) =>
    request<{ queued: number }>(`/api/lectures/${id}/notes`, { method: "POST" }),

  // AI
  getAIStatus: () => request<AIStatusResponse>(`/api/ai/status`),
  getAIProviders: () => request<AIProvidersStatus>(`/api/ai/providers`),
  getAIPanel: () => request<AIPanelData>(`/api/ai/pannello`),
  /** Backend: query `course_id` e `limit` (non un body JSON). */
  queueCourseNotes: (course_id: number, limit = 3) =>
    request<{ queued: number }>(`/api/ai/queue${q({ course_id, limit })}`, { method: "POST" }),
  cancelAIQueue: () => request<{ cancelled: number }>(`/api/ai/cancel`, { method: "POST" }),

  // Flashcards
  getDueFlashcards: (course_id?: number) =>
    request<any>(`/api/flashcards/due${q({ course_id })}`).then((data: any) => ({
      ...data,
      cards: (data.cards || []).map(enhanceFlashcard),
    })),
  importFlashcards: (course_id?: number) =>
    request<{ added: number }>(`/api/flashcards/import${q({ course_id })}`, { method: "POST" }),
  reviewFlashcard: (id: number, rating: number) =>
    request<any>(`/api/flashcards/${id}/review`, { method: "POST", body: JSON.stringify({ rating }) }),
  exportAnki: (courseId?: number) => downloadFile(`/api/flashcards/anki.tsv${q({ course_id: courseId })}`, "studyhub_flashcards.tsv"),
  exportAnkiApkg: (courseId?: number) => downloadFile(`/api/flashcards/anki.apkg${q({ course_id: courseId })}`, "studyhub_flashcards.apkg"),
  getFlashcardStats: (course_id?: number) => request<any>(`/api/flashcards/stats${q({ course_id })}`),

  // Tutor
  getTutorThreads: (course_id?: number) => request<any[]>(`/api/tutor/threads${q({ course_id })}`),
  createTutorThread: (course_id: number | null, mode: string = "normale") =>
    request<any>(`/api/tutor/threads`, { method: "POST", body: JSON.stringify({ course_id, mode }) }),
  getTutorThread: (id: number) => request<any>(`/api/tutor/threads/${id}`),
  askTutor: (id: number, question: string) =>
    request<any>(`/api/tutor/threads/${id}/ask`, { method: "POST", body: JSON.stringify({ question }) }),
  deleteTutorThread: (id: number) => request<{ ok: boolean }>(`/api/tutor/threads/${id}`, { method: "DELETE" }),

  // Quiz (n va in query: il backend non accetta un body)
  getLectureQuizzes: (lecture_id: number) => request<any[]>(`/api/lectures/${lecture_id}/quizzes`),
  generateQuiz: (lecture_id: number, n: number = 10) =>
    request<any>(`/api/lectures/${lecture_id}/quiz${q({ n })}`, { method: "POST" }),
  getQuiz: (id: number) => request<any>(`/api/quizzes/${id}`),
  submitQuiz: (id: number, answers: unknown[]) =>
    request<any>(`/api/quizzes/${id}/submit`, { method: "POST", body: JSON.stringify({ answers }) }),
  getQuizHistory: (course_id?: number) => request<any[]>(`/api/quizzes/history/list${q({ course_id })}`),

  // Study
  getPlan: () => request<PlanData>(`/api/plan`),
  getStudyCourses: () => request<StudyCourseOverview[]>(`/api/study`),
  getStudyCourseStats: (id: number) => request<any>(`/api/study/${id}`),
  prepareStudy: (id: number, limit?: number) =>
    request<any>(`/api/study/${id}/prepare`, { method: "POST", body: JSON.stringify({ limit: limit ?? null }) }),
  stopPrepare: (id: number) => request<any>(`/api/study/${id}/prepare/stop`, { method: "POST" }),
  getStudyTopicDetail: (topicId: number) => request<any>(`/api/study/topics/${topicId}`),
  getStudyChapters: (courseId: number) => request<any>(`/api/study/${courseId}/chapters`),
  getExcludedChapters: (courseId: number) => request<string[]>(`/api/study/${courseId}/chapters/excluded`),
  setChapterExcluded: (courseId: number, chapter: string, exclude: boolean = true) =>
    request<{ topics: number }>(`/api/study/${courseId}/chapters`, { method: "POST", body: JSON.stringify({ chapter, exclude }) }),
  getCourseArchetype: (courseId: number) => request<any>(`/api/courses/${courseId}/archetype`),
  getCourseMoodleStrategy: (courseId: number) => request<any>(`/api/courses/${courseId}/moodle-strategy`),
  /** Backend: query `n` (numero di lezioni da preparare), non un elenco di topic. */
  prefetchStudyLessons: (courseId: number, n = 4) =>
    request<{ topics: number[] }>(`/api/study/${courseId}/lessons/prefetch${q({ n })}`, { method: "POST" }),

  // Sessions (contratto: backend/src/studyhub/study/session.py)
  createSession: (course_id: number, minutes: number = 45, focus_topic?: number) =>
    request<any>(`/api/study/${course_id}/sessions`, { method: "POST", body: JSON.stringify({ minutes, focus_topic }) }).then(normalizeSession),
  getSession: (id: number) => request<any>(`/api/study/sessions/${id}`).then(normalizeSession),
  /** Sessione aperta più recente del corso (la ripresa sta sul server, non nel browser). null se non ce n'è (204). */
  getOpenSession: (courseId: number) =>
    request<any>(`/api/study/${courseId}/sessions/open`).then((raw) => (raw ? normalizeSession(raw) : null)),
  abandonSession: (id: number) =>
    request<any>(`/api/study/sessions/${id}/abandon`, { method: "POST" }).then(normalizeSession),
  /** Scheda letta: la voce della coda viene segnata fatta sul server. */
  seenSession: (id: number, idx: number) =>
    request<{ ok: boolean; done: boolean }>(`/api/study/sessions/${id}/seen/${idx}`, { method: "POST" }),
  answerSession: (id: number, answer: AnswerPayload) =>
    request<AnswerResult>(`/api/study/sessions/${id}/answer`, { method: "POST", body: JSON.stringify(answer) }),
  photoSession: (id: number, photo: PhotoPayload) =>
    request<AnswerResult>(`/api/study/sessions/${id}/photo`, { method: "POST", body: JSON.stringify(photo) }),
  /** Mostra la soluzione. La sicurezza dichiarata qui prevale su quella inviata con l'autovalutazione. */
  revealSession: (id: number, idx: number, body?: { confidence?: number; seconds?: number }) =>
    request<RevealResult>(`/api/study/sessions/${id}/reveal/${idx}`, {
      method: "POST",
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
  finishSession: (id: number) =>
    request<FinishResult>(`/api/study/sessions/${id}/finish`, { method: "POST" }),
  /** Scheda letta: segna la lezione dell'argomento come completata (nessuna AI). */
  completeTopicLesson: (topicId: number) =>
    request<{ ok: boolean }>(`/api/study/topics/${topicId}/lesson/done`, { method: "POST" }),
  /**
   * Flashcard da una risposta sbagliata. Predisposto: l'endpoint è chiesto al backend
   * (C:\Dev\sh-audit\f2-richieste-backend.md). Finché non c'è risponde 404/405 e la UI lo dice.
   */
  flashcardFromError: (attemptId: number) =>
    request<{ id: number; created?: boolean }>(`/api/flashcards/from-error`, { method: "POST", body: JSON.stringify({ attempt_id: attemptId }) }),

  // Exams
  createExam: (data: { course_id: number; date: string; kind?: string; note?: string }) =>
    request<{ id: number }>(`/api/exams`, { method: "POST", body: JSON.stringify(data) }),
  deleteExam: (id: number) => request<{ ok: boolean }>(`/api/exams/${id}`, { method: "DELETE" }),
  getCourseExam: (course_id: number) => request<any>(`/api/courses/${course_id}/exam`),
  generateExamProfile: (course_id: number, force: boolean = false) =>
    request<any>(`/api/courses/${course_id}/exam/profile`, { method: "POST", body: JSON.stringify({ force }) }),
  generateSimulation: (course_id: number) =>
    request<any>(`/api/courses/${course_id}/exam/sims`, { method: "POST" }),
  getSimulation: (id: string) => request<any>(`/api/sims/${id}`),
  submitSimulation: (id: string, answers: any[], elapsed_min?: number, submission_id?: string) =>
    request<any>(`/api/sims/${id}/submit`, { method: "POST", body: JSON.stringify({ answers, elapsed_min, submission_id }) }),

  // Feed (StudyTok shorts)
  getFeed: (course_id?: number, limit: number = 30) => request<any>(`/api/feed${q({ course_id, limit })}`),

  // Notifications (real news, not feed)
  getNotifications: () => request<any[]>(`/api/notifications`),
  markNotificationsRead: () => request<{ ok: boolean }>(`/api/notifications/read`, { method: "POST" }),

  // Search: il backend risponde {results, semantic}
  search: async (text: string, opts: { courseId?: number; year?: number; limit?: number; signal?: AbortSignal } = {}): Promise<SearchResponse> => {
    const filters = { q: text, course_id: opts.courseId, year: opts.year, limit: opts.limit ?? 20 }
    return toSearchResponse(await request<unknown>(`/api/search${q(filters)}`, { signal: opts.signal }))
  },
  searchSemantic: async (text: string, opts: { courseId?: number; year?: number; limit?: number; signal?: AbortSignal } = {}): Promise<SearchResponse> => {
    const filters = { q: text, course_id: opts.courseId, year: opts.year, limit: opts.limit ?? 20 }
    return toSearchResponse(await request<unknown>("/api/search", {
      method: "POST", body: JSON.stringify(filters), signal: opts.signal,
    }))
  },

  // Storage
  getStorage: () => request<StorageStatus>(`/api/storage`),

  // Documents (binari: niente res.json())
  getDocument: (id: number) => request<any>(`/api/docs/${id}`),
  documentFileUrl: (id: number, page?: number) => `/api/docs/${id}/file${page ? `#page=${page}` : ""}`,
  documentPageUrl: (id: number, page: number, dpi = 110) => `/api/docs/${id}/page/${page}.png?dpi=${dpi}`,

  // Export
  downloadLecturePdf: (lecture_id: number) => downloadFile(`/api/lectures/${lecture_id}/notes.pdf`, `appunti_lezione_${lecture_id}.pdf`),
  downloadCoursePdf: (course_id: number) => downloadFile(`/api/courses/${course_id}/dispensa.pdf`, `dispensa_corso_${course_id}.pdf`),

  // Setup
  getSetupStatus: () => request<SetupStatus>(`/api/setup`),
  setupLogin: () => request<{ started: boolean }>(`/api/setup/login`, { method: "POST" }),
  setupCourses: () => request<{ courses: number; active: number }>(`/api/setup/courses`, { method: "POST" }),
  setupFullrun: () => request<{ started: boolean }>(`/api/setup/fullrun`, { method: "POST" }),
  getFullrunStatus: () => request<any>(`/api/fullrun`),

  // UI version
  getUIVersion: (currentVersion?: string) => request<{ ui: string }>(`/api/version${q({ v: currentVersion })}`),
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})
