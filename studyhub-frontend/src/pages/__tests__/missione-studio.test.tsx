import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { setCsrfToken } from "@/lib/api"
import { useFocusDraft, useStudyPlan } from "@/lib/study-navigation"
import { OggiStudy } from "@/components/home/OggiStudy"
import { FocusWidget } from "@/components/study/FocusWidget"
import { SystemStatusPanel } from "@/components/study/SystemStatusPanel"
import { LecturePanel } from "@/components/study/LecturePanel"
import { FlashcardPage } from "@/pages/Flashcard"
import { Impara } from "@/pages/Impara"
import { Piano } from "@/pages/Piano"
import { Quaderno } from "@/pages/Quaderno"
import * as f from "@/lib/__fixtures__/study-api"

type Handler = (route: string, body: unknown) => Response | undefined
const calls: { route: string; body: unknown }[] = []
const defaults: Record<string, unknown> = {
  "GET /api/courses": [f.course],
  "GET /api/courses/7/lectures": [f.lecture],
  "GET /api/plan/week": f.week,
  "GET /api/settings/availability": f.availability,
}

function backend(handler: Handler) {
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const route = `${init?.method ?? "GET"} ${input}`
    const body: unknown = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ route, body })
    return handler(route, body) ?? (route in defaults ? Response.json(defaults[route]) : Response.json({ detail: `Fixture mancante per ${route}` }, { status: 500 }))
  }))
}

function mount(children: ReactNode, url = "/") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } } })
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[url]}>{children}</MemoryRouter></QueryClientProvider>)
}

beforeEach(() => {
  calls.length = 0
  setCsrfToken("test-csrf")
  useStudyPlan.setState({ missedDay: undefined })
  useFocusDraft.setState({ draft: null })
  vi.spyOn(window, "scrollTo").mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  setCsrfToken(null)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("Oggi e piano", () => {
  it("mostra minuti, arretrato, conto alla rovescia e collegamenti ai blocchi", async () => {
    backend((route) => route === "GET /api/review/today?limit=1" ? Response.json(f.review) : undefined)
    mount(<OggiStudy />)
    expect((await screen.findByRole("link", { name: /Esercizi · Cambio di base/ })).getAttribute("href")).toBe("/studio/7?duration=25&topic=17")
    expect(await screen.findByText("3 min")).toBeDefined()
    expect(screen.getByText("7 carte dovute · 4 in arretrato")).toBeDefined()
    expect(screen.getByText(/Tra 6 giorni/)).toBeDefined()
    expect(screen.getByRole("link", { name: "Ripassa le flashcard" }).getAttribute("href")).toBe("/flashcard?ripasso=1")
    fireEvent.click(screen.getByRole("button", { name: "Avvia focus per Cambio di base" }))
    expect(useFocusDraft.getState().draft).toEqual({ courseId: 7, task: "Esercizi · Cambio di base", minutes: 25 })
  })

  it("salva ore e giorni liberi e presenta i blocchi ricalcolati", async () => {
    backend((route, body) => {
      if (route === "PUT /api/settings/availability") return Response.json(body)
      if (route === "POST /api/plan/recompute" || route === `GET /api/plan/week?missed_day=${f.day}`) return Response.json(f.recomputed)
    })
    mount(<Piano />, "/piano")
    fireEvent.change(await screen.findByLabelText("Lunedì"), { target: { value: "1.5" } })
    fireEvent.change(screen.getByLabelText("Giorno libero"), { target: { value: "2026-11-30" } })
    fireEvent.click(screen.getByRole("button", { name: "Aggiungi giorno libero" }))
    fireEvent.click(screen.getByRole("button", { name: "Salva disponibilità" }))
    expect(await screen.findByText("Disponibilità salvata.")).toBeDefined()
    expect(calls).toContainEqual({ route: "PUT /api/settings/availability", body: { hours_by_weekday: [1.5, 2, 2, 2, 2, 1, 0], days_off: ["2026-11-29", "2026-11-30"] } })
    fireEvent.click(await screen.findByRole("button", { name: "Ho saltato oggi" }))
    expect(await screen.findByText(/Esercizi · Cambio di base.+Nuova data/)).toBeDefined()
    expect(calls).toContainEqual({ route: "POST /api/plan/recompute", body: { missed_day: f.day, start: f.day } })
    expect(useStudyPlan.getState().missedDay).toBe(f.day)
  })

  it("modifica con un solo PUT e ripete la stessa operazione in caso di errore", async () => {
    let failures = 1
    backend((route) => {
      if (route === "PUT /api/exams/3") return failures-- > 0
        ? Response.json({ detail: "Errore temporaneo" }, { status: 500 }) : Response.json({ id: 3 })
    })
    mount(<Piano />, "/piano")
    fireEvent.click(await screen.findByRole("button", { name: "Modifica" }))
    fireEvent.change(screen.getByLabelText("Data dell’appello"), { target: { value: "2026-12-02" } })
    fireEvent.click(screen.getByRole("button", { name: "Salva appello" }))
    expect(await screen.findByText("Errore temporaneo")).toBeDefined()
    fireEvent.click(screen.getByRole("button", { name: "Salva appello" }))
    await waitFor(() => expect(screen.queryByText("Modifica appello")).toBeNull())
    const edit = { route: "PUT /api/exams/3", body: { course_id: 7, date: "2026-12-02", kind: "orale", note: null } }
    expect(calls.filter(({ route }) => route.includes("/api/exams"))).toEqual([edit, edit])
  })
})

describe("Quaderno e flashcard", () => {
  it("apre direttamente la nota cercata anche se non è nella prima pagina", async () => {
    backend((route) => {
      if (route === "GET /api/notes/4") return Response.json(f.note)
      if (route.startsWith("GET /api/notes?")) return Response.json({ notes: [] })
    })
    mount(<Quaderno />, "/quaderno?nota=4")
    expect(await screen.findByText(/La matrice è invertibile/)).toBeDefined()
    expect(calls.filter(({ route }) => route.includes("/api/notes"))).toEqual([{ route: "GET /api/notes/4", body: undefined }])
    fireEvent.click(screen.getByRole("button", { name: "Tutte le note" }))
    expect(await screen.findByText("Nessuna nota corrisponde ai filtri.")).toBeDefined()
  })
  it("annulla la conferma pendente quando si torna dal dettaglio alla lista", async () => {
    backend((route) => {
      if (route === "GET /api/notes/4") return Response.json(f.note)
      if (route.startsWith("GET /api/notes?")) return Response.json({ notes: [{ ...f.note, id: 8, body: "Altra nota" }] })
    })
    mount(<Quaderno />, "/quaderno?nota=4")
    fireEvent.click(await screen.findByRole("button", { name: "Elimina" }))
    expect(screen.getByRole("button", { name: "Conferma eliminazione" })).toBeDefined()
    fireEvent.click(screen.getByRole("button", { name: "Tutte le note" }))
    expect(await screen.findByText("Altra nota")).toBeDefined()
    expect(screen.queryByRole("button", { name: "Conferma eliminazione" })).toBeNull()
    expect((screen.getByRole("button", { name: "Elimina" }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByRole("button", { name: "Modifica" }) as HTMLButtonElement).disabled).toBe(false)
    expect(calls.every(({ route }) => !route.startsWith("DELETE"))).toBe(true)
  })
  it("apre la lista filtrata quando si sceglie un tag nel dettaglio", async () => {
    const [tag] = f.note.tags
    backend((route) => {
      if (route === "GET /api/notes/4") return Response.json(f.note)
      if (route.startsWith("GET /api/notes?") && route.includes(`tag=${tag}`)) {
        return Response.json({ notes: [{ ...f.note, id: 8, body: "Nota con lo stesso tag" }] })
      }
    })
    mount(<Quaderno />, "/quaderno?nota=4")
    fireEvent.click(await screen.findByRole("button", { name: tag }))
    expect(await screen.findByText("Nota con lo stesso tag")).toBeDefined()
    expect((screen.getByPlaceholderText("Tutti i tag") as HTMLInputElement).value).toBe(tag)
    expect(screen.queryByRole("button", { name: "Tutte le note" })).toBeNull()
  })
  it("precompila la fonte dal player, mostra LaTeX e salva la nota", async () => {
    backend((route) => {
      if (route.startsWith("GET /api/notes?")) return Response.json({ notes: [f.note] })
      if (route === "POST /api/notes") return Response.json(f.note, { status: 201 })
    })
    mount(<Quaderno />, "/quaderno?nuova=1&corso=7&lezione=9&t=92.5")
    expect((await screen.findByLabelText("Secondi nel video") as HTMLInputElement).value).toBe("92.5")
    expect((await screen.findByLabelText("Lezione collegata") as HTMLSelectElement).value).toBe("9")
    expect((await screen.findByRole("link", { name: "Lezione a 1:32" })).getAttribute("href")).toBe("/corsi/7?lezione=9&t=92.5")
    fireEvent.change(screen.getByLabelText("Testo della nota"), { target: { value: f.note.body } })
    fireEvent.change(screen.getByLabelText(/Tag della nota/), { target: { value: "esame, matrice" } })
    fireEvent.click(screen.getByRole("button", { name: "Anteprima" }))
    expect(document.querySelectorAll(".katex").length).toBe(2)
    fireEvent.click(screen.getByRole("button", { name: "Salva nota" }))
    await waitFor(() => expect(screen.queryByLabelText("Testo della nota")).toBeNull())
    expect(calls).toContainEqual({ route: "POST /api/notes", body: { body: f.note.body, tags: ["esame", "matrice"], course_id: 7, lecture_id: 9, timestamp_s: 92.5, doc_id: null, page: null } })
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "matrice" } })
    fireEvent.click(screen.getByRole("button", { name: "Cerca" }))
    await waitFor(() => expect(calls.some(({ route }) => route.includes("q=matrice"))).toBe(true))
  })

  it("mostra la pagina del PDF e sospende una flashcard per il corso", async () => {
    let suspended = false
    backend((route) => {
      if (route.startsWith("GET /api/flashcards?")) return Response.json({ cards: [{ ...f.card, suspended }] })
      if (route.startsWith("GET /api/review/today?")) return Response.json(f.review)
      if (route === "PATCH /api/flashcards/10") {
        suspended = true
        return Response.json({ ...f.card, suspended })
      }
    })
    mount(<FlashcardPage />, "/flashcard?corso=7")
    expect((await screen.findByRole("link", { name: "Documento a pagina 12" })).getAttribute("href")).toBe("/documento/40?pagina=12")
    fireEvent.click(screen.getByRole("button", { name: "Sospendi" }))
    expect(await screen.findByText("Sospesa")).toBeDefined()
    expect(calls).toContainEqual({ route: "PATCH /api/flashcards/10", body: { suspended: true } })
  })

  it("apre la coda del ripasso usando le carte restituite da review/today", async () => {
    backend((route) => {
      if (route.startsWith("GET /api/flashcards?")) return Response.json({ cards: [f.card] })
      if (route.startsWith("GET /api/review/today?")) return Response.json(f.review)
    })
    mount(<FlashcardPage />, "/flashcard?corso=7&ripasso=1")
    const dialog = await screen.findByRole("dialog")
    expect(dialog.textContent).toContain(f.card.front)
    expect(dialog.textContent).not.toContain("Lezione #0")
  })
})

describe("Focus", () => {
  it("ripristina dal server il tempo residuo e carica il riepilogo per giorno e corso", async () => {
    backend((route) => {
      if (route === "GET /api/focus?limit=1") return Response.json({ sessions: [f.focus] })
      if (route.startsWith("GET /api/focus/summary")) return Response.json(f.summary)
    })
    mount(<FocusWidget />)
    await waitFor(() => expect(screen.getByRole("button", { name: "Apri Pomodoro" }).textContent).toBe(" 23:00"))
    fireEvent.click(screen.getByRole("button", { name: "Apri Pomodoro" }))
    expect(await screen.findByText("7 min di focus · 3 min di pausa")).toBeDefined()
    expect(screen.getByRole("timer").textContent).toBe("23:00")
    await screen.findByRole("option", { name: f.course.fullname })
    fireEvent.change(screen.getByLabelText("Corso del riepilogo"), { target: { value: "7" } })
    fireEvent.change(screen.getByLabelText("Giorno del riepilogo"), { target: { value: "2026-11-24" } })
    await waitFor(() => expect(calls).toContainEqual({ route: "GET /api/focus/summary?course_id=7&day=2026-11-24", body: undefined }))
  })

  it("avvia un timer da un compito del piano e consente di terminarlo", async () => {
    let session: object | null = null
    backend((route) => {
      if (route === "GET /api/focus?limit=1") return Response.json({ sessions: session ? [session] : [] })
      if (route.startsWith("GET /api/focus/summary")) return Response.json(f.summary)
      if (route === "POST /api/focus/start") {
        session = { ...f.focus, actual_seconds: 0 }
        return Response.json(session, { status: 201 })
      }
      if (route === "POST /api/focus/6/stop") {
        session = { ...f.focus, status: "stopped", stopped_at: f.focus.ends_at }
        return Response.json(session)
      }
    })
    mount(<FocusWidget />)
    act(() => useFocusDraft.getState().openFocus({ courseId: 7, task: f.focus.task, minutes: 25 }))
    expect((await screen.findByLabelText("Compito") as HTMLInputElement).value).toBe(f.focus.task)
    await waitFor(() => expect((screen.getByRole("button", { name: "Avvia timer" }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole("button", { name: "Avvia timer" }))
    expect(await screen.findByRole("timer")).toBeDefined()
    await waitFor(() => expect((screen.getByRole("button", { name: "Termina sessione" }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole("button", { name: "Termina sessione" }))
    await waitFor(() => expect(screen.queryByRole("timer")).toBeNull())
    expect(calls).toContainEqual({ route: "POST /api/focus/start", body: { course_id: 7, task: f.focus.task, kind: "focus", planned_seconds: 1500 } })
    expect(calls).toContainEqual({ route: "POST /api/focus/6/stop", body: undefined })
  })
})

describe("Impara, pannello lezione e stato", () => {
  function mountImpara() {
    return mount(<Routes><Route path="/impara/:topicId" element={<Impara />} /></Routes>, "/impara/17")
  }

  it("legge la lezione senza prepararla finché non viene richiesto", async () => {
    backend((route) => {
      if (route.endsWith("?prepare=false")) return Response.json(f.lessonMissing)
      if (route.endsWith("/lesson/prepare")) return Response.json({ ...f.lessonMissing, status: "in_coda" })
    })
    mountImpara()
    const prepare = await screen.findByRole("button", { name: "Prepara lezione con AI" })
    expect(calls.map(({ route }) => route)).toEqual(["GET /api/study/topics/17/lesson?prepare=false"])
    fireEvent.click(prepare)
    expect(await screen.findByText("Preparazione in corso…")).toBeDefined()
    expect(calls.map(({ route }) => route)).toContain("POST /api/study/topics/17/lesson/prepare")
  })

  it("rende il simulatore e la verifica e registra il completamento", async () => {
    backend((route) => {
      if (route.endsWith("?prepare=false")) return Response.json(f.lessonReady)
      if (route.endsWith("/lesson/done")) return Response.json({ ok: true })
    })
    mountImpara()
    expect(await screen.findByText("Griglia delle basi")).toBeDefined()
    expect((screen.getByRole("button", { name: "Vai al riepilogo" }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "Due" }))
    expect(screen.getByText("Risposta corretta")).toBeDefined()
    fireEvent.click(screen.getByRole("button", { name: "Vai al riepilogo" }))
    fireEvent.click(screen.getByRole("button", { name: "Completa lezione" }))
    expect(await screen.findByText("Lezione completata.")).toBeDefined()
    expect(calls).toContainEqual({ route: "POST /api/study/topics/17/lesson/done", body: undefined })
  })

  it("legge appunti e tentativi, invia Falso come 0 e mostra la correzione reale", async () => {
    backend((route) => {
      if (route === "GET /api/lectures/9/topics") return Response.json(f.lectureTopics)
      if (route === "GET /api/lectures/9/notes") return Response.json(f.lectureNotes)
      if (route === "GET /api/lectures/9/quizzes") return Response.json(f.quizList)
      if (route === "GET /api/quizzes/11") return Response.json(f.quiz)
      if (route === "POST /api/quizzes/11/submit") return Response.json(f.correction)
    })
    mount(<LecturePanel lectureId={9} />)
    expect(await screen.findByText("Un sottospazio è chiuso per somma.")).toBeDefined()
    const quiz = await screen.findByRole("button", { name: /Quiz sulle basi/ })
    expect(calls.every(({ route }) => route.startsWith("GET "))).toBe(true)
    fireEvent.click(quiz)
    fireEvent.click(await screen.findByRole("radio", { name: "Falso" }))
    expect(screen.getByText(/· 1 \/ 2/)).toBeDefined()
    fireEvent.change(screen.getByLabelText("Risposta"), { target: { value: "Combinazioni lineari" } })
    fireEvent.click(screen.getByRole("button", { name: "Consegna quiz" }))
    expect(await screen.findByText("Punteggio 1,5 / 2")).toBeDefined()
    expect(screen.getByText("Specifica l’insieme dei vettori.")).toBeDefined()
    expect(calls).toContainEqual({ route: "POST /api/quizzes/11/submit", body: { answers: [0, "Combinazioni lineari"] } })
  })

  it("accoda gli appunti da un pulsante e rilegge quelli pronti al termine del lavoro", async () => {
    let generated = false
    backend((route) => {
      if (route === "GET /api/lectures/9/topics" || route === "GET /api/lectures/9/quizzes") return Response.json([])
      if (route === "GET /api/lectures/9/notes") return Response.json(generated ? f.lectureNotes : { exists: false })
      if (route === "POST /api/lectures/9/notes") return Response.json({ queued: [20] })
      if (route === "GET /api/ai/status") {
        generated = true
        return Response.json({ jobs: [{ id: 20, target_id: 9, kind: "lecture_notes", status: "fatto", message: null }], paused_reason: null })
      }
    })
    mount(<LecturePanel lectureId={9} />)
    await screen.findByText("Appunti ancora da generare.")
    expect(calls.some(({ route }) => route.startsWith("POST "))).toBe(false)
    fireEvent.click(screen.getByRole("button", { name: "Genera appunti AI" }))
    expect(await screen.findByText("Elaborazione completata.")).toBeDefined()
    expect(await screen.findByText("Un sottospazio è chiuso per somma.")).toBeDefined()
    expect(calls).toContainEqual({ route: "POST /api/lectures/9/notes", body: undefined })
  })

  it("mostra errori provider, login, ultimo sync e spazio Restic dalla risposta", async () => {
    backend((route) => route === "GET /api/system/status" ? Response.json(f.system) : undefined)
    mount(<SystemStatusPanel />)
    expect(await screen.findByText("Verifica l’abbonamento Claude.")).toBeDefined()
    expect(screen.getByText("Accesso scaduto")).toBeDefined()
    expect(screen.getByText("2 file nuovi · 1 aggiornati · 0 errori")).toBeDefined()
    expect(screen.getByText(/Repository 1 GiB · 2 GiB liberi/)).toBeDefined()
    expect(calls).toEqual([{ route: "GET /api/system/status", body: undefined }])
  })
})
