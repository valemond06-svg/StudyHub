import { afterEach, describe, expect, it, vi } from "vitest"
import { api, setCsrfToken, ApiError, errorMessageFromBody, messageForStatus, describeError } from "./api"

afterEach(() => {
  setCsrfToken(null)
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("API sessioni (blocco 3)", () => {
  it("sessions/open: 204 = nessuna sessione aperta (null), 200 = sessione normalizzata", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(Response.json({ id: 31, course_id: 7, entries: [{ t: "scheda", topic: 4 }] }))
    vi.stubGlobal("fetch", fetch)
    await expect(api.getOpenSession(7)).resolves.toBeNull()
    const s = await api.getOpenSession(7)
    expect(s).toMatchObject({ id: 31, entries: [{ idx: 0, done: false }] })
    expect(fetch.mock.calls[0][0]).toBe("/api/study/7/sessions/open")
  })

  it("reveal manda sicurezza e secondi solo se presenti; seen e abandon sono POST", async () => {
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(Response.json({ ok: true, done: true, entries: [] })))
    vi.stubGlobal("fetch", fetch)
    setCsrfToken("t")
    await api.revealSession(31, 2, { confidence: 3, seconds: 41.5 })
    await api.revealSession(31, 2)
    await api.seenSession(31, 0)
    await api.abandonSession(31)
    expect(fetch.mock.calls[0][1].body).toBe(JSON.stringify({ confidence: 3, seconds: 41.5 }))
    expect(fetch.mock.calls[1][1].body).toBeUndefined()
    expect(fetch.mock.calls.slice(2).map((c) => [c[0], c[1].method])).toEqual([
      ["/api/study/sessions/31/seen/0", "POST"], ["/api/study/sessions/31/abandon", "POST"],
    ])
  })
})

describe("API flashcard", () => {
  it("invia il corso nella query dell'import mantenendo CSRF e credenziali", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ added: 2 }))
    vi.stubGlobal("fetch", fetch)
    setCsrfToken("test-token")

    await expect(api.importFlashcards(42)).resolves.toEqual({ added: 2 })
    expect(fetch).toHaveBeenCalledExactlyOnceWith("/api/flashcards/import?course_id=42", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": "test-token" },
    })
  })

  it.each([
    { format: "tsv", download: api.exportAnki, filename: "studyhub_flashcard.txt", body: "Domanda\tRisposta\n" },
    { format: "apkg", download: api.exportAnkiApkg, filename: "studyhub.apkg", body: new Uint8Array([80, 75, 3, 4]) },
  ])("scarica la risposta $format con il nome restituito dal server", async ({ format, download, filename, body }) => {
    const response = new Response(body, { headers: { "Content-Disposition": `attachment; filename="${filename}"` } })
    const fetch = vi.fn().mockResolvedValue(response)
    const createObjectURL = vi.fn().mockReturnValue("blob:anki")
    const revokeObjectURL = vi.fn()
    vi.stubGlobal("fetch", fetch)
    vi.stubGlobal("URL", Object.assign(class extends URL {}, { createObjectURL, revokeObjectURL }))
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.href).toBe("blob:anki")
      expect(this.download).toBe(filename)
    })
    const json = vi.spyOn(response, "json")
    vi.useFakeTimers()
    try {
      await download(42)
      expect(fetch).toHaveBeenCalledExactlyOnceWith(
        `/api/flashcards/anki.${format}?course_id=42`, expect.objectContaining({ credentials: "include" }),
      )
      expect(json).not.toHaveBeenCalled()
      const blob = createObjectURL.mock.calls[0][0] as Blob
      expect(blob.size).toBe(body.length)
      expect(click).toHaveBeenCalledTimes(1)
      expect(document.querySelector("a[download]")).toBeNull()
      await vi.runAllTimersAsync()
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:anki")
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("API: errori e contratti", () => {
  it("mostra il detail di FastAPI (stringa) come messaggio", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ detail: "Limite della finestra Claude Pro raggiunto." }, { status: 429 })))
    const err = await api.getPlan().catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(429)
    expect(err.message).toBe("Limite della finestra Claude Pro raggiunto.")
  })

  it("422 con detail a lista diventa un testo italiano leggibile", () => {
    expect(errorMessageFromBody(422, { detail: [{ loc: ["body", "minutes"], msg: "Input should be a valid integer" }] }))
      .toBe("Dati inviati non validi. minutes: Input should be a valid integer")
  })

  it("senza detail usa un messaggio italiano per codice (anche con corpo non JSON)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>oops</html>", { status: 502 })))
    const err = await api.getPlan().catch((e) => e)
    expect(err.message).toBe("Il servizio AI non ha risposto correttamente.")
    expect(messageForStatus(418)).toBe("Richiesta non riuscita (HTTP 418).")
    expect(describeError(new TypeError("Failed to fetch"))).toContain("non risponde")
  })

  it("la ricerca usa POST con filtri e legge {results, semantic}", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ semantic: true, results: [
      { id: 1, kind: "pdf", page: 2, t_start: null, t_end: null, heading: null, doc_id: 4, path: "x/a.pdf", title: "A", lecture_id: null, course: "C", course_id: 3, snippet: "s", score: 1 },
    ] }))
    vi.stubGlobal("fetch", fetch)
    setCsrfToken("t")
    const res = await api.searchSemantic("laplace transform", { courseId: 3 })
    expect(fetch).toHaveBeenCalledExactlyOnceWith("/api/search", expect.objectContaining({
      method: "POST", body: JSON.stringify({ q: "laplace transform", course_id: 3, limit: 20 }),
      headers: expect.objectContaining({ "X-CSRF-Token": "t" }),
    }))
    expect(res.semantic).toBe(true)
    expect(res.results[0]).toMatchObject({ docId: 4, page: 2, group: "documenti" })
  })

  it("cerca per parole direttamente con GET e passa il segnale di annullamento", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ semantic: false, results: [
        { id: 12, kind: "note", note_id: 12, doc_id: null, lecture_id: 4, snippet: "Laplace" },
      ] }))
    vi.stubGlobal("fetch", fetch)
    const { signal } = new AbortController()
    const res = await api.search("laplace", { year: 2, limit: 8, signal })
    expect(fetch).toHaveBeenCalledExactlyOnceWith("/api/search?q=laplace&year=2&limit=8", expect.objectContaining({ signal }))
    expect(res.semantic).toBe(false)
    expect(res.results[0]).toMatchObject({ noteId: 12, docId: null, lectureId: 4, group: "appunti" })
  })

  it("riusa i risultati lessicali del POST se il backend ha già fatto il ripiego", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ semantic: false, results: [] }))
    vi.stubGlobal("fetch", fetch)
    setCsrfToken("t")
    await expect(api.searchSemantic("laplace")).resolves.toEqual({ semantic: false, results: [] })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it("quiz, prefetch e coda AI mandano i parametri in query come vuole il backend", async () => {
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(Response.json({})))
    vi.stubGlobal("fetch", fetch)
    setCsrfToken("t")
    await api.generateQuiz(5, 8)
    await api.prefetchStudyLessons(7, 4)
    await api.queueCourseNotes(7, 2)
    expect(fetch.mock.calls.map((c) => [c[0], c[1].body])).toEqual([
      ["/api/lectures/5/quiz?n=8", undefined],
      ["/api/study/7/lessons/prefetch?n=4", undefined],
      ["/api/ai/queue?course_id=7&limit=2", undefined],
    ])
  })

  it("il download PDF non chiama res.json() e mostra il detail in caso di errore", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ detail: "Corso non trovato/a" }, { status: 404 })))
    await expect(api.downloadCoursePdf(9)).rejects.toThrow("Corso non trovato/a")
  })
})
