import { useParams, useSearchParams, useNavigate } from "react-router-dom"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useState, useEffect, useCallback, useRef } from "react"
import { ArrowLeft, Play, Pause, SkipForward, RotateCcw, Flag, Target, Zap, Heart, X, Check, Loader2, Volume2, VolumeX, Settings, ChevronDown, ChevronUp, HelpCircle, Brain } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { api } from "@/lib/api"
import { useSessionStore } from "@/store/session"
import { cn } from "@/lib/utils"
import { formatDistanceToNow, parseISO } from "date-fns"
import { it } from "date-fns/locale"
import {
  WarmupPhase,
  LearnPhase,
  PracticePhase,
  BossPhase,
  CooldownPhase,
  CompletePhase,
  StatCard,
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
  topics: Record<number, any>
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

export function Studio() {
  const { courseId } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const duration = Number(searchParams.get("duration")) || 45
  const courseIdNum = Number(courseId)

  const { currentSession, startSession, endSession, cancelSession, updateSessionProgress } = useSessionStore()

  // Course data
  const { data: course } = useQuery({
    queryKey: ["course", courseIdNum],
    queryFn: () => api.getCourse(courseIdNum),
    enabled: !!courseIdNum,
  })

  // Session state
  const [phase, setPhase] = useState<SessionPhase>("warmup")
  const [phaseProgress, setPhaseProgress] = useState(0)
  const [currentEntryIndex, setCurrentEntryIndex] = useState(0)
  const [showAnswer, setShowAnswer] = useState(false)
  const [confidence, setConfidence] = useState(3)
  const [xpEarned, setXpEarned] = useState(0)
  const [streak, setStreak] = useState(0)
  const [combo, setCombo] = useState(0)
  const [questionsAnswered, setQuestionsAnswered] = useState(0)
  const [correctAnswers, setCorrectAnswers] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [sessionData, setSessionData] = useState<SessionData | null>(null)

  // Timer with requestAnimationFrame for precise timing
  const timerRef = useRef<number | null>(null)
  const startTimeRef = useRef<number>(0)
  const durationMsRef = useRef<number>(0)
  const animationFrameRef = useRef<number | null>(null)

  const currentPhaseConfig = PHASE_CONFIG[phase as SessionPhase]
  const totalPhases = PHASE_ORDER.length - 1
  const currentPhaseIndex = PHASE_ORDER.indexOf(phase)

  // Get entries for current phase
  const getPhaseEntries = useCallback((phaseName: SessionPhase): SessionEntry[] => {
    if (!sessionData) return []
    return sessionData.entries.filter((e) => {
      if (phaseName === "warmup" || phaseName === "practice" || phaseName === "boss") {
        return e.t === "domanda" && (!e.boss || phaseName === "boss") && (e.boss || phaseName !== "boss")
      }
      if (phaseName === "learn") {
        return e.t === "scheda"
      }
      return false
    })
  }, [sessionData])

  const currentPhaseEntries = getPhaseEntries(phase)

  // Timer using requestAnimationFrame for precise sync
  const startTimer = useCallback((phaseDurationMinutes: number) => {
    durationMsRef.current = phaseDurationMinutes * 60 * 1000
    startTimeRef.current = performance.now()

    const tick = () => {
      const elapsed = performance.now() - startTimeRef.current
      const progress = Math.min((elapsed / durationMsRef.current) * 100, 100)
      setPhaseProgress(progress)

      if (progress >= 100) {
        advancePhase()
      } else {
        animationFrameRef.current = requestAnimationFrame(tick)
      }
    }

    animationFrameRef.current = requestAnimationFrame(tick)
  }, [])

  const stopTimer = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }
  }, [])

  useEffect(() => {
    if (phase === "complete" || phase === "cooldown") {
      stopTimer()
      setPhaseProgress(0)
      return
    }

    const config = PHASE_CONFIG[phase]
    if (config.duration === 0) {
      setPhaseProgress(0)
      return
    }

    startTimer(config.duration)

    return () => stopTimer()
  }, [phase, startTimer, stopTimer])

  const advancePhase = useCallback(() => {
    stopTimer()
    const nextIndex = PHASE_ORDER.indexOf(phase) + 1
    if (nextIndex < PHASE_ORDER.length) {
      setPhase(PHASE_ORDER[nextIndex])
      setCurrentEntryIndex(0)
      setShowAnswer(false)
      setConfidence(3)
      setPhaseProgress(0)
    }
  }, [phase, stopTimer])

  // Create session mutation
  const createSessionMutation = useMutation({
    mutationFn: () => api.createSession(courseIdNum, duration),
    onSuccess: (data) => {
      setSessionData(data)
      startSession(courseIdNum, duration, data.id, data.entries)
      // Start with warmup phase entries
      const warmupEntries = data.entries.filter((e: SessionEntry) => e.t === "domanda" && !e.boss)
      if (warmupEntries.length > 0) {
        setPhase("warmup")
        setCurrentEntryIndex(0)
      } else {
        // No warmup, go to learn
        setPhase("learn")
      }
    },
    onError: (error) => {
      console.error("Failed to create session:", error)
      alert("Impossibile avviare la sessione: " + error.message)
    },
  })

  // Answer mutation
  const answerMutation = useMutation({
    mutationFn: ({ sid, payload }: { sid: number; payload: AnswerPayload }) =>
      api.answerSession(sid, payload),
    onSuccess: (result, variables) => {
      const isCorrect = (result.score || 0) >= 0.7
      setShowAnswer(true)
      setQuestionsAnswered((prev) => prev + 1)
      if (isCorrect) {
        setCorrectAnswers((prev) => prev + 1)
        setStreak((prev) => prev + 1)
        setCombo((prev) => prev + 1)
        const xpGain = result.xp || (10 + Math.min(combo * 5, 50))
        setXpEarned((prev) => prev + xpGain)
        updateSessionProgress({ xpEarned: xpEarned + xpGain, questionsAnswered: questionsAnswered + 1, correctAnswers: correctAnswers + 1 })
      } else {
        setStreak(0)
        setCombo(0)
        updateSessionProgress({ questionsAnswered: questionsAnswered + 1 })
      }
    },
    onError: (error) => {
      console.error("Failed to answer:", error)
      alert("Errore nella risposta: " + error.message)
    },
  })

  // Reveal mutation
  const revealMutation = useMutation({
    mutationFn: ({ sid, idx }: { sid: number; idx: number }) => api.revealSession(sid, idx),
    onSuccess: () => {
      setShowAnswer(true)
    },
    onError: (error) => {
      console.error("Failed to reveal:", error)
    },
  })

  // Finish mutation
  const finishMutation = useMutation({
    mutationFn: (sid: number) => api.finishSession(sid),
    onSuccess: (result) => {
      setXpEarned(result.xp || xpEarned)
      setStreak(result.streak || streak)
      setQuestionsAnswered(result.answered || questionsAnswered)
      setCorrectAnswers(result.correct || correctAnswers)
      setPhase("cooldown")
      updateSessionProgress({
        xpEarned: result.xp || xpEarned,
        questionsAnswered: result.answered || questionsAnswered,
        correctAnswers: result.correct || correctAnswers,
      })
      // Store session result for cooldown
      setSessionData((prev) => prev ? { ...prev, ...result } : null)
    },
    onError: (error) => {
      console.error("Failed to finish session:", error)
      alert("Errore nel completamento: " + error.message)
    },
  })

  const handleStartSession = () => {
    createSessionMutation.mutate()
  }

  const handleAnswer = (isCorrect: boolean, conf: number, answerData?: { choice?: number; text?: string }) => {
    if (!sessionData) return
    const entry = currentPhaseEntries[currentEntryIndex]
    if (!entry || entry.t !== "domanda" || !entry.question) return

    const payload: AnswerPayload = {
      idx: entry.id,
      confidence: conf,
      seconds: 0, // Could track actual time
    }

    if (entry.question.kind === "multipla" || entry.question.kind === "vero_falso") {
      payload.choice = answerData?.choice
    } else {
      payload.text = answerData?.text
    }

    answerMutation.mutate({ sid: sessionData.id, payload })
  }

  const handleNext = () => {
    if (currentEntryIndex < currentPhaseEntries.length - 1) {
      setCurrentEntryIndex((prev) => prev + 1)
      setShowAnswer(false)
      setConfidence(3)
    } else {
      advancePhase()
    }
  }

  const handleReveal = async () => {
    if (!sessionData) return
    const entry = currentPhaseEntries[currentEntryIndex]
    if (!entry || entry.t !== "domanda") return
    await revealMutation.mutateAsync({ sid: sessionData.id, idx: entry.id })
  }

  const handleFinish = () => {
    if (!sessionData) return
    finishMutation.mutate(sessionData.id)
  }

  const handleCooldownComplete = () => {
    setPhase("complete")
    if (sessionData) {
      endSession({
        xpEarned: xpEarned,
        questionsAnswered: questionsAnswered,
        correctAnswers: correctAnswers,
      })
    }
  }

  if (!course) return <div className="flex items-center justify-center h-64">Caricamento...</div>

  // Auto-start session if not already started
  useEffect(() => {
    if (!currentSession && !createSessionMutation.isPending) {
      handleStartSession()
    }
  }, [courseIdNum, currentSession, createSessionMutation.isPending])

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
        {createSessionMutation.isPending && (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-accent-500" />
            <span className="ml-2 text-neutral-500">Creazione sessione...</span>
          </div>
        )}

        {sessionData && !createSessionMutation.isPending && (
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
                onSetShowAnswer={setShowAnswer}
                onSetConfidence={setConfidence}
                onReveal={handleReveal}
                isLoading={answerMutation.isPending || revealMutation.isPending}
              />
            )}
            {phase === "learn" && currentPhaseEntries.length > 0 && (
              <LearnPhase
                entries={currentPhaseEntries}
                currentIndex={currentEntryIndex}
                showAnswer={showAnswer}
                confidence={confidence}
                onAnswer={handleAnswer}
                onSetShowAnswer={setShowAnswer}
                isLoading={answerMutation.isPending}
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
                onSetShowAnswer={setShowAnswer}
                onSetConfidence={setConfidence}
                onReveal={handleReveal}
                isLoading={answerMutation.isPending || revealMutation.isPending}
                xpEarned={xpEarned}
                streak={streak}
                combo={combo}
                questionsAnswered={questionsAnswered}
                correctAnswers={correctAnswers}
              />
            )}
            {phase === "boss" && currentPhaseEntries.length > 0 && (
              <BossPhase
                entry={currentPhaseEntries[0]}
                showAnswer={showAnswer}
                onAnswer={handleAnswer}
                onSetShowAnswer={setShowAnswer}
                isLoading={answerMutation.isPending}
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
                courseId={courseId || ""}
                duration={duration}
                verdict={sessionData.ended_at ? "Hai completato la sessione. I risultati sono stati salvati." : "Sessione completata!"}
                nextRecommendations={[]}
              />
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
                <Button onClick={advancePhase} className="mt-4">Vai al defaticamento</Button>
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
            <Button
              size="lg"
              className="flex-1 sm:flex-none min-w-[160px]"
              onClick={showAnswer ? handleNext : () => handleAnswer(true, confidence)}
              disabled={!showAnswer && phase !== "learn" || answerMutation.isPending}
            >
              {showAnswer ? (
                currentEntryIndex < currentPhaseEntries.length - 1
                  ? "Avanti"
                  : "Fase successiva"
              ) : (
                "Conferma risposta"
              )}
            </Button>
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