import { describe, expect, it } from "vitest"
import {
  applyAnswer,
  firstPending,
  measuredSeconds,
  normalizeSession,
  planPhases,
  resumeIndex,
  selfAssessmentPayload,
  sourceHref,
  topicName,
  topicsToReview,
  verdictFromChecks,
  type AnswerResult,
} from "./study-session"

// Formato reale di GET /api/study/sessions/{sid} (session.get)
const raw = {
  id: 31, course_id: 7, minutes: 45, started_at: "2026-11-25T10:00:00", ended_at: null, xp: 12,
  entries: [
    { t: "domanda", item: 501, done: true, score: 1, question: { id: 501, kind: "multipla", difficulty: 1, prompt_md: "A?", topic_id: 4, doc_id: null, page: null, lecture_id: 9, t_start: 75, options: ["x", "y"], n_criteria: 0 } },
    { t: "scheda", topic: 4, done: false },
    { t: "domanda", item: 502, done: false, revealed: true, question: { id: 502, kind: "aperta", difficulty: 2, prompt_md: "B?", topic_id: 4, doc_id: 3, page: 12, lecture_id: null, t_start: null, options: null, n_criteria: 2 } },
    { t: "domanda", item: 503, boss: true, done: false, question: { id: 503, kind: "esercizio", difficulty: 3, prompt_md: "C?", topic_id: 5, doc_id: null, page: null, lecture_id: null, t_start: null, options: null, n_criteria: 3 } },
  ],
  topics: { "4": { id: 4, name: "Serie di Laurent", summary_md: "..." }, "5": { id: 5, name: "Residui" } },
  resume_index: 1, phase: "scheda", errors: [],
}

const result = (over: Partial<AnswerResult> = {}): AnswerResult => ({
  attempt_id: 1, score: 0, correct: 0, answer_md: "", rubric: [], criteria_ok: [], feedback_md: null,
  graded_by: "auto", xp: 0, retry: false, requeued: null, ...over,
})

describe("study-session", () => {
  it("normalizza idx e done e riprende dall'indice del server", () => {
    const s = normalizeSession(raw)
    expect(s.entries.map((e) => e.idx)).toEqual([0, 1, 2, 3])
    expect(s.entries[1].done).toBe(false)
    expect(resumeIndex(s)).toBe(1)
  })

  it("salta la scheda letta in locale anche se il server non la segna", () => {
    const s = normalizeSession(raw)
    expect(resumeIndex(s, new Set([1]))).toBe(2)
    expect(firstPending(s.entries, new Set([1]), 3)).toBe(3)
    expect(resumeIndex({ ...s, ended_at: "x" })).toBeNull()
  })

  it("aggiunge in coda la domanda rimessa dal server, una volta sola", () => {
    const s = normalizeSession(raw)
    const requeued = { idx: 4, t: "domanda", item: 502, retry: true, done: false, question: s.entries[2].question }
    const once = applyAnswer(s, 2, result({ score: 0.2, xp: 0, requeued }))
    const twice = applyAnswer(once, 2, result({ score: 0.2, requeued }))
    expect(twice.entries).toHaveLength(5)
    expect(twice.entries[2].done).toBe(true)
    expect(twice.entries[4]).toMatchObject({ idx: 4, retry: true, done: false })
    expect(firstPending(twice.entries, new Set([1]), 3)).toBe(3)
  })

  it("nome dell'argomento, mai Topic N", () => {
    const s = normalizeSession(raw)
    expect(topicName(s, 4)).toBe("Serie di Laurent")
    expect(topicName(s, 99)).toBe("")
  })

  it("fasi informative proporzionate alla durata scelta", () => {
    const s = normalizeSession(raw)
    const p25 = planPhases(s.entries, 25)
    const p90 = planPhases(s.entries, 90)
    expect(p25.map((p) => p.key)).toEqual(["ripasso", "boss"])
    expect(p25.reduce((a, p) => a + p.budget, 0)).toBeCloseTo(25 * 60, -1)
    expect(p90.reduce((a, p) => a + p.budget, 0)).toBeCloseTo(90 * 60, -1)
    expect(p25[0]).toMatchObject({ total: 3, done: 1 })
  })

  it("misura i secondi reali", () => {
    expect(measuredSeconds(1_000, 43_500)).toBe(42.5)
    expect(measuredSeconds(5_000, 1_000)).toBe(0)
    expect(measuredSeconds(0, 10 * 3600_000)).toBe(3600)
  })

  it("autovalutazione: spunte sui criteri oppure giudizio complessivo", () => {
    expect(selfAssessmentPayload(["a", "b"], [true, false], null)).toEqual({ self_criteria: [true, false] })
    expect(selfAssessmentPayload(["a", "b"], null, "parziale")).toEqual({ self_score: 0.5 })
    expect(selfAssessmentPayload([], null, "si")).toEqual({ self_score: 1 })
    expect(selfAssessmentPayload([], null, null)).toBeNull()
    expect(verdictFromChecks([true, true])).toBe("si")
    expect(verdictFromChecks([true, false])).toBe("parziale")
    expect(verdictFromChecks([false])).toBe("no")
  })

  it("link alla fonte: lezione al secondo, PDF alla pagina", () => {
    expect(sourceHref(7, { lecture_id: 9, t_start: 75.6 })).toBe("/corsi/7?lezione=9&t=75")
    expect(sourceHref(7, { doc_id: 3, page: 12 })).toBe("/api/docs/3/file#page=12")
    expect(sourceHref(7, {})).toBeNull()
  })

  it("argomenti da rivedere ordinati per errori", () => {
    const wrong = [
      { id: 1, attempt_id: 1, prompt_md: "", topic: "A", lecture_id: null, t_start: null, doc_id: null, page: null },
      { id: 2, attempt_id: 2, prompt_md: "", topic: "B", lecture_id: null, t_start: null, doc_id: null, page: null },
      { id: 3, attempt_id: 3, prompt_md: "", topic: "B", lecture_id: null, t_start: null, doc_id: null, page: null },
    ]
    expect(topicsToReview(wrong)).toEqual([{ name: "B", count: 2 }, { name: "A", count: 1 }])
  })
})
