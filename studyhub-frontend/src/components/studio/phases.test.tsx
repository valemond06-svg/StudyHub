import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { BrowserRouter } from "react-router-dom"
import {
  WarmupPhase,
  PracticePhase,
  BossPhase,
  CompletePhase,
  StatCard,
  type SessionEntry,
} from "./phases"

describe("Studio Phases Components", () => {
  it("renders StatCard with value and label", () => {
    render(<StatCard label="XP Totali" value="150" subtext="+25 oggi" />)
    expect(screen.getByText("XP Totali")).toBeDefined()
    expect(screen.getByText("150")).toBeDefined()
    expect(screen.getByText("+25 oggi")).toBeDefined()
  })

  it("renders WarmupPhase and handles choice selection", () => {
    const onAnswer = vi.fn()
    const onNext = vi.fn()
    const onSetShowAnswer = vi.fn()
    const onSetConfidence = vi.fn()

    const mockEntries: SessionEntry[] = [
      {
        id: 1,
        t: "domanda",
        question: {
          prompt: "Quanto vale $2 + 2$?",
          choices: ["3", "4", "5"],
          answer: 1,
          kind: "multipla",
        },
      },
    ]

    render(
      <WarmupPhase
        entries={mockEntries}
        currentIndex={0}
        showAnswer={false}
        confidence={3}
        onAnswer={onAnswer}
        onNext={onNext}
        onSetShowAnswer={onSetShowAnswer}
        onSetConfidence={onSetConfidence}
      />
    )

    expect(screen.getByText(/Quanto vale/)).toBeDefined()
    expect(screen.getByText("A")).toBeDefined()
    expect(screen.getByText("B")).toBeDefined()

    // Click on option B ("4")
    const optionB = screen.getByText("B").closest("button")
    expect(optionB).toBeDefined()
    fireEvent.click(optionB!)

    // Click confirm answer
    const confirmBtn = screen.getByText("Conferma risposta")
    fireEvent.click(confirmBtn)

    expect(onAnswer).toHaveBeenCalledWith(true, 3, { choice: 1, text: undefined })
  })

  it("renders camera button 'Svolgi a mano sul quaderno e allega foto' and toggles photo upload", () => {
    const onAnswer = vi.fn()
    const onNext = vi.fn()
    const onSetShowAnswer = vi.fn()
    const onSetConfidence = vi.fn()
    const onPhotoUpload = vi.fn()

    const mockEntries: SessionEntry[] = [
      {
        id: 42,
        t: "domanda",
        question: {
          prompt: "Dimostra il teorema di Pitagora",
          kind: "aperta",
        },
      },
    ]

    render(
      <WarmupPhase
        entries={mockEntries}
        currentIndex={0}
        showAnswer={false}
        confidence={4}
        onAnswer={onAnswer}
        onNext={onNext}
        onSetShowAnswer={onSetShowAnswer}
        onSetConfidence={onSetConfidence}
        onPhotoUpload={onPhotoUpload}
      />
    )

    const cameraBtn = screen.getByText("Svolgi a mano sul quaderno e allega foto")
    expect(cameraBtn).toBeDefined()

    // Click camera button to toggle PhotoUpload section
    fireEvent.click(cameraBtn)

    expect(screen.getByText("Foto svolgimento quaderno")).toBeDefined()
    expect(screen.getByText("Carica foto")).toBeDefined()
  })

  it("renders BossPhase and displays photo feedback when photo upload is used", () => {
    const onAnswer = vi.fn()
    const onSetShowAnswer = vi.fn()

    const bossEntry: SessionEntry = {
      id: 99,
      t: "domanda",
      boss: true,
      question: {
        prompt: "Calcola l'integrale definito di $\\int_0^1 x e^x dx$",
        kind: "aperta",
      },
    }

    render(
      <BossPhase
        entry={bossEntry}
        showAnswer={false}
        onAnswer={onAnswer}
        onSetShowAnswer={onSetShowAnswer}
      />
    )

    expect(screen.getByText("Boss Finale · Livello Esame")).toBeDefined()
    const cameraBtn = screen.getByText("Svolgi a mano sul quaderno e allega foto")
    expect(cameraBtn).toBeDefined()

    fireEvent.click(cameraBtn)
    expect(screen.getByText("Foto svolgimento dimostrazione / quaderno")).toBeDefined()
  })

  it("renders CompletePhase with metrics and XP", () => {
    render(
      <BrowserRouter>
        <CompletePhase
          xpEarned={120}
          streak={5}
          questionsAnswered={10}
          correctAnswers={9}
          courseId="1"
          duration={45}
        />
      </BrowserRouter>
    )

    expect(screen.getByText("Sessione Completata!")).toBeDefined()
    expect(screen.getByText("+120 XP Aggiunti al tuo profilo")).toBeDefined()
    expect(screen.getByText("90%")).toBeDefined() // 9/10 accuracy
  })
})
