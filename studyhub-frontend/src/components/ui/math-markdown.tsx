import React, { useMemo } from "react"
import { cn } from "@/lib/utils"

declare global {
  interface Window {
    katex?: {
      renderToString: (
        tex: string,
        options?: { displayMode?: boolean; throwOnError?: boolean }
      ) => string
    }
  }
}

export interface MathMarkdownProps {
  content: string
  className?: string
}

/**
 * Replaces common LaTeX notation with clean Unicode equivalents for fallback display
 */
function formatMathFallback(latex: string): string {
  let s = latex.trim()

  // Normalize multiple consecutive backslashes before command names (e.g. \\alpha -> \alpha)
  s = s.replace(/\\{2,}([a-zA-Z]+)/g, "\\$1")

  // Remove common wrapper commands
  s = s.replace(/\\+text\{([^}]+)\}/g, "$1")
  s = s.replace(/\\+mathrm\{([^}]+)\}/g, "$1")
  s = s.replace(/\\+mathbf\{([^}]+)\}/g, "$1")
  s = s.replace(/\\+mathit\{([^}]+)\}/g, "$1")

  // Number sets
  s = s.replace(/\\+mathbb\{R\}/g, "ℝ")
  s = s.replace(/\\+mathbb\{N\}/g, "ℕ")
  s = s.replace(/\\+mathbb\{Z\}/g, "ℤ")
  s = s.replace(/\\+mathbb\{Q\}/g, "ℚ")
  s = s.replace(/\\+mathbb\{C\}/g, "ℂ")

  // Fractions: \frac{a}{b} -> (a)/(b)
  s = s.replace(/\\+frac\{([^}]+)\}\{([^}]+)\}/g, "($1) / ($2)")
  s = s.replace(/\\+dfrac\{([^}]+)\}\{([^}]+)\}/g, "($1) / ($2)")

  // Square roots: \sqrt{x} -> √(x)
  s = s.replace(/\\+sqrt\[(\d+)\]\{([^}]+)\}/g, "$1√($2)")
  s = s.replace(/\\+sqrt\{([^}]+)\}/g, "√($1)")

  // Mathematical operators & relations
  s = s.replace(/\\+times\b/g, "×")
  s = s.replace(/\\+cdot\b/g, "·")
  s = s.replace(/\\+div\b/g, "÷")
  s = s.replace(/\\+pm\b/g, "±")
  s = s.replace(/\\+mp\b/g, "∓")
  s = s.replace(/\\+leq?\b/g, "≤")
  s = s.replace(/\\+geq?\b/g, "≥")
  s = s.replace(/\\+neq\b/g, "≠")
  s = s.replace(/\\+approx\b/g, "≈")
  s = s.replace(/\\+equiv\b/g, "≡")
  s = s.replace(/\\+sim\b/g, "∼")
  s = s.replace(/\\+propto\b/g, "∝")
  s = s.replace(/\\+infty\b/g, "∞")
  s = s.replace(/\\+partial\b/g, "∂")
  s = s.replace(/\\+nabla\b/g, "∇")

  // Greek letters
  s = s.replace(/\\+alpha\b/g, "α")
  s = s.replace(/\\+beta\b/g, "β")
  s = s.replace(/\\+gamma\b/g, "γ")
  s = s.replace(/\\+Gamma\b/g, "Γ")
  s = s.replace(/\\+delta\b/g, "δ")
  s = s.replace(/\\+Delta\b/g, "Δ")
  s = s.replace(/\\+(?:epsilon|varepsilon)\b/g, "ε")
  s = s.replace(/\\+zeta\b/g, "ζ")
  s = s.replace(/\\+eta\b/g, "η")
  s = s.replace(/\\+theta\b/g, "θ")
  s = s.replace(/\\+Theta\b/g, "Θ")
  s = s.replace(/\\+iota\b/g, "ι")
  s = s.replace(/\\+kappa\b/g, "κ")
  s = s.replace(/\\+lambda\b/g, "λ")
  s = s.replace(/\\+Lambda\b/g, "Λ")
  s = s.replace(/\\+mu\b/g, "μ")
  s = s.replace(/\\+nu\b/g, "ν")
  s = s.replace(/\\+xi\b/g, "ξ")
  s = s.replace(/\\+pi\b/g, "π")
  s = s.replace(/\\+Pi\b/g, "Π")
  s = s.replace(/\\+rho\b/g, "ρ")
  s = s.replace(/\\+sigma\b/g, "σ")
  s = s.replace(/\\+Sigma\b/g, "Σ")
  s = s.replace(/\\+tau\b/g, "τ")
  s = s.replace(/\\+upsilon\b/g, "υ")
  s = s.replace(/\\+(?:phi|varphi)\b/g, "φ")
  s = s.replace(/\\+Phi\b/g, "Φ")
  s = s.replace(/\\+chi\b/g, "χ")
  s = s.replace(/\\+psi\b/g, "ψ")
  s = s.replace(/\\+omega\b/g, "ω")
  s = s.replace(/\\+Omega\b/g, "Ω")

  // Big operators
  s = s.replace(/\\+sum\b/g, "∑")
  s = s.replace(/\\+prod\b/g, "∏")
  s = s.replace(/\\+int\b/g, "∫")
  s = s.replace(/\\+oint\b/g, "∮")
  s = s.replace(/\\+iint\b/g, "∬")

  // Logic & set theory
  s = s.replace(/\\+forall\b/g, "∀")
  s = s.replace(/\\+exists\b/g, "∃")
  s = s.replace(/\\+in\b/g, "∈")
  s = s.replace(/\\+notin\b/g, "∉")
  s = s.replace(/\\+subset\b/g, "⊂")
  s = s.replace(/\\+subseteq\b/g, "⊆")
  s = s.replace(/\\+cup\b/g, "∪")
  s = s.replace(/\\+cap\b/g, "∩")
  s = s.replace(/\\+land\b/g, "∧")
  s = s.replace(/\\+lor\b/g, "∨")
  s = s.replace(/\\+neg\b/g, "¬")
  s = s.replace(/\\+emptyset\b/g, "∅")

  // Arrows
  s = s.replace(/\\+(?:rightarrow|to)\b/g, "→")
  s = s.replace(/\\+leftarrow\b/g, "←")
  s = s.replace(/\\+leftrightarrow\b/g, "↔")
  s = s.replace(/\\+(?:Rightarrow|implies)\b/g, "⇒")
  s = s.replace(/\\+Leftarrow\b/g, "⇐")
  s = s.replace(/\\+iff\b/g, "⇔")

  // Spacing and misc
  s = s.replace(/\\+quad\b/g, "   ")
  s = s.replace(/\\+qquad\b/g, "      ")
  s = s.replace(/\\+,/g, " ")
  s = s.replace(/\\+[;:]/g, " ")
  s = s.replace(/\\+circ\b/g, "°")
  s = s.replace(/\\+(?:dots|ldots|cdots)\b/g, "…")

  return s
}

/**
 * Renders LaTeX formula using KaTeX if available, otherwise stylish fallback
 */
function renderFormula(latex: string, displayMode: boolean, key: string | number): React.ReactNode {
  const hasKatex = typeof window !== "undefined" && typeof window.katex?.renderToString === "function"

  if (hasKatex) {
    try {
      const html = window.katex!.renderToString(latex, {
        displayMode,
        throwOnError: false,
      })
      if (displayMode) {
        return (
          <span
            key={key}
            className="block my-3 py-2 px-3 overflow-x-auto text-center rounded-xl bg-neutral-50/70 dark:bg-neutral-900/60 border border-neutral-200/80 dark:border-neutral-800 select-text"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )
      }
      return (
        <span
          key={key}
          className="inline-block px-1 align-baseline select-text"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )
    } catch {
      // Ignore KaTeX error and fall back to typography renderer
    }
  }

  // Fallback typography
  const formatted = formatMathFallback(latex)
  if (displayMode) {
    return (
      <span
        key={key}
        className="block my-3 py-2.5 px-4 overflow-x-auto text-center rounded-xl bg-neutral-100/70 dark:bg-neutral-800/50 border border-neutral-200 dark:border-neutral-800/80 font-serif text-base sm:text-lg tracking-wide text-neutral-900 dark:text-neutral-100 shadow-2xs select-text"
      >
        {formatted}
      </span>
    )
  }

  return (
    <span
      key={key}
      className="font-serif italic font-medium px-1.5 py-0.5 mx-0.5 rounded bg-neutral-100/90 dark:bg-neutral-800/80 text-neutral-900 dark:text-neutral-100 text-[0.95em] border border-neutral-200/60 dark:border-neutral-700/50 inline-block align-baseline select-text"
    >
      {formatted}
    </span>
  )
}

/**
 * Parses inline string containing bold, italic, code, links, and inline math
 */
function parseInline(text: string, baseKey: string | number): React.ReactNode[] {
  const nodes: React.ReactNode[] = []

  // Token pattern matching:
  // 1. Math block inside line: $$...$$ or \[...\]
  // 2. Math inline: $...$ or \(...\)
  // 3. Inline code: `...`
  // 4. Bold: **...** or __...__
  // 5. Italic: *...* or _..._
  // 6. Link: [text](url)
  // 7. Strikethrough: ~~...~~
  const regex = /(\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\$(?!\s)(?:\\.|[^\$\\])+?(?<!\s)\$|\\\([\s\S]*?\\\)|\`[^\`\n]+\`|\*\*[^*]+?\*\*|__[^_]+?__|\*[^*]+?\*|_[^_]+?_|\[([^\]]+)\]\(([^)]+)\)|~~[^~]+?~~)/g

  let lastIndex = 0
  let match: RegExpExecArray | null
  let count = 0

  while ((match = regex.exec(text)) !== null) {
    // Add preceding text
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index))
    }

    const token = match[0]
    const key = `${baseKey}-inline-${count++}`

    if (token.startsWith("$$") && token.endsWith("$$")) {
      const latex = token.slice(2, -2).trim()
      nodes.push(renderFormula(latex, true, key))
    } else if (token.startsWith("\\[") && token.endsWith("\\]")) {
      const latex = token.slice(2, -2).trim()
      nodes.push(renderFormula(latex, true, key))
    } else if (token.startsWith("$") && token.endsWith("$")) {
      const latex = token.slice(1, -1).trim()
      nodes.push(renderFormula(latex, false, key))
    } else if (token.startsWith("\\(") && token.endsWith("\\)")) {
      const latex = token.slice(2, -2).trim()
      nodes.push(renderFormula(latex, false, key))
    } else if (token.startsWith("`") && token.endsWith("`")) {
      nodes.push(
        <code
          key={key}
          className="font-mono text-xs px-1.5 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-accent-600 dark:text-accent-400 border border-neutral-200/80 dark:border-neutral-700/60"
        >
          {token.slice(1, -1)}
        </code>
      )
    } else if ((token.startsWith("**") && token.endsWith("**")) || (token.startsWith("__") && token.endsWith("__"))) {
      nodes.push(
        <strong key={key} className="font-semibold text-neutral-900 dark:text-neutral-50">
          {token.slice(2, -2)}
        </strong>
      )
    } else if ((token.startsWith("*") && token.endsWith("*")) || (token.startsWith("_") && token.endsWith("_"))) {
      nodes.push(
        <em key={key} className="italic text-neutral-800 dark:text-neutral-200">
          {token.slice(1, -1)}
        </em>
      )
    } else if (token.startsWith("~~") && token.endsWith("~~")) {
      nodes.push(
        <del key={key} className="line-through text-neutral-400 dark:text-neutral-500">
          {token.slice(2, -2)}
        </del>
      )
    } else if (token.startsWith("[") && token.includes("](") && token.endsWith(")")) {
      const linkMatch = token.match(/\[([^\]]+)\]\(([^)]+)\)/)
      if (linkMatch) {
        nodes.push(
          <a
            key={key}
            href={linkMatch[2]}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent-600 dark:text-accent-400 underline underline-offset-4 hover:text-accent-700 dark:hover:text-accent-300"
          >
            {linkMatch[1]}
          </a>
        )
      } else {
        nodes.push(token)
      }
    } else {
      nodes.push(token)
    }

    lastIndex = regex.lastIndex
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex))
  }

  return nodes
}

export function MathMarkdown({ content, className }: MathMarkdownProps) {
  const renderedContent = useMemo(() => {
    if (!content) return null

    // Normalize newlines
    const raw = content.replace(/\r\n/g, "\n")
    const blocks: React.ReactNode[] = []

    // Split raw text into blocks: Code blocks, Block math, Tables, Lists, Headings, Paragraphs
    const lines = raw.split("\n")
    let i = 0
    let blockIndex = 0

    while (i < lines.length) {
      const line = lines[i]

      // Empty line
      if (line.trim() === "") {
        i++
        continue
      }

      // Display math $$ ... $$ on multiple lines or single line
      if (line.trim().startsWith("$$") || line.trim().startsWith("\\[")) {
        const isBracket = line.trim().startsWith("\\[")
        const endMarker = isBracket ? "\\]" : "$$"
        let mathContent = line.trim().startsWith("$$")
          ? line.trim().slice(2)
          : line.trim().slice(2)

        if (mathContent.endsWith(endMarker)) {
          mathContent = mathContent.slice(0, -endMarker.length)
          blocks.push(renderFormula(mathContent.trim(), true, `block-math-${blockIndex++}`))
          i++
          continue
        }

        // Multi-line math
        const mathLines = [mathContent]
        i++
        while (i < lines.length && !lines[i].includes(endMarker)) {
          mathLines.push(lines[i])
          i++
        }
        if (i < lines.length) {
          const lastLine = lines[i]
          const endIdx = lastLine.indexOf(endMarker)
          mathLines.push(lastLine.slice(0, endIdx))
          i++
        }
        blocks.push(renderFormula(mathLines.join("\n").trim(), true, `block-math-${blockIndex++}`))
        continue
      }

      // Code blocks ```lang
      if (line.trim().startsWith("```")) {
        const lang = line.trim().slice(3).trim()
        const codeLines: string[] = []
        i++
        while (i < lines.length && !lines[i].trim().startsWith("```")) {
          codeLines.push(lines[i])
          i++
        }
        if (i < lines.length && lines[i].trim().startsWith("```")) {
          i++
        }
        blocks.push(
          <div
            key={`code-${blockIndex++}`}
            className="my-3 rounded-xl overflow-hidden border border-neutral-200 dark:border-neutral-800 bg-neutral-900 text-neutral-100 text-xs sm:text-sm font-mono shadow-sm"
          >
            {lang && (
              <div className="px-3 py-1.5 bg-neutral-800/80 border-b border-neutral-700/60 text-neutral-400 text-2xs tracking-wider uppercase">
                {lang}
              </div>
            )}
            <pre className="p-3 overflow-x-auto leading-relaxed">
              <code>{codeLines.join("\n")}</code>
            </pre>
          </div>
        )
        continue
      }

      // Headings
      const headingMatch = line.match(/^(#{1,6})\s+(.*)$/)
      if (headingMatch) {
        const level = headingMatch[1].length
        const headingText = headingMatch[2]
        const key = `h-${blockIndex++}`
        const inlineNodes = parseInline(headingText, key)

        if (level === 1) {
          blocks.push(
            <h1 key={key} className="text-xl sm:text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50 mt-4 mb-2">
              {inlineNodes}
            </h1>
          )
        } else if (level === 2) {
          blocks.push(
            <h2 key={key} className="text-lg sm:text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-50 mt-3 mb-1.5">
              {inlineNodes}
            </h2>
          )
        } else if (level === 3) {
          blocks.push(
            <h3 key={key} className="text-base sm:text-lg font-semibold text-neutral-900 dark:text-neutral-50 mt-2.5 mb-1">
              {inlineNodes}
            </h3>
          )
        } else {
          blocks.push(
            <h4 key={key} className="text-sm sm:text-base font-medium text-neutral-900 dark:text-neutral-100 mt-2 mb-1">
              {inlineNodes}
            </h4>
          )
        }
        i++
        continue
      }

      // Blockquotes
      if (line.trim().startsWith(">")) {
        const quoteLines: string[] = []
        while (i < lines.length && lines[i].trim().startsWith(">")) {
          quoteLines.push(lines[i].replace(/^>\s?/, ""))
          i++
        }
        blocks.push(
          <blockquote
            key={`quote-${blockIndex++}`}
            className="my-2.5 border-l-3 border-accent-500 pl-3.5 py-1 text-neutral-700 dark:text-neutral-300 italic text-sm"
          >
            {quoteLines.map((ql, qIdx) => (
              <p key={qIdx} className="my-0.5">
                {parseInline(ql, `quote-${qIdx}`)}
              </p>
            ))}
          </blockquote>
        )
        continue
      }

      // Horizontal rules
      if (line.trim() === "---" || line.trim() === "***" || line.trim() === "___") {
        blocks.push(<hr key={`hr-${blockIndex++}`} className="my-4 border-neutral-200 dark:border-neutral-800" />)
        i++
        continue
      }

      // Unordered lists (- or * followed by space)
      if (/^\s*[-*]\s+/.test(line)) {
        const items: string[] = []
        while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*[-*]\s+/, ""))
          i++
        }
        blocks.push(
          <ul key={`ul-${blockIndex++}`} className="my-2 space-y-1 pl-5 list-disc text-neutral-900 dark:text-neutral-100 text-sm sm:text-base">
            {items.map((item, itemIdx) => (
              <li key={itemIdx} className="leading-relaxed">
                {parseInline(item, `li-${itemIdx}`)}
              </li>
            ))}
          </ul>
        )
        continue
      }

      // Ordered lists (1. followed by space)
      if (/^\s*\d+\.\s+/.test(line)) {
        const items: string[] = []
        while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*\d+\.\s+/, ""))
          i++
        }
        blocks.push(
          <ol key={`ol-${blockIndex++}`} className="my-2 space-y-1 pl-5 list-decimal text-neutral-900 dark:text-neutral-100 text-sm sm:text-base">
            {items.map((item, itemIdx) => (
              <li key={itemIdx} className="leading-relaxed">
                {parseInline(item, `oli-${itemIdx}`)}
              </li>
            ))}
          </ol>
        )
        continue
      }

      // Normal paragraph (collect lines until empty or special block)
      const paraLines: string[] = [line]
      i++
      while (
        i < lines.length &&
        lines[i].trim() !== "" &&
        !lines[i].trim().startsWith("$$") &&
        !lines[i].trim().startsWith("\\[") &&
        !lines[i].trim().startsWith("```") &&
        !lines[i].trim().startsWith("#") &&
        !lines[i].trim().startsWith(">") &&
        !/^\s*[-*]\s+/.test(lines[i]) &&
        !/^\s*\d+\.\s+/.test(lines[i]) &&
        lines[i].trim() !== "---"
      ) {
        paraLines.push(lines[i])
        i++
      }

      const pKey = `p-${blockIndex++}`
      blocks.push(
        <p key={pKey} className="my-1.5 leading-relaxed text-neutral-900 dark:text-neutral-100 text-sm sm:text-base">
          {paraLines.map((pLine, lIdx) => (
            <React.Fragment key={lIdx}>
              {parseInline(pLine, `${pKey}-line-${lIdx}`)}
              {lIdx < paraLines.length - 1 && " "}
            </React.Fragment>
          ))}
        </p>
      )
    }

    return blocks
  }, [content])

  return (
    <div className={cn("math-markdown prose-neutral max-w-none text-neutral-900 dark:text-neutral-100", className)}>
      {renderedContent}
    </div>
  )
}
