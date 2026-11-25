import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { CommandPalette } from "@/components/command-palette"
import { MainLayout } from "@/components/layout/MainLayout"
import { useUIStore } from "@/store/ui"
import { api } from "@/lib/api"

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api")
  return {
    ...actual,
    api: { search: vi.fn(), getLecture: vi.fn(), getNotifications: vi.fn(), markNotificationsRead: vi.fn() },
  }
})

function Where() {
  const loc = useLocation()
  return <div data-testid="where">{loc.pathname}{loc.search}</div>
}

function renderApp(path = "/") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<MainLayout />}>
            <Route path="*" element={<Where />} />
          </Route>
        </Routes>
        <CommandPalette />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  localStorage.clear()
  useUIStore.setState({ theme: "system", sidebarOpen: false, sidebarCollapsed: false, commandPaletteOpen: false })
  vi.mocked(api.getNotifications).mockResolvedValue([])
  Element.prototype.scrollIntoView = vi.fn()
})

describe("Ricerca globale", () => {
  it("Ctrl+K apre la palette da qualsiasi punto e la richiude", async () => {
    renderApp()
    expect(screen.queryByRole("dialog")).toBeNull()
    fireEvent.keyDown(window, { key: "k", ctrlKey: true })
    expect(await screen.findByRole("dialog")).toBeDefined()
    fireEvent.keyDown(window, { key: "k", metaKey: true })
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })

  it("mostra i risultati reali raggruppati e apre la lezione al minuto giusto", async () => {
    vi.mocked(api.search).mockResolvedValue({
      semantic: true,
      results: [
        { id: 11, kind: "transcript", group: "lezioni", title: "Lezione 12", snippet: "la [[trasformata]] di Laplace", course: "Analisi", courseId: 25782, docId: 5, lectureId: 190, page: null, tStart: 754.2, heading: null, score: 1 },
        { id: 12, kind: "pdf", group: "documenti", title: "dispense.pdf", snippet: "", course: "Analisi", courseId: 25782, docId: 8, lectureId: null, page: 7, tStart: null, heading: null, score: 0.5 },
      ],
    })
    renderApp()
    act(() => useUIStore.getState().setCommandPaletteOpen(true))
    fireEvent.change(await screen.findByRole("textbox", { name: "Cerca nel materiale" }), { target: { value: "laplace" } })
    expect(await screen.findByTestId("gruppo-lezioni")).toBeDefined()
    expect(screen.getByTestId("gruppo-documenti")).toBeDefined()
    expect(screen.getByText("trasformata").tagName).toBe("MARK")
    expect(api.search).toHaveBeenCalledWith("laplace", { limit: 20 })
    fireEvent.click(screen.getByText("Lezione 12"))
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/corsi/25782?lezione=190&t=754"))
  })

  it("apre il PDF alla pagina del risultato nel visore dell'app", async () => {
    vi.mocked(api.search).mockResolvedValue({
      semantic: false,
      results: [{ id: 12, kind: "pdf", group: "documenti", title: "dispense.pdf", snippet: "", course: null, courseId: null, docId: 8, lectureId: null, page: 7, tStart: null, heading: null, score: 1 }],
    })
    renderApp()
    act(() => useUIStore.getState().setCommandPaletteOpen(true))
    fireEvent.change(await screen.findByRole("textbox", { name: "Cerca nel materiale" }), { target: { value: "teorema" } })
    const hit = await screen.findByText("dispense.pdf")
    expect(screen.getByText(/solo per parole/)).toBeDefined()
    fireEvent.click(hit)
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/documento/8?pagina=7"))
  })

  it("mostra in italiano il detail di errore del backend", async () => {
    const { ApiError } = await vi.importActual<typeof import("@/lib/api")>("@/lib/api")
    vi.mocked(api.search).mockRejectedValue(new ApiError(500, "Indice di ricerca non disponibile"))
    renderApp()
    act(() => useUIStore.getState().setCommandPaletteOpen(true))
    fireEvent.change(await screen.findByRole("textbox", { name: "Cerca nel materiale" }), { target: { value: "xx" } })
    expect((await screen.findByRole("alert")).textContent).toContain("Indice di ricerca non disponibile")
  })
})

describe("Layout", () => {
  it("il menu mobile parte chiuso, si apre dal pulsante e si chiude con Esc o cambiando pagina", async () => {
    renderApp()
    const sidebar = document.getElementById("app-sidebar")!
    expect(sidebar.getAttribute("data-open")).toBe("false")
    expect(screen.queryByTestId("sidebar-backdrop")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Apri menu" }))
    expect(sidebar.getAttribute("data-open")).toBe("true")
    fireEvent.keyDown(window, { key: "Escape" })
    expect(sidebar.getAttribute("data-open")).toBe("false")
    fireEvent.click(screen.getByRole("button", { name: "Apri menu" }))
    fireEvent.click(screen.getByRole("link", { name: "Corsi" }))
    await waitFor(() => expect(sidebar.getAttribute("data-open")).toBe("false"))
    expect(screen.getByTestId("where").textContent).toBe("/corsi")
  })

  it("il campanello mostra le notifiche non lette senza duplicati", async () => {
    vi.mocked(api.getNotifications).mockResolvedValue([
      { id: 1, kind: "errore", course_id: null, title: "Panopto: login necessario", body: "", ref: null, read: 0, course: null, created_at: "2026-11-24" },
      { id: 2, kind: "errore", course_id: null, title: "Panopto: login necessario", body: "", ref: null, read: 0, course: null, created_at: "2026-11-23" },
      { id: 3, kind: "file", course_id: 7, title: "Nuovo file", body: "", ref: null, read: 1, course: "Analisi", created_at: "2026-11-22" },
    ])
    renderApp()
    expect(await screen.findByRole("button", { name: "Notifiche: 1 non lette" })).toBeDefined()
  })
})
