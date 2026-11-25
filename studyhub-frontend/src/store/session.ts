import { create } from "zustand"
import { persist } from "zustand/middleware"

interface StudySession {
  id: string                    // frontend UUID
  backendId?: number            // backend session ID
  courseId: number
  focusTopic?: number
  duration: number              // minutes: 25, 45, 90
  startedAt: Date
  completedAt?: Date
  xpEarned: number
  questionsAnswered: number
  correctAnswers: number
  entries?: any[]               // session entries from backend
  /** Schede lette in questa sessione: il backend le segna fatte solo se la lezione dell'argomento esiste. */
  localDone?: number[]
}

interface SessionState {
  currentSession: StudySession | null
  startSession: (courseId: number, duration: number, backendId?: number, entries?: any[], focusTopic?: number) => void
  endSession: (results: { xpEarned: number; questionsAnswered: number; correctAnswers: number }) => void
  cancelSession: () => void
  updateSessionProgress: (progress: Partial<StudySession>) => void
  markLocalDone: (backendId: number, idx: number) => void
  todaySessions: StudySession[]
  addToHistory: (session: StudySession) => void
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set, get) => ({
      currentSession: null,
      todaySessions: [],

      startSession: (courseId, duration, backendId, entries, focusTopic) => {
        const session: StudySession = {
          id: crypto.randomUUID(),
          courseId,
          focusTopic,
          duration,
          startedAt: new Date(),
          xpEarned: 0,
          questionsAnswered: 0,
          correctAnswers: 0,
          backendId,
          entries,
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

      updateSessionProgress: (progress) =>
        set((state) => ({
          currentSession: state.currentSession
            ? { ...state.currentSession, ...progress }
            : null,
        })),

      markLocalDone: (backendId, idx) =>
        set((state) => {
          const s = state.currentSession
          if (!s || s.backendId !== backendId || s.localDone?.includes(idx)) return state
          return { currentSession: { ...s, localDone: [...(s.localDone ?? []), idx] } }
        }),

      addToHistory: (session) =>
        set((s) => ({ todaySessions: [session, ...s.todaySessions].slice(0, 50) })),
    }),
    { name: "studyhub-session" }
  )
)
