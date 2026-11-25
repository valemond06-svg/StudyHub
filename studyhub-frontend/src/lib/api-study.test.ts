import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError, setCsrfToken } from "@/lib/api"
import { studyApi, toReviewCard } from "@/lib/api-study"
import { blockHref, sourceDraft, sourcePayload, studySource } from "@/lib/study-navigation"
import * as f from "./__fixtures__/study-api"

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
  setCsrfToken("test-csrf")
})
afterEach(() => {
  setCsrfToken(null)
  vi.unstubAllGlobals()
})

describe("Client API dello studio", () => {
  const reads = [
    ["GET /api/notes?course_id=7&lecture_id=9&q=matrice&tag=esame&limit=30&offset=30", () => studyApi.notes({ course_id: 7, lecture_id: 9, q: "matrice", tag: "esame", limit: 30, offset: 30 }), { notes: [f.note] }],
    ["GET /api/flashcards?course_id=7&limit=30&offset=0", () => studyApi.cards(7, 30, 0), { cards: [f.card] }],
    ["GET /api/review/today?course_id=7&limit=50", () => studyApi.review(7), f.review],
    ["GET /api/plan/week?start=2026-11-25&missed_day=2026-11-25", () => studyApi.week(f.day, f.day), f.recomputed],
    ["GET /api/settings/availability", studyApi.availability, f.availability],
    ["GET /api/focus?limit=1", studyApi.focus, { sessions: [f.focus] }],
    ["GET /api/focus/summary?course_id=7&day=2026-11-25", () => studyApi.focusSummary(7, f.day), f.summary],
    ["GET /api/study/topics/17/lesson?prepare=false", () => studyApi.lesson(17), f.lessonReady],
    ["GET /api/lectures/9/notes", () => studyApi.lectureNotes(9), f.lectureNotes],
    ["GET /api/ai/status", studyApi.lectureNoteJobs, { jobs: [{ id: 20, target_id: 9, kind: "lecture_notes", status: "in_coda", message: null }], paused_reason: null }],
    ["GET /api/lectures/9/topics", () => studyApi.lectureTopics(9), f.lectureTopics],
    ["GET /api/lectures/9/quizzes", () => studyApi.lectureQuizzes(9), f.quizList],
    ["GET /api/quizzes/11", () => studyApi.quiz(11), f.quiz],
    ["GET /api/system/status", studyApi.systemStatus, f.system],
  ] as const

  it.each(reads)("legge %s", async (route, run, payload) => {
    const [method, path] = route.split(" ")
    fetchMock.mockResolvedValueOnce(Response.json(payload))
    expect(await run()).toEqual(payload)
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(path, expect.objectContaining({ method, credentials: "include" }))
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).has("X-CSRF-Token")).toBe(false)
  })

  const noteInput = { course_id: 7, body: f.note.body, tags: f.note.tags, lecture_id: 9, timestamp_s: 92.5 }
  const cardInput = { course_id: 7, front: f.card.front, back: f.card.back, doc_id: 40, page: 12 }
  const examInput = { course_id: 7, date: f.exam.date, kind: f.exam.kind, note: null }
  const focusInput = { course_id: 7, task: f.focus.task, planned_seconds: 1500, kind: "focus" as const }
  const writes = [
    ["POST /api/notes", () => studyApi.createNote(noteInput), noteInput, f.note, 201],
    ["PATCH /api/notes/4", () => studyApi.editNote(4, { lecture_id: null, timestamp_s: null, tags: [] }), { lecture_id: null, timestamp_s: null, tags: [] }, { ...f.note, lecture_id: null, timestamp_s: null, tags: [] }, 200],
    ["DELETE /api/notes/4", () => studyApi.deleteNote(4), undefined, undefined, 204],
    ["POST /api/flashcards", () => studyApi.createCard(cardInput), cardInput, f.card, 201],
    ["PATCH /api/flashcards/10", () => studyApi.editCard(10, { suspended: true }), { suspended: true }, { ...f.card, suspended: true }, 200],
    ["DELETE /api/flashcards/10", () => studyApi.deleteCard(10), undefined, undefined, 204],
    ["POST /api/plan/recompute", () => studyApi.recompute(f.day, f.day), { missed_day: f.day, start: f.day }, f.recomputed, 200],
    ["PUT /api/settings/availability", () => studyApi.saveAvailability(f.availability), f.availability, f.availability, 200],
    ["POST /api/exams", () => studyApi.createExam(examInput), examInput, { id: 3 }, 200],
    ["DELETE /api/exams/3", () => studyApi.deleteExam(3), undefined, { ok: true }, 200],
    ["POST /api/focus/start", () => studyApi.startFocus(focusInput), focusInput, f.focus, 201],
    ["POST /api/focus/6/stop", () => studyApi.stopFocus(6), undefined, { ...f.focus, status: "stopped", stopped_at: "2026-11-25T10:02:00+00:00" }, 200],
    ["POST /api/study/topics/17/lesson/prepare", () => studyApi.prepareLesson(17), undefined, { ...f.lessonMissing, status: "in_coda" }, 200],
    ["POST /api/study/topics/17/lesson/done", () => studyApi.completeLesson(17), undefined, { ok: true }, 200],
    ["POST /api/lectures/9/notes", () => studyApi.queueLectureNotes(9), undefined, { queued: [20] }, 200],
    ["POST /api/lectures/9/quiz?n=10", () => studyApi.generateQuiz(9), undefined, { id: 11, cached: false, utilization: 0.1 }, 200],
    ["POST /api/quizzes/11/submit", () => studyApi.submitQuiz(11, [0, "Combinazioni lineari"]), { answers: [0, "Combinazioni lineari"] }, f.correction, 200],
  ] as const

  it.each(writes)("invia %s con CSRF", async (route, run, body, response, status) => {
    const [method, path] = route.split(" ")
    fetchMock.mockResolvedValueOnce(status === 204 ? new Response(null, { status }) : Response.json(response, { status }))
    expect(await run()).toEqual(response)
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(path, expect.objectContaining({ method, credentials: "include", body: JSON.stringify(body) }))
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("X-CSRF-Token")).toBe("test-csrf")
  })

  it("mantiene status e detail di FastAPI", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ detail: "C'è già una sessione in corso" }, { status: 409 }))
    await expect(studyApi.startFocus(focusInput)).rejects.toEqual(new ApiError(409, "C'è già una sessione in corso", "C'è già una sessione in corso"))
  })
})

describe("Adattatori di attività e fonti", () => {
  it("traduce i blocchi e preserva il topic", () => {
    expect(blockHref(f.block)).toBe("/studio/7?duration=25&topic=17")
    expect(blockHref({ ...f.block, kind: "theory" })).toBe("/impara/17?lettura=appunti")
    expect(blockHref({ ...f.block, kind: "simulation" })).toBe("/corsi/7?tab=esame#simulazioni")
    expect(blockHref({ ...f.block, kind: "fsrs" })).toBe("/flashcard?corso=7&ripasso=1")
  })
  it("preserva tempi anche a zero, pagina PDF e campi del ripasso", () => {
    expect(studySource(7, f.note, 0)).toBe("/corsi/7?lezione=9&t=0")
    // url_hint del backend: /api/docs/40/file#page=12 → visore interno dell'app alla stessa pagina
    expect(f.card.url_hint).toBe("/api/docs/40/file#page=12")
    expect(studySource(7, f.card)).toBe("/documento/40?pagina=12")
    expect(sourcePayload(sourceDraft(f.note, 0))).toMatchObject({ lecture_id: 9, timestamp_s: 0 })
    expect(toReviewCard(f.card)).toMatchObject({ id: 10, fronte: f.card.front, retro: f.card.back, due_date: f.card.due })
  })
})
