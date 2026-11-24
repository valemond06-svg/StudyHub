import { fireEvent, render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { CorsoDetail } from "../CorsoDetail"
import { api } from "@/lib/api"

vi.mock("@/lib/api", () => ({
  api: {
    getCourse: vi.fn(),
    getCourseLectures: vi.fn(),
    getCourseExam: vi.fn(),
    generateExamProfile: vi.fn(),
    getStudyCourseStats: vi.fn(),
    getStudyChapters: vi.fn(),
    getFlashcardStats: vi.fn(),
    importFlashcards: vi.fn(),
    getPlan: vi.fn(),
  },
}))

async function renderCourse(tab: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/corsi/7"]}>
        <Routes>
          <Route path="/corsi/:id" element={<CorsoDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  fireEvent.mouseDown(await screen.findByRole("tab", { name: tab }), { button: 0 })
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(api.getCourse).mockResolvedValue({
    id: 7, fullname: "Analisi", year_of_study: 1, passed: false, active: 1,
    priority: 0, folder: null, lectures: 0, ready: 0,
  })
  vi.mocked(api.getCourseLectures).mockResolvedValue([])
  vi.mocked(api.getCourseExam).mockResolvedValue({ profile: null, profile_md: null, sims: [] })
  vi.mocked(api.getStudyCourseStats).mockResolvedValue({ topics: [] })
  vi.mocked(api.getStudyChapters).mockResolvedValue([])
  vi.mocked(api.getPlan).mockResolvedValue({
    today: "2026-11-24", exams: [], tasks: [], courses: [],
    flashcards: { totale: 0, da_ripassare: 0, ripassate_oggi: 0 },
  })
})

describe("Dettaglio corso", () => {
  it("genera e rigenera il profilo con il flag corretto e aggiorna il contenuto", async () => {
    vi.mocked(api.getCourseExam)
      .mockResolvedValueOnce({ profile: null, profile_md: null, sims: [] })
      .mockResolvedValueOnce({ profile: {}, profile_md: "Prima versione", sims: [] })
      .mockResolvedValueOnce({ profile: {}, profile_md: "Versione rigenerata", sims: [] })
    vi.mocked(api.generateExamProfile).mockResolvedValue({})
    vi.mocked(api.getFlashcardStats).mockResolvedValue({})
    await renderCourse("Esame")

    const initial = await screen.findAllByRole("button", { name: "Genera profilo" })
    fireEvent.click(initial[0])
    expect(await screen.findByText("Prima versione")).toBeDefined()
    fireEvent.click(screen.getByRole("button", { name: "Rigenera" }))
    expect(await screen.findByText("Versione rigenerata")).toBeDefined()
    expect(vi.mocked(api.generateExamProfile).mock.calls).toEqual([[7, false], [7, true]])
  })

  it("importa le flashcard del corso e aggiorna le statistiche mostrate", async () => {
    vi.mocked(api.getFlashcardStats)
      .mockResolvedValueOnce({ totale: 2, da_ripassare: 1 })
      .mockResolvedValueOnce({ totale: 5, da_ripassare: 4 })
    vi.mocked(api.importFlashcards).mockResolvedValue({ added: 3 })
    await renderCourse("Lab")

    await screen.findByText("Da rivedere oggi")
    fireEvent.click(screen.getByRole("button", { name: "Import" }))
    expect(await screen.findByText("4")).toBeDefined()
    expect(api.importFlashcards).toHaveBeenCalledExactlyOnceWith(7)
    expect(vi.mocked(api.getFlashcardStats).mock.calls).toEqual([[7], [7]])
  })
})
