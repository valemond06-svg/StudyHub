import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { SimulazioneRunner } from "../SimulazioneRunner"
import { api } from "@/lib/api"

vi.mock("@/lib/api", async (orig) => {
  const real = await orig<typeof import("@/lib/api")>()
  return {
    ...real,
    api: {
      getSimulation: vi.fn(),
      submitSimulation: vi.fn(),
    },
  }
})

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

const grading = {
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
}

const DRAFT_KEY = "studyhub-sim-draft-12"

function renderRunner(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/simulazione/12"]}>
        <Routes>
          <Route path="/simulazione/:id" element={<SimulazioneRunner />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe("SimulazioneRunner", () => {
  let queryClient: QueryClient

  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  })
  afterEach(() => vi.useRealTimers())

  it("mostra le istruzioni prima: il timer parte solo da 'Inizia la prova'", async () => {
    vi.mocked(api.getSimulation).mockResolvedValueOnce(mockSimulation)
    renderRunner(queryClient)
    expect(screen.getByText("Caricamento simulazione d'esame...")).toBeDefined()
    expect(await screen.findByText("Simulazione Ufficiale Appello Invernale")).toBeDefined()
    expect(screen.getByText("Risolvere tutti i quesiti con rigore.")).toBeDefined()
    expect(screen.getByText(/60 minuti · 2 quesiti · 15 punti/)).toBeDefined()
    expect(screen.queryByText(/Qual è la condizione necessaria/)).toBeNull()
    expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: /Inizia la prova/ }))
    expect(screen.getByText("60:00")).toBeDefined()
    expect(screen.getByText(/Qual è la condizione necessaria per la stabilità/)).toBeDefined()
    const draft = JSON.parse(window.localStorage.getItem(DRAFT_KEY)!)
    expect(draft.deadline - draft.startedAt).toBe(3_600_000)
  })

  it("salva la risposta nella bozza e passa al quesito successivo", async () => {
    vi.mocked(api.getSimulation).mockResolvedValueOnce(mockSimulation)
    renderRunner(queryClient)
    fireEvent.click(await screen.findByRole("button", { name: /Inizia la prova/ }))
    fireEvent.click(screen.getByText("Tutti i poli a parte reale strettamente negativa"))
    fireEvent.click(screen.getByText("Prossimo Quesito"))
    await waitFor(() => {
      expect(screen.getByText("Quesito 2 di 2")).toBeDefined()
      expect(screen.getByPlaceholderText(/Scrivi qui la spiegazione/)).toBeDefined()
    })
    const draft = JSON.parse(window.localStorage.getItem(DRAFT_KEY)!)
    expect(draft.answers["0"].scelta).toBe(0)
    expect(draft.selected).toBe(1)
  })

  it("consegna con conferma, mostra la correzione e cancella la bozza", async () => {
    vi.mocked(api.getSimulation).mockResolvedValue(mockSimulation)
    vi.mocked(api.submitSimulation).mockResolvedValueOnce(grading)
    renderRunner(queryClient)
    fireEvent.click(await screen.findByRole("button", { name: /Inizia la prova/ }))
    fireEvent.click(screen.getByText("Consegna Esame"))
    expect(screen.getByText("Vuoi consegnare la prova?")).toBeDefined()
    fireEvent.click(screen.getByText("Conferma e Consegna"))
    await waitFor(() => {
      expect(screen.getByText("28")).toBeDefined()
      expect(screen.getByText("Prova Superata")).toBeDefined()
      expect(screen.getByText(/Ottima comprensione dei concetti/)).toBeDefined()
      expect(screen.getByText("Polinomio ausiliario")).toBeDefined()
    })
    expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull()
  })

  it("scadenza assoluta: dopo 3000 s mancano 10:00 e la consegna manda 50 minuti", async () => {
    let now = 1_000_000_000
    vi.spyOn(Date, "now").mockImplementation(() => now)
    vi.mocked(api.getSimulation).mockResolvedValue(mockSimulation)
    vi.mocked(api.submitSimulation).mockImplementation(() => new Promise(() => {}))
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] })
    queryClient.setQueryData(["simulation", "12"], mockSimulation)
    renderRunner(queryClient)
    fireEvent.click(screen.getByRole("button", { name: /Inizia la prova/ }))
    now += 3_000_000
    await act(async () => { vi.advanceTimersByTime(1000) })
    expect(screen.getByText("10:00")).toBeDefined()
    fireEvent.click(screen.getByText("Consegna Esame"))
    await act(async () => { fireEvent.click(screen.getByText("Conferma e Consegna")) })
    expect(api.submitSimulation).toHaveBeenCalledExactlyOnceWith("12", expect.any(Array), 50, expect.any(String))
  })

  it("una ricarica riprende la bozza con il tempo che restava davvero", async () => {
    const now = Date.now()
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify({
      startedAt: now - 50 * 60_000, deadline: now + 10 * 60_000, selected: 1,
      answers: { 0: { testo: "", scelta: 2, immagini: [] }, 1: { testo: "y(t) = ...", scelta: null, immagini: [] } },
    }))
    vi.mocked(api.getSimulation).mockResolvedValueOnce(mockSimulation)
    renderRunner(queryClient)
    expect(await screen.findByText(/10:00|09:59/)).toBeDefined()
    expect(screen.queryByRole("button", { name: /Inizia la prova/ })).toBeNull()
    expect(screen.getByText("Quesito 2 di 2")).toBeDefined()
    expect((screen.getByPlaceholderText(/Scrivi qui la spiegazione/) as HTMLTextAreaElement).value).toBe("y(t) = ...")
    expect(screen.getByText(/2 di 2 risposte completate/)).toBeDefined()
  })

  it("allo zero consegna da sola, anche se riapri la pagina dopo la scadenza", async () => {
    const now = Date.now()
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify({
      startedAt: now - 70 * 60_000, deadline: now - 10 * 60_000, selected: 0,
      answers: { 0: { testo: "", scelta: 0, immagini: [] } },
    }))
    vi.mocked(api.getSimulation).mockResolvedValue(mockSimulation)
    vi.mocked(api.submitSimulation).mockResolvedValueOnce(grading)
    renderRunner(queryClient)
    expect(await screen.findByText("Prova Superata")).toBeDefined()
    expect(api.submitSimulation).toHaveBeenCalledTimes(1)
    const [, answers, minutes] = vi.mocked(api.submitSimulation).mock.calls[0]
    expect(answers[0]).toMatchObject({ scelta: 0 })
    expect(minutes).toBe(60)
  })

  it("se la consegna automatica fallisce resta la bozza con 'Riprova la consegna'", async () => {
    const now = Date.now()
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ startedAt: now - 61 * 60_000, deadline: now - 60_000, selected: 0, answers: {} }))
    vi.mocked(api.getSimulation).mockResolvedValue(mockSimulation)
    vi.mocked(api.submitSimulation).mockRejectedValueOnce(new Error("AI non raggiungibile")).mockResolvedValueOnce(grading)
    renderRunner(queryClient)
    expect((await screen.findByRole("alert")).textContent).toContain("Tempo scaduto")
    expect(window.localStorage.getItem(DRAFT_KEY)).not.toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Riprova la consegna" }))
    expect(await screen.findByText("Prova Superata")).toBeDefined()
    expect(api.submitSimulation).toHaveBeenCalledTimes(2)
    expect(vi.mocked(api.submitSimulation).mock.calls[0][3]).toBe(vi.mocked(api.submitSimulation).mock.calls[1][3])
  })

  it("riapre una consegna automatica in corso con lo stesso ID salvato nella bozza", async () => {
    const now = Date.now()
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify({
      startedAt: now - 61 * 60_000, deadline: now - 60_000, selected: 0, answers: {},
    }))
    vi.mocked(api.getSimulation).mockResolvedValue(mockSimulation)
    vi.mocked(api.submitSimulation)
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValueOnce(grading)
    const first = renderRunner(queryClient)
    await waitFor(() => expect(api.submitSimulation).toHaveBeenCalledOnce())
    const saved = JSON.parse(window.localStorage.getItem(DRAFT_KEY)!)
    expect(saved.submissionId).toBe(`legacy-${now - 61 * 60_000}`)
    first.unmount()

    renderRunner(new QueryClient({ defaultOptions: { queries: { retry: false } } }))
    expect(await screen.findByText("Prova Superata")).toBeDefined()
    expect(vi.mocked(api.submitSimulation).mock.calls.map((call) => call[3])).toEqual([saved.submissionId, saved.submissionId])
    expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull()
  })
})
