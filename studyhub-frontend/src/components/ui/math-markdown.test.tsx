import { describe, it, expect } from "vitest"
import { render } from "@testing-library/react"
import { MathMarkdown, MathInline } from "./math-markdown"
import { renderLatexToHtml } from "@/lib/latex"

describe("MathMarkdown (KaTeX dal pacchetto npm)", () => {
  it("renders text and markdown headings", () => {
    const { container } = render(<MathMarkdown content={"# Titolo Test\n\nTesto normale con **grassetto**"} />)
    expect(container.querySelector("h1")?.textContent).toContain("Titolo Test")
    expect(container.querySelector("strong")?.textContent).toContain("grassetto")
  })

  it("rende la formula inline $...$ con KaTeX", () => {
    const { container } = render(<MathMarkdown content={"Formula: $\\alpha + \\beta = \\gamma$"} />)
    const math = container.querySelector('[data-math="inline"] .katex')
    expect(math).not.toBeNull()
    // KaTeX conserva la sorgente TeX nell'annotazione MathML
    expect(container.querySelector("annotation")?.textContent).toBe("\\alpha + \\beta = \\gamma")
  })

  it("rende la formula in display $$...$$ (frazioni)", () => {
    const { container } = render(<MathMarkdown content={"$$\\frac{a}{b} = c$$"} />)
    expect(container.querySelector('[data-math="display"] .katex-display')).not.toBeNull()
    expect(container.querySelector(".mfrac")).not.toBeNull()
  })

  it("rende matrici e sistemi su più righe", () => {
    const content = [
      "Matrice:",
      "",
      "$$",
      "A = \\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}",
      "$$",
      "",
      "\\begin{cases}",
      "x + y = 1 \\\\",
      "x - y = 0",
      "\\end{cases}",
    ].join("\n")
    const { container } = render(<MathMarkdown content={content} />)
    const displays = container.querySelectorAll('[data-math="display"]')
    expect(displays.length).toBe(2)
    expect(container.querySelector(".mtable")).not.toBeNull()
    const sources = Array.from(container.querySelectorAll("annotation")).map((a) => a.textContent)
    expect(sources.some((s) => s?.includes("\\begin{cases}"))).toBe(true)
  })

  it("formule con insiemi e sopralineato del report d'audit", () => {
    const { container } = render(<MathMarkdown content={"Sia $z \\in \\mathbb{C} \\setminus \\{0\\}$ con $\\bar{z} = z^{-1}$ e $\\det A = 0$."} />)
    expect(container.querySelectorAll('[data-math="inline"] .katex').length).toBe(3)
    // nessuna sorgente TeX lasciata in chiaro nel testo visibile
    const visible = Array.from(container.querySelectorAll(".katex-html")).map((n) => n.textContent).join(" ")
    expect(visible).not.toContain("\\setminus")
  })

  it("se KaTeX non capisce la formula usa il ripiego tipografico", () => {
    expect(renderLatexToHtml("\\frac{a}{", false)).toBeNull()
    const { container } = render(<MathMarkdown content={"Rotta: $\\frac{a}{$"} />)
    expect(container.querySelector(".katex")).toBeNull()
  })

  it("MathInline rende formule in una riga senza blocchi", () => {
    const { container } = render(<MathInline content={"$\\det A \\neq 0$ e **vero**"} />)
    expect(container.querySelector("p")).toBeNull()
    expect(container.querySelector(".katex")).not.toBeNull()
    expect(container.querySelector("strong")?.textContent).toBe("vero")
  })
})
