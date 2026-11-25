import katex from "katex"

/**
 * LaTeX → HTML con KaTeX (pacchetto npm; CSS e font sono importati da math-markdown.tsx e finiscono nel bundle).
 * Restituisce null solo se KaTeX non riesce a interpretare la formula: allora si usa il ripiego tipografico.
 */
export function renderLatexToHtml(latex: string, displayMode: boolean): string | null {
  try {
    return katex.renderToString(latex, {
      displayMode,
      throwOnError: true,
      strict: "ignore",
      trust: false,
    })
  } catch {
    return null
  }
}
