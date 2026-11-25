import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { CorsoDetail } from "../CorsoDetail"
import { api } from "@/lib/api"

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api")
  return {
    ...actual,
    api: {
      getCourse: vi.fn(),
      getCourseLectures: vi.fn(),
      getNotesIndex: vi.fn(),
      getCourseExam: vi.fn(),
      generateExamProfile: vi.fn(),
      generateSimulation: vi.fn(),
      getStudyCourseStats: vi.fn(),
      getStudyChapters: vi.fn(),
      getFlashcardStats: vi.fn(),
      importFlashcards: vi.fn(),
      exportAnki: vi.fn(),
      downloadCoursePdf: vi.fn(),
      getPlan: vi.fn(),
      getLecture: vi.fn(),
    },
  }
})

vi.mock("@/components/player/VideoPlayer", () => ({
  VideoPlayer: ({ lectureId, initialTime }: { lectureId: number; initialTime: number }) => (
    <div data-testid="player">player {lectureId} @ {initialTime}</div>
  ),
}))

function renderCourse(path = "/corsi/7") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/corsi/:id" element={<CorsoDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

async function openTab(tab: string) {
  fireEvent.mouseDown(await screen.findByRole("tab", { name: tab }), { button: 0 })
}

// Profilo nel formato reale di study/exam.py (PROFILE_SCHEMA)
const realProfile = (sintesi: string) => ({
  sintesi_md: sintesi,
  formato: { durata_min: 0, parti: [], orale: "", materiale_consentito: "", regole_voto: "" },
  argomenti: [{ nome: "Laplace", frequenza: "4 appelli su 4", peso: "alto", note: "" }],
  esercizi_tipo: [{ titolo: "Antitrasformata", metodo_md: "Fratti semplici", frequenza: "4/4" }],
  teoria_richiesta: [],
  consigli_md: "",
})

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(api.getCourse).mockResolvedValue({
    id: 7, fullname: "Analisi", year_of_study: 1, passed: false, active: 1,
    priority: 0, folder: null, lectures: 20, ready: 18,
  })
  vi.mocked(api.getCourseLectures).mockResolvedValue([])
  vi.mocked(api.getNotesIndex).mockResolvedValue([])
  vi.mocked(api.getCourseExam).mockResolvedValue({ profile: null, profile_md: null, sims: [] })
  vi.mocked(api.getStudyCourseStats).mockResolvedValue({ topics: [], ready_exam: 0.003 })
  vi.mocked(api.getStudyChapters).mockResolvedValue([])
  vi.mocked(api.getFlashcardStats).mockResolvedValue({})
  vi.mocked(api.getPlan).mockResolvedValue({
    today: "2026-11-24", exams: [], tasks: [], courses: [],
    flashcards: { totale: 0, da_ripassare: 0, ripassate_oggi: 0 },
  })
})

describe("Dettaglio corso", () => {
  it("la prontezza è la padronanza reale, non le lezioni trascritte", async () => {
    renderCourse()
    // 18/20 lezioni trascritte ma ready_exam 0,3%: deve mostrare 0%, non 90%
    expect(await screen.findByText("0%")).toBeDefined()
    expect(screen.queryByText("90%")).toBeNull()
  })

  it("genera e rigenera il profilo con il flag corretto; durata 0 = non indicata, pesi senza %", async () => {
    vi.mocked(api.getCourseExam)
      .mockResolvedValueOnce({ profile: null, profile_md: null, sims: [] })
      .mockResolvedValueOnce({ profile: realProfile("Prima versione"), profile_md: "# duplicato", sims: [] })
      .mockResolvedValueOnce({ profile: realProfile("Versione rigenerata"), profile_md: "# duplicato", sims: [] })
    vi.mocked(api.generateExamProfile).mockResolvedValue({})
    renderCourse()
    await openTab("Esame")

    fireEvent.click(await screen.findByRole("button", { name: "Genera profilo" }))
    expect(await screen.findByText("Prima versione")).toBeDefined()
    expect(screen.getByText("Non indicata")).toBeDefined()
    expect(screen.getByText("Peso alto")).toBeDefined()
    expect(screen.queryByText(/alto%/)).toBeNull()
    expect(screen.getByText("Antitrasformata")).toBeDefined()
    expect(screen.queryByText("duplicato")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Rigenera" }))
    expect(await screen.findByText("Versione rigenerata")).toBeDefined()
    expect(vi.mocked(api.generateExamProfile).mock.calls).toEqual([[7, false], [7, true]])
  })

  it("importa le flashcard del corso e aggiorna le statistiche mostrate", async () => {
    vi.mocked(api.getFlashcardStats)
      .mockResolvedValueOnce({ totale: 2, da_ripassare: 1 })
      .mockResolvedValueOnce({ totale: 5, da_ripassare: 4 })
    vi.mocked(api.importFlashcards).mockResolvedValue({ added: 3 })
    renderCourse()
    await openTab("Lab")

    await screen.findByText("Da rivedere oggi")
    fireEvent.click(screen.getByRole("button", { name: "Import" }))
    expect(await screen.findByText("4")).toBeDefined()
    expect(api.importFlashcards).toHaveBeenCalledExactlyOnceWith(7)
  })

  it("le lezioni con solo Panopto si aprono; quelle senza sorgenti no; durata assente = n.d.", async () => {
    vi.mocked(api.getCourseLectures).mockResolvedValue([
      { id: 1, course_id: 7, title: "Solo Panopto", status: "nuova", date: "2026-11-01", duration: 5100, has_audio: false, n_slides: 0, panopto_id: "abc", video_type: "panopto" },
      { id: 2, course_id: 7, title: "Vuota", status: "nuova", date: null, duration: null, has_audio: false, n_slides: 0, video_type: "standard" },
    ] as any)
    renderCourse()
    await openTab("Lezioni")
    expect(await screen.findByRole("button", { name: "Apri Solo Panopto" })).toBeDefined()
    expect(screen.queryByRole("button", { name: "Apri Vuota" })).toBeNull()
    expect(screen.getByText(/durata n\.d\./)).toBeDefined()
    fireEvent.click(screen.getByRole("button", { name: "Apri Solo Panopto" }))
    expect(screen.getByTestId("player").textContent).toBe("player 1 @ 0")
  })

  it("apre direttamente la lezione al secondo indicato nell'indirizzo (dalla ricerca)", async () => {
    renderCourse("/corsi/7?lezione=190&t=754")
    await waitFor(() => expect(screen.getByTestId("player").textContent).toBe("player 190 @ 754"))
  })

  it("niente pulsanti senza azione in testata", async () => {
    renderCourse()
    await screen.findByText("Analisi")
    expect(screen.queryByRole("button", { name: "Export" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Impostazioni" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Dispensa PDF" }))
    await waitFor(() => expect(api.downloadCoursePdf).toHaveBeenCalledWith(7))
  })
})
