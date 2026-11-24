import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { SimulazioneRunner } from "../SimulazioneRunner"
import { api } from "@/lib/api"

vi.mock("@/lib/api", () => ({
  api: {
    getSimulation: vi.fn(),
    submitSimulation: vi.fn(),
  },
}))

const mockSimulation = {
  id: 12,
  course_id: 1,
  titolo: "Simulazione Ufficiale Appello Invernale",
  durata_min: 60,
  istruzioni_md: "Risolvere tutti i quesiti con rigore.",
  domande: [
    {
      parte: "Teoria",
      tipo: "multipla",
      punti: 5,
      testo_md: "Qual è la condizione necessaria per la stabilità asintotica?",
      opzioni: [
        "Tutti i poli a parte reale strettamente negativa",
        "Almeno un polo nell'origine",
        "Modulo della risposta impulsiva infinito",
      ],
      corretta: 0,
      soluzione_md: "I poli devono avere $\\text{Re}(p) < 0$.",
    },
    {
      parte: "Esercizio",
      tipo: "esercizio",
      punti: 10,
      testo_md: "Dato il sistema $G(s) = \\frac{1}{s+2}$, calcola la risposta al gradino unitario.",
      soluzione_md: "La risposta è $y(t) = \\frac{1}{2}(1 - e^{-2t})u(t)$.",
    },
  ],
  attempts: [],
}

describe("SimulazioneRunner Page", () => {
  let queryClient: QueryClient

  beforeEach(() => {
    vi.clearAllMocks()
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })
  })

  it("loads and displays simulation title, timer, and question prompt", async () => {
    vi.mocked(api.getSimulation).mockResolvedValueOnce(mockSimulation)

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/simulazione/12"]}>
          <Routes>
            <Route path="/simulazione/:id" element={<SimulazioneRunner />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    )

    expect(screen.getByText("Caricamento simulazione d'esame...")).toBeDefined()

    await waitFor(() => {
      expect(screen.getByText("Simulazione Ufficiale Appello Invernale")).toBeDefined()
    })

    // Check timer format MM:SS
    expect(screen.getByText(/60:00|59:59/)).toBeDefined()

    // Check question 1
    expect(screen.getByText(/Qual è la condizione necessaria per la stabilità/)).toBeDefined()
    expect(screen.getByText("Tutti i poli a parte reale strettamente negativa")).toBeDefined()
  })

  it("allows selecting multiple-choice option and moving to next question", async () => {
    vi.mocked(api.getSimulation).mockResolvedValueOnce(mockSimulation)

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/simulazione/12"]}>
          <Routes>
            <Route path="/simulazione/:id" element={<SimulazioneRunner />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    )

    await waitFor(() => {
      expect(screen.getByText("Simulazione Ufficiale Appello Invernale")).toBeDefined()
    })

    // Select option A
    const optA = screen.getByText("Tutti i poli a parte reale strettamente negativa")
    fireEvent.click(optA)

    // Navigate to next question
    const nextBtn = screen.getByText("Prossimo Quesito")
    fireEvent.click(nextBtn)

    // Question 2 should be displayed
    await waitFor(() => {
      expect(screen.getByText("Quesito 2 di 2")).toBeDefined()
      expect(screen.getByPlaceholderText(/Scrivi qui la spiegazione/)).toBeDefined()
    })
  })

  it("submits the simulation and renders grading report card", async () => {
    vi.mocked(api.getSimulation).mockResolvedValue(mockSimulation)
    vi.mocked(api.submitSimulation).mockResolvedValueOnce({
      attempt_id: 1,
      voto_30: 28,
      superato: true,
      commento_md: "Ottima comprensione dei concetti di stabilità e risposta al gradino.",
      da_ripassare: ["Polinomio ausiliario"],
      valutazioni: [
        { indice: 0, punti: 5, feedback_md: "Risposta corretta e precisa." },
        { indice: 1, punti: 9, feedback_md: "Calcolo corretto, solo una piccola imprecisione sui limiti." },
      ],
      soluzioni: [
        { soluzione_md: "I poli devono avere $\\text{Re}(p) < 0$.", corretta: 0, punti_max: 5 },
        { soluzione_md: "$y(t) = \\frac{1}{2}(1 - e^{-2t})u(t)$", corretta: -1, punti_max: 10 },
      ],
    })

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/simulazione/12"]}>
          <Routes>
            <Route path="/simulazione/:id" element={<SimulazioneRunner />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    )

    await waitFor(() => {
      expect(screen.getByText("Simulazione Ufficiale Appello Invernale")).toBeDefined()
    })

    // Click submit button in header
    const submitBtn = screen.getByText("Consegna Esame")
    fireEvent.click(submitBtn)

    // Confirm dialog appears
    expect(screen.getByText("Vuoi consegnare la prova?")).toBeDefined()

    // Click confirm
    const confirmBtn = screen.getByText("Conferma e Consegna")
    fireEvent.click(confirmBtn)

    // Grading view appears
    await waitFor(() => {
      expect(screen.getByText("28")).toBeDefined()
      expect(screen.getByText("Prova Superata")).toBeDefined()
      expect(screen.getByText("Giudizio del Docente AI")).toBeDefined()
      expect(screen.getByText(/Ottima comprensione dei concetti/)).toBeDefined()
      expect(screen.getByText("Polinomio ausiliario")).toBeDefined()
    })
  })
})
