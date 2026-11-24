import { afterEach, describe, expect, it, vi } from "vitest"
import { api, setCsrfToken } from "./api"

afterEach(() => {
  setCsrfToken(null)
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
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
