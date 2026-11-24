import { beforeEach, describe, expect, it } from "vitest"
import { useSessionStore } from "./session"

beforeEach(() => {
  localStorage.clear()
  useSessionStore.setState({ currentSession: null, todaySessions: [] })
})

describe("useSessionStore", () => {
  it("avvia, aggiorna e chiude una sessione spostandola nella cronologia", () => {
    const s = useSessionStore.getState()
    s.startSession(7, 25, 99)
    expect(useSessionStore.getState().currentSession).toMatchObject({ courseId: 7, duration: 25, backendId: 99 })
    useSessionStore.getState().updateSessionProgress({ questionsAnswered: 3 })
    useSessionStore.getState().endSession({ xpEarned: 40, questionsAnswered: 5, correctAnswers: 4 })
    const st = useSessionStore.getState()
    expect(st.currentSession).toBeNull()
    expect(st.todaySessions[0]).toMatchObject({ xpEarned: 40, correctAnswers: 4 })
    expect(st.todaySessions[0].completedAt).toBeDefined()
  })
  it("endSession senza sessione non fa nulla", () => {
    useSessionStore.getState().endSession({ xpEarned: 1, questionsAnswered: 1, correctAnswers: 1 })
    expect(useSessionStore.getState().todaySessions).toHaveLength(0)
  })
  it("cancelSession scarta la sessione senza storico", () => {
    useSessionStore.getState().startSession(1, 45)
    useSessionStore.getState().cancelSession()
    expect(useSessionStore.getState().currentSession).toBeNull()
    expect(useSessionStore.getState().todaySessions).toHaveLength(0)
  })
  it("la cronologia tiene al massimo 50 sessioni", () => {
    for (let i = 0; i < 55; i++) {
      useSessionStore.getState().startSession(1, 25)
      useSessionStore.getState().endSession({ xpEarned: i, questionsAnswered: 0, correctAnswers: 0 })
    }
    expect(useSessionStore.getState().todaySessions).toHaveLength(50)
    expect(useSessionStore.getState().todaySessions[0].xpEarned).toBe(54)
  })
})
