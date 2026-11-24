import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { MILESTONES, useGamification } from "./use-gamification"

beforeEach(() => localStorage.clear())

describe("useGamification", () => {
  it("accumula XP e sale di livello (100 XP per il livello 2)", () => {
    const { result } = renderHook(() => useGamification())
    expect(result.current.level).toBe(1)
    act(() => result.current.addXp(100))
    expect(result.current.xp).toBe(100)
    expect(result.current.level).toBe(2)
  })
  it("ignora XP negativi", () => {
    const { result } = renderHook(() => useGamification())
    act(() => result.current.addXp(-50))
    expect(result.current.xp).toBe(0)
  })
  it("più azioni nello stesso tick non si sovrascrivono", () => {
    const { result } = renderHook(() => useGamification())
    act(() => {
      result.current.addXp(30)
      result.current.recordSession()
      result.current.addXp(20)
    })
    expect(result.current.xp).toBe(50)
    const saved = JSON.parse(localStorage.getItem("studyhub-gamification")!)
    expect(saved.totalSessions).toBe(1)
    expect(saved.unlockedMilestones).toContain("first-session")
  })
  it("sblocca la milestone una sola volta e avvisa i listener", async () => {
    const { result } = renderHook(() => useGamification())
    const cb = vi.fn()
    act(() => { result.current.onMilestone(cb) })
    act(() => result.current.recordSession())
    act(() => result.current.recordSession())
    await Promise.resolve()
    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb.mock.calls[0][0].id).toBe("first-session")
  })
  it("la streak parte da 1 e il reset la azzera", () => {
    const { result } = renderHook(() => useGamification())
    act(() => result.current.incrementStreak())
    expect(result.current.streak).toBe(1)
    act(() => result.current.resetStreak())
    expect(result.current.streak).toBe(0)
  })
  it("riprende lo stato salvato e tollera JSON corrotto", () => {
    localStorage.setItem("studyhub-gamification", JSON.stringify({ xp: 250 }))
    expect(renderHook(() => useGamification()).result.current.xp).toBe(250)
    localStorage.setItem("studyhub-gamification", "{rotto")
    expect(renderHook(() => useGamification()).result.current.xp).toBe(0)
  })
  it("tutte le milestone hanno id unici", () => {
    expect(new Set(MILESTONES.map((m) => m.id)).size).toBe(MILESTONES.length)
  })
})
