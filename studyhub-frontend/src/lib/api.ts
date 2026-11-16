import { QueryClient } from "@tanstack/react-query"
import type { Course, Lecture, Flashcard, Quiz, ExamProfile, Simulation, TutorThread, AIPanelData } from "@/types"

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

const API_BASE = ""

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
    ...options,
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: res.statusText }))
    throw new Error(error.message || `HTTP ${res.status}`)
  }

  if (res.status === 204) return undefined as T
  return res.json()
}

export const api = {
  // Courses
  getCourses: () => request<Course[]>("/api/courses"),
  getCourse: (id: number) => request<Course>(`/api/courses/${id}`),
  getCourseLectures: (id: number) => request<Lecture[]>(`/api/courses/${id}/lectures`),
  getNotesIndex: (id: number) => request<any>(`/api/courses/${id}/notes-index`),

  // Lectures
  getLecture: (id: number) => request<Lecture>(`/api/lectures/${id}`),
  getLectureNotes: (id: number) => request<any>(`/api/lectures/${id}/notes`),
  generateLectureNotes: (id: number) =>
    request<any>(`/api/lectures/${id}/notes`, { method: "POST" }),

  // AI
  getAIStatus: () => request<any>("/api/ai/status"),
  getAIPanel: () => request<AIPanelData>("/api/ai/pannello"),
  queueAIJob: (job: { kind: string; course_id: number; lecture_id?: number; priority?: number }) =>
    request<any>("/api/ai/queue", { method: "POST", body: JSON.stringify(job) }),
  cancelAIJob: (id: number) =>
    request<any>(`/api/ai/cancel`, { method: "POST", body: JSON.stringify({ id }) }),

  // Flashcards
  getDueFlashcards: () => request<Flashcard[]>("/api/flashcards/due"),
  importFlashcards: (cards: any[]) =>
    request<any>("/api/flashcards/import", { method: "POST", body: JSON.stringify({ cards }) }),
  reviewFlashcard: (id: number, rating: number) =>
    request<any>(`/api/flashcards/${id}/review`, { method: "POST", body: JSON.stringify({ rating }) }),
  exportAnki: () => request<string>("/api/flashcards/anki.tsv"),

  // Tutor
  getTutorThreads: () => request<TutorThread[]>("/api/tutor/threads"),
  createTutorThread: (course_id: number, title: string) =>
    request<TutorThread>("/api/tutor/threads", { method: "POST", body: JSON.stringify({ course_id, title }) }),
  getTutorThread: (id: string) => request<TutorThread>(`/api/tutor/threads/${id}`),
  askTutor: (id: string, question: string) =>
    request<any>(`/api/tutor/threads/${id}/ask`, { method: "POST", body: JSON.stringify({ question }) }),

  // Quiz
  getLectureQuizzes: (lecture_id: number) => request<Quiz[]>(`/api/lectures/${lecture_id}/quizzes`),
  generateQuiz: (lecture_id: number) =>
    request<Quiz>(`/api/lectures/${lecture_id}/quiz`, { method: "POST" }),
  getQuiz: (id: number) => request<Quiz>(`/api/quizzes/${id}`),
  submitQuiz: (id: number, answers: any) =>
    request<any>(`/api/quizzes/${id}/submit`, { method: "POST", body: JSON.stringify({ answers }) }),

  // Study
  getPlan: () => request<any>("/api/plan"),
  getStudyCourse: (id: number) => request<any>(`/api/study/${id}`),
  prepareStudy: (id: number) =>
    request<any>(`/api/study/${id}/prepare`, { method: "POST" }),
  scanStudy: (id: number) => request<any>(`/api/study/${id}/scan`),
  stopPrepare: (id: number) =>
    request<any>(`/api/study/${id}/prepare/stop`, { method: "POST" }),

  // Sessions
  createSession: (course_id: number) =>
    request<any>(`/api/study/${course_id}/sessions`, { method: "POST" }),
  getSession: (id: string) => request<any>(`/api/study/sessions/${id}`),
  answerSession: (id: string, answer: any) =>
    request<any>(`/api/study/sessions/${id}/answer`, { method: "POST", body: JSON.stringify(answer) }),
  photoSession: (id: string, photo: string) =>
    request<any>(`/api/study/sessions/${id}/photo`, { method: "POST", body: JSON.stringify({ photo }) }),
  revealSession: (id: string, idx: number) =>
    request<any>(`/api/study/sessions/${id}/reveal/${idx}`, { method: "POST" }),
  finishSession: (id: string) =>
    request<any>(`/api/study/sessions/${id}/finish`, { method: "POST" }),

  // Exams
  getExams: () => request<any[]>("/api/exams"),
  createExam: (data: any) =>
    request<any>("/api/exams", { method: "POST", body: JSON.stringify(data) }),
  deleteExam: (id: number) => request<any>(`/api/exams/${id}`, { method: "DELETE" }),
  getCourseExam: (course_id: number) => request<any>(`/api/courses/${course_id}/exam`),
  generateExamProfile: (course_id: number) =>
    request<any>(`/api/courses/${course_id}/exam/profile`, { method: "POST" }),
  generateSimulations: (course_id: number, count: number) =>
    request<any>(`/api/courses/${course_id}/exam/sims`, { method: "POST", body: JSON.stringify({ count }) }),
  getSimulation: (id: string) => request<Simulation>(`/api/sims/${id}`),
  submitSimulation: (id: string, answers: any) =>
    request<any>(`/api/sims/${id}/submit`, { method: "POST", body: JSON.stringify({ answers }) }),

  // Feed
  getFeed: () => request<any>("/api/feed"),

  // Fullrun
  getFullrunStatus: () => request<any>("/api/fullrun"),

  // Search
  search: (q: string) => request<any>(`/api/search?q=${encodeURIComponent(q)}`),

  // Storage
  getStorage: () => request<any>("/api/storage"),

  // Documents
  getDocument: (id: number) => request<any>(`/api/docs/${id}`),
  getDocumentFile: (id: number) => request<any>(`/api/docs/${id}/file`),
  getDocumentPage: (id: number, page: number) => request<any>(`/api/docs/${id}/page/${page}.png`),
}