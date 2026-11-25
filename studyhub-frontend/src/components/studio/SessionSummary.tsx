import { useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { ArrowRight, Check, Layers, RotateCcw, TrendingUp } from "lucide-react"
import { Button } from "@/components/ui/button"
import { MathInline, MathMarkdown } from "@/components/ui/math-markdown"
import { ApiError, api, describeError } from "@/lib/api"
import { cn } from "@/lib/utils"
import { sourceHref, topicsToReview, type FinishResult } from "@/lib/study-session"

type CardState = "idle" | "pending" | "done" | "error"

/**
 * Riepilogo onesto di fine sessione: cosa hai sbagliato, argomenti da rivedere, prontezza prima/dopo
 * (dal server, non stimata qui) e la prossima sessione consigliata.
 */
export function SessionSummary({ result, courseId, duration, focusTopicForNext }: {
  result: FinishResult
  courseId: number
  duration: number
  /** Argomento da proporre per la prossima sessione mirata (il più sbagliato), se noto. */
  focusTopicForNext?: number
}) {
  const navigate = useNavigate()
  const [cards, setCards] = useState<Record<number, CardState>>({})
  const [cardsUnavailable, setCardsUnavailable] = useState(false)
  const [cardError, setCardError] = useState<string | null>(null)
  const accuracy = result.answered > 0 ? Math.round((result.correct / result.answered) * 100) : null
  const review = topicsToReview(result.wrong)
  const before = result.ready_before
  const after = result.ready_after
  const pct = (v: number | null | undefined) => (typeof v === "number" ? `${Math.round(v * 100)}%` : "n.d.")

  const makeCard = (attemptId: number) => {
    if (cards[attemptId] === "pending" || cards[attemptId] === "done") return
    setCards((c) => ({ ...c, [attemptId]: "pending" }))
    setCardError(null)
    api.flashcardFromError(attemptId)
      .then(() => setCards((c) => ({ ...c, [attemptId]: "done" })))
      .catch((err) => {
        if (err instanceof ApiError && (err.status === 404 || err.status === 405)) {
          setCardsUnavailable(true)
          setCards((c) => ({ ...c, [attemptId]: "idle" }))
        } else {
          setCardError(describeError(err))
          setCards((c) => ({ ...c, [attemptId]: "error" }))
        }
      })
  }

  const nextHref = focusTopicForNext
    ? `/studio/${courseId}?duration=25&topic=${focusTopicForNext}`
    : `/studio/${courseId}?duration=${duration}`

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <section className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5">
        <h2 className="text-2xl font-semibold mb-1">Sessione conclusa</h2>
        {result.answered === 0 ? (
          <p className="text-neutral-600 dark:text-neutral-400">Non hai risposto a nessuna domanda: questa sessione non misura nulla.</p>
        ) : (
          <p className="text-neutral-600 dark:text-neutral-400">
            {result.correct} giuste su {result.answered} risposte{accuracy !== null ? ` (${accuracy}%)` : ""}, {result.xp} XP.
          </p>
        )}
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-xl bg-neutral-50 dark:bg-neutral-950 p-3">
            <dt className="text-neutral-500">Prontezza d'esame</dt>
            <dd className="font-mono font-semibold text-lg">{pct(before)} <ArrowRight className="inline h-4 w-4" /> {pct(after)}</dd>
          </div>
          <div className="rounded-xl bg-neutral-50 dark:bg-neutral-950 p-3">
            <dt className="text-neutral-500">Da rivedere</dt>
            <dd className="font-mono font-semibold text-lg">{result.wrong.length}</dd>
          </div>
        </dl>
        {result.verdict?.title && (
          <div className={cn(
            "mt-4 rounded-xl p-3 text-sm",
            result.verdict.tone === "ok" ? "bg-success-50 dark:bg-success-900/20" : "bg-warning-50 dark:bg-warning-900/20",
          )}>
            <p className="font-semibold">{result.verdict.title}</p>
            {result.verdict.text && <p className="mt-1">{result.verdict.text}</p>}
          </div>
        )}
      </section>

      {result.wrong.length > 0 && (
        <section className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5" aria-labelledby="sbagliate">
          <h3 id="sbagliate" className="font-semibold mb-3 flex items-center gap-2"><RotateCcw className="h-4 w-4" /> Cosa hai sbagliato</h3>
          <ul className="space-y-3">
            {result.wrong.map((w) => {
              const href = sourceHref(courseId, w)
              const state = cards[w.attempt_id] ?? "idle"
              return (
                <li key={w.id} className="rounded-xl border border-neutral-200 dark:border-neutral-700 p-3">
                  {w.topic && <p className="text-xs text-neutral-500 mb-1"><MathInline content={w.topic} /></p>}
                  <MathMarkdown content={w.prompt_md} className="text-sm" />
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {href && (href.startsWith("/api/")
                      ? <a href={href} target="_blank" rel="noreferrer" className="text-sm text-accent-600 dark:text-accent-400 underline underline-offset-2">Apri la fonte</a>
                      : <Link to={href} className="text-sm text-accent-600 dark:text-accent-400 underline underline-offset-2">Rivedi a lezione</Link>)}
                    {!cardsUnavailable && (
                      <Button size="sm" variant="outline" className="ml-auto gap-1.5" disabled={state === "pending" || state === "done"} onClick={() => makeCard(w.attempt_id)}>
                        {state === "done" ? <><Check className="h-4 w-4" /> Flashcard creata</> : <><Layers className="h-4 w-4" /> Crea flashcard</>}
                      </Button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
          {cardsUnavailable && (
            <p className="mt-3 text-xs text-neutral-500">La creazione di flashcard dagli errori non è ancora disponibile in questa versione del server.</p>
          )}
          {cardError && <p role="alert" className="mt-3 text-sm text-error-700">{cardError}</p>}
        </section>
      )}

      {(review.length > 0 || result.topics_up.length > 0) && (
        <section className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 space-y-4">
          {review.length > 0 && (
            <div>
              <h3 className="font-semibold mb-2">Argomenti da rivedere</h3>
              <ul className="flex flex-wrap gap-2">
                {review.map((t) => (
                  <li key={t.name} className="px-3 py-1 rounded-full bg-warning-50 dark:bg-warning-900/20 text-sm">
                    <MathInline content={t.name} />{t.count > 1 ? ` (${t.count})` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {result.topics_up.length > 0 && (
            <div>
              <h3 className="font-semibold mb-2 flex items-center gap-2"><TrendingUp className="h-4 w-4" /> Argomenti saliti</h3>
              <ul className="space-y-1 text-sm">
                {result.topics_up.map((t) => (
                  <li key={t.name} className="flex justify-between gap-2">
                    <span className="min-w-0 break-words"><MathInline content={t.name} /></span>
                    <span className="font-mono shrink-0">{Math.round(t.from * 100)}% <ArrowRight className="inline h-3 w-3" /> {Math.round(t.to * 100)}% · {t.level_name}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <div className="flex flex-col sm:flex-row gap-2">
        <Button className="min-h-12 flex-1 gap-2" onClick={() => navigate(nextHref)}>
          {focusTopicForNext ? "Prossima sessione: 25 min sugli errori" : "Prossima sessione"} <ArrowRight className="h-4 w-4" />
        </Button>
        <Button variant="outline" className="min-h-12 flex-1" onClick={() => navigate(`/corsi/${courseId}`)}>Torna al corso</Button>
      </div>
    </div>
  )
}
