import { StrictMode } from "react"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Studio } from "../Studio"
import { api } from "@/lib/api"
import { useSessionStore } from "@/store/session"

vi.mock("@/lib/api", () => ({
  api: {
    getCourse: vi.fn(),
    getSession: vi.fn(),
    createSession: vi.fn(),
    answerSession: vi.fn(),
    photoSession: vi.fn(),
    revealSession: vi.fn(),
    finishSession: vi.fn(),
  },
}))

const images = ["data:image/jpeg;base64,YQ==", "data:image/jpeg;base64,Yg=="]

vi.mock("@/components/camera/PhotoUpload", () => ({
  PhotoUpload: ({ onPhotosChange }: { onPhotosChange: (photos: string[]) => void }) => (
    <button onClick={() => onPhotosChange(images)}>Allega due foto</button>
  ),
}))

const question = (id: number, prompt: string, kind = "aperta", boss = false) => ({
  id, t: "domanda", boss, question: { prompt_md: prompt, kind },
})

const scheda = { id: 50, t: "scheda", topic: 8 }
const topics = { 8: { name: "Derivate", summary_md: "La derivata misura il tasso di variazione." } }
const session = (entries: object[] = []) => ({
  id: 28, course_id: 7, minutes: 45, xp: 0, entries, topics,
})

function renderStudio(query = "") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <StrictMode>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/studio/7${query}`]}>
          <Routes>
            <Route path="/studio/:courseId" element={<Studio />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </StrictMode>,
  )
  return client
}

function click(name: string) {
  fireEvent.click(screen.getByRole("button", { name }))
}

beforeEach(() => {
  vi.resetAllMocks()
  useSessionStore.setState({ currentSession: null, todaySessions: [] })
  vi.mocked(api.getCourse).mockResolvedValue({
    id: 7, fullname: "Analisi", year_of_study: 1, passed: false, active: 1,
    priority: 0, folder: null, lectures: 0, ready: 0,
  })
  vi.mocked(api.createSession).mockResolvedValue(session())
  vi.mocked(api.answerSession).mockResolvedValue({ score: 1, answer_md: "Soluzione scritta", feedback_md: "Correzione testuale" })
  vi.mocked(api.revealSession).mockResolvedValue({ answer_md: "Soluzione rivelata" })
  vi.mocked(api.finishSession).mockResolvedValue({ ended_at: "2026-11-24T12:00:00Z", xp: 0, answered: 0, correct: 0 })
})

afterEach(() => vi.restoreAllMocks())

describe("Studio", () => {
  it("riprende le schede dal server e mostra titolo e contenuto del topic", async () => {
    useSessionStore.getState().startSession(7, 45, 28, [scheda])
    vi.mocked(api.getSession).mockResolvedValue(session([scheda]))
    renderStudio()

    expect(await screen.findByRole("heading", { name: "Derivate" })).toBeDefined()
    expect(screen.getByText(topics[8].summary_md)).toBeDefined()
    expect(api.getSession).toHaveBeenCalledWith(28)
    expect(api.createSession).not.toHaveBeenCalled()
    click("Ho compreso")
    click("Prossima scheda")
    expect(screen.getByText("Nessuna domanda di esercizio")).toBeDefined()
  })

  it("usa il topic di StudyTok anche se esiste una sessione generica dello stesso corso", async () => {
    useSessionStore.getState().startSession(7, 45, 42, [scheda])
    renderStudio("?topic=8&duration=25")

    await screen.findByText("Nessuna lezione nuova")
    expect(api.createSession).toHaveBeenCalledExactlyOnceWith(7, 25, 8)
    expect(api.getSession).not.toHaveBeenCalled()
    expect(useSessionStore.getState().currentSession?.focusTopic).toBe(8)
  })

  it.each(["0", "-1", "2.5", "abc", "9007199254740992"])("ignora il topic non valido %s", async (topic) => {
    renderStudio(`?topic=${topic}`)
    await screen.findByText("Nessuna lezione nuova")
    expect(api.createSession).toHaveBeenCalledExactlyOnceWith(7, 45, undefined)
  })

  it("mantiene le fasi disgiunte e usa gli indici della coda per correggere e rivelare", async () => {
    vi.mocked(api.createSession).mockResolvedValue(session([
      question(75, "Domanda boss", "aperta", true),
      question(76, "Riscaldamento uno"),
      question(77, "Riscaldamento due"),
      question(78, "Domanda pratica"),
    ]))
    renderStudio()

    await screen.findByText("Riscaldamento uno")
    click("Rivela risposta")
    expect(await screen.findByText("Soluzione rivelata")).toBeDefined()
    click("Prossima domanda")
    expect(screen.queryByText("Soluzione rivelata")).toBeNull()

    click("Conferma risposta")
    expect(await screen.findByText("Soluzione scritta")).toBeDefined()
    expect(screen.getByText("Correzione testuale")).toBeDefined()
    fireEvent.click(screen.getAllByRole("button", { name: "Fase successiva" })[0])
    click("Vai alla fase successiva")

    expect(screen.getByText("Domanda pratica")).toBeDefined()
    click("Verifica risposta")
    await screen.findByText("Correzione testuale")
    fireEvent.click(screen.getAllByRole("button", { name: "Fase successiva" })[0])
    expect(screen.getByText("Domanda boss")).toBeDefined()
    click("Affronta il Boss")
    await screen.findByText("Soluzione scritta")

    expect(vi.mocked(api.revealSession).mock.calls).toEqual([[28, 1]])
    expect(vi.mocked(api.answerSession).mock.calls.map(([, payload]) => payload.idx)).toEqual([2, 3, 0])
  })

  it("invia tutte le foto e il testo alla consegna e mostra la correzione ricevuta", async () => {
    vi.mocked(api.createSession).mockResolvedValue(session([
      scheda, question(61, "Esercizio sul quaderno", "richiamo"),
    ]))
    vi.mocked(api.photoSession).mockResolvedValue({ score: 1, xp: 12, answer_md: "Soluzione fotografata", feedback_md: "Passaggi verificati" })
    renderStudio()

    await screen.findByText("Esercizio sul quaderno")
    fireEvent.change(screen.getByPlaceholderText("Inserisci la tua risposta o procedimento..."), { target: { value: "I miei passaggi" } })
    click("Svolgi a mano sul quaderno e allega foto")
    click("Allega due foto")
    expect(api.photoSession).not.toHaveBeenCalled()
    click("Conferma risposta")

    expect(await screen.findByText("Soluzione fotografata")).toBeDefined()
    expect(screen.getByText("Passaggi verificati")).toBeDefined()
    expect(api.photoSession).toHaveBeenCalledExactlyOnceWith(28, {
      idx: 1, images, text: "I miei passaggi", confidence: 3, seconds: 0,
    })
    expect(api.answerSession).not.toHaveBeenCalled()
    expect(useSessionStore.getState().currentSession?.questionsAnswered).toBe(1)
  })

  it("salva al termine del boss, resta nella fase se fallisce e aspetta il salvataggio prima del defaticamento", async () => {
    vi.mocked(api.createSession).mockResolvedValue(session([question(52, "Boss da concludere", "aperta", true)]))
    let resolveFinish!: (result: { ended_at: string }) => void
    vi.mocked(api.finishSession)
      .mockRejectedValueOnce(new Error("offline"))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFinish = resolve }))
    const client = renderStudio()
    const invalidate = vi.spyOn(client, "invalidateQueries")
    await screen.findByText("Nessuna lezione nuova")
    click("Vai alla fase successiva")
    click("Vai al Boss Finale")
    click("Affronta il Boss")
    await screen.findByText("Soluzione scritta")
    click("Termina sfida")

    expect((await screen.findByRole("alert")).textContent).toContain("Impossibile salvare")
    expect(screen.getByText("Boss da concludere")).toBeDefined()
    expect(screen.queryByRole("button", { name: "Vedi risultati finali" })).toBeNull()
    click("Riprova il salvataggio")
    await waitFor(() => expect(api.finishSession).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole("button", { name: "Vedi risultati finali" })).toBeNull()
    await act(async () => resolveFinish({ ended_at: "2026-11-24T12:00:00Z" }))
    fireEvent.click(await screen.findByRole("button", { name: "Vedi risultati finali" }))

    expect(screen.getByText("Sessione Completata!")).toBeDefined()
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["plan"] })
    expect(useSessionStore.getState().todaySessions).toHaveLength(1)
  })

  it("salva prima del defaticamento anche quando il boss è vuoto", async () => {
    renderStudio()
    await screen.findByText("Nessuna lezione nuova")
    click("Vai alla fase successiva")
    click("Vai al Boss Finale")
    click("Vai al defaticamento")
    await screen.findByRole("button", { name: "Vedi risultati finali" })
    expect(api.finishSession).toHaveBeenCalledExactlyOnceWith(28)
  })

  it("il timer avanza dalla fase corrente nelle quattro scadenze e salva alla fine", async () => {
    vi.mocked(api.createSession).mockResolvedValue(session([
      question(52, "Ripasso a tempo", "richiamo"),
      scheda,
      question(53, "Pratica a tempo"),
      question(54, "Boss a tempo", "aperta", true),
    ]))
    let now = 0
    let frameId = 0
    const frames = new Map<number, FrameRequestCallback>()
    vi.spyOn(performance, "now").mockImplementation(() => now)
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.set(++frameId, callback)
      return frameId
    })
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => { frames.delete(id) })
    const elapse = async (minutes: number) => {
      await act(async () => {
        now += minutes * 60_000
        const pending = [...frames.values()]
        frames.clear()
        pending.forEach((callback) => callback(now))
      })
    }

    renderStudio()
    await screen.findByText("Ripasso a tempo")
    await elapse(2)
    expect(screen.getByRole("heading", { name: "Derivate" })).toBeDefined()
    await elapse(60)
    expect(screen.getByText("Pratica a tempo")).toBeDefined()
    await elapse(30)
    expect(screen.getByText("Boss a tempo")).toBeDefined()
    await elapse(8)
    await screen.findByRole("button", { name: "Vedi risultati finali" })
    expect(api.finishSession).toHaveBeenCalledExactlyOnceWith(28)
  })
})
