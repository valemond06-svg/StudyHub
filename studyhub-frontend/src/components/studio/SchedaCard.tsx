import { useEffect, useRef, useState } from "react"
import { ArrowRight, BookOpen, Loader2 } from "lucide-react"
import { Link } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { MathMarkdown, MathInline } from "@/components/ui/math-markdown"
import { describeError } from "@/lib/api"
import { sourceHref, type SessionTopic } from "@/lib/study-session"

export interface SchedaCardProps {
  topic: SessionTopic | undefined
  topicId: number | undefined
  courseId: number
  position: number
  total: number
  /** Segna la scheda come letta (backend + memoria locale); deve risolversi prima di avanzare. */
  onDone: () => Promise<void>
}

/**
 * Argomento nuovo: la scheda di sintesi, poi si passa alle domande. La lezione interattiva completa
 * ("Impara") non è ancora nella nuova UI: qui c'è la sintesi del server e il link alla fonte.
 */
export function SchedaCard({ topic, topicId, courseId, position, total, onDone }: SchedaCardProps) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const busy = useRef(false)
  const href = sourceHref(courseId, topic ?? undefined)

  const done = () => {
    if (busy.current) return
    busy.current = true
    setPending(true)
    setError(null)
    onDone()
      .catch((err) => setError(describeError(err, "Non sono riuscito a salvare.")))
      .finally(() => { busy.current = false; setPending(false) })
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (e.key !== "Enter" || e.ctrlKey || e.altKey || e.metaKey) return
      if (t && ["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A"].includes(t.tagName)) return
      e.preventDefault()
      done()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  return (
    <article aria-label={`Scheda ${position} di ${total}`} className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 sm:p-6 shadow-2xs">
      <header className="flex flex-wrap items-center gap-2 mb-3 text-xs">
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-semibold bg-accent-50 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300">
          <BookOpen className="h-3 w-3" /> Argomento nuovo
        </span>
        <span className="ml-auto font-mono text-neutral-500">{position}/{total}</span>
      </header>
      <h2 className="text-xl sm:text-2xl font-semibold mb-3 break-words">
        {topic?.name ? <MathInline content={topic.name} /> : `Argomento ${topicId ?? ""}`}
      </h2>
      {topic?.summary_md
        ? <MathMarkdown content={topic.summary_md} className="text-sm sm:text-base" />
        : <p className="text-sm text-neutral-500">La scheda di sintesi di questo argomento non è ancora pronta: studialo dalla fonte, poi passa alle domande.</p>}
      {href && (
        href.startsWith("/api/")
          ? <a href={href} target="_blank" rel="noreferrer" className="mt-4 inline-block text-sm text-accent-600 dark:text-accent-400 underline underline-offset-2">Apri la fonte (PDF)</a>
          : <Link to={href} className="mt-4 inline-block text-sm text-accent-600 dark:text-accent-400 underline underline-offset-2">Rivedi il punto della lezione</Link>
      )}
      {error && (
        <div role="alert" className="mt-4 rounded-xl border border-error-300 bg-error-50 dark:bg-error-900/20 p-3 text-sm">
          {error}
        </div>
      )}
      <div className="sticky bottom-0 -mx-4 sm:-mx-6 -mb-4 sm:-mb-6 px-4 sm:px-6 py-3 mt-4 border-t border-neutral-100 dark:border-neutral-800 bg-white/95 dark:bg-neutral-900/95 backdrop-blur rounded-b-2xl">
        <Button className="w-full min-h-12 gap-2" onClick={done} disabled={pending} title="Invio">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {error ? "Riprova" : "Ho letto: passa alle domande"} <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </article>
  )
}
