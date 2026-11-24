import { useParams, useSearchParams, useNavigate } from "react-router-dom"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import { ArrowLeft, RotateCcw, Flag, Target, Zap, Heart, Check, Loader2, Brain } from "lucide-react"
import { Button } from "@/components/ui/button"
import { api } from "@/lib/api"
import { useSessionStore } from "@/store/session"
import { cn } from "@/lib/utils"
import {
  WarmupPhase,
  LearnPhase,
  PracticePhase,
  BossPhase,
  CooldownPhase,
  CompletePhase,
  type QuestionResult,
  type SessionEntry,
  type PhaseConfig,
} from "@/components/studio/phases"
import { RadioGroup, RadioGroupItem } from "@radix-ui/react-radio-group"

type SessionPhase = "warmup" | "learn" | "practice" | "boss" | "cooldown" | "complete"

interface SessionData {
  id: number
  course_id: number
  minutes: number
  started_at: string
  ended_at?: string
  xp: number
  entries: SessionEntry[]
  topics: Record<number, { name: string; summary_md: string }>
  answered?: number
  correct?: number
  streak?: number
}

const PHASE_CONFIG: Record<SessionPhase, PhaseConfig> = {
  warmup: { label: "Riscaldamento", icon: Zap, color: "text-warning-500", bg: "bg-warning-50 dark:bg-warning-900/20", duration: 2 },
  learn: { label: "Impara", icon: Brain, color: "text-accent-500", bg: "bg-accent-50 dark:bg-accent-900/20", duration: 60 },
  practice: { label: "Esercitati", icon: Target, color: "text-success-500", bg: "bg-success-50 dark:bg-success-900/20", duration: 30 },
  boss: { label: "Boss Finale", icon: Flag, color: "text-error-500", bg: "bg-error-50 dark:bg-error-900/20", duration: 8 },
  cooldown: { label: "Defaticamento", icon: Heart, color: "text-neutral-500", bg: "bg-neutral-50 dark:bg-neutral-900/20", duration: 2 },
  complete: { label: "Completato", icon: Check, color: "text-success-500", bg: "bg-success-50 dark:bg-success-900/20", duration: 0 },
}

const PHASE_ORDER: SessionPhase[] = ["warmup", "learn", "practice", "boss", "cooldown", "complete"]

interface AnswerPayload {
  idx: number
  choice?: number
  text?: string
  confidence: number
  seconds: number
}

function groupSessionEntries(session: SessionData | null) {
  const entries = (session?.entries ?? []).map((entry, idx) => ({ ...entry, idx }))
  const questions = entries.filter((entry) => entry.t === "domanda")
  const explicitBoss = questions.filter((entry) => entry.boss)
  const regularQuestions = questions.filter((entry) => !entry.boss)
  const recalls = regularQuestions.filter((entry) => entry.question?.kind === "richiamo")
  const nonRecalls = regularQuestions.filter((entry) => entry.question?.kind !== "richiamo")
  const fallbackBoss = nonRecalls.findLast(
    (entry) => (entry.question?.difficulty ?? 0) >= 3 || entry.question?.kind === "aperta"
  ) ?? nonRecalls.at(-1)
  const boss = explicitBoss.length > 0 ? explicitBoss : fallbackBoss ? [fallbackBoss] : []
  const bossIndices = new Set(boss.map((entry) => entry.idx))
  const regular = regularQuestions.filter((entry) => !bossIndices.has(entry.idx))
  const warmup = recalls.length > 0 ? recalls : regular.slice(0, 2)
  const warmupIndices = new Set(warmup.map((entry) => entry.idx))
  const practice = regular.filter((entry) => !warmupIndices.has(entry.idx))
  const learn = entries.filter((entry) => entry.t === "scheda").map((entry) => {
    const topic = entry.topic === undefined ? undefined : session?.topics?.[entry.topic]
    return topic ? { ...entry, scheda: { ...entry.scheda, title: topic.name, content: topic.summary_md } } : entry
  })

  return { warmup, learn, practice, boss, cooldown: [], complete: [] }
}

export function Studio() {
  const { courseId } = useParams()
  const [searchParams] = useSearchParams()
  const duration = Number(searchParams.get("duration")) || 45
  const topic = searchParams.get("topic") ?? ""
  const topicId = Number(topic)
  const focusTopic = /^\d+$/.test(topic) && Number.isSafeInteger(topicId) && topicId > 0 ? topicId : undefined

  return <StudioSession key={`${courseId}:${duration}:${focusTopic}`} courseId={Number(courseId)} duration={duration} focusTopic={focusTopic} />
}

function StudioSession({ courseId, duration, focusTopic }: { courseId: number; duration: number; focusTopic?: number }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { currentSession, startSession, endSession, updateSessionProgress } = useSessionStore()

  useEffect(() => {
    if (!courseId) navigate("/corsi", { replace: true })
  }, [courseId, navigate])

  const { data: course, isLoading: courseLoading, isError: courseError, refetch: refetchCourse } = useQuery({
    queryKey: ["course", courseId],
    queryFn: () => api.getCourse(courseId),
    enabled: !!courseId,
  })

  const [phase, setPhase] = useState<SessionPhase>("warmup")
  const [phaseProgress, setPhaseProgress] = useState(0)
  const [currentEntryIndex, setCurrentEntryIndex] = useState(0)
  const [schedaConfirmed, setSchedaConfirmed] = useState(false)
  const [questionResults, setQuestionResults] = useState<Record<number, QuestionResult>>({})
  const [confidence, setConfidence] = useState(3)
  const [xpEarned, setXpEarned] = useState(0)
  const [streak, setStreak] = useState(0)
  const [combo, setCombo] = useState(0)
  const [questionsAnswered, setQuestionsAnswered] = useState(0)
  const [correctAnswers, setCorrectAnswers] = useState(0)
  const [sessionData, setSessionData] = useState<SessionData | null>(null)
  const creationRequested = useRef(false)
  const finishRequested = useRef(false)

  const currentPhaseConfig = PHASE_CONFIG[phase]
  const totalPhases = PHASE_ORDER.length - 1
  const currentPhaseIndex = PHASE_ORDER.indexOf(phase)
  const phaseEntries = useMemo(() => groupSessionEntries(sessionData), [sessionData])
  const currentPhaseEntries = phaseEntries[phase]
  const currentEntry = currentPhaseEntries[currentEntryIndex]
  const questionResult = currentEntry ? questionResults[currentEntry.idx] : undefined
  const showAnswer = phase === "learn" ? schedaConfirmed : Boolean(questionResult)

  const resumeId = currentSession?.courseId === courseId &&
    (focusTopic === undefined || currentSession.focusTopic === focusTopic)
    ? currentSession.backendId : undefined
  const resumeQuery = useQuery<SessionData>({
    queryKey: ["studioSession", resumeId],
    queryFn: () => api.getSession(resumeId!),
    enabled: Boolean(resumeId) && !sessionData,
    staleTime: 0,
  })

  const openSession = useCallback((data: SessionData) => {
    setSessionData(data)
    setPhase(data.ended_at ? "cooldown" : groupSessionEntries(data).warmup.length > 0 ? "warmup" : "learn")
  }, [])

  const { mutate: createSession, isPending: isCreating, isError: createFailed } = useMutation<SessionData>({
    mutationFn: () => api.createSession(courseId, duration, focusTopic),
  })

  const requestSession = useCallback(() => {
    createSession(undefined, {
      onSuccess: (data) => {
        startSession(courseId, duration, data.id, data.entries, focusTopic)
        openSession(data)
      },
    })
  }, [createSession, startSession, courseId, duration, focusTopic, openSession])

  useEffect(() => {
    if (sessionData || !course || creationRequested.current) return
    if (resumeId) {
      const data = resumeQuery.data
      if (data && !resumeQuery.isFetching && !resumeQuery.isError) {
        openSession(data)
        setXpEarned(data.xp ?? currentSession?.xpEarned ?? 0)
        setStreak(data.streak ?? 0)
        setQuestionsAnswered(data.answered ?? currentSession?.questionsAnswered ?? 0)
        setCorrectAnswers(data.correct ?? currentSession?.correctAnswers ?? 0)
      }
      return
    }

    creationRequested.current = true
    requestSession()
  }, [sessionData, course, resumeId, resumeQuery.data, resumeQuery.isFetching, resumeQuery.isError, currentSession, openSession, requestSession])

  const saveQuestionResult = (idx: number, result: QuestionResult) => {
    setQuestionResults((previous) => ({ ...previous, [idx]: result }))
  }

  const answerMutation = useMutation({
    mutationFn: ({ sid, payload, images }: { sid: number; payload: AnswerPayload; images?: string[] }) => {
      if (images?.length) {
        const { idx, text, confidence, seconds } = payload
        return api.photoSession(sid, { idx, text, confidence, seconds, images })
      }
      return api.answerSession(sid, payload)
    },
    onSuccess: (result: QuestionResult, { sid, payload }) => {
      saveQuestionResult(payload.idx, result)
      const isCorrect = (result.score ?? 0) >= 0.7
      const xp = xpEarned + (result.xp ?? (isCorrect ? 10 + Math.min(combo * 5, 50) : 0))
      const answered = questionsAnswered + 1
      const correct = correctAnswers + Number(isCorrect)
      setXpEarned(xp)
      setQuestionsAnswered(answered)
      setCorrectAnswers(correct)
      setStreak(isCorrect ? streak + 1 : 0)
      setCombo(isCorrect ? combo + 1 : 0)
      if (useSessionStore.getState().currentSession?.backendId === sid) {
        updateSessionProgress({ xpEarned: xp, questionsAnswered: answered, correctAnswers: correct })
      }
    },
  })

  const revealMutation = useMutation({
    mutationFn: ({ sid, idx }: { sid: number; idx: number }) => api.revealSession(sid, idx),
    onSuccess: (result: QuestionResult, { idx }) => saveQuestionResult(idx, result),
  })

  const { mutate: finishSession, isPending: isFinishing, isError: finishFailed } = useMutation({
    mutationFn: (sid: number) => api.finishSession(sid),
    onSuccess: (result: Partial<SessionData>, sid) => {
      const xp = result.xp ?? xpEarned
      const answered = result.answered ?? questionsAnswered
      const correct = result.correct ?? correctAnswers
      setXpEarned(xp)
      setStreak(result.streak ?? streak)
      setQuestionsAnswered(answered)
      setCorrectAnswers(correct)
      setSessionData((previous) => previous ? { ...previous, ...result } : null)
      if (useSessionStore.getState().currentSession?.backendId === sid) {
        updateSessionProgress({ xpEarned: xp, questionsAnswered: answered, correctAnswers: correct })
      }
      setPhase("cooldown")
      setPhaseProgress(0)
      void queryClient.invalidateQueries({ queryKey: ["plan"] })
      void queryClient.invalidateQueries({ queryKey: ["studioSession", sid] })
    },
    onError: () => { finishRequested.current = false },
  })

  const isQuestionPending = answerMutation.isPending || revealMutation.isPending
  const isSessionBusy = isQuestionPending || isFinishing

  const advancePhase = useCallback(() => {
    if (!sessionData || isSessionBusy) return
    const nextPhase = PHASE_ORDER[PHASE_ORDER.indexOf(phase) + 1]
    if (nextPhase === "cooldown") {
      if (finishRequested.current) return
      finishRequested.current = true
      finishSession(sessionData.id)
    } else if (nextPhase && nextPhase !== "complete") {
      setPhase(nextPhase)
      setCurrentEntryIndex(0)
      setSchedaConfirmed(false)
      setConfidence(3)
      setPhaseProgress(0)
    }
  }, [sessionData, isSessionBusy, phase, finishSession])

  const sessionId = sessionData?.id
  useEffect(() => {
    if (!sessionId || phase === "cooldown" || phase === "complete") return
    const startedAt = performance.now()
    const durationMs = PHASE_CONFIG[phase].duration * 60_000
    let frame: number
    const tick = (now: number) => {
      const progress = Math.min((now - startedAt) / durationMs * 100, 100)
      setPhaseProgress(progress)
      if (progress < 100) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [phase, sessionId])

  useEffect(() => {
    if (phaseProgress >= 100 && !finishFailed) advancePhase()
  }, [phaseProgress, advancePhase, finishFailed])

  const handleAnswer = (
    _isCorrect: boolean,
    conf: number,
    answerData?: { choice?: number; text?: string; photos?: string[] },
  ) => {
    if (!sessionData || !currentEntry || currentEntry.t !== "domanda" || showAnswer || isSessionBusy) return

    const payload: AnswerPayload = {
      idx: currentEntry.idx,
      confidence: conf,
      seconds: 0,
      choice: answerData?.choice,
      text: answerData?.text,
    }
    answerMutation.mutate({ sid: sessionData.id, payload, images: answerData?.photos })
  }

  const handleNext = () => {
    if (isSessionBusy) return
    if (currentEntryIndex < currentPhaseEntries.length - 1) {
      setCurrentEntryIndex((prev) => prev + 1)
      setSchedaConfirmed(false)
      setConfidence(3)
    } else {
      advancePhase()
    }
  }

  const handleReveal = () => {
    if (!sessionData || !currentEntry || currentEntry.t !== "domanda" || showAnswer || isSessionBusy) return
    revealMutation.mutate({ sid: sessionData.id, idx: currentEntry.idx })
  }

  const handleCooldownComplete = () => {
    setPhase("complete")
    endSession({ xpEarned, questionsAnswered, correctAnswers })
  }

  if (courseLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-neutral-500">
        <Loader2 className="h-8 w-8 animate-spin text-accent-500" />
        <p className="text-sm">Caricamento sessione di studio...</p>
      </div>
    )
  }

  if (courseError || !course) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center space-y-4">
        <p className="text-neutral-600 dark:text-neutral-400">Impossibile avviare lo studio per il corso #{courseId}.</p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate("/corsi")}>Torna ai corsi</Button>
          <Button onClick={() => refetchCourse()}>Riprova</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="h-[calc(100vh-140px)] flex flex-col">
      {/* Top Bar */}
      <div className="flex items-center justify-between p-4 border-b border-neutral-200 dark:border-neutral-700">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(`/corsi/${courseId}`)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="font-semibold text-lg">{course.fullname}</h1>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              Sessione {duration} min · Fase {currentPhaseIndex + 1}/{totalPhases}
            </p>
          </div>
        </div>

        {/* Phase indicator */}
        <div className="flex items-center gap-2">
          {PHASE_ORDER.slice(0, -1).map((p, i) => {
            const Icon = PHASE_CONFIG[p].icon
            return (
              <div key={p} className={cn(
                "flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium transition-all",
                i < currentPhaseIndex ? "bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-400" :
                i === currentPhaseIndex ? `${currentPhaseConfig.bg} ${currentPhaseConfig.color}` :
                "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
              )}>
                {Icon && <Icon className="h-3 w-3" />}
                {p !== "warmup" && <span>{PHASE_CONFIG[p].label}</span>}
              </div>
            )
          })}
        </div>

        {/* XP & Streak */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-neutral-100 dark:bg-neutral-800">
            <Zap className="h-4 w-4 text-warning-500" />
            <span className="font-mono font-semibold">{xpEarned} XP</span>
          </div>
          <div className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-neutral-100 dark:bg-neutral-800">
            <Heart className="h-4 w-4 text-error-500" />
            <span className="font-mono font-semibold">{streak}</span>
          </div>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="h-2 bg-neutral-200 dark:bg-neutral-700 relative overflow-hidden">
        <div
          className="h-full bg-accent-500 transition-all duration-500 ease-out"
          style={{ width: `${((currentPhaseIndex) / (totalPhases - 1) + (phaseProgress / 100) * (1 / (totalPhases - 1))) * 100}%` }}
        />
        {/* Phase markers */}
        {PHASE_ORDER.slice(0, -1).map((p, i) => (
          <div
            key={p}
            className="absolute top-0 bottom-0 w-0.5 bg-white/50"
            style={{ left: `${(i / (totalPhases - 1)) * 100}%` }}
          />
        ))}
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {(isCreating || (resumeId && resumeQuery.isFetching && !sessionData)) && (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-accent-500" />
            <span className="ml-2 text-neutral-500">{resumeId ? "Caricamento sessione..." : "Creazione sessione..."}</span>
          </div>
        )}

        {!sessionData && (createFailed || resumeQuery.isError) && (
          <div role="alert" className="text-center py-12">
            <p>Impossibile caricare la sessione di studio.</p>
            <Button className="mt-4" onClick={() => resumeId ? resumeQuery.refetch() : requestSession()}>Riprova</Button>
          </div>
        )}

        {sessionData && !isCreating && (
          <>
            {phase === "warmup" && currentPhaseEntries.length > 0 && (
              <WarmupPhase
                entries={currentPhaseEntries}
                currentIndex={currentEntryIndex}
                showAnswer={showAnswer}
                confidence={confidence}
                currentPhaseConfig={currentPhaseConfig}
                onAnswer={handleAnswer}
                onNext={handleNext}
                onSetShowAnswer={setSchedaConfirmed}
                onSetConfidence={setConfidence}
                onReveal={handleReveal}
                result={questionResult}
                isLoading={isSessionBusy}
                sessionId={sessionData.id}
              />
            )}
            {phase === "learn" && currentPhaseEntries.length > 0 && (
              <LearnPhase
                entries={currentPhaseEntries}
                currentIndex={currentEntryIndex}
                showAnswer={showAnswer}
                confidence={confidence}
                onSetShowAnswer={setSchedaConfirmed}
                onNext={handleNext}
                isLoading={isSessionBusy}
              />
            )}
            {phase === "practice" && currentPhaseEntries.length > 0 && (
              <PracticePhase
                entries={currentPhaseEntries}
                currentIndex={currentEntryIndex}
                showAnswer={showAnswer}
                confidence={confidence}
                onAnswer={handleAnswer}
                onNext={handleNext}
                onSetShowAnswer={setSchedaConfirmed}
                onSetConfidence={setConfidence}
                onReveal={handleReveal}
                result={questionResult}
                isLoading={isSessionBusy}
                xpEarned={xpEarned}
                streak={streak}
                combo={combo}
                questionsAnswered={questionsAnswered}
                correctAnswers={correctAnswers}
                sessionId={sessionData.id}
              />
            )}
            {phase === "boss" && currentPhaseEntries.length > 0 && (
              <BossPhase
                entry={currentEntry}
                showAnswer={showAnswer}
                onAnswer={handleAnswer}
                onSetShowAnswer={setSchedaConfirmed}
                onNext={handleNext}
                result={questionResult}
                hasNext={currentEntryIndex < currentPhaseEntries.length - 1}
                isLoading={isSessionBusy}
                sessionId={sessionData.id}
              />
            )}
            {phase === "cooldown" && (
              <CooldownPhase
                xpEarned={xpEarned}
                streak={streak}
                questionsAnswered={questionsAnswered}
                correctAnswers={correctAnswers}
                topicsUp={sessionData.topics ? Object.values(sessionData.topics).slice(0, 5) : []}
                wrongItems={[]}
              />
            )}
            {phase === "complete" && (
              <CompletePhase
                xpEarned={xpEarned}
                streak={streak}
                questionsAnswered={questionsAnswered}
                correctAnswers={correctAnswers}
                courseId={String(courseId)}
                duration={duration}
                verdict="Hai completato la sessione. I risultati sono stati salvati."
                nextRecommendations={[]}
              />
            )}

            {(answerMutation.isError || revealMutation.isError) && !showAnswer && (
              <p role="alert" className="mt-4 text-center">Impossibile ottenere la correzione o la soluzione. Riprova.</p>
            )}
            {isFinishing && <p role="status" className="mt-4 text-center">Salvataggio della sessione...</p>}
            {finishFailed && (
              <div role="alert" className="mt-4 text-center">
                <p>Impossibile salvare il completamento della sessione.</p>
                <Button className="mt-2" onClick={advancePhase}>Riprova il salvataggio</Button>
              </div>
            )}

            {/* Phase empty states */}
            {phase === "learn" && currentPhaseEntries.length === 0 && (
              <div className="text-center py-12">
                <Brain className="h-12 w-12 mx-auto text-neutral-400 mb-4" />
                <h3 className="text-lg font-medium text-neutral-900 dark:text-neutral-100 mb-2">Nessuna lezione nuova</h3>
                <p className="text-neutral-500">Tutti gli argomenti di questa sessione sono già stati studiati.</p>
                <Button onClick={advancePhase} className="mt-4">Vai alla fase successiva</Button>
              </div>
            )}
            {phase === "practice" && currentPhaseEntries.length === 0 && (
              <div className="text-center py-12">
                <Target className="h-12 w-12 mx-auto text-neutral-400 mb-4" />
                <h3 className="text-lg font-medium text-neutral-900 dark:text-neutral-100 mb-2">Nessuna domanda di esercizio</h3>
                <p className="text-neutral-500">La sessione passa direttamente al Boss Finale.</p>
                <Button onClick={advancePhase} className="mt-4">Vai al Boss Finale</Button>
              </div>
            )}
            {phase === "boss" && currentPhaseEntries.length === 0 && (
              <div className="text-center py-12">
                <Flag className="h-12 w-12 mx-auto text-neutral-400 mb-4" />
                <h3 className="text-lg font-medium text-neutral-900 dark:text-neutral-100 mb-2">Nessun Boss Finale</h3>
                <p className="text-neutral-500">Non ci sono esercizi d'esame per questa sessione.</p>
                <Button onClick={advancePhase} disabled={isFinishing} className="mt-4">Vai al defaticamento</Button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Bottom Actions */}
      <div className="p-4 border-t border-neutral-200 dark:border-neutral-700 bg-white/50 dark:bg-neutral-950/50 backdrop-blur-sm">
        {phase !== "complete" && phase !== "cooldown" && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm text-neutral-500">Sicurezza:</span>
              <RadioGroup
                value={String(confidence)}
                onValueChange={(v) => setConfidence(Number(v))}
                className="flex gap-1"
                role="radiogroup"
                aria-label="Quanto sei sicuro della tua risposta?"
              >
                {[1, 2, 3, 4, 5].map((c) => (
                  <RadioGroupItem
                    key={c}
                    value={String(c)}
                    className={cn(
                      "w-8 h-8 rounded-full text-xs font-medium transition-all focus:outline-none focus:ring-2 focus:ring-accent-500",
                      "data-[state=checked]:bg-accent-500 data-[state=checked]:text-white",
                      "data-[state=unchecked]:bg-neutral-200 data-[state=unchecked]:text-neutral-500 data-[state=unchecked]:hover:bg-neutral-300 dark:data-[state=unchecked]:bg-neutral-700 dark:data-[state=unchecked]:text-neutral-400"
                    )}
                  >
                    {c}
                  </RadioGroupItem>
                ))}
              </RadioGroup>
            </div>
            {showAnswer && (
              <Button size="lg" onClick={handleNext} disabled={isSessionBusy} className="min-w-[160px]">
                {currentEntryIndex < currentPhaseEntries.length - 1 ? "Avanti" : "Fase successiva"}
              </Button>
            )}
          </div>
        )}

        {phase === "cooldown" && (
          <Button size="lg" className="w-full" onClick={handleCooldownComplete}>
            Vedi risultati finali
          </Button>
        )}

        {phase === "complete" && (
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => navigate(`/corsi/${courseId}`)}>
              Torna al corso
            </Button>
            <Button className="flex-1" onClick={() => navigate(`/studio/${courseId}?duration=${duration}`)}>
              <RotateCcw className="h-4 w-4 mr-1" />
              Nuova sessione
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
