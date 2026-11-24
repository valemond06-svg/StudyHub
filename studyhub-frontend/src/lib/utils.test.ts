import { describe, expect, it } from "vitest"
import { cn, safeDaysLeft, safeFormatDistance } from "./utils"

describe("cn", () => {
  it("unisce le classi e risolve i conflitti Tailwind", () => {
    expect(cn("px-2", "px-4")).toBe("px-4")
    expect(cn("a", { b: false }, undefined, "c")).toBe("a c")
  })
})

describe("safeFormatDistance", () => {
  it("restituisce il fallback per valori mancanti o non validi", () => {
    expect(safeFormatDistance(null)).toBe("Data non disponibile")
    expect(safeFormatDistance("non-una-data", "n/d")).toBe("n/d")
  })
  it("formatta in italiano una data valida", () => {
    const iso = new Date(Date.now() - 3 * 86_400_000).toISOString()
    expect(safeFormatDistance(iso)).toMatch(/fa$/)
  })
})

describe("safeDaysLeft", () => {
  it("gestisce null e date invalide", () => {
    expect(safeDaysLeft(undefined)).toBeNull()
    expect(safeDaysLeft("xx")).toBeNull()
  })
  it("non va mai sotto zero", () => {
    expect(safeDaysLeft("2000-01-01")).toBe(0)
  })
  it("conta i giorni mancanti", () => {
    const d = new Date(Date.now() + 5 * 86_400_000).toISOString()
    expect(safeDaysLeft(d)).toBeGreaterThanOrEqual(4)
  })
})
