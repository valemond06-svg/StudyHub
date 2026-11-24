import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import React from "react"
import { FlashcardReviewModal } from "../FlashcardReviewModal"
import type { Flashcard } from "@/types"

// Mock api
vi.mock("@/lib/api", () => ({
  api: {
    reviewFlashcard: vi.fn().mockResolvedValue({ success: true }),
  },
}))

const mockCards: Flashcard[] = [
  {
    id: 101,
    lecture_id: 1,
    fronte: "Qual è la definizione di limite?",
    retro: "Per ogni $\\epsilon > 0$ esiste un $\\delta > 0$...",
    due_date: "2026-11-18",
    interval: 1,
    ease_factor: 2500,
    reps: 0,
  },
  {
    id: 102,
    lecture_id: 1,
    fronte: "Teorema di Weierstrass",
    retro: "Una funzione continua su un compatto ammette max e min assoluti.",
    due_date: "2026-11-18",
    interval: 2,
    ease_factor: 2500,
    reps: 1,
  },
]

describe("FlashcardReviewModal Component", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("does not render when isOpen is false", () => {
    const { container } = render(
      <FlashcardReviewModal isOpen={false} onClose={vi.fn()} cards={mockCards} />
    )
    expect(container.firstChild).toBeNull()
  })

  it("renders the first card front when open", () => {
    render(<FlashcardReviewModal isOpen={true} onClose={vi.fn()} cards={mockCards} />)

    expect(screen.getByText(/Qual è la definizione di limite\?/i)).toBeDefined()
    expect(screen.getByText(/Mostra risposta/i)).toBeDefined()
    expect(screen.getByText(/Ripasso FSRS a Flusso Continuo/i)).toBeDefined()
  })

  it("flips card when clicking 'Mostra risposta' and reveals rating buttons", () => {
    render(<FlashcardReviewModal isOpen={true} onClose={vi.fn()} cards={mockCards} />)

    const flipBtn = screen.getByText(/Mostra risposta/i)
    fireEvent.click(flipBtn)

    // Now rating buttons 1-4 are present
    expect(screen.getByText(/Di nuovo/i)).toBeDefined()
    expect(screen.getByText(/Difficile/i)).toBeDefined()
    expect(screen.getByText(/Bene/i)).toBeDefined()
    expect(screen.getByText(/Facile/i)).toBeDefined()
  })

  it("continuous flow FSRS: rating 1 moves card to the back of the queue", async () => {
    const { api } = await import("@/lib/api")
    render(<FlashcardReviewModal isOpen={true} onClose={vi.fn()} cards={mockCards} />)

    // Flip card
    fireEvent.click(screen.getByText(/Mostra risposta/i))

    // Press rating 1 (Di nuovo)
    const againBtn = screen.getByText(/Di nuovo/i)
    fireEvent.click(againBtn)

    expect(api.reviewFlashcard).toHaveBeenCalledWith(101, 1)

    // Second card should now be displayed
    expect(screen.getByText(/Teorema di Weierstrass/i)).toBeDefined()

    // Flip second card
    fireEvent.click(screen.getByText(/Mostra risposta/i))

    // Rate second card as Good (3)
    fireEvent.click(screen.getByText(/Bene/i))
    expect(api.reviewFlashcard).toHaveBeenCalledWith(102, 3)

    // Card 101 should reappear because it was re-queued!
    expect(screen.getByText(/Qual è la definizione di limite\?/i)).toBeDefined()
  })

  it("completes session and shows completion screen when all cards are rated >= 2", () => {
    render(<FlashcardReviewModal isOpen={true} onClose={vi.fn()} cards={[mockCards[0]]} />)

    // Flip
    fireEvent.click(screen.getByText(/Mostra risposta/i))

    // Rate Good (3)
    fireEvent.click(screen.getByText(/Bene/i))

    // Completion screen
    expect(screen.getByText(/Sessione completata!/i)).toBeDefined()
    expect(screen.getByText(/Chiudi sessione/i)).toBeDefined()
  })
})
