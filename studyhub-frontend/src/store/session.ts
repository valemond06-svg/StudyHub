import { create } from "zustand"
import { persist } from "zustand/middleware"

interface StudySession {
  id: string
  courseId: number
  duration: number // minutes: 25, 45, 90
  startedAt: Date
  completedAt?: Date
  xpEarned: number
  questionsAnswered: number
  correctAnswers: number
}

interface SessionState {
  currentSession: StudySession | null
  startSession: (courseId: number, duration: number) => void
  endSession: (results: { xpEarned: number; questionsAnswered: number; correctAnswers: number }) => void
  cancelSession: () => void
  todaySessions: StudySession[]
  addToHistory: (session: StudySession) => void
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set, get) => ({
      currentSession: null,
      todaySessions: [],

      startSession: (courseId, duration) => {
        const session: StudySession = {
          id: crypto.randomUUID(),
          courseId,
          duration,
          startedAt: new Date(),
          xpEarned: 0,
          questionsAnswered: 0,
          correctAnswers: 0,
        }
        set({ currentSession: session })
      },

      endSession: (results) => {
        const { currentSession, todaySessions } = get()
        if (!currentSession) return

        const completedSession: StudySession = {
          ...currentSession,
          completedAt: new Date(),
          ...results,
        }

        set({
          currentSession: null,
          todaySessions: [completedSession, ...todaySessions].slice(0, 50),
        })
      },

      cancelSession: () => set({ currentSession: null }),

      addToHistory: (session) =>
        set((s) => ({ todaySessions: [session, ...s.todaySessions].slice(0, 50) })),
    }),
    { name: "studyhub-session" }
  )
)