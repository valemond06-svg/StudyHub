import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { ArrowRight, Camera, Check, Flag, Loader2, NotebookPen, RotateCcw, Send, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { MathMarkdown, MathInline } from "@/components/ui/math-markdown"
import { PhotoUpload } from "@/components/camera/PhotoUpload"
import { describeError } from "@/lib/api"
import { cn } from "@/lib/utils"
import {
  CONFIDENCE_LEVELS,
  SELF_VERDICTS,
  TRUE_FALSE,
  isChoiceKind,
  measuredSeconds,
  scoreLabel,
  selfAssessmentPayload,
  sourceHref,
  verdictFromChecks,
  type AnswerPayload,
  type AnswerResult,
  type PhotoPayload,
  type RevealResult,
  type SelfVerdict,
  type SessionEntry,
} from "@/lib/study-session"

const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"]

type Confidence = 1 | 2 | 3
type Submission = { type: "answer"; payload: AnswerPayload } | { type: "photo"; payload: PhotoPayload }

export interface QuestionCardProps {
  entry: SessionEntry
  courseId: number
  topicName: string
  /** Posizione nella coda, per l'intestazione ("Domanda 3 di 12"). */
  position: number
  total: number
  /** Esito già salvato (voce fatta): la card lo mostra soltanto. */
  savedResult?: AnswerResult
  submitAnswer: (payload: AnswerPayload) => Promise<AnswerResult>
  submitPhoto: (payload: PhotoPayload) => Promise<AnswerResult>
  reveal: () => Promise<RevealResult>
  onSaved: (result: AnswerResult) => void
  onNext: () => void
  isLast: boolean
}

const KIND_LABEL: Record<string, string> = {
  multipla: "Scelta multipla",
  vero_falso: "Vero o falso",
  richiamo: "Richiamo",
  aperta: "Risposta aperta",
  esercizio: "Esercizio",
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return isTypingTarget(target) || target.tagName === "BUTTON" || target.tagName === "A"
}

/**
 * Una domanda della sessione. Percorsi:
 *  - scelta (multipla, vero/falso): scegli, consegni, il server corregge;
 *  - aperta: scrivi e consegni (corregge l'AI), oppure invii le foto, oppure "svolto sul quaderno":
 *    si rivela la soluzione e ti autovaluti sui criteri (No/Parziale/Sì), mai inviato come risposta sbagliata.
 * Prima di consegnare scegli quanto sei sicuro (1-3). Un errore di salvataggio non fa avanzare:
 * "Riprova" rimanda la stessa identica richiesta (il server la riconosce e non la conta due volte).
 */
export function QuestionCard(props: QuestionCardProps) {
  const { entry, courseId, topicName, position, total, savedResult, submitAnswer, submitPhoto, reveal, onSaved, onNext, isLast } = props
  const q = entry.question
  const kind = q?.kind ?? "aperta"
  const options = q?.options ?? []
  const isTF = kind === "vero_falso"
  const isChoice = isChoiceKind(kind) && (isTF || options.length > 0)

  const [startedAt] = useState(() => Date.now())
  const inFlight = useRef(false)
  const [confidence, setConfidence] = useState<Confidence | null>(null)
  const [choice, setChoice] = useState<number | null>(null)
  const [text, setText] = useState("")
  const [photos, setPhotos] = useState<string[]>([])
  const [showPhotos, setShowPhotos] = useState(false)
  const [revealed, setRevealed] = useState<RevealResult | null>(null)
  const [resumedAsRevealed] = useState(Boolean(entry.revealed && !entry.done))
  const [revealing, setRevealing] = useState(resumedAsRevealed)
  const [revealError, setRevealError] = useState<string | null>(null)
  const [checks, setChecks] = useState<boolean[] | null>(null)
  const [verdict, setVerdict] = useState<SelfVerdict | null>(null)
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState<{ submission: Submission; message: string } | null>(null)
  const [result, setResult] = useState<AnswerResult | null>(savedResult ?? null)

  const stage: "answer" | "self" | "result" = result ? "result" : revealed || revealing || revealError ? "self" : "answer"

  const doReveal = useCallback(() => {
    if (inFlight.current) return
    inFlight.current = true
    setRevealing(true)
    setRevealError(null)
    reveal()
      .then((r) => setRevealed(r))
      .catch((err) => { setRevealError(describeError(err, "Impossibile mostrare la soluzione.")); setRevealing(false) })
      .finally(() => { inFlight.current = false })
  }, [reveal])

  // Ripresa di una domanda già rivelata (fase "rivelata"): si torna dritti all'autovalutazione.
  const resumedReveal = useRef(false)
  useEffect(() => {
    if (resumedReveal.current || !entry.revealed || entry.done) return
    resumedReveal.current = true
    inFlight.current = true
    reveal()
      .then((r) => setRevealed(r))
      .catch((err) => { setRevealError(describeError(err, "Impossibile mostrare la soluzione.")); setRevealing(false) })
      .finally(() => { inFlight.current = false })
  }, [entry.revealed, entry.done, reveal])

  const send = useCallback((submission: Submission) => {
    if (inFlight.current) return
    inFlight.current = true
    setPending(true)
    setFailed(null)
    const call = submission.type === "photo" ? submitPhoto(submission.payload) : submitAnswer(submission.payload)
    call
      .then((r) => { setResult(r); onSaved(r) })
      .catch((err) => setFailed({ submission, message: describeError(err, "Salvataggio non riuscito.") }))
      .finally(() => { inFlight.current = false; setPending(false) })
  }, [submitAnswer, submitPhoto, onSaved])


  const canSubmitChoice = isChoice && choice !== null && confidence !== null
  const canSubmitText = !isChoice && text.trim().length > 0 && photos.length === 0 && confidence !== null
  const canSubmitPhotos = !isChoice && photos.length > 0 && confidence !== null
  const rubric = revealed?.rubric ?? []
  const selfPayload = selfAssessmentPayload(rubric, checks, verdict)
  const canSaveSelf = Boolean(revealed && selfPayload && confidence !== null)

  const submitCurrent = useCallback(() => {
    const seconds = () => measuredSeconds(startedAt, Date.now())
    if (pending || failed || confidence === null) return
    if (stage === "answer") {
      if (canSubmitChoice) send({ type: "answer", payload: { idx: entry.idx, choice: choice!, confidence, seconds: seconds() } })
      else if (canSubmitPhotos) send({ type: "photo", payload: { idx: entry.idx, images: photos, text: text.trim() || undefined, confidence, seconds: seconds() } })
      else if (canSubmitText) send({ type: "answer", payload: { idx: entry.idx, text: text.trim(), confidence, seconds: seconds() } })
    } else if (stage === "self" && canSaveSelf) {
      send({ type: "answer", payload: { idx: entry.idx, ...selfPayload!, confidence, seconds: seconds() } })
    }
  }, [pending, failed, confidence, stage, canSubmitChoice, canSubmitPhotos, canSubmitText, canSaveSelf, send, entry.idx, choice, photos, text, selfPayload, startedAt])

  // Scorciatoie: 1-3 sicurezza (prima) o voto (autovalutazione), lettere/V-F per le opzioni,
  // Invio consegna/avanti, Spazio rivela la soluzione (domande aperte). Mai mentre scrivi.
  // useLayoutEffect: il gestore va aggiornato subito al commit, altrimenti "3" seguito subito da Invio
  // userebbe lo stato vecchio e Invio verrebbe ignorato (visto nella prova dal vivo).
  useLayoutEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.metaKey) return
      if (isTypingTarget(e.target)) {
        if (e.key === "Enter" && e.ctrlKey && stage === "answer") { e.preventDefault(); submitCurrent() }
        return
      }
      if (e.ctrlKey) return
      const k = e.key.toLowerCase()
      if (stage === "result") {
        if (k === "enter" && !isInteractiveTarget(e.target)) { e.preventDefault(); onNext() }
        return
      }
      if (pending) return
      if (["1", "2", "3"].includes(k)) {
        const n = Number(k) as Confidence
        if (stage === "answer" || confidence === null) setConfidence(n)
        else { setVerdict(SELF_VERDICTS[n - 1].key); setChecks(null) }
        e.preventDefault()
        return
      }
      if (k === "enter" && !isInteractiveTarget(e.target)) { e.preventDefault(); submitCurrent(); return }
      if (stage !== "answer") return
      if (k === " " && !isChoice && !isInteractiveTarget(e.target)) {
        if (confidence !== null) { e.preventDefault(); doReveal() }
        return
      }
      if (isTF) {
        const tf = TRUE_FALSE.find((x) => x.key === k)
        if (tf) { setChoice(tf.choice); e.preventDefault() }
      } else if (isChoice) {
        const i = LETTERS.findIndex((l) => l.toLowerCase() === k)
        if (i >= 0 && i < options.length) { setChoice(i); e.preventDefault() }
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [stage, pending, submitCurrent, onNext, isChoice, isTF, options.length, confidence, doReveal])

  const locked = stage !== "answer" || pending
  const badge = entry.retry ? "Riprova" : entry.boss ? "Boss finale" : KIND_LABEL[kind] ?? "Domanda"

  return (
    <article
      aria-label={`Domanda ${position} di ${total}`}
      className={cn(
        "rounded-2xl border bg-white dark:bg-neutral-900 p-4 sm:p-6 shadow-2xs",
        entry.boss ? "border-error-300 dark:border-error-900/60" : "border-neutral-200 dark:border-neutral-800",
      )}
    >
      <header className="flex flex-wrap items-center gap-2 mb-4 text-xs">
        <span className={cn(
          "inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-semibold",
          entry.boss ? "bg-error-600 text-white" : entry.retry ? "bg-warning-100 text-warning-800 dark:bg-warning-900/40 dark:text-warning-200" : "bg-accent-50 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300",
        )}>
          {entry.boss && <Flag className="h-3 w-3" />}
          {entry.retry && <RotateCcw className="h-3 w-3" />}
          {badge}
        </span>
        {topicName && (
          <span className="min-w-0 max-w-full truncate px-2.5 py-1 rounded-full border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300" title={topicName}>
            <MathInline content={topicName} />
          </span>
        )}
        <span className="ml-auto font-mono text-neutral-500">{position}/{total}</span>
      </header>

      {entry.retry && stage === "answer" && (
        <p className="mb-3 text-sm text-warning-700 dark:text-warning-300">L'avevi sbagliata prima in questa sessione: riprovaci.</p>
      )}

      <MathMarkdown content={q?.prompt_md ?? ""} className="text-base sm:text-lg leading-relaxed mb-5" />

      {/* Opzioni */}
      {isChoice && (
        <div className={cn("gap-2 mb-5", isTF ? "grid grid-cols-2" : "flex flex-col")} role="group" aria-label="Opzioni di risposta">
          {(isTF ? TRUE_FALSE.map((t) => ({ label: t.label, value: t.choice, hint: t.key.toUpperCase() })) :
            options.map((o, i) => ({ label: o, value: i, hint: LETTERS[i] ?? String(i + 1) }))).map((opt) => {
            const selected = choice === opt.value
            const isCorrect = result && result.correct === opt.value
            const isWrongPick = result && selected && result.correct !== opt.value
            return (
              <button
                key={opt.value}
                type="button"
                disabled={locked}
                aria-pressed={selected}
                onClick={() => setChoice(opt.value)}
                className={cn(
                  "w-full min-h-12 flex items-start gap-3 p-3 sm:p-4 rounded-xl border text-left transition-colors disabled:cursor-default",
                  "border-neutral-200 dark:border-neutral-700 hover:border-neutral-300 dark:hover:border-neutral-600",
                  selected && !result && "border-accent-500 ring-2 ring-accent-500/30 bg-accent-50 dark:bg-accent-900/20",
                  isCorrect && "border-success-500 bg-success-50 dark:bg-success-900/20",
                  isWrongPick && "border-error-500 bg-error-50 dark:bg-error-900/20",
                  isTF && "justify-center text-center font-semibold",
                )}
              >
                {!isTF && (
                  <kbd className="shrink-0 inline-flex h-6 w-6 items-center justify-center rounded-md bg-neutral-100 dark:bg-neutral-800 text-xs font-semibold">{opt.hint}</kbd>
                )}
                <span className="min-w-0 flex-1 break-words">{isTF ? opt.label : <MathInline content={opt.label} />}</span>
                {isCorrect && <Check className="h-5 w-5 shrink-0 text-success-600" aria-label="risposta giusta" />}
                {isWrongPick && <X className="h-5 w-5 shrink-0 text-error-600" aria-label="la tua scelta" />}
              </button>
            )
          })}
        </div>
      )}

      {/* Risposta aperta */}
      {!isChoice && stage === "answer" && (
        <div className="space-y-3 mb-5">
          <textarea
            value={text}
            disabled={locked}
            onChange={(e) => setText(e.target.value)}
            placeholder="Scrivi la risposta o i passaggi principali (Ctrl+Invio per consegnare)"
            aria-label="La tua risposta"
            rows={4}
            className="w-full rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-950 p-3 text-base focus:outline-none focus:ring-2 focus:ring-accent-500"
          />
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" disabled={locked} onClick={() => setShowPhotos((v) => !v)} aria-expanded={showPhotos} className="gap-1.5">
              <Camera className="h-4 w-4" /> Foto del quaderno{photos.length > 0 ? ` (${photos.length})` : ""}
            </Button>
          </div>
          {showPhotos && (
            <div className="rounded-xl border border-neutral-200 dark:border-neutral-700 p-3">
              <PhotoUpload photos={photos} onPhotosChange={setPhotos} maxPhotos={4} label="Foto dello svolgimento" disabled={locked} />
              <p className="mt-2 text-xs text-neutral-500">Le foto vengono corrette dall'AI solo quando premi "Invia le foto".</p>
            </div>
          )}
        </div>
      )}

      {/* Sicurezza: prima di consegnare o di vedere la soluzione; dopo una ricarica in fase "rivelata" si richiede qui */}
      {(stage === "answer" || (stage === "self" && (confidence === null || resumedAsRevealed))) && (
        <div className="mb-4" role="radiogroup" aria-label="Quanto sei sicuro?">
          <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-2">
            {stage === "answer" ? "Quanto sei sicuro?" : "Quanto eri sicuro prima di vedere la soluzione?"} <span className="text-neutral-400">(tasti 1-3)</span>
          </p>
          <div className="grid grid-cols-3 gap-2">
            {CONFIDENCE_LEVELS.map((c) => (
              <button
                key={c.value}
                type="button"
                role="radio"
                aria-checked={confidence === c.value}
                disabled={pending}
                onClick={() => setConfidence(c.value)}
                className={cn(
                  "min-h-11 px-2 rounded-xl border text-sm font-medium transition-colors",
                  confidence === c.value
                    ? "bg-accent-600 border-accent-600 text-white"
                    : "border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800",
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Autovalutazione guidata */}
      {stage === "self" && (
        <section aria-label="Autovalutazione" className="space-y-4 mb-4">
          {!revealed && !revealError && (
            <p role="status" className="flex items-center gap-2 text-sm text-neutral-500"><Loader2 className="h-4 w-4 animate-spin" /> Carico la soluzione...</p>
          )}
          {revealed && (
            <>
              <div className="rounded-xl bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-2">Soluzione</h3>
                <MathMarkdown content={revealed.answer_md || "Nessuna soluzione disponibile per questa domanda."} className="text-sm" />
                <SourceLink courseId={courseId} source={revealed.source} />
              </div>
              {rubric.length > 0 && (
                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium mb-1">Confronta il tuo svolgimento con i criteri</legend>
                  {rubric.map((c, i) => {
                    const on = checks?.[i] ?? false
                    return (
                      <label key={i} className="flex items-start gap-3 p-3 rounded-xl border border-neutral-200 dark:border-neutral-700 cursor-pointer min-h-11">
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4 accent-accent-600"
                          checked={on}
                          disabled={pending}
                          onChange={(e) => {
                            const next = rubric.map((_, j) => (j === i ? e.target.checked : checks?.[j] ?? false))
                            setChecks(next)
                            setVerdict(null)
                          }}
                        />
                        <span className="text-sm min-w-0 break-words"><MathInline content={c} /></span>
                      </label>
                    )
                  })}
                </fieldset>
              )}
              <div role="radiogroup" aria-label="Il tuo svolgimento era giusto?">
                <p className="text-sm font-medium mb-2">
                  {rubric.length > 0 ? "Oppure giudica in blocco:" : "Il tuo svolgimento era giusto?"} <span className="text-neutral-400 font-normal">(tasti 1-3)</span>
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {SELF_VERDICTS.map((v) => {
                    const active = verdict === v.key || (checks !== null && verdictFromChecks(checks) === v.key)
                    return (
                      <button
                        key={v.key}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        disabled={pending}
                        onClick={() => { setVerdict(v.key); setChecks(null) }}
                        className={cn(
                          "min-h-11 rounded-xl border text-sm font-semibold transition-colors",
                          active ? "bg-accent-600 border-accent-600 text-white" : "border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800",
                        )}
                      >
                        {v.label}
                      </button>
                    )
                  })}
                </div>
                <p className="mt-2 text-xs text-neutral-500">L'autovalutazione vale al massimo l'85%: per il punteggio pieno serve la correzione.</p>
              </div>
            </>
          )}
          {revealError && (
            <div role="alert" className="rounded-xl border border-error-300 bg-error-50 dark:bg-error-900/20 p-3 text-sm">
              <p>{revealError}</p>
              <Button size="sm" variant="outline" className="mt-2" onClick={doReveal}>Riprova</Button>
            </div>
          )}
        </section>
      )}

      {/* Esito */}
      {result && <ResultPanel result={result} courseId={courseId} isChoice={isChoice} />}

      {failed && (
        <div role="alert" className="mb-4 rounded-xl border border-error-300 bg-error-50 dark:bg-error-900/20 p-3 text-sm">
          <p className="font-medium">Risposta non salvata: {failed.message}</p>
          <p className="text-neutral-600 dark:text-neutral-400 mt-1">La domanda resta qui finché il salvataggio non riesce.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => send(failed.submission)} disabled={pending}>Riprova</Button>
            <Button size="sm" variant="ghost" onClick={() => setFailed(null)} disabled={pending}>Modifica la risposta</Button>
          </div>
        </div>
      )}

      {/* Azioni: in basso e grandi, usabili col pollice */}
      <div className="sticky bottom-0 -mx-4 sm:-mx-6 -mb-4 sm:-mb-6 px-4 sm:px-6 py-3 mt-2 border-t border-neutral-100 dark:border-neutral-800 bg-white/95 dark:bg-neutral-900/95 backdrop-blur rounded-b-2xl">
        {stage === "answer" && (
          <div className="flex flex-col sm:flex-row gap-2">
            {!isChoice && (
              <Button
                type="button"
                variant="outline"
                className="min-h-12 gap-2 sm:flex-1"
                disabled={pending || confidence === null || Boolean(failed)}
                onClick={doReveal}
                title="Spazio"
              >
                <NotebookPen className="h-4 w-4" /> Svolto sul quaderno: mostra la soluzione
              </Button>
            )}
            <Button
              type="button"
              className="min-h-12 gap-2 sm:flex-1"
              disabled={pending || Boolean(failed) || !(canSubmitChoice || canSubmitText || canSubmitPhotos)}
              onClick={submitCurrent}
              title="Invio"
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {photos.length > 0 ? "Invia le foto per la correzione" : isChoice ? "Conferma" : "Consegna per la correzione"}
            </Button>
          </div>
        )}
        {stage !== "result" && confidence === null && (
          <p className="mt-2 text-xs text-neutral-500">Prima scegli quanto sei sicuro.</p>
        )}
        {stage === "self" && (
          <Button type="button" className="w-full min-h-12 gap-2" disabled={!canSaveSelf || pending || Boolean(failed)} onClick={submitCurrent} title="Invio">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Salva l'autovalutazione
          </Button>
        )}
        {stage === "result" && (
          <Button type="button" className="w-full min-h-12 gap-2" onClick={onNext} title="Invio">
            {isLast ? "Vai al riepilogo" : "Avanti"} <ArrowRight className="h-4 w-4" />
          </Button>
        )}
        {pending && <p role="status" className="sr-only">Salvataggio in corso</p>}
      </div>
    </article>
  )
}

function SourceLink({ courseId, source }: { courseId: number; source?: RevealResult["source"] }) {
  const href = sourceHref(courseId, source)
  if (!href || !source) return null
  const label = source.lecture_id
    ? `Rivedi a lezione${source.lecture ? `: ${source.lecture}` : ""}${source.t_start ? ` (min ${Math.floor(source.t_start / 60)})` : ""}`
    : `Apri il PDF${source.doc ? ` ${source.doc}` : ""}${source.page ? `, pagina ${source.page}` : ""}`
  return href.startsWith("/api/")
    ? <a href={href} target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm text-accent-600 dark:text-accent-400 underline underline-offset-2">{label}</a>
    : <Link to={href} className="mt-3 inline-block text-sm text-accent-600 dark:text-accent-400 underline underline-offset-2">{label}</Link>
}

function ResultPanel({ result, courseId, isChoice }: { result: AnswerResult; courseId: number; isChoice: boolean }) {
  const s = scoreLabel(result.score)
  return (
    <section aria-label="Esito" className="space-y-3 mb-4">
      <div className={cn(
        "flex flex-wrap items-center gap-2 rounded-xl p-3 text-sm font-semibold",
        s.tone === "ok" && "bg-success-50 text-success-800 dark:bg-success-900/20 dark:text-success-300",
        s.tone === "partial" && "bg-warning-50 text-warning-800 dark:bg-warning-900/20 dark:text-warning-300",
        s.tone === "bad" && "bg-error-50 text-error-800 dark:bg-error-900/20 dark:text-error-300",
      )}>
        <span>{s.label}</span>
        <span className="font-mono">{Math.round(result.score * 100)}%</span>
        {result.graded_by === "io" && <span className="font-normal">(autovalutazione)</span>}
        {result.graded_by === "ai" && <span className="font-normal">(corretta dall'AI)</span>}
        {result.xp > 0 && <span className="ml-auto font-mono">+{result.xp} XP</span>}
      </div>
      {result.requeued && (
        <p className="text-sm text-warning-700 dark:text-warning-300">La ritrovi in fondo alla sessione, per riprovarla.</p>
      )}
      {result.feedback_md && (
        <div className="rounded-xl bg-accent-50 dark:bg-accent-900/20 p-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-1">Correzione</h3>
          <MathMarkdown content={result.feedback_md} className="text-sm" />
        </div>
      )}
      {result.rubric?.length > 0 && result.criteria_ok?.length > 0 && (
        <ul className="space-y-1.5" aria-label="Criteri">
          {result.rubric.map((c, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              {result.criteria_ok[i]
                ? <Check className="h-4 w-4 mt-0.5 shrink-0 text-success-600" aria-label="rispettato" />
                : <X className="h-4 w-4 mt-0.5 shrink-0 text-error-600" aria-label="mancante" />}
              <span className="min-w-0 break-words"><MathInline content={c} /></span>
            </li>
          ))}
        </ul>
      )}
      {(!isChoice || result.score < 1) && result.answer_md && (
        <div className="rounded-xl bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-2">Soluzione</h3>
          <MathMarkdown content={result.answer_md} className="text-sm" />
        </div>
      )}
      <SourceLink courseId={courseId} source={result.source} />
    </section>
  )
}
