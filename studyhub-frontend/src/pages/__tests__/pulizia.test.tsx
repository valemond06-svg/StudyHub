import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Impostazioni } from "../Impostazioni"
import { Lab } from "../Lab"
import { Corsi } from "../Corsi"
import { FlashcardReviewModal } from "@/components/flashcards/FlashcardReviewModal"
import { api } from "@/lib/api"
import { system } from "@/lib/__fixtures__/study-api"

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api")
  return {
    ...actual,
    api: {
      getStorage: vi.fn(), getAIStatus: vi.fn(), getAIPanel: vi.fn(), getSetupStatus: vi.fn(),
      getCourses: vi.fn(), setupLogin: vi.fn(), cancelAIQueue: vi.fn(), exportAnki: vi.fn(), exportAnkiApkg: vi.fn(),
      downloadCoursePdf: vi.fn(), getFlashcardStats: vi.fn(), getDueFlashcards: vi.fn(), getQuizHistory: vi.fn(),
      getTutorThreads: vi.fn(), importFlashcards: vi.fn(), getStudyCourses: vi.fn(), reviewFlashcard: vi.fn(),
    },
  }
})

function wrap(ui: React.ReactNode, path = "/") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter></QueryClientProvider>)
}

const panel = {
  coda: { per_stato: { in_coda: 2 }, per_tipo: {}, in_corso: [], ultimi_errori: [
    { id: 9, kind: "lecture_notes", titolo: "Lezione 3", messaggio: "Claude Code can't use your Claude subscription: payment is past due" },
  ] },
  arretrati: { trascritte_senza_appunti: 0, da_trascrivere: 0, unita_nuove: 0, unita_lezione_attesa_sonnet: 0 },
  finestra: { claude_backlog: true, uso_pct: 0, soglia_pct: 70, arretrati_in_pausa: false, reset_alle: null, coda_in_pausa: null },
  notte: { in_corso: false, ultimo: null },
  cluster: { url: "http://127.0.0.1:8080", model: "Qwen3.6-35B", healthy: true, status: "in_attesa" },
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url === "/api/system/status") return Response.json({ ...system, login: { ...system.login, moodle: { status: "missing" } } })
    return Response.json({ detail: "Fixture mancante" }, { status: 404 })
  }))
  vi.mocked(api.getStorage).mockResolvedValue({ media_root: null, free_gb: 120.5 })
  vi.mocked(api.getAIStatus).mockResolvedValue({ jobs: [], paused_reason: null, usage: { utilization: 0, status: "rejected" }, backlog: { enabled: true, stop_at: 0.7 } })
  vi.mocked(api.getAIPanel).mockResolvedValue(panel as any)
  vi.mocked(api.getSetupStatus).mockResolvedValue({ ready: false, login_running: false, fullrun_running: false, checks: [
    { id: "login", ok: false, required: true, label: "Login a Moodle UniVR", detail: "", fix: "Premi «Accedi a Moodle»" },
  ] })
  vi.mocked(api.getCourses).mockResolvedValue([])
  vi.mocked(api.getStudyCourses).mockResolvedValue([])
  vi.mocked(api.getFlashcardStats).mockResolvedValue({ totale: 3, da_ripassare: 0, ripassate_oggi: 0 })
  vi.mocked(api.getDueFlashcards).mockResolvedValue({ cards: [], stats: {} })
  vi.mocked(api.getQuizHistory).mockResolvedValue([])
  vi.mocked(api.getTutorThreads).mockResolvedValue([])
})
afterEach(() => vi.unstubAllGlobals())

describe("Impostazioni: stati reali, niente valori scritti nel codice", () => {
  it("mostra abbonamento Claude rifiutato, login mancante e media non configurati", async () => {
    wrap(<Impostazioni />)
    expect(await screen.findByText(/abbonamento da verificare/)).toBeDefined()
    expect(await screen.findByText("Abbonamento rifiutato")).toBeDefined()
    expect(screen.getByText("Accesso mancante")).toBeDefined()
    expect(screen.getByText("Login a Moodle UniVR")).toBeDefined()
    expect(screen.getByText("Non configurato")).toBeDefined()
    expect(document.body.textContent).not.toContain("100.83.194.37")
    expect(document.body.textContent).not.toContain("Antigravity")
    expect(screen.queryByText("Connesso")).toBeNull()
  })

  it("il login e l'annullamento della coda chiamano davvero il backend (con conferma)", async () => {
    vi.mocked(api.setupLogin).mockResolvedValue({ started: true })
    vi.mocked(api.cancelAIQueue).mockResolvedValue({ cancelled: 2 })
    wrap(<Impostazioni />)
    fireEvent.click(await screen.findByRole("button", { name: /Accedi a Moodle/ }))
    await waitFor(() => expect(api.setupLogin).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole("button", { name: /Annulla la coda/ }))
    expect(api.cancelAIQueue).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Sì, annulla" }))
    await waitFor(() => expect(api.cancelAIQueue).toHaveBeenCalledTimes(1))
  })
})

describe("Lab: niente dati finti", () => {
  it("nessun quiz finto né generatore con argomenti fissi", async () => {
    wrap(<Lab />, "/lab?tab=quiz")
    expect(await screen.findByText("Nessun quiz svolto.")).toBeDefined()
    expect(screen.queryByText("Derivate")).toBeNull()
    expect(screen.queryByText("Limiti e continuità")).toBeNull()
    expect(screen.queryByText("Genera quiz personalizzato")).toBeNull()
  })
})

describe("Corsi: filtri funzionanti, nessun link a /corsi/nuevo", () => {
  it("filtra per stato di corsi.yaml (da seguire, arretrati, futuri, superati) con prontezza onesta", async () => {
    vi.mocked(api.getCourses).mockResolvedValue([
      { id: 1, fullname: "Analisi", year_of_study: 1, passed: false, active: 1, priority: 1, folder: "a", lectures: 20, ready: 18, stage: "corrente" },
      { id: 2, fullname: "Fisica", year_of_study: 1, passed: false, active: 0, priority: 0, folder: "b", lectures: 0, ready: 0, stage: "futuro" },
      { id: 3, fullname: "Geometria", year_of_study: null as any, passed: true, active: 0, priority: 0, folder: "c", lectures: 0, ready: 0, stage: "archivio" },
      { id: 4, fullname: "Algebra", year_of_study: 1, passed: false, active: 1, priority: 0, folder: "d", lectures: 0, ready: 0, stage: "arretrato" },
      { id: 5, fullname: "Statistica", year_of_study: 2, passed: false, active: 1, priority: 0, folder: "e", lectures: 0, ready: 0, stage: "corrente" },
    ])
    vi.mocked(api.getStudyCourses).mockResolvedValue([
      { id: 1, name: "Analisi", ready_exam: 0.003, n_items: 100, tried_items: 2 },
      { id: 5, name: "Statistica", ready_exam: 0.41, n_items: 50, tried_items: 30, coverage: 0.6, exam: { id: 9, course_id: 5, course: "Statistica", date: "2026-12-01", kind: "scritto", done: false, days_left: 6 } },
    ])
    wrap(<Corsi />, "/corsi")
    expect(await screen.findByText("Analisi")).toBeDefined()
    expect(screen.queryByText("Fisica")).toBeNull()
    expect(screen.queryByText("Algebra")).toBeNull()
    // Statistica ha l'appello più vicino: prima; Analisi ha 2 risposte: niente percentuale piena
    const titles = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)
    expect(titles).toEqual(["Statistica", "Analisi"])
    expect(screen.getByText("dati insufficienti")).toBeDefined()
    expect(screen.getByText("41%")).toBeDefined()
    fireEvent.click(screen.getByRole("button", { name: /Arretrati/ }))
    expect(await screen.findByText("Algebra")).toBeDefined()
    fireEvent.click(screen.getByRole("button", { name: /Futuri e archivio/ }))
    expect(await screen.findByText("Fisica")).toBeDefined()
    fireEvent.click(screen.getByRole("button", { name: /Superati/ }))
    expect(await screen.findByText("Geometria")).toBeDefined()
    expect(screen.getByText("Anno n.d.")).toBeDefined()
    expect(document.querySelector('a[href="/corsi/nuevo"]')).toBeNull()
  })
})

describe("Ripasso flashcard", () => {
  it("è un dialog in portal sopra header (z-100) e sidebar (z-200)", () => {
    const { container } = render(<FlashcardReviewModal isOpen onClose={vi.fn()} cards={[]} />)
    const dialog = screen.getByRole("dialog")
    expect(container.contains(dialog)).toBe(false)
    expect(dialog.className).toContain("z-[500]")
  })
})
