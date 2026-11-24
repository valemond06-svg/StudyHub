import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { StudyTok } from "../StudyTok"
import { api } from "@/lib/api"
import type { FeedShort, Course } from "@/types"

vi.mock("@/lib/api", () => ({
  api: {
    getCourses: vi.fn(),
    getFeed: vi.fn(),
  },
}))

const mockCourses: Course[] = [
  {
    id: 1,
    fullname: "Analisi Matematica I",
    shortname: "Analisi 1",
    year_of_study: 1,
    passed: false,
    active: 1,
    priority: 1,
    folder: null,
    lectures: 10,
    ready: 10,
  },
  {
    id: 2,
    fullname: "Fisica I",
    shortname: "Fisica 1",
    year_of_study: 1,
    passed: false,
    active: 1,
    priority: 2,
    folder: null,
    lectures: 8,
    ready: 8,
  },
]

const mockShorts: FeedShort[] = [
  {
    id: "short_1",
    topic_id: 1,
    course_id: 1,
    course_name: "Analisi 1",
    title: "Teorema di Rolle",
    hook_md: "Se $f(a) = f(b)$, esiste un punto stazionario $c$ con $f'(c) = 0$.",
    widget: null,
    slide: null,
    audio: null,
    exam_trick: "Ipotesi di derivabilità nell'intervallo aperto!",
    archetipo_nome: "Teoremi calcolo differenziale",
    has_pcp: true,
    has_sniper: false,
  },
  {
    id: "short_2",
    topic_id: 2,
    course_id: 1,
    course_name: "Analisi 1",
    title: "Teorema di Lagrange",
    hook_md: "Generalizzazione di Rolle con retta secante.",
    widget: null,
    slide: null,
    audio: null,
    exam_trick: null,
    archetipo_nome: null,
    has_pcp: false,
    has_sniper: false,
  },
  {
    id: "short_3",
    topic_id: 3,
    course_id: 1,
    course_name: "Analisi 1",
    title: "Formula di Taylor con resto di Peano",
    hook_md: "Approssimazione polinomiale locale.",
    widget: null,
    slide: null,
    audio: null,
    exam_trick: null,
    archetipo_nome: null,
    has_pcp: false,
    has_sniper: false,
  },
  {
    id: "short_4",
    topic_id: 4,
    course_id: 1,
    course_name: "Analisi 1",
    title: "Serie Geometrica",
    hook_md: "Converge se e solo se $|q| < 1$.",
    widget: null,
    slide: null,
    audio: null,
    exam_trick: null,
    archetipo_nome: null,
    has_pcp: false,
    has_sniper: false,
  },
  {
    id: "short_5",
    topic_id: 5,
    course_id: 1,
    course_name: "Analisi 1",
    title: "Criterio del Confronto Asintotico",
    hook_md: "Confronto tra infinitesimi o infiniti.",
    widget: null,
    slide: null,
    audio: null,
    exam_trick: null,
    archetipo_nome: null,
    has_pcp: false,
    has_sniper: false,
  },
]

describe("StudyTok Page", () => {
  let queryClient: QueryClient

  beforeEach(() => {
    vi.clearAllMocks()
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })
  })

  it("renders StudyTok header, courses dropdown and active card", async () => {
    vi.mocked(api.getCourses).mockResolvedValue(mockCourses)
    vi.mocked(api.getFeed).mockResolvedValue({ shorts: mockShorts })

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <StudyTok />
        </MemoryRouter>
      </QueryClientProvider>
    )

    expect(screen.getByText("Caricamento pillole di studio...")).toBeDefined()

    await waitFor(() => {
      expect(screen.getByText("StudyTok Feed")).toBeDefined()
      expect(screen.getByText("Teorema di Rolle")).toBeDefined()
      expect(screen.getAllByText("Analisi 1").length).toBeGreaterThanOrEqual(1)
      expect(screen.getByText("1 / 5")).toBeDefined()
    })
  })

  it("navigates through cards and triggers anti-doomscrolling speedbump on 5th card", async () => {
    vi.mocked(api.getCourses).mockResolvedValue(mockCourses)
    vi.mocked(api.getFeed).mockResolvedValue({ shorts: mockShorts })

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <StudyTok />
        </MemoryRouter>
      </QueryClientProvider>
    )

    await waitFor(() => {
      expect(screen.getByText("Teorema di Rolle")).toBeDefined()
    })

    // Advance 4 times to reach 5 unique viewed cards (0 -> 1 -> 2 -> 3 -> 4)
    const nextBtn = screen.getByTitle("Pillola successiva (↓)")

    fireEvent.click(nextBtn)
    await waitFor(() => expect(screen.getByText("Teorema di Lagrange")).toBeDefined())

    fireEvent.click(nextBtn)
    await waitFor(() => expect(screen.getByText("Formula di Taylor con resto di Peano")).toBeDefined())

    fireEvent.click(nextBtn)
    await waitFor(() => expect(screen.getByText("Serie Geometrica")).toBeDefined())

    fireEvent.click(nextBtn)
    await waitFor(() => expect(screen.getByText("Criterio del Confronto Asintotico")).toBeDefined())

    // Anti-doomscrolling dialog should be triggered at 5 pills!
    await waitFor(() => {
      expect(screen.getByText("Dosso Anti-Doomscrolling")).toBeDefined()
      expect(screen.getByText("Hai visto 5 pillole!")).toBeDefined()
      expect(screen.getByText("Avvia Studio Attivo")).toBeDefined()
      expect(screen.getByText("Continua nel feed")).toBeDefined()
    })

    // Click "Continua nel feed" to dismiss
    fireEvent.click(screen.getByText("Continua nel feed"))
    expect(screen.queryByText("Dosso Anti-Doomscrolling")).toBeNull()
  })
})
