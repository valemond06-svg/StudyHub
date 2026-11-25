import { useParams, useSearchParams, useNavigate, useLocation } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useState, useEffect, useCallback, useRef } from "react"
import { ArrowLeft, Loader2, Play, Square, Timer, Zap } from "lucide-react"
import { Button } from "@/components/ui/button"
import { MathInline } from "@/components/ui/math-markdown"
import { api, ApiError, describeError } from "@/lib/api"
import { QuestionCard } from "@/components/studio/QuestionCard"
import { SchedaCard } from "@/components/studio/SchedaCard"
import { SessionSummary } from "@/components/studio/SessionSummary"
import {
  applyAnswer,
  firstPending,
  formatClock,
  markRevealed,
  phaseOf,
  planPhases,
  resumeIndex,
  topicName,
  type AnswerPayload,
  type AnswerResult,
  type FinishResult,
  type PhotoPayload,
  type SessionEntry,
  type StudySessionData,
} from "@/lib/study-session"

export function Studio() {
  // Ogni navigazione (anche «Nuova sessione» sulla stessa pagina) riparte dalla schermata d'avvio
  const location = useLocation()
  return <StudioPage key={location.key} />
}

function StudioPage() {
  const { courseId } = useParams()
  const [searchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const initialDuration = [25, 45, 90].includes(Number(searchParams.get("duration"))) ? Number(searchParams.get("duration")) : 45
  const topic = searchParams.get("topic") ?? ""
  const topicId = Number(topic)
  const initialTopic = /^\d+$/.test(topic) && Number.isSafeInteger(topicId) && topicId > 0 ? topicId : undefined
  const id = Number(courseId)
  const valid = Number.isSafeInteger(id) && id > 0
  const [choice, setChoice] = useState<{ duration: number; focusTopic?: number; resumeId?: number } | null>(null)

  // La sessione aperta del corso sta sul server: si propone di riprenderla o di chiuderla, mai di duplicarla.
  const open = useQuery({
    queryKey: ["open-session", id],
    queryFn: () => api.getOpenSession(id),
    enabled: valid && !choice,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  })

  if (!choice) {
    if (valid && open.isPending) {
      return (
        <div className="flex flex-col items-center justify-center h-64 gap-3 text-neutral-500">
          <Loader2 className="h-8 w-8 animate-spin text-accent-500" />
          <p className="text-sm">Controllo se hai una sessione aperta...</p>
        </div>
      )
    }
    if (open.data) {
      return (
        <OpenSessionPrompt
          session={open.data}
          onResume={() => setChoice({ duration: open.data!.minutes, resumeId: open.data!.id })}
          onClosed={() => queryClient.invalidateQueries({ queryKey: ["open-session", id] })}
        />
      )
    }
    return (
      <>
        {open.isError && (
          <p role="alert" className="max-w-2xl mx-auto mb-4 text-sm text-error-600 dark:text-error-400">
            Non riesco a sapere se hai una sessione aperta: {describeError(open.error)}
          </p>
        )}
        <StudioStart
          courseId={id}
          initialDuration={initialDuration}
          initialTopic={initialTopic}
          onStart={(duration, focusTopic) => setChoice({ duration, focusTopic })}
        />
      </>
    )
  }
  return (
    <StudioSession
      key={`${id}:${choice.duration}:${choice.focusTopic}:${choice.resumeId}`}
      courseId={id}
      duration={choice.duration}
      focusTopic={choice.focusTopic}
      resumeId={choice.resumeId}
      onAbandon={() => setChoice(null)}
    />
  )
}

function formatSessionStart(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "prima"
  const sameDay = d.toDateString() === new Date().toDateString()
  const time = d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })
  return sameDay ? `oggi alle ${time}` : `${d.toLocaleDateString("it-IT", { day: "numeric", month: "long" })} alle ${time}`
}

/** C'è già una sessione aperta su questo corso (anche da un altro browser): riprenderla o chiuderla. */
function OpenSessionPrompt({ session, onResume, onClosed }: {
  session: StudySessionData
  onResume: () => void
  onClosed: () => void
}) {
  const navigate = useNavigate()
  const [closing, setClosing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const done = session.entries.filter((e) => e.done).length
  const when = formatSessionStart(session.started_at)
  const close = () => {
    if (closing) return
    setClosing(true)
    setError(null)
    api.abandonSession(session.id)
      .then(onClosed)
      .catch((err) => setError(describeError(err, "Non sono riuscito a chiudere la sessione.")))
      .finally(() => setClosing(false))
  }
  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div className="flex items-start gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(`/corsi/${session.course_id}`)} aria-label="Torna al corso">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">Hai una sessione aperta</h1>
          <p className="text-neutral-500 dark:text-neutral-400">
            Iniziata {when} · {session.minutes} min · {done} di {session.entries.length} voci fatte
          </p>
        </div>
      </div>
      <p className="text-sm text-neutral-600 dark:text-neutral-300">
        Riprendila da dove eri rimasto, oppure chiudila: le risposte già date restano salvate e contano per la padronanza;
        le voci non fatte non contano.
      </p>
      {error && <p role="alert" className="text-sm text-error-600 dark:text-error-400">{error}</p>}
      <div className="flex flex-col sm:flex-row gap-2">
        <Button size="lg" className="min-h-12 gap-2 flex-1" onClick={onResume} disabled={closing}>
          <Play className="h-4 w-4" /> Riprendi la sessione {when.startsWith("oggi") ? "di " : "del "}{when}
        </Button>
        <Button size="lg" variant="outline" className="min-h-12" onClick={close} disabled={closing}>
          {closing ? "Chiudo..." : "Chiudila"}
        </Button>
      </div>
    </div>
  )
}

/** Schermata d'avvio: aprire la pagina non crea sessioni né avvia generazioni AI; lo fa solo «Avvia sessione». */
function StudioStart({ courseId, initialDuration, initialTopic, onStart }: {
  courseId: number
  initialDuration: number
  initialTopic?: number
  onStart: (duration: number, focusTopic?: number) => void
}) {
  const navigate = useNavigate()
  const [duration, setDuration] = useState(initialDuration)
  const [topicChoice, setTopicChoice] = useState<string>(initialTopic ? String(initialTopic) : "auto")
  const { data: course, isLoading, isError } = useQuery({
    queryKey: ["course", courseId],
    queryFn: () => api.getCourse(courseId),
    enabled: Number.isSafeInteger(courseId) && courseId > 0,
  })
  // Gli argomenti si caricano solo se scegli di indicarne uno (o se arrivi con ?topic=)
  const wantsTopic = topicChoice !== "auto"
  const { data: study } = useQuery<any>({
    queryKey: ["study", courseId],
    queryFn: () => api.getStudyCourseStats(courseId),
    enabled: wantsTopic,
  })
  const topics: Array<{ id: number; name: string; chapter: string | null }> = study?.topics ?? []

  if (isLoading) {
    return <div className="flex justify-center h-64 items-center"><Loader2 className="h-8 w-8 animate-spin text-accent-500" /></div>
  }
  if (isError || !course) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center space-y-4">
        <p className="text-neutral-600 dark:text-neutral-400">Impossibile caricare il corso.</p>
        <Button variant="outline" onClick={() => navigate("/corsi")}>Torna ai corsi</Button>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-start gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(`/corsi/${courseId}`)} aria-label="Torna al corso">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold break-words">Nuova sessione di studio</h1>
          <p className="text-neutral-500 dark:text-neutral-400 break-words">{course.fullname}</p>
        </div>
      </div>

      <section className="space-y-2" aria-labelledby="durata-label">
        <h2 id="durata-label" className="font-medium">Durata</h2>
        <div className="grid grid-cols-3 gap-2">
          {[25, 45, 90].map((d) => (
            <Button key={d} className="min-h-11" variant={duration === d ? "default" : "outline"} aria-pressed={duration === d} onClick={() => setDuration(d)}>
              {d} min
            </Button>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Argomento</h2>
        <select
          value={topicChoice}
          onChange={(e) => setTopicChoice(e.target.value)}
          aria-label="Argomento della sessione"
          className="w-full min-h-11 rounded-md border border-neutral-200 bg-white px-3 py-2 text-base dark:border-neutral-700 dark:bg-neutral-900"
        >
          <option value="auto">Scelgono le tue lacune (consigliato)</option>
          {!wantsTopic && <option value="pick">Voglio scegliere un argomento…</option>}
          {topicChoice !== "auto" && topicChoice !== "pick" && !topics.some((t) => String(t.id) === topicChoice) && (
            <option value={topicChoice}>Argomento #{topicChoice}</option>
          )}
          {topics.map((t) => (
            <option key={t.id} value={String(t.id)}>{t.chapter ? `${t.chapter} · ` : ""}{t.name}</option>
          ))}
        </select>
      </section>

      <div className="rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900/50 p-4 text-sm text-neutral-600 dark:text-neutral-300 space-y-2">
        <p>
          Avviando, StudyHub crea la sessione con domande dalla banca del corso, nell'ordine del corso: ripasso, argomenti nuovi,
          un esercizio finale. Le domande sbagliate tornano in fondo. Se per qualche argomento manca la scheda di studio,
          la chiede all'AI in background. Le risposte scritte vengono corrette dall'AI solo quando le consegni; se svolgi sul
          quaderno ti autovaluti sui criteri.
        </p>
        <p>Nessun limite di tempo per domanda: il timer è solo un riferimento. Tasti: 1-3 sicurezza o voto, Invio conferma, Spazio mostra la soluzione.</p>
      </div>

      <Button
        size="lg"
        className="w-full gap-2 min-h-12"
        disabled={topicChoice === "pick"}
        onClick={() => onStart(duration, /^\d+$/.test(topicChoice) ? Number(topicChoice) : undefined)}
      >
        <Play className="h-4 w-4" />
        Avvia sessione
      </Button>
    </div>
  )
}

function markDone(s: StudySessionData, idx: number): StudySessionData {
  return { ...s, entries: s.entries.map((e) => (e.idx === idx ? { ...e, done: true } : e)) }
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string; notFound: boolean }
  | { status: "ready" }

function StudioSession({ courseId, duration, focusTopic, resumeId, onAbandon }: {
  courseId: number
  duration: number
  focusTopic?: number
  /** Sessione aperta da riprendere (da GET /api/study/{id}/sessions/open); senza, se ne crea una nuova. */
  resumeId?: number
  onAbandon: () => void
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data: course } = useQuery({
    queryKey: ["course", courseId],
    queryFn: () => api.getCourse(courseId),
    enabled: courseId > 0,
  })

  const [load, setLoad] = useState<LoadState>({ status: "loading" })
  const [session, setSession] = useState<StudySessionData | null>(null)
  const [cursor, setCursor] = useState<number | null>(null)
  const [results, setResults] = useState<Record<number, AnswerResult>>({})
  const [finish, setFinish] = useState<FinishResult | null>(null)
  const [finishing, setFinishing] = useState(false)
  const [finishError, setFinishError] = useState<string | null>(null)
  const [confirmStop, setConfirmStop] = useState(false)
  const [mountedAt] = useState(() => Date.now())
  const [now, setNow] = useState(() => Date.now())
  const requested = useRef(false)
  const finishBusy = useRef(false)
  const schedaBusy = useRef(false)

  const open = useCallback((data: StudySessionData) => {
    if (data.ended_at) {
      // Sessione già chiusa altrove: non si riapre, si ricomincia dalla schermata d'avvio.
      setLoad({ status: "error", message: "Questa sessione è già conclusa.", notFound: true })
      return
    }
    setSession(data)
    setCursor(resumeIndex(data))
    setLoad({ status: "ready" })
  }, [])

  const loadSession = useCallback(() => {
    const call = resumeId ? api.getSession(resumeId) : api.createSession(courseId, duration, focusTopic)
    call
      .then(open)
      .catch((err) => setLoad({
        status: "error",
        message: describeError(err, "Impossibile caricare la sessione di studio."),
        notFound: err instanceof ApiError && err.status === 404,
      }))
  }, [resumeId, courseId, duration, focusTopic, open])

  useEffect(() => {
    if (requested.current || !(courseId > 0)) return
    requested.current = true
    loadSession()
  }, [courseId, loadSession])

  // Orologio informativo (1 s): nessun avanzamento automatico.
  const ticking = Boolean(session) && !finish
  useEffect(() => {
    if (!ticking) return
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [ticking])

  const sid = session?.id
  const submitAnswer = useCallback((payload: AnswerPayload) => api.answerSession(sid!, payload), [sid])
  const submitPhoto = useCallback((payload: PhotoPayload) => api.photoSession(sid!, payload), [sid])
  const reveal = useCallback((body?: { confidence: number; seconds: number }) => {
    const idx = cursor!
    return api.revealSession(sid!, idx, body).then((r) => {
      setSession((s) => (s ? markRevealed(s, idx) : s))
      return r
    })
  }, [sid, cursor])

  const onSaved = useCallback((result: AnswerResult) => {
    const idx = cursor!
    setResults((r) => ({ ...r, [idx]: result }))
    setSession((s) => (s ? applyAnswer(s, idx, result) : s))
  }, [cursor])

  const doFinish = useCallback(() => {
    if (!sid || finishBusy.current) return
    finishBusy.current = true
    setFinishing(true)
    setFinishError(null)
    api.finishSession(sid)
      .then((r) => {
        setFinish(r)
        setConfirmStop(false)
        void queryClient.invalidateQueries({ queryKey: ["plan"] })
        void queryClient.invalidateQueries({ queryKey: ["study"] })
        void queryClient.invalidateQueries({ queryKey: ["studyCourses"] })
      })
      .catch((err) => setFinishError(describeError(err, "Impossibile salvare la fine della sessione.")))
      .finally(() => { finishBusy.current = false; setFinishing(false) })
  }, [sid, queryClient])

  const advanceFrom = useCallback((entries: SessionEntry[], from: number) => {
    const next = firstPending(entries, undefined, from + 1) ?? firstPending(entries)
    setCursor(next)
    window.scrollTo?.({ top: 0 })
    if (next === null) doFinish()
  }, [doFinish])

  const goNext = useCallback(() => {
    if (!session || cursor === null) return
    advanceFrom(session.entries, cursor)
  }, [session, cursor, advanceFrom])

  // Scheda letta: la segna il server (POST /seen), così la ripresa non la ripropone nemmeno da un altro browser.
  const onSchedaDone = useCallback(async () => {
    if (!session || cursor === null || schedaBusy.current) return
    schedaBusy.current = true
    try {
      const entry = session.entries.find((e) => e.idx === cursor)
      await api.seenSession(session.id, cursor)
      // Primo completamento della lezione dell'argomento: utile ma non bloccante per la sessione.
      if (entry?.topic) await api.completeTopicLesson(entry.topic).catch(() => undefined)
      const updated = markDone(session, cursor)
      setSession(updated)
      advanceFrom(updated.entries, cursor)
    } finally {
      schedaBusy.current = false
    }
  }, [session, cursor, advanceFrom])

  // ---------------------------------------------------------------------------------------------

  if (load.status === "loading") {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-neutral-500">
        <Loader2 className="h-8 w-8 animate-spin text-accent-500" />
        <p className="text-sm">{resumeId ? "Riprendo la sessione..." : "Creo la sessione..."}</p>
      </div>
    )
  }
  if (load.status === "error" || !session) {
    const message = load.status === "error" ? load.message : "Sessione non disponibile."
    const notFound = load.status === "error" && load.notFound
    return (
      <div role="alert" className="max-w-md mx-auto text-center py-12 space-y-4">
        <p>{message}</p>
        <div className="flex flex-col sm:flex-row gap-2 justify-center">
          {!notFound && <Button onClick={() => { setLoad({ status: "loading" }); loadSession() }}>Riprova</Button>}
          <Button variant={notFound ? "default" : "outline"} onClick={onAbandon}>Nuova sessione</Button>
          <Button variant="ghost" onClick={() => navigate(`/corsi/${courseId}`)}>Torna al corso</Button>
        </div>
      </div>
    )
  }

  if (finish) {
    const counts = new Map<number, number>()
    for (const w of finish.wrong) {
      const t = session.entries.find((e) => e.item === w.id)?.question?.topic_id
      if (t) counts.set(t, (counts.get(t) ?? 0) + 1)
    }
    const worst = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
    return <SessionSummary result={finish} courseId={courseId} duration={duration} focusTopicForNext={worst} />
  }

  const entries = session.entries
  const total = entries.length
  const doneCount = entries.filter((e) => e.done).length
  const entry = cursor === null ? undefined : entries.find((e) => e.idx === cursor)
  const position = entry ? entries.indexOf(entry) + 1 : total
  const phases = planPhases(entries, session.minutes || duration)
  const currentPhase = entry ? phases.find((p) => p.key === phaseOf(entry)) : undefined
  // Il tempo parte dall'avvio della sessione sul server (così una ricarica non lo azzera);
  // se la sessione è di ore fa (ripresa il giorno dopo) si conta da quando l'hai riaperta.
  const startedMs = Date.parse(session.started_at)
  const timerBase = Number.isFinite(startedMs) && mountedAt - startedMs >= 0 && mountedAt - startedMs < 3 * 3600_000 ? startedMs : mountedAt
  const elapsed = Math.round((now - timerBase) / 1000)
  const plannedUntilPhaseEnd = currentPhase
    ? phases.slice(0, phases.indexOf(currentPhase) + 1).reduce((s, p) => s + p.budget, 0)
    : (session.minutes || duration) * 60
  const isLast = firstPending(entries.filter((e) => e.idx !== cursor)) === null
  const answered = Object.values(results)
  const xp = session.xp

  return (
    <div className="max-w-3xl mx-auto">
      {/* Barra della sessione: compatta e fissa in alto, anche su telefono */}
      <div className="sticky top-14 z-30 -mx-4 lg:mx-0 px-4 py-2 mb-4 bg-neutral-50/95 dark:bg-neutral-950/95 backdrop-blur border-b border-neutral-200 dark:border-neutral-800">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => navigate(`/corsi/${courseId}`)} aria-label="Torna al corso (la sessione resta aperta)">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <p className="font-semibold truncate">{course?.fullname ?? "Sessione di studio"}</p>
            <p className="text-xs text-neutral-500 truncate">
              {currentPhase ? `${currentPhase.label} · ${currentPhase.done}/${currentPhase.total}` : "Coda completata"}
            </p>
          </div>
          <span className="inline-flex items-center gap-1 text-xs font-mono px-2 py-1 rounded-full bg-neutral-100 dark:bg-neutral-800" title="Tempo trascorso e durata scelta">
            <Timer className="h-3.5 w-3.5" /> {formatClock(elapsed)}/{formatClock((session.minutes || duration) * 60)}
          </span>
          <span className="hidden sm:inline-flex items-center gap-1 text-xs font-mono px-2 py-1 rounded-full bg-neutral-100 dark:bg-neutral-800">
            <Zap className="h-3.5 w-3.5 text-warning-500" /> {xp} XP
          </span>
          <Button variant="ghost" size="icon" onClick={() => setConfirmStop(true)} aria-label="Termina la sessione">
            <Square className="h-4 w-4" />
          </Button>
        </div>
        <div
          className="mt-2 h-1.5 rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden"
          role="progressbar"
          aria-label="Avanzamento della sessione"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={doneCount}
        >
          <div className="h-full bg-accent-500 transition-[width]" style={{ width: `${total ? (doneCount / total) * 100 : 0}%` }} />
        </div>
        {currentPhase && elapsed > plannedUntilPhaseEnd && (
          <p className="mt-1 text-xs text-neutral-500">Sei oltre il tempo previsto per questa fase: nessuna fretta, nessuna domanda viene saltata.</p>
        )}
      </div>

      {confirmStop && (
        <div role="alertdialog" aria-label="Terminare la sessione?" className="mb-4 rounded-2xl border border-warning-300 bg-warning-50 dark:bg-warning-900/20 p-4 text-sm">
          <p className="font-medium">Terminare adesso?</p>
          <p className="mt-1 text-neutral-600 dark:text-neutral-400">
            Quello che hai risposto resta salvato; le {total - doneCount} voci non fatte non contano.
          </p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={doFinish} disabled={finishing}>{finishing ? "Salvo..." : "Termina e vedi il riepilogo"}</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmStop(false)} disabled={finishing}>Continua a studiare</Button>
          </div>
        </div>
      )}

      {entry?.t === "domanda" && (
        <QuestionCard
          key={`${session.id}:${entry.idx}`}
          entry={entry}
          courseId={courseId}
          topicName={topicName(session, entry.question?.topic_id)}
          position={position}
          total={total}
          savedResult={results[entry.idx]}
          submitAnswer={submitAnswer}
          submitPhoto={submitPhoto}
          reveal={reveal}
          onSaved={onSaved}
          onNext={goNext}
          isLast={isLast}
        />
      )}
      {entry?.t === "scheda" && (
        <SchedaCard
          key={`${session.id}:${entry.idx}`}
          topic={entry.topic !== undefined ? session.topics[String(entry.topic)] : undefined}
          topicId={entry.topic}
          courseId={courseId}
          position={position}
          total={total}
          onDone={onSchedaDone}
        />
      )}
      {entry && entry.t !== "domanda" && entry.t !== "scheda" && (
        <div className="rounded-2xl border p-4 text-sm">
          Voce di tipo sconosciuto ({entry.t}).
          <Button size="sm" className="ml-2" onClick={() => { const updated = markDone(session, entry.idx); setSession(updated); advanceFrom(updated.entries, entry.idx) }}>Salta</Button>
        </div>
      )}

      {!entry && (
        <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6 text-center space-y-3">
          <p className="font-semibold">Hai completato tutte le voci della sessione.</p>
          {answered.length > 0 && <p className="text-sm text-neutral-500">{answered.filter((r) => r.score >= 0.7).length} giuste su {answered.length} in questa visita.</p>}
          {finishing && <p role="status" className="text-sm">Salvataggio della sessione...</p>}
          {!finishing && !finishError && <Button className="min-h-12" onClick={doFinish}>Concludi e vedi il riepilogo</Button>}
        </div>
      )}

      {finishError && (
        <div role="alert" className="mt-4 rounded-2xl border border-error-300 bg-error-50 dark:bg-error-900/20 p-4 text-sm">
          <p>Impossibile salvare la fine della sessione: {finishError}</p>
          <Button size="sm" className="mt-2" onClick={doFinish} disabled={finishing}>Riprova il salvataggio</Button>
        </div>
      )}

      {focusTopic && session.topics[String(focusTopic)]?.name && (
        <p className="mt-4 text-xs text-neutral-500">Sessione mirata su: <MathInline content={session.topics[String(focusTopic)].name} /></p>
      )}
    </div>
  )
}
