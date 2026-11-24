import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import React from "react"
import { PomodoroTimer } from "../PomodoroTimer"

describe("PomodoroTimer Component", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("renders default 25:00 studio session", () => {
    render(<PomodoroTimer />)

    expect(screen.getByText("25:00")).toBeDefined()
    expect(screen.getByText(/Sessione Studio/i)).toBeDefined()
    expect(screen.getByText(/Avvia/i)).toBeDefined()
  })

  it("toggles play and pause state", () => {
    render(<PomodoroTimer />)

    const startBtn = screen.getByText(/Avvia/i)
    fireEvent.click(startBtn)

    expect(screen.getByText(/Pausa/i)).toBeDefined()

    const pauseBtn = screen.getByText(/Pausa/i)
    fireEvent.click(pauseBtn)

    expect(screen.getByText(/Avvia/i)).toBeDefined()
  })

  it("switches to break mode when skip button is clicked", () => {
    render(<PomodoroTimer />)

    const skipBtn = screen.getByTitle(/Passa alla pausa/i)
    fireEvent.click(skipBtn)

    expect(screen.getByText("05:00")).toBeDefined()
    expect(screen.getByText(/Pausa Relax/i)).toBeDefined()
  })

  it("renders compact mode correctly", () => {
    render(<PomodoroTimer compact={true} />)

    expect(screen.getByText("25:00")).toBeDefined()
    expect(screen.getByText("Studio")).toBeDefined()
  })
})
