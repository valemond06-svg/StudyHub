import { describe, it, expect } from "vitest"
import { render } from "@testing-library/react"
import { MathMarkdown } from "./math-markdown"

describe("MathMarkdown", () => {
  it("renders text and markdown headings", () => {
    const { container } = render(<MathMarkdown content="# Titolo Test\n\nTesto normale con **grassetto**" />)
    expect(container.querySelector("h1")?.textContent).toContain("Titolo Test")
    expect(container.querySelector("strong")?.textContent).toContain("grassetto")
  })

  it("formats inline math fallback gracefully", () => {
    const { container } = render(<MathMarkdown content="Formula: $\\alpha + \\beta = \\gamma$" />)
    expect(container.textContent).toContain("α + β = γ")
  })

  it("formats block math $$ fallback gracefully", () => {
    const { container } = render(<MathMarkdown content="$$\\frac{a}{b} = c$$" />)
    expect(container.textContent).toContain("(a) / (b) = c")
  })
})
