import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { Linear2DEngine } from "../Linear2DEngine"
import { PoleZeroEngine } from "../PoleZeroEngine"
import { VectorFieldEngine } from "../VectorFieldEngine"
import { CircuitSimEngine } from "../CircuitSimEngine"
import { InteractiveEngine } from "../InteractiveEngine"

describe("StudyHub Interactive Engines", () => {
  beforeEach(() => {
    // Mock HTMLCanvasElement getContext for jsdom
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      fill: vi.fn(),
      arc: vi.fn(),
      closePath: vi.fn(),
      setLineDash: vi.fn(),
      fillText: vi.fn(),
      scale: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
    })) as any

    HTMLCanvasElement.prototype.getBoundingClientRect = vi.fn(() => ({
      width: 480,
      height: 320,
      top: 0,
      left: 0,
      bottom: 320,
      right: 480,
      x: 0,
      y: 0,
      toJSON: () => {},
    }))

    window.requestAnimationFrame = vi.fn((_cb) => {
      return 1 as any
    })
    window.cancelAnimationFrame = vi.fn()
  })

  describe("Linear2DEngine (Algebra Lineare)", () => {
    it("renders default matrix and determinant", () => {
      render(<Linear2DEngine config={{ a: 1.5, b: 0.5, c: 0.0, d: 1.2 }} />)
      // det = 1.5 * 1.2 - 0.5 * 0 = 1.80
      expect(screen.getByText("Matrice di Trasformazione A")).toBeDefined()
      expect(screen.getByText("1.80")).toBeDefined()
      expect(screen.getByText(/Orientamento Preservato/i)).toBeDefined()
    })

    it("detects dimensional collapse (singular matrix det=0)", () => {
      render(<Linear2DEngine config={{ a: 1.0, b: 2.0, c: 0.5, d: 1.0 }} />)
      // det = 1.0 * 1.0 - 2.0 * 0.5 = 0.00
      expect(screen.getByText("0.00")).toBeDefined()
      expect(screen.getByText(/Collasso Dimensionale/i)).toBeDefined()
    })

    it("applies presets correctly", () => {
      render(<Linear2DEngine />)
      const singularBtn = screen.getByText("Singolare (det=0)")
      fireEvent.click(singularBtn)
      expect(screen.getByText(/Collasso Dimensionale/i)).toBeDefined()

      const rotBtn = screen.getByText("Rotazione 45°")
      fireEvent.click(rotBtn)
      expect(screen.queryByText(/Collasso Dimensionale/i)).toBeNull()
    })
  })

  describe("PoleZeroEngine (Controlli & Robotica)", () => {
    it("renders stable LHP system correctly", () => {
      render(<PoleZeroEngine config={{ sigma: 1.0, omega: 2.0 }} />)
      expect(screen.getByText(/SISTEMA STABILE/i)).toBeDefined()
      expect(screen.getByText(/Piano Complesso s/i)).toBeDefined()
      expect(screen.getByText(/Risposta al Gradino Unitario/i)).toBeDefined()
    })

    it("renders unstable RHP system warning", () => {
      render(<PoleZeroEngine config={{ sigma: -0.6, omega: 2.0 }} />)
      expect(screen.getByText(/SISTEMA INSTABILE/i)).toBeDefined()
    })

    it("renders oscillator when sigma is zero", () => {
      render(<PoleZeroEngine config={{ sigma: 0.0, omega: 3.0 }} />)
      expect(screen.getByText(/SEMPLICEMENTE STABILE/i)).toBeDefined()
    })
  })

  describe("VectorFieldEngine (Analisi 2 & Fisica)", () => {
    it("renders with default vortex mode and switches modes", () => {
      render(<VectorFieldEngine config={{ mode: "vortex" }} />)
      expect(screen.getByText(/Vortice \/ Rotore/i)).toBeDefined()

      const sourceBtn = screen.getByText("Sorgente")
      fireEvent.click(sourceBtn)
      expect(screen.getByText(/Sorgente \(Divergenza Positiva/i)).toBeDefined()
    })

    it("handles speed and density controls", () => {
      render(<VectorFieldEngine />)
      expect(screen.getByText("Intensità Campo")).toBeDefined()
      expect(screen.getByText("Velocità Flusso")).toBeDefined()
      expect(screen.getByText("Densità Particelle")).toBeDefined()
    })
  })

  describe("CircuitSimEngine (Elettronica)", () => {
    it("calculates inverting gain and linear output", () => {
      // R1 = 10k, R2 = 50k, Vin = 1.0V -> Av = -5, Vout = -5.0V (|Vout| < 12V -> linear)
      render(<CircuitSimEngine config={{ r1: 10, r2: 50, vin: 1.0, vsat: 12 }} />)
      expect(screen.getByText(/REGIONE LINEARE/i)).toBeDefined()
      expect(screen.getByText(/-5.00 V/i)).toBeDefined()
      expect(screen.getByText(/-5.00x \(Inverte 180°\)/i)).toBeDefined()
    })

    it("detects rail saturation and clips output", () => {
      // R1 = 10k, R2 = 200k, Vin = 1.5V -> Av = -20, Ideal Vout = -30V -> Saturated at -12V
      render(<CircuitSimEngine config={{ r1: 10, r2: 200, vin: 1.5, vsat: 12 }} />)
      expect(screen.getByText(/SATURAZIONE RAILS ALIMENTAZIONE/i)).toBeDefined()
      expect(screen.getByText(/-12.00 V/i)).toBeDefined()
    })
  })

  describe("InteractiveEngine Wrapper", () => {
    it("renders wrapped engine with apple-minimal card layout", () => {
      render(<InteractiveEngine type="linear_2d" title="Test Engine" />)
      expect(screen.getByText("Test Engine")).toBeDefined()
      expect(screen.getByText("Algebra Lineare")).toBeDefined()
      expect(screen.getByText("Nascondi Slider")).toBeDefined()
    })

    it("toggles sliders visibility when button is clicked", () => {
      render(<InteractiveEngine type="linear_2d" />)
      const toggleBtn = screen.getByText("Nascondi Slider")
      fireEvent.click(toggleBtn)
      expect(screen.getByText("Mostra Slider")).toBeDefined()
    })
  })
})
