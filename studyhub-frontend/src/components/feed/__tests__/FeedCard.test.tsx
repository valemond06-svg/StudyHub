import { describe, it, expect } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { FeedCard } from "../FeedCard"
import type { FeedShort } from "@/types"

const mockShort: FeedShort = {
  id: "short_1",
  topic_id: 101,
  course_id: 2,
  course_name: "Controlli Automatici",
  title: "Stabilità di Routh-Hurwitz",
  hook_md: "Il criterio di Routh determina se tutte le radici hanno parte reale negativa: $$\\text{Re}(s) < 0$$.",
  widget: null,
  slide: { doc_id: 12, page: 5 },
  audio: {
    lecture_id: 42,
    start_s: 120,
    lecture_title: "Lezione 5 - Criteri di stabilità",
  },
  exam_trick: "Attenzione alle righe di zeri nella tabella di Routh: richiedono la derivata del polinomio ausiliario!",
  archetipo_nome: "Calcolo Stabilità",
  has_pcp: true,
  has_sniper: false,
}

describe("FeedCard Component", () => {
  it("renders course badge, title, archetype and key point with math markdown", () => {
    render(
      <MemoryRouter>
        <FeedCard short={mockShort} index={0} total={10} isActive={true} />
      </MemoryRouter>
    )

    expect(screen.getByText("Controlli Automatici")).toBeDefined()
    expect(screen.getByText("Stabilità di Routh-Hurwitz")).toBeDefined()
    expect(screen.getByText("Calcolo Stabilità")).toBeDefined()
    expect(screen.getByText("p. 5")).toBeDefined()
    expect(screen.getByText("1 / 10")).toBeDefined()
    expect(screen.getByText("Punto Chiave")).toBeDefined()
  })

  it("renders audio player and controls", () => {
    render(
      <MemoryRouter>
        <FeedCard short={mockShort} index={0} total={10} isActive={true} />
      </MemoryRouter>
    )

    expect(screen.getByText(/Clip del Docente \(25s\)/)).toBeDefined()
    expect(screen.getByText("Lezione 5 - Criteri di stabilità")).toBeDefined()
    expect(screen.getByLabelText("Riproduci clip audio docente")).toBeDefined()
  })

  it("toggles tranello d'esame (exam trick) on click", () => {
    render(
      <MemoryRouter>
        <FeedCard short={mockShort} index={0} total={10} isActive={true} />
      </MemoryRouter>
    )

    const trickButton = screen.getByText("Svela Tranello d'Esame")
    expect(trickButton).toBeDefined()

    // Initially not visible
    expect(screen.queryByText("Tranello del Docente & Errori Tipici")).toBeNull()

    // Click to reveal
    fireEvent.click(trickButton)
    expect(screen.getByText("Tranello del Docente & Errori Tipici")).toBeDefined()
    expect(screen.getByText(/polinomio ausiliario/)).toBeDefined()
    expect(screen.getByText("Nascondi Tranello d'Esame")).toBeDefined()

    // Click to hide again
    fireEvent.click(screen.getByText("Nascondi Tranello d'Esame"))
    expect(screen.queryByText("Tranello del Docente & Errori Tipici")).toBeNull()
  })

  it("renders 'Studia argomento completo' button", () => {
    render(
      <MemoryRouter>
        <FeedCard short={mockShort} index={0} total={10} isActive={true} />
      </MemoryRouter>
    )

    const studyButton = screen.getByText("Studia argomento completo")
    expect(studyButton).toBeDefined()
  })
})
