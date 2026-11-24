import { QueryClient } from "@tanstack/react-query"
import type {
  Course,
  Lecture,
  Quiz,
  ExamProfile,
  TutorThread,
  AIPanelData,
  PlanData,
  DueFlashcardsResponse,
  StudyCourseStats,
  StudyCourseOverview,
  AIProvidersStatus,
  FullrunStatus,
} from "@/types"

const API_BASE = ""
const CSRF_COOKIE_NAME = "csrf_token"

let cachedCsrfToken: string | null = null
let csrfFetchPromise: Promise<string | null> | null = null

export function setCsrfToken(token: string | null) {
  cachedCsrfToken = token
  if (typeof window !== "undefined") {
    (window as any).__csrf_token = token
  }
}

export function getCsrfToken(): string | null {
  if (cachedCsrfToken) return cachedCsrfToken
  if (typeof window !== "undefined") {
    const winToken = (window as any).__csrf_token
    if (winToken) return winToken
    return getCsrfTokenFromCookie()
  }
  return null
}

// Read CSRF token from cookie
export function getCsrfTokenFromCookie(): string | null {
  if (typeof document === "undefined") return null
  const cookies = document.cookie.split(";")
  for (const cookie of cookies) {
    const [name, value] = cookie.trim().split("=")
    if (name === CSRF_COOKIE_NAME) {
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

async function request<T = any>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options?.headers as Record<string, string> || {}),
  }

  // Add CSRF token for mutating requests
  if (options?.method && ["POST", "PUT", "PATCH", "DELETE"].includes(options.method.toUpperCase())) {
    const csrfToken = await ensureCsrfToken()
    if (csrfToken) {
      headers["X-CSRF-Token"] = csrfToken
    }
  }

  const res = await fetch(`${API_BASE}${path}`, {
    headers,
    ...options,
    credentials: "include", // Important: include cookies for CSRF
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: res.statusText }))
    throw new Error(error.message || `HTTP ${res.status}`)
  }

  if (res.status === 204) return undefined as any
  return res.json()
}

function enhanceFlashcard(card: any): any {
  return {
    ...card,
    // Normalize backend front/back → fronte/retro
    fronte: card.fronte ?? card.front ?? "",
    retro: card.retro ?? card.back ?? "",
    // Normalize due date field
    due_date: card.due_date ?? card.due ?? null,
    // Normalize ease_factor (backend may store as int * 1000 or as float)
    ease_factor: card.ease_factor ?? 2500,
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
  }
}

function enhanceCourse(course: any): Course {
  return {
    ...course,
    shortname: course.fullname?.split("(")[0]?.trim() || course.fullname,
    semester: course.active ? 1 : 2,
    readiness: course.lectures > 0 ? Math.round((course.ready || 0) / course.lectures * 100) : 0,
    next_exam_date: null,
  }
}

function enhanceLectures(lectures: any[]): Lecture[] {
  return lectures.map((lecture: any): Lecture => {
    return {
      ...lecture,
      has_audio: Boolean(lecture.has_audio),
      has_slides: Boolean(lecture.n_slides && lecture.n_slides > 0),
      has_transcript: Boolean(lecture.transcript_source && lecture.transcript_source !== "none"),
    };
  });
}

function enhanceSession(session: any): any {
  if (!session) return session;
  return {
    ...session,
    entries: (session.entries || []).map((entry: any, index: number) => ({
      ...entry,
      id: entry.id ?? index,
      idx: entry.idx ?? index,
    })),
  };
}


export const api = {
  // Courses
  getCourses: () => request<any[]>(`/api/courses`).then(courses => courses.map(enhanceCourse)),
  getCourse: (id: number) => request<any>(`/api/courses/${id}`).then(enhanceCourse),
  getCourseLectures: (id: number) =>
    request<any[]>(`/api/courses/${id}/lectures`).then(enhanceLectures),
  getNotesIndex: (id: number) => request<number[]>(`/api/courses/${id}/notes-index`),

  // Lectures
  getLecture: (id: number) =>
    request<any>(`/api/lectures/${id}`).then(enhanceLecture),
  getLectureNotes: (id: number) => request<any>(`/api/lectures/${id}/notes`),
  generateLectureNotes: (id: number) =>
    request<any>(`/api/lectures/${id}/notes`, { method: "POST" }),

  // AI
  getAIStatus: () => request<any>(`/api/ai/status`),
  getAIProviders: () => request<AIProvidersStatus>(`/api/ai/providers`),
  getAIPanel: () => request<AIPanelData>(`/api/ai/pannello`),
  queueAIJob: (job: { kind: string; course_id: number; lecture_id?: number; priority?: number }) =>
    request<any>(`/api/ai/queue`, { method: "POST", body: JSON.stringify(job) }),
  cancelAIJob: (id: number) =>
    request<any>(`/api/ai/cancel`, { method: "POST", body: JSON.stringify({ id }) }),

  // Flashcards
  getDueFlashcards: (course_id?: number) =>
    request<any>(`/api/flashcards/due${course_id ? `?course_id=${course_id}` : ''}`).then((data: any) => ({
      ...data,
      cards: (data.cards || data.flashcards || []).map(enhanceFlashcard),
    })),
  importFlashcards: (course_id?: number) =>
    request<any>(`/api/flashcards/import`, { method: "POST", body: JSON.stringify({ course_id }) }),
  reviewFlashcard: (id: number, rating: number) =>
    request<any>(`/api/flashcards/${id}/review`, { method: "POST", body: JSON.stringify({ rating }) }),
  exportAnki: () => request<string>(`/api/flashcards/anki.tsv`),
  exportAnkiApkg: (course_id?: number) =>
    request<Blob>(`/api/flashcards/anki.apkg${course_id ? `?course_id=${course_id}` : ''}`, { method: "GET" }),
  getFlashcardStats: (course_id?: number) => request<any>(`/api/flashcards/stats${course_id ? `?course_id=${course_id}` : ''}`),

  // Tutor
  getTutorThreads: (course_id?: number) => request<any[]>(`/api/tutor/threads${course_id ? `?course_id=${course_id}` : ''}`),
  createTutorThread: (course_id: number | null, mode: string = "normale") =>
    request<any>(`/api/tutor/threads`, { method: "POST", body: JSON.stringify({ course_id, mode }) }),
  getTutorThread: (id: string) => request<any>(`/api/tutor/threads/${id}`),
  askTutor: (id: string, question: string) =>
    request<any>(`/api/tutor/threads/${id}/ask`, { method: "POST", body: JSON.stringify({ question }) }),
  deleteTutorThread: (id: string) => request<any>(`/api/tutor/threads/${id}`, { method: "DELETE" }),

  // Quiz
  getLectureQuizzes: (lecture_id: number) => request<any[]>(`/api/lectures/${lecture_id}/quizzes`),
  generateQuiz: (lecture_id: number, n: number = 10) =>
    request<any>(`/api/lectures/${lecture_id}/quiz`, { method: "POST", body: JSON.stringify({ n }) }),
  getQuiz: (id: number) => request<any>(`/api/quizzes/${id}`),
  submitQuiz: (id: number, answers: any[]) =>
    request<any>(`/api/quizzes/${id}/submit`, { method: "POST", body: JSON.stringify({ answers }) }),
  getQuizHistory: (course_id?: number) => request<any>(`/api/quizzes/history/list${course_id ? `?course_id=${course_id}` : ''}`),

  // Study
  getPlan: () => request<PlanData>(`/api/plan`),
  getStudyCourses: () => request<StudyCourseOverview[]>(`/api/study`),
  getStudyCourseStats: (id: number) => request<any>(`/api/study/${id}`),
  getStudyTopics: (id: number) => request<any>(`/api/study/${id}`), // Returns topics with mastery
  prepareStudy: (id: number, limit?: number) =>
    request<any>(`/api/study/${id}/prepare`, { method: "POST", body: JSON.stringify({ limit }) }),
  scanStudy: (id: number) => request<any>(`/api/study/${id}/scan`),
  stopPrepare: (id: number) =>
    request<any>(`/api/study/${id}/prepare/stop`, { method: "POST" }),
  getStudyTopicDetail: (topicId: number) => request<any>(`/api/study/topics/${topicId}`),
  getStudyTopicLesson: (topicId: number) => request<any>(`/api/study/topics/${topicId}/lesson`),
  completeStudyTopicLesson: (topicId: number) => request<any>(`/api/study/topics/${topicId}/lesson/done`, { method: "POST" }),
  askStudyTopic: (topicId: number, question: string, context?: string, mode?: string) =>
    request<any>(`/api/study/topics/${topicId}/ask`, { method: "POST", body: JSON.stringify({ question, context, mode }) }),
  getStudyChapters: (courseId: number) => request<any>(`/api/study/${courseId}/chapters`),
  getExcludedChapters: (courseId: number) => request<any>(`/api/study/${courseId}/chapters/excluded`),
  excludeChapter: (courseId: number, chapter: string) =>
    request<any>(`/api/study/${courseId}/chapters`, { method: "POST", body: JSON.stringify({ chapter }) }),
  getStudyArchetype: (courseId: number) => request<any>(`/api/courses/${courseId}/archetype`),
  getMoodleStrategy: (courseId: number) => request<any>(`/api/courses/${courseId}/moodle-strategy`),
  getStudyTopicArtifact: (topicId: number) => request<any>(`/api/study/topics/${topicId}/artifact`),
  getStudyTopicScript: (topicId: number) => request<any>(`/api/study/topics/${topicId}/script.m`),
  prefetchStudyLessons: (courseId: number, topicIds: number[]) =>
    request<any>(`/api/study/${courseId}/lessons/prefetch`, { method: "POST", body: JSON.stringify({ topic_ids: topicIds }) }),

  // Sessions
  createSession: (course_id: number, minutes: number = 45, focus_topic?: number) =>
    request<any>(`/api/study/${course_id}/sessions`, { method: "POST", body: JSON.stringify({ minutes, focus_topic }) }).then(enhanceSession),
  getSession: (id: number) => request<any>(`/api/study/sessions/${id}`).then(enhanceSession),
  answerSession: (id: number, answer: any) =>
    request<any>(`/api/study/sessions/${id}/answer`, { method: "POST", body: JSON.stringify(answer) }),
  photoSession: (id: number, photo: any) =>
    request<any>(`/api/study/sessions/${id}/photo`, { method: "POST", body: JSON.stringify(photo) }),
  revealSession: (id: number, idx: number) =>
    request<any>(`/api/study/sessions/${id}/reveal/${idx}`, { method: "POST" }),
  finishSession: (id: number) =>
    request<any>(`/api/study/sessions/${id}/finish`, { method: "POST" }),

  // Exams
  createExam: (data: { course_id: number; date: string; kind?: string; note?: string }) =>
    request<any>(`/api/exams`, { method: "POST", body: JSON.stringify(data) }),
  deleteExam: (id: number) => request<any>(`/api/exams/${id}`, { method: "DELETE" }),
  getCourseExam: (course_id: number) => request<any>(`/api/courses/${course_id}/exam`),
  generateExamProfile: (course_id: number, force: boolean = false) =>
    request<any>(`/api/courses/${course_id}/exam/profile`, { method: "POST", body: JSON.stringify({ force }) }),
  generateSimulations: (course_id: number, count: number) =>
    request<any>(`/api/courses/${course_id}/exam/sims`, { method: "POST", body: JSON.stringify({ count }) }),
  getSimulation: (id: string) => request<any>(`/api/sims/${id}`),
  submitSimulation: (id: string, answers: any[], elapsed_min?: number) =>
    request<any>(`/api/sims/${id}/submit`, { method: "POST", body: JSON.stringify({ answers, elapsed_min }) }),
  getExamSims: (course_id: number) => request<any>(`/api/courses/${course_id}/exam/sims`),
  getExamSim: (sim_id: string) => request<any>(`/api/sims/${sim_id}`),

  // Feed (StudyTok shorts)
  getFeed: (course_id?: number, limit: number = 30) => request<any>(`/api/feed${course_id ? `?course_id=${course_id}&limit=${limit}` : `?limit=${limit}`}`),

  // Notifications (real news, not feed)
  getNotifications: () => request<any[]>(`/api/notifications`),
  markNotificationsRead: () => request<{ ok: boolean }>(`/api/notifications/read`, { method: "POST" }),

  // Fullrun
  getFullrunStatus: () => request<any>(`/api/fullrun`),

  // Search
  search: (q: string, course_id?: number, year?: number, limit: number = 20) =>
    request<any>(`/api/search?q=${encodeURIComponent(q)}${course_id ? `&course_id=${course_id}` : ""}${year ? `&year=${year}` : ""}&limit=${limit}`),

  // Storage
  getStorage: () => request<any>(`/api/storage`),

  // Documents
  getDocument: (id: number) => request<any>(`/api/docs/${id}`),
  getDocumentFile: (id: number) => request<Blob>(`/api/docs/${id}/file`),
  getDocumentPage: (id: number, page: number, dpi: number = 110) => request<Blob>(`/api/docs/${id}/page/${page}.png?dpi=${dpi}`),

  // Export
  exportLecturePdf: (lecture_id: number) => request<Blob>(`/api/lectures/${lecture_id}/notes.pdf`),
  exportCoursePdf: (course_id: number) => request<Blob>(`/api/courses/${course_id}/dispensa.pdf`),

  // Setup
  getSetupStatus: () => request<any>(`/api/setup`),
  setupLogin: () => request<{ started: boolean }>(`/api/setup/login`, { method: "POST" }),
  setupCourses: () => request<{ courses: number; active: number }>(`/api/setup/courses`, { method: "POST" }),
  setupFullrun: () => request<{ started: boolean }>(`/api/setup/fullrun`, { method: "POST" }),

  // Study chapters
  setChapterExcluded: (course_id: number, chapter: string, exclude: boolean = true) =>
    request<any>(`/api/study/${course_id}/chapters`, { method: "POST", body: JSON.stringify({ chapter, exclude }) }),

  // Course archetype & moodle strategy
  getCourseArchetype: (course_id: number) => request<any>(`/api/courses/${course_id}/archetype`),
  getCourseMoodleStrategy: (course_id: number) => request<any>(`/api/courses/${course_id}/moodle-strategy`),

  // UI version
  getUIVersion: (currentVersion?: string) => request<{ ui: string }>(`/api/version${currentVersion ? `?v=${currentVersion}` : ""}`),
  getUIClients: () => request<any>(`/api/version/clients`),
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