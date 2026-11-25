import { StrictMode } from "react"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Studio } from "../Studio"
import { api, ApiError } from "@/lib/api"
import { normalizeSession, type AnswerResult, type FinishResult } from "@/lib/study-session"

vi.mock("@/lib/api", async (orig) => {
  const real = await orig<typeof import("@/lib/api")>()
  return {
    ...real,
    api: {
      getCourse: vi.fn(),
      getSession: vi.fn(),
      getOpenSession: vi.fn(),
      abandonSession: vi.fn(),
      seenSession: vi.fn(),
      createSession: vi.fn(),
      answerSession: vi.fn(),
      photoSession: vi.fn(),
      revealSession: vi.fn(),
      finishSession: vi.fn(),
      getStudyCourseStats: vi.fn(),
      completeTopicLesson: vi.fn(),
      flashcardFromError: vi.fn(),
    },
  }
})

const images = ["data:image/jpeg;base64,YQ==", "data:image/jpeg;base64,Yg=="]
vi.mock("@/components/camera/PhotoUpload", () => ({
  PhotoUpload: ({ onPhotosChange }: { onPhotosChange: (photos: string[]) => void }) => (
    <button onClick={() => onPhotosChange(images)}>Allega due foto</button>
  ),
}))

const q = (item: number, prompt: string, kind = "aperta", extra: Record<string, unknown> = {}) => ({
  t: "domanda", item, done: false, ...extra,
  question: {
    id: item, kind, difficulty: 2, prompt_md: prompt, topic_id: 4, doc_id: null, page: null,
    lecture_id: 9, t_start: 120, options: kind === "multipla" ? ["Uno", "Due", "Tre"] : null, n_criteria: 2,
  },
})
const scheda = { t: "scheda", topic: 4, done: false }
const topics = { "4": { id: 4, name: "Serie di Laurent", summary_md: "La serie di Laurent ha anche potenze negative." } }

const session = (entries: object[], extra: Record<string, unknown> = {}) => normalizeSession({
  id: 28, course_id: 7, minutes: 45, started_at: "2026-11-25T10:00:00", ended_at: null, xp: 0,
  entries, topics, resume_index: entries.findIndex((e: any) => !e.done), phase: "domanda", errors: [], ...extra,
})

const answer = (over: Partial<AnswerResult> = {}): AnswerResult => ({
  attempt_id: 1, score: 1, correct: null, answer_md: "Soluzione ufficiale", rubric: [], criteria_ok: [],
  feedback_md: null, graded_by: "auto", xp: 10, retry: false, requeued: null,
  source: { lecture_id: 9, lecture: "Lezione 12", t_start: 120, doc_id: null, doc: null, page: null }, ...over,
})

const finished = (over: Partial<FinishResult> = {}): FinishResult => ({
  answered: 1, correct: 1, xp: 10, ready_before: 0.1, ready_after: 0.15, topics_up: [], wrong: [], streak: 1,
  verdict: { tone: "warn", title: "Non sei pronto", text: "Proiezione bassa." }, ...over,
})

function renderStudio(query = "") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <StrictMode>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/studio/7${query}`]}>
          <Routes>
            <Route path="/studio/:courseId" element={<Studio />} />
            <Route path="/corsi/:id" element={<p>Pagina corso</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </StrictMode>,
  )
  return client
}

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }))
const pick = (name: string) => fireEvent.click(screen.getByRole("radio", { name }))
async function start() {
  fireEvent.click(await screen.findByRole("button", { name: "Avvia sessione" }))
}

beforeEach(() => {
  vi.resetAllMocks()
  window.scrollTo = (() => {}) as typeof window.scrollTo // jsdom non lo implementa
  vi.mocked(api.getOpenSession).mockResolvedValue(null)
  vi.mocked(api.seenSession).mockResolvedValue({ ok: true, done: true })
  vi.mocked(api.getCourse).mockResolvedValue({ id: 7, fullname: "Analisi", shortname: "Analisi" } as any)
  vi.mocked(api.finishSession).mockResolvedValue(finished())
  vi.mocked(api.completeTopicLesson).mockResolvedValue({ ok: true })
})
afterEach(() => vi.restoreAllMocks())

describe("Studio: avvio e ripresa", () => {
  it("aprire la pagina non crea sessioni: serve il pulsante Avvia", async () => {
    vi.mocked(api.createSession).mockResolvedValue(session([q(1, "Prima domanda")]))
    renderStudio("?duration=90")
    expect(await screen.findByRole("button", { name: "Avvia sessione" })).toBeDefined()
    expect(screen.getByRole("button", { name: "90 min" }).getAttribute("aria-pressed")).toBe("true")
    expect(api.createSession).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "25 min" }))
    await start()
    await screen.findByText("Prima domanda")
    expect(api.createSession).toHaveBeenCalledExactlyOnceWith(7, 25, undefined)
    expect(api.getOpenSession).toHaveBeenCalledWith(7)
  })

  it("una sessione aperta sul server (anche da un altro browser) si propone: riprendila", async () => {
    const open = session([
      q(1, "Già fatta uno", "aperta", { done: true }), q(2, "Già fatta due", "aperta", { done: true }), q(3, "Terza da fare"),
    ], { resume_index: 2 })
    vi.mocked(api.getOpenSession).mockResolvedValue(open)
    vi.mocked(api.getSession).mockResolvedValue(open)
    renderStudio()
    expect(await screen.findByText("Hai una sessione aperta")).toBeDefined()
    expect(screen.getByText(/2 di 3 voci fatte/)).toBeDefined()
    expect(screen.queryByRole("button", { name: "Avvia sessione" })).toBeNull()
    click(/Riprendi la sessione/)
    expect(await screen.findByText("Terza da fare")).toBeDefined()
    expect(api.getSession).toHaveBeenCalledWith(28)
    expect(screen.queryByText("Già fatta uno")).toBeNull()
    expect(api.createSession).not.toHaveBeenCalled()
    expect(screen.getByText("3/3")).toBeDefined()
  })

  it("'Chiudila' abbandona la sessione aperta e torna alla schermata d'avvio", async () => {
    vi.mocked(api.getOpenSession).mockResolvedValueOnce(session([q(1, "Vecchia")])).mockResolvedValue(null)
    vi.mocked(api.abandonSession).mockResolvedValue(session([q(1, "Vecchia")], { ended_at: "2026-11-25T11:00:00" }))
    renderStudio()
    fireEvent.click(await screen.findByRole("button", { name: "Chiudila" }))
    expect(await screen.findByRole("button", { name: "Avvia sessione" })).toBeDefined()
    expect(api.abandonSession).toHaveBeenCalledExactlyOnceWith(28)
    expect(api.getSession).not.toHaveBeenCalled()
  })

  it("ripresa in fase 'rivelata' senza sicurezza salvata: la richiede prima di salvare", async () => {
    const open = session([q(1, "Rivelata prima", "aperta", { revealed: true })], { phase: "rivelata" })
    vi.mocked(api.getOpenSession).mockResolvedValue(open)
    vi.mocked(api.getSession).mockResolvedValue(open)
    vi.mocked(api.revealSession).mockResolvedValue({ answer_md: "Passaggi corretti", rubric: ["Imposta", "Conclude"], confidence: null })
    renderStudio()
    fireEvent.click(await screen.findByRole("button", { name: /Riprendi la sessione/ }))
    expect(await screen.findByText("Passaggi corretti")).toBeDefined()
    expect(api.revealSession).toHaveBeenCalledWith(28, 0, undefined)
    expect(screen.getByRole("checkbox", { name: "Imposta" })).toBeDefined()
    // dopo la ricarica la sicurezza va richiesta di nuovo, altrimenti non si potrebbe salvare
    expect(screen.getByRole("button", { name: "Salva l'autovalutazione" }).hasAttribute("disabled")).toBe(true)
    expect(screen.getByText("Quanto eri sicuro prima di vedere la soluzione?", { exact: false })).toBeDefined()
    vi.mocked(api.answerSession).mockResolvedValue(answer({ score: 0.5, graded_by: "io" }))
    pick("Credo")
    fireEvent.click(screen.getByRole("checkbox", { name: "Imposta" }))
    click("Salva l'autovalutazione")
    await screen.findByText("Parziale")
    expect(vi.mocked(api.answerSession).mock.calls[0][1]).toMatchObject({ idx: 0, self_criteria: [true, false], confidence: 2 })
  })

  it("ripresa in fase 'rivelata' con la sicurezza salvata al reveal: non la richiede", async () => {
    const open = session([q(1, "Rivelata prima", "aperta", { revealed: true })], { phase: "rivelata" })
    vi.mocked(api.getOpenSession).mockResolvedValue(open)
    vi.mocked(api.getSession).mockResolvedValue(open)
    vi.mocked(api.revealSession).mockResolvedValue({ answer_md: "Passaggi corretti", rubric: [], confidence: 3, revealed_at: "2026-11-25T10:05:00Z" })
    vi.mocked(api.answerSession).mockResolvedValue(answer({ score: 0.85, graded_by: "io" }))
    renderStudio()
    fireEvent.click(await screen.findByRole("button", { name: /Riprendi la sessione/ }))
    expect(await screen.findByText("Passaggi corretti")).toBeDefined()
    expect(screen.queryByText("Quanto eri sicuro prima di vedere la soluzione?", { exact: false })).toBeNull()
    pick("Sì")
    click("Salva l'autovalutazione")
    await screen.findByText("Corretta")
    expect(vi.mocked(api.answerSession).mock.calls[0][1]).toMatchObject({ self_score: 1, confidence: 3 })
  })

  it("la scheda letta la segna il server (POST /seen), niente copia nel browser", async () => {
    vi.mocked(api.createSession).mockResolvedValue(session([scheda, q(2, "Dopo la scheda")]))
    renderStudio()
    await start()
    expect(await screen.findByRole("heading", { name: "Serie di Laurent" })).toBeDefined()
    click(/Ho letto/)
    expect(await screen.findByText("Dopo la scheda")).toBeDefined()
    expect(api.seenSession).toHaveBeenCalledExactlyOnceWith(28, 0)
    expect(api.completeTopicLesson).toHaveBeenCalledWith(4)
    expect(window.localStorage.getItem("studyhub-session")).toBeNull()
  })

  it("se /seen fallisce la scheda resta lì con l'errore e 'Riprova'", async () => {
    vi.mocked(api.createSession).mockResolvedValue(session([scheda, q(2, "Dopo la scheda")]))
    vi.mocked(api.seenSession).mockRejectedValueOnce(new ApiError(409, "La sessione è già terminata."))
    renderStudio()
    await start()
    await screen.findByRole("heading", { name: "Serie di Laurent" })
    click(/Ho letto/)
    expect((await screen.findByRole("alert")).textContent).toContain("già terminata")
    expect(screen.queryByText("Dopo la scheda")).toBeNull()
    click(/Riprova/)
    expect(await screen.findByText("Dopo la scheda")).toBeDefined()
  })
})

describe("Studio: risposte", () => {
  it("mostra il nome dell'argomento, non 'Topic N'", async () => {
    vi.mocked(api.createSession).mockResolvedValue(session([q(1, "Domanda con argomento")]))
    renderStudio()
    await start()
    await screen.findByText("Domanda con argomento")
    expect(screen.getByText("Serie di Laurent")).toBeDefined()
    expect(screen.queryByText(/Topic 4/)).toBeNull()
  })

  it("vero/falso ha i pulsanti e manda Vero=1", async () => {
    vi.mocked(api.createSession).mockResolvedValue(session([q(1, "La serie converge?", "vero_falso")]))
    vi.mocked(api.answerSession).mockResolvedValue(answer({ correct: 1 }))
    renderStudio()
    await start()
    await screen.findByText("La serie converge?")
    click("Vero")
    pick("Sicuro")
    click("Conferma")
    await screen.findByText("Corretta")
    expect(vi.mocked(api.answerSession).mock.calls[0][1]).toMatchObject({ idx: 0, choice: 1, confidence: 3 })
  })

  it("'svolto sul quaderno' rivela e salva l'autovalutazione sui criteri, mai come testo", async () => {
    vi.mocked(api.createSession).mockResolvedValue(session([q(1, "Calcola il residuo")]))
    vi.mocked(api.revealSession).mockResolvedValue({ answer_md: "Il residuo vale 2", rubric: ["Polo semplice", "Limite corretto"] })
    vi.mocked(api.answerSession).mockResolvedValue(answer({ score: 0.5, graded_by: "io" }))
    renderStudio()
    await start()
    await screen.findByText("Calcola il residuo")
    expect(screen.getByRole("button", { name: /Svolto sul quaderno/ }).hasAttribute("disabled")).toBe(true)
    pick("Credo")
    click(/Svolto sul quaderno/)
    expect(await screen.findByText("Il residuo vale 2")).toBeDefined()
    // la sicurezza e il tempo di risoluzione si salvano già al reveal (prevalgono su quelli dell'autovalutazione)
    expect(api.revealSession).toHaveBeenCalledExactlyOnceWith(28, 0, { confidence: 2, seconds: expect.any(Number) })
    fireEvent.click(screen.getByRole("checkbox", { name: "Polo semplice" }))
    click("Salva l'autovalutazione")
    await screen.findByText("Parziale")
    const payload = vi.mocked(api.answerSession).mock.calls[0][1]
    expect(payload).toMatchObject({ idx: 0, self_criteria: [true, false], confidence: 2 })
    expect(payload.text).toBeUndefined()
  })

  it("senza criteri: giudizio No/Parziale/Sì con i tasti 1-3", async () => {
    vi.mocked(api.createSession).mockResolvedValue(session([q(1, "Enuncia il teorema")]))
    vi.mocked(api.revealSession).mockResolvedValue({ answer_md: "Enunciato", rubric: [] })
    vi.mocked(api.answerSession).mockResolvedValue(answer({ score: 0.85, graded_by: "io" }))
    renderStudio()
    await start()
    await screen.findByText("Enuncia il teorema")
    fireEvent.keyDown(window, { key: "1" })
    fireEvent.keyDown(window, { key: " " })
    await screen.findByText("Enunciato")
    fireEvent.keyDown(window, { key: "3" })
    fireEvent.keyDown(window, { key: "Enter" })
    await screen.findByText("Corretta")
    expect(vi.mocked(api.answerSession).mock.calls[0][1]).toMatchObject({ self_score: 1, confidence: 1 })
  })

  it("scorciatoie: 1-3 sicurezza, lettera per l'opzione, Invio consegna e poi avanza", async () => {
    vi.mocked(api.createSession).mockResolvedValue(session([q(1, "Quale?", "multipla"), q(2, "Seconda")]))
    vi.mocked(api.answerSession).mockResolvedValue(answer({ correct: 1 }))
    renderStudio()
    await start()
    await screen.findByText("Quale?")
    fireEvent.keyDown(window, { key: "3" })
    fireEvent.keyDown(window, { key: "b" })
    fireEvent.keyDown(window, { key: "Enter" })
    await screen.findByText("Corretta")
    expect(vi.mocked(api.answerSession).mock.calls[0][1]).toMatchObject({ choice: 1, confidence: 3 })
    fireEvent.keyDown(window, { key: "Enter" })
    expect(await screen.findByText("Seconda")).toBeDefined()
  })

  it("manda i secondi misurati davvero", async () => {
    let t = 1_000_000
    vi.spyOn(Date, "now").mockImplementation(() => t)
    vi.mocked(api.createSession).mockResolvedValue(session([q(1, "Quanto tempo?", "multipla")]))
    vi.mocked(api.answerSession).mockResolvedValue(answer())
    renderStudio()
    await start()
    await screen.findByText("Quanto tempo?")
    t += 42_000
    click(/Due/)
    pick("Credo")
    click("Conferma")
    await screen.findByText("Corretta")
    expect(vi.mocked(api.answerSession).mock.calls[0][1].seconds).toBe(42)
  })

  it("la domanda sbagliata rimessa in coda dal server compare alla fine", async () => {
    const s = session([q(1, "Domanda difficile", "multipla"), q(2, "Altra domanda", "multipla")])
    vi.mocked(api.createSession).mockResolvedValue(s)
    vi.mocked(api.answerSession)
      .mockResolvedValueOnce(answer({ score: 0, correct: 2, requeued: { idx: 2, t: "domanda", item: 1, retry: true, done: false, question: s.entries[0].question } }))
      .mockResolvedValueOnce(answer({ correct: 0 }))
    renderStudio()
    await start()
    await screen.findByText("Domanda difficile")
    click(/Uno/); pick("Sicuro"); click("Conferma")
    expect(await screen.findByText(/La ritrovi in fondo/)).toBeDefined()
    click("Avanti")
    await screen.findByText("Altra domanda")
    click(/Uno/); pick("Credo"); click("Conferma")
    await screen.findByText("Corretta")
    click("Avanti")
    expect(await screen.findByText("Domanda difficile")).toBeDefined()
    expect(screen.getByText(/L'avevi sbagliata/)).toBeDefined()
    expect(screen.getByText("3/3")).toBeDefined()
  })

  it("nessun avanzamento a tempo: dopo due ore la domanda è ancora lì", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      vi.mocked(api.createSession).mockResolvedValue(session([q(1, "Resto qui"), q(2, "Non devo comparire")]))
      renderStudio("?duration=25")
      await start()
      await screen.findByText("Resto qui")
      await act(async () => { vi.advanceTimersByTime(2 * 3600_000) })
      expect(screen.getByText("Resto qui")).toBeDefined()
      expect(screen.queryByText("Non devo comparire")).toBeNull()
      expect(api.answerSession).not.toHaveBeenCalled()
      expect(api.finishSession).not.toHaveBeenCalled()
      expect(screen.getByText(/oltre il tempo previsto/)).toBeDefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it("se il salvataggio fallisce: errore, niente avanti, 'Riprova' rimanda la stessa richiesta", async () => {
    vi.mocked(api.createSession).mockResolvedValue(session([q(1, "Salvami", "multipla"), q(2, "Dopo")]))
    vi.mocked(api.answerSession)
      .mockRejectedValueOnce(new ApiError(502, "Il servizio AI non ha risposto correttamente."))
      .mockResolvedValueOnce(answer())
    renderStudio()
    await start()
    await screen.findByText("Salvami")
    click(/Due/); pick("Sicuro"); click("Conferma")
    expect((await screen.findByRole("alert")).textContent).toContain("Risposta non salvata")
    expect(screen.queryByRole("button", { name: "Avanti" })).toBeNull()
    expect(screen.getByRole("button", { name: "Conferma" }).hasAttribute("disabled")).toBe(true)
    click("Riprova")
    await screen.findByText("Corretta")
    const [first, second] = vi.mocked(api.answerSession).mock.calls
    expect(second).toEqual(first)
  })

  it("nessun doppio invio con doppio clic", async () => {
    let resolve!: (r: AnswerResult) => void
    vi.mocked(api.createSession).mockResolvedValue(session([q(1, "Un clic solo", "multipla")]))
    vi.mocked(api.answerSession).mockImplementation(() => new Promise((r) => { resolve = r }))
    renderStudio()
    await start()
    await screen.findByText("Un clic solo")
    click(/Tre/); pick("Sicuro")
    const btn = screen.getByRole("button", { name: "Conferma" })
    fireEvent.click(btn); fireEvent.click(btn)
    fireEvent.keyDown(window, { key: "Enter" })
    await act(async () => resolve(answer()))
    expect(api.answerSession).toHaveBeenCalledTimes(1)
  })

  it("le foto vanno al percorso foto con testo, sicurezza e secondi", async () => {
    vi.mocked(api.createSession).mockResolvedValue(session([q(1, "Esercizio a mano", "esercizio")]))
    vi.mocked(api.photoSession).mockResolvedValue(answer({ graded_by: "ai", feedback_md: "Passaggi letti" }))
    renderStudio()
    await start()
    await screen.findByText("Esercizio a mano")
    fireEvent.change(screen.getByRole("textbox", { name: "La tua risposta" }), { target: { value: "I miei passaggi" } })
    click(/Foto del quaderno/)
    click("Allega due foto")
    pick("Credo")
    click("Invia le foto per la correzione")
    expect(await screen.findByText("Passaggi letti")).toBeDefined()
    expect(vi.mocked(api.photoSession).mock.calls[0][1]).toMatchObject({ idx: 0, images, text: "I miei passaggi", confidence: 2 })
    expect(api.answerSession).not.toHaveBeenCalled()
  })
})

describe("Studio: fine sessione", () => {
  it("alla fine salva e mostra un riepilogo onesto con errori, argomenti e prossima sessione", async () => {
    vi.mocked(api.createSession).mockResolvedValue(session([q(1, "Ultima", "multipla")]))
    vi.mocked(api.answerSession).mockResolvedValue(answer({ score: 0, correct: 0, attempt_id: 77 }))
    vi.mocked(api.finishSession).mockResolvedValue(finished({
      answered: 1, correct: 0,
      wrong: [{ id: 1, attempt_id: 77, prompt_md: "Ultima", topic: "Serie di Laurent", lecture_id: 9, t_start: 120, doc_id: null, page: null }],
    }))
    vi.mocked(api.flashcardFromError).mockRejectedValue(new ApiError(404, "Elemento non trovato."))
    renderStudio()
    await start()
    await screen.findByText("Ultima")
    click(/Uno/); pick("Tiro a indovinare"); click("Conferma")
    await screen.findByText("Da rivedere")
    click("Vai al riepilogo")
    expect(await screen.findByText("Sessione conclusa")).toBeDefined()
    expect(api.finishSession).toHaveBeenCalledExactlyOnceWith(28)
    expect(screen.getByText(/0 giuste su 1/)).toBeDefined()
    expect(screen.getByText("Cosa hai sbagliato")).toBeDefined()
    expect(screen.getByText("Argomenti da rivedere")).toBeDefined()
    expect(screen.getByRole("button", { name: /25 min sugli errori/ })).toBeDefined()
    click(/Crea flashcard/)
    expect(await screen.findByText(/non è ancora disponibile/)).toBeDefined()
    expect(api.flashcardFromError).toHaveBeenCalledWith(77)
  })

  it("se il salvataggio finale fallisce si può riprovare", async () => {
    vi.mocked(api.createSession).mockResolvedValue(session([q(1, "Fine", "multipla")]))
    vi.mocked(api.answerSession).mockResolvedValue(answer())
    vi.mocked(api.finishSession).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(finished())
    renderStudio()
    await start()
    await screen.findByText("Fine")
    click(/Uno/); pick("Sicuro"); click("Conferma")
    await screen.findByText("Corretta")
    click("Vai al riepilogo")
    expect((await screen.findByRole("alert")).textContent).toContain("Impossibile salvare la fine")
    click("Riprova il salvataggio")
    expect(await screen.findByText("Sessione conclusa")).toBeDefined()
    await waitFor(() => expect(api.finishSession).toHaveBeenCalledTimes(2))
  })

  it("'Termina' chiede conferma e poi chiude la sessione", async () => {
    vi.mocked(api.createSession).mockResolvedValue(session([q(1, "Una"), q(2, "Due")]))
    renderStudio()
    await start()
    await screen.findByText("Una")
    click("Termina la sessione")
    expect(api.finishSession).not.toHaveBeenCalled()
    click("Termina e vedi il riepilogo")
    expect(await screen.findByText("Sessione conclusa")).toBeDefined()
  })
})
