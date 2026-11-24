import React, { useState, useEffect, useMemo } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  Clock,
  CheckCircle2,
  Send,
  ArrowLeft,
  BookOpen,
  Award,
  Sparkles,
  RotateCcw,
  Loader2,
  FileText,
  ChevronRight,
  ShieldAlert,
  Flame,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { MathMarkdown } from "@/components/ui/math-markdown"
import { PhotoUpload } from "@/components/camera/PhotoUpload"
import { api } from "@/lib/api"
import type { Simulation, ExamQuestion, SimulationGrading } from "@/types"
import { cn } from "@/lib/utils"

interface StudentAnswerState {
  testo: string
  scelta: number | null
  immagini: string[]
}

export function SimulazioneRunner() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  // Fetch simulation data
  const {
    data: simData,
    isLoading,
    error,
  } = useQuery<Simulation>({
    queryKey: ["simulation", id],
    queryFn: () => api.getSimulation(id!),
    enabled: !!id,
  })

  const rawQuestions: ExamQuestion[] = useMemo(() => {
    if (!simData) return []
    if (simData.domande && simData.domande.length > 0) return simData.domande
    if (simData.questions && simData.questions.length > 0) {
      return simData.questions.map((q) => ({
        parte: "Quesito",
        tipo: q.type || "aperta",
        punti: q.points || 5,
        testo_md: q.prompt,
        opzioni: q.options,
        soluzione_md: q.solution,
      }))
    }
    return []
  }, [simData])

  const totalMinutes = simData?.durata_min || simData?.duration_min || 60
  const totalSeconds = totalMinutes * 60

  // State: timer
  const [remainingSeconds, setRemainingSeconds] = useState<number>(totalSeconds)
  const [isTimerRunning, setIsTimerRunning] = useState<boolean>(true)
  const [elapsedMinutes, setElapsedMinutes] = useState<number>(0)

  // Answers state: mapped by question index
  const [answers, setAnswers] = useState<Record<number, StudentAnswerState>>({})

  // UI state
  const [selectedQuestionIndex, setSelectedQuestionIndex] = useState(0)
  const [showConfirmModal, setShowConfirmModal] = useState(false)
  const [gradingResult, setGradingResult] = useState<SimulationGrading | null>(null)

  // Synchronize timer duration once simulation data arrives
  useEffect(() => {
    if (simData) {
      const dur = (simData.durata_min || simData.duration_min || 60) * 60
      setRemainingSeconds(dur)
      setIsTimerRunning(true)
    }
  }, [simData])

  // Countdown timer effect
  useEffect(() => {
    if (!isTimerRunning || gradingResult) return

    const interval = window.setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          window.clearInterval(interval)
          setIsTimerRunning(false)
          return 0
        }
        return prev - 1
      })
      setElapsedMinutes((prev) => +(prev + 1 / 60).toFixed(2))
    }, 1000)

    return () => window.clearInterval(interval)
  }, [isTimerRunning, gradingResult])

  // Submit Mutation
  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error("ID simulazione mancante")
      const formattedAnswers = rawQuestions.map((q, idx) => {
        const a = answers[idx] || { testo: "", scelta: null, immagini: [] }
        return {
          testo: a.testo ? a.testo.trim() : null,
          scelta: q.tipo === "multipla" ? a.scelta : null,
          immagini: a.immagini || [],
        }
      })
      return api.submitSimulation(id, formattedAnswers, Math.max(1, Math.round(elapsedMinutes)))
    },
    onSuccess: (data: SimulationGrading) => {
      setIsTimerRunning(false)
      setGradingResult(data)
      setShowConfirmModal(false)
      queryClient.invalidateQueries({ queryKey: ["examProfile", simData?.course_id] })
      queryClient.invalidateQueries({ queryKey: ["simulation", id] })
    },
  })

  // Handlers for question answers
  const handleTextChange = (idx: number, val: string) => {
    setAnswers((prev) => ({
      ...prev,
      [idx]: {
        ...(prev[idx] || { scelta: null, immagini: [] }),
        testo: val,
      },
    }))
  }

  const handleChoiceChange = (idx: number, optIdx: number) => {
    setAnswers((prev) => ({
      ...prev,
      [idx]: {
        ...(prev[idx] || { testo: "", immagini: [] }),
        scelta: optIdx,
      },
    }))
  }

  const handlePhotosChange = (idx: number, photos: string[]) => {
    setAnswers((prev) => ({
      ...prev,
      [idx]: {
        ...(prev[idx] || { testo: "", scelta: null }),
        immagini: photos,
      },
    }))
  }

  // Formatting helpers
  const formatTime = (totalSecs: number) => {
    const mins = Math.floor(totalSecs / 60)
    const secs = totalSecs % 60
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`
  }

  const isWarningTime = remainingSeconds <= 600 // Less than 10 minutes

  // Compute how many questions have answers
  const answeredCount = useMemo(() => {
    return rawQuestions.filter((q, idx) => {
      const a = answers[idx]
      if (!a) return false
      if (q.tipo === "multipla") return a.scelta !== null && a.scelta !== undefined
      return (a.testo && a.testo.trim().length > 0) || (a.immagini && a.immagini.length > 0)
    }).length
  }, [answers, rawQuestions])

  const totalPoints = useMemo(() => {
    return rawQuestions.reduce((acc, q) => acc + (q.punti || 0), 0)
  }, [rawQuestions])

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <Loader2 className="h-10 w-10 animate-spin text-accent-500" />
        <p className="text-sm text-neutral-500">Caricamento simulazione d'esame...</p>
      </div>
    )
  }

  if (error || !simData) {
    return (
      <div className="max-w-md mx-auto py-16 text-center space-y-4">
        <ShieldAlert className="h-12 w-12 mx-auto text-rose-500" />
        <h2 className="text-lg font-bold text-neutral-900 dark:text-neutral-50">
          Simulazione non trovata
        </h2>
        <p className="text-xs text-neutral-500">
          Impossibile caricare i dati della prova d'esame richiesta.
        </p>
        <Button onClick={() => navigate(-1)} variant="outline" size="sm">
          Torna indietro
        </Button>
      </div>
    )
  }

  // --- SUBMIT LOADING OVERLAY ---
  if (submitMutation.isPending) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[65vh] space-y-6 text-center px-4">
        <div className="relative">
          <div className="h-20 w-20 rounded-full border-4 border-accent-200 border-t-accent-600 animate-spin" />
          <Award className="h-8 w-8 text-accent-600 absolute inset-0 m-auto" />
        </div>
        <div className="space-y-2 max-w-md">
          <h2 className="text-xl font-bold text-neutral-900 dark:text-neutral-50">
            Correzione d'esame in corso...
          </h2>
          <p className="text-sm text-neutral-500 dark:text-neutral-400 leading-relaxed">
            Il docente AI sta esaminando le risposte, verificando i calcoli matematici e leggendo le foto del quaderno.
          </p>
        </div>
      </div>
    )
  }

  // --- SCHEDA CORREZIONE / RISULTATO D'ESAME ---
  if (gradingResult) {
    const isPassed = gradingResult.superato
    const grade = gradingResult.voto_30

    return (
      <div className="max-w-4xl mx-auto space-y-6 pb-12 animate-in fade-in duration-300">
        {/* Top return bar */}
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(`/corsi/${simData.course_id}`)}
            className="gap-2 text-xs text-neutral-600 dark:text-neutral-400"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Torna al corso</span>
          </Button>
        </div>

        {/* Hero Score Card */}
        <Card
          className={cn(
            "overflow-hidden border-2 shadow-xl",
            isPassed
              ? "border-emerald-500/40 bg-linear-to-b from-emerald-500/5 to-transparent"
              : "border-rose-500/40 bg-linear-to-b from-rose-500/5 to-transparent"
          )}
        >
          <CardContent className="p-6 sm:p-8 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-xs px-2.5 py-0.5 font-bold uppercase",
                      isPassed
                        ? "border-emerald-500 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10"
                        : "border-rose-500 text-rose-600 dark:text-rose-400 bg-rose-500/10"
                    )}
                  >
                    {isPassed ? "Prova Superata" : "Prova Non Superata"}
                  </Badge>
                  <span className="text-xs text-neutral-400 font-mono">
                    Durata: {Math.max(1, Math.round(elapsedMinutes))} min
                  </span>
                </div>

                <h1 className="text-2xl sm:text-3xl font-extrabold text-neutral-900 dark:text-neutral-50 tracking-tight">
                  Esito: {simData.titolo || simData.title || "Simulazione d'Esame"}
                </h1>
                <p className="text-xs sm:text-sm text-neutral-500 dark:text-neutral-400">
                  Valutazione rigorosa basata sui criteri d'esame ufficiali del corso.
                </p>
              </div>

              {/* Big Grade Badge */}
              <div
                className={cn(
                  "flex flex-col items-center justify-center p-5 rounded-3xl min-w-[140px] text-center shadow-lg border",
                  isPassed
                    ? "bg-emerald-600 text-white border-emerald-400"
                    : "bg-rose-600 text-white border-rose-400"
                )}
              >
                <span className="text-3xs uppercase tracking-widest font-semibold opacity-90">
                  Voto Finale
                </span>
                <span className="text-4xl sm:text-5xl font-black font-mono">
                  {grade}
                </span>
                <span className="text-xs font-semibold opacity-85">su 30</span>
              </div>
            </div>

            <Separator />

            {/* Commento generale del docente */}
            <div className="space-y-2.5">
              <div className="flex items-center gap-2 text-xs font-bold uppercase text-neutral-700 dark:text-neutral-300">
                <Sparkles className="h-4 w-4 text-accent-500" />
                <span>Giudizio del Docente AI</span>
              </div>
              <div className="p-4 rounded-2xl bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-sm leading-relaxed text-neutral-900 dark:text-neutral-50">
                <MathMarkdown content={gradingResult.commento_md} />
              </div>
            </div>

            {/* Argomenti da ripassare */}
            {gradingResult.da_ripassare && gradingResult.da_ripassare.length > 0 && (
              <div className="space-y-2">
                <span className="text-xs font-bold uppercase text-neutral-600 dark:text-neutral-400 flex items-center gap-1.5">
                  <Flame className="h-3.5 w-3.5 text-amber-500" />
                  Argomenti critici da consolidare
                </span>
                <div className="flex flex-wrap gap-2">
                  {gradingResult.da_ripassare.map((topic, tIdx) => (
                    <Badge
                      key={tIdx}
                      variant="secondary"
                      className="text-xs px-2.5 py-1 bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20"
                    >
                      {topic}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Detailed Questions Comparison */}
        <div className="space-y-4">
          <h2 className="text-lg font-bold text-neutral-900 dark:text-neutral-50 flex items-center gap-2">
            <FileText className="h-5 w-5 text-accent-500" />
            Correzione Esercizio per Esercizio
          </h2>

          <div className="space-y-5">
            {rawQuestions.map((q, idx) => {
              const evalItem = gradingResult.valutazioni?.find((v) => v.indice === idx)
              const solItem = gradingResult.soluzioni?.[idx]
              const studentAnswer = answers[idx]
              const userGotPoints = evalItem?.punti ?? 0
              const maxPoints = solItem?.punti_max ?? q.punti ?? 0

              const isFullPoints = userGotPoints >= maxPoints && maxPoints > 0
              const isZeroPoints = userGotPoints === 0

              return (
                <Card
                  key={idx}
                  className="overflow-hidden border border-neutral-200 dark:border-neutral-800 shadow-sm"
                >
                  <CardHeader className="p-4 sm:p-5 bg-neutral-50/70 dark:bg-neutral-900/60 border-b border-neutral-100 dark:border-neutral-800 flex flex-row items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold bg-neutral-200 dark:bg-neutral-800 px-2 py-1 rounded-lg">
                        #{idx + 1}
                      </span>
                      <span className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                        {q.parte || `Domanda ${idx + 1}`}
                      </span>
                      <Badge variant="outline" className="text-2xs capitalize">
                        {q.tipo}
                      </Badge>
                    </div>

                    <Badge
                      variant="secondary"
                      className={cn(
                        "text-xs font-mono font-bold px-2.5 py-1",
                        isFullPoints
                          ? "bg-emerald-500/10 text-emerald-600 border border-emerald-500/20"
                          : isZeroPoints
                          ? "bg-rose-500/10 text-rose-600 border border-rose-500/20"
                          : "bg-amber-500/10 text-amber-600 border border-amber-500/20"
                      )}
                    >
                      {userGotPoints} / {maxPoints} pt
                    </Badge>
                  </CardHeader>

                  <CardContent className="p-4 sm:p-6 space-y-4">
                    {/* Testo domanda */}
                    <div className="space-y-1">
                      <span className="text-2xs font-semibold uppercase text-neutral-400">
                        Testo Quesito
                      </span>
                      <div className="text-sm">
                        <MathMarkdown content={q.testo_md || q.prompt || ""} />
                      </div>
                    </div>

                    <Separator />

                    {/* Risposta dello studente */}
                    <div className="space-y-2">
                      <span className="text-2xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">
                        La tua risposta consegnata
                      </span>

                      {q.tipo === "multipla" ? (
                        <div className="p-3 rounded-xl bg-neutral-100/70 dark:bg-neutral-800/60 text-xs font-medium">
                          {studentAnswer?.scelta !== null &&
                          studentAnswer?.scelta !== undefined &&
                          q.opzioni?.[studentAnswer.scelta] ? (
                            <span>{q.opzioni[studentAnswer.scelta]}</span>
                          ) : (
                            <span className="text-neutral-400 italic">
                              Nessuna opzione selezionata
                            </span>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {studentAnswer?.testo ? (
                            <div className="p-3.5 rounded-xl bg-neutral-100/70 dark:bg-neutral-800/60 text-xs font-mono whitespace-pre-wrap">
                              {studentAnswer.testo}
                            </div>
                          ) : (
                            <p className="text-xs text-neutral-400 italic">
                              Nessun testo digitato.
                            </p>
                          )}

                          {studentAnswer?.immagini && studentAnswer.immagini.length > 0 && (
                            <div className="space-y-1.5">
                              <span className="text-2xs text-neutral-400">
                                Foto svolgimento allegate ({studentAnswer.immagini.length}):
                              </span>
                              <div className="flex flex-wrap gap-2">
                                {studentAnswer.immagini.map((img, pIdx) => (
                                  <img
                                    key={pIdx}
                                    src={img}
                                    alt={`Foto ${pIdx + 1}`}
                                    className="h-16 w-16 object-cover rounded-xl border border-neutral-300 dark:border-neutral-700 shadow-2xs"
                                  />
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Feedback Docente */}
                    {evalItem?.feedback_md && (
                      <div className="p-3.5 rounded-2xl bg-accent-50/60 dark:bg-accent-950/20 border border-accent-200/80 dark:border-accent-900/40 text-xs sm:text-sm space-y-1">
                        <div className="font-semibold text-accent-700 dark:text-accent-300 flex items-center gap-1.5">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          <span>Feedback Docente</span>
                        </div>
                        <div className="leading-relaxed text-neutral-800 dark:text-neutral-200">
                          <MathMarkdown content={evalItem.feedback_md} />
                        </div>
                      </div>
                    )}

                    {/* Soluzione ufficiale */}
                    {(solItem?.soluzione_md || q.soluzione_md) && (
                      <div className="p-3.5 rounded-2xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-xs sm:text-sm space-y-1">
                        <div className="font-semibold text-neutral-700 dark:text-neutral-300 flex items-center gap-1.5">
                          <BookOpen className="h-3.5 w-3.5 text-neutral-500" />
                          <span>Soluzione Ufficiale Passo-Passo</span>
                        </div>
                        <div className="leading-relaxed">
                          <MathMarkdown
                            content={solItem?.soluzione_md || q.soluzione_md || ""}
                          />
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </div>

        {/* Bottom Actions */}
        <div className="pt-4 flex items-center justify-center gap-4">
          <Button
            onClick={() => navigate(`/corsi/${simData.course_id}`)}
            className="rounded-xl px-6 bg-accent-600 hover:bg-accent-700 text-white font-semibold"
          >
            Torna alla scheda del Corso
          </Button>

          <Button
            variant="outline"
            onClick={() => {
              setGradingResult(null)
              setAnswers({})
              setSelectedQuestionIndex(0)
              setRemainingSeconds(totalSeconds)
              setIsTimerRunning(true)
              setElapsedMinutes(0)
            }}
            className="rounded-xl gap-2"
          >
            <RotateCcw className="h-4 w-4" />
            <span>Rifai questa simulazione</span>
          </Button>
        </div>
      </div>
    )
  }

  // --- RUNNER VIEW (ESAME IN CORSO) ---
  const activeQ = rawQuestions[selectedQuestionIndex]
  const activeAnswer = answers[selectedQuestionIndex] || {
    testo: "",
    scelta: null,
    immagini: [],
  }

  return (
    <div className="max-w-4xl mx-auto space-y-5 pb-16">
      {/* Top Sticky Header with Timer & Actions */}
      <div className="sticky top-0 z-20 backdrop-blur-md bg-white/90 dark:bg-neutral-950/90 py-3.5 px-4 rounded-2xl border border-neutral-200/90 dark:border-neutral-800 shadow-md flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (
                window.confirm(
                  "Sei sicuro di voler uscire? I progressi non consegnati andranno persi."
                )
              ) {
                navigate(-1)
              }
            }}
            className="h-8 px-2 rounded-lg text-neutral-500 hover:text-neutral-900"
            title="Esci dalla simulazione"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>

          <div>
            <h1 className="text-sm sm:text-base font-bold text-neutral-900 dark:text-neutral-50 truncate max-w-[200px] sm:max-w-xs md:max-w-md">
              {simData.titolo || simData.title || "Simulazione d'Esame"}
            </h1>
            <p className="text-2xs text-neutral-500">
              {answeredCount} di {rawQuestions.length} risposte completate · {totalPoints} pt totali
            </p>
          </div>
        </div>

        {/* Real-time Timer Badge */}
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded-xl font-mono font-bold text-sm sm:text-base border transition-all",
              isWarningTime
                ? "bg-rose-500/15 border-rose-500 text-rose-600 dark:text-rose-400 animate-pulse shadow-rose-500/20 shadow-md"
                : "bg-neutral-100 dark:bg-neutral-900 border-neutral-300 dark:border-neutral-700 text-neutral-800 dark:text-neutral-100"
            )}
            title={isWarningTime ? "Attenzione! Mancano meno di 10 minuti" : "Tempo rimanente"}
          >
            <Clock className={cn("h-4 w-4", isWarningTime ? "text-rose-600" : "text-neutral-500")} />
            <span>{formatTime(remainingSeconds)}</span>
          </div>

          <Button
            type="button"
            onClick={() => setShowConfirmModal(true)}
            className="gap-1.5 text-xs font-semibold rounded-xl bg-accent-600 hover:bg-accent-700 text-white shadow-sm"
          >
            <Send className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Consegna Esame</span>
            <span className="sm:hidden">Consegna</span>
          </Button>
        </div>
      </div>

      {/* Questions Navigation Carousel / Pills */}
      <div className="flex items-center gap-2 overflow-x-auto py-1 px-1 scrollbar-none">
        {rawQuestions.map((q, idx) => {
          const a = answers[idx]
          const isAnswered =
            q.tipo === "multipla"
              ? a?.scelta !== null && a?.scelta !== undefined
              : (a?.testo && a.testo.trim().length > 0) || (a?.immagini && a.immagini.length > 0)
          const isCurrent = idx === selectedQuestionIndex

          return (
            <button
              key={idx}
              type="button"
              onClick={() => setSelectedQuestionIndex(idx)}
              className={cn(
                "h-9 min-w-9 px-2.5 rounded-xl text-xs font-mono font-bold flex items-center justify-center gap-1.5 transition-all border shrink-0",
                isCurrent
                  ? "bg-accent-600 border-accent-600 text-white shadow-sm scale-105"
                  : isAnswered
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400 hover:border-emerald-500"
                  : "bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-800 text-neutral-600 dark:text-neutral-400 hover:border-accent-300"
              )}
            >
              <span>#{idx + 1}</span>
              {isAnswered && !isCurrent && (
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
              )}
            </button>
          )
        })}
      </div>

      {/* Active Question Box */}
      {activeQ && (
        <Card className="border border-neutral-200 dark:border-neutral-800 shadow-md overflow-hidden rounded-3xl">
          <CardHeader className="p-5 sm:p-6 bg-neutral-50/80 dark:bg-neutral-900/60 border-b border-neutral-100 dark:border-neutral-800/80 flex flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="h-7 px-2.5 rounded-lg bg-neutral-200 dark:bg-neutral-800 font-mono text-xs font-bold flex items-center">
                Quesito {selectedQuestionIndex + 1} di {rawQuestions.length}
              </span>
              <span className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                {activeQ.parte || "Esercizio"}
              </span>
              <Badge variant="outline" className="text-2xs capitalize">
                {activeQ.tipo === "multipla"
                  ? "Scelta multipla"
                  : activeQ.tipo === "esercizio"
                  ? "Esercizio numerico"
                  : "Risposta aperta"}
              </Badge>
            </div>

            <Badge variant="secondary" className="text-xs font-mono font-semibold">
              {activeQ.punti || 0} punti
            </Badge>
          </CardHeader>

          <CardContent className="p-5 sm:p-7 space-y-6">
            {/* Testo Domanda con Formule LaTeX */}
            <div className="space-y-2">
              <span className="text-2xs font-semibold uppercase tracking-wider text-neutral-400">
                Testo della prova
              </span>
              <div className="text-sm sm:text-base leading-relaxed text-neutral-900 dark:text-neutral-100 select-text">
                <MathMarkdown content={activeQ.testo_md || activeQ.prompt || ""} />
              </div>
            </div>

            <Separator />

            {/* Sezione Risposta in base al tipo */}
            {activeQ.tipo === "multipla" ? (
              <div className="space-y-3">
                <span className="text-xs font-bold text-neutral-700 dark:text-neutral-300">
                  Seleziona l'opzione corretta:
                </span>
                <div className="space-y-2">
                  {(activeQ.opzioni || activeQ.options || []).map((opt, optIdx) => {
                    const isSelected = activeAnswer.scelta === optIdx

                    return (
                      <button
                        key={optIdx}
                        type="button"
                        onClick={() => handleChoiceChange(selectedQuestionIndex, optIdx)}
                        className={cn(
                          "w-full text-left p-4 rounded-2xl border transition-all flex items-start gap-3",
                          isSelected
                            ? "bg-accent-50 dark:bg-accent-950/30 border-accent-500 shadow-xs ring-1 ring-accent-500 text-neutral-900 dark:text-neutral-50"
                            : "bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-800 text-neutral-700 dark:text-neutral-300 hover:border-accent-300"
                        )}
                      >
                        <span
                          className={cn(
                            "h-6 w-6 rounded-full flex items-center justify-center font-mono text-xs font-bold shrink-0 mt-0.5 border",
                            isSelected
                              ? "bg-accent-600 text-white border-accent-600"
                              : "border-neutral-300 text-neutral-500 dark:border-neutral-700"
                          )}
                        >
                          {String.fromCharCode(65 + optIdx)}
                        </span>
                        <div className="flex-1 text-sm leading-relaxed">
                          <MathMarkdown content={opt} />
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Textarea risposta testuale */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-neutral-700 dark:text-neutral-300">
                      Risposta digitata (motivazioni, passaggi o risultati numerici):
                    </label>
                    <span className="text-2xs text-neutral-400">
                      Supporta notazione standard
                    </span>
                  </div>
                  <textarea
                    rows={5}
                    value={activeAnswer.testo || ""}
                    onChange={(e) =>
                      handleTextChange(selectedQuestionIndex, e.target.value)
                    }
                    placeholder="Scrivi qui la spiegazione, i passaggi algebrici o il risultato..."
                    className="w-full p-4 rounded-2xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-sm text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-accent-500 leading-relaxed font-sans"
                  />
                </div>

                {/* Integrazione PhotoUpload per calcoli su quaderno */}
                <div className="p-4 rounded-2xl bg-neutral-50/70 dark:bg-neutral-900/60 border border-neutral-200 dark:border-neutral-800 space-y-3">
                  <PhotoUpload
                    photos={activeAnswer.immagini || []}
                    onPhotosChange={(photos) =>
                      handlePhotosChange(selectedQuestionIndex, photos)
                    }
                    maxPhotos={4}
                    label="Foto dei calcoli su quaderno (OCR & Vision AI)"
                  />
                </div>
              </div>
            )}

            {/* Question Bottom Navigation */}
            <div className="pt-4 border-t border-neutral-100 dark:border-neutral-800 flex items-center justify-between">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={selectedQuestionIndex === 0}
                onClick={() => setSelectedQuestionIndex((prev) => prev - 1)}
                className="rounded-xl text-xs"
              >
                Precedente
              </Button>

              <div className="flex items-center gap-2">
                {selectedQuestionIndex < rawQuestions.length - 1 ? (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => setSelectedQuestionIndex((prev) => prev + 1)}
                    className="rounded-xl text-xs gap-1.5"
                  >
                    <span>Prossimo Quesito</span>
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => setShowConfirmModal(true)}
                    className="rounded-xl text-xs gap-1.5 bg-accent-600 hover:bg-accent-700 text-white font-semibold"
                  >
                    <Send className="h-3.5 w-3.5" />
                    <span>Consegna Esame</span>
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Confirmation Submit Modal */}
      {showConfirmModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"
        >
          <div className="relative max-w-md w-full bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-3xl shadow-2xl p-6 sm:p-7 space-y-5 animate-in zoom-in-95 duration-200">
            <div className="h-12 w-12 rounded-2xl bg-accent-500/10 text-accent-600 flex items-center justify-center mx-auto">
              <Award className="h-6 w-6" />
            </div>

            <div className="text-center space-y-2">
              <h3 className="text-lg font-bold text-neutral-900 dark:text-neutral-50">
                Vuoi consegnare la prova?
              </h3>
              <p className="text-xs sm:text-sm text-neutral-600 dark:text-neutral-300 leading-relaxed">
                Hai risposto a{" "}
                <strong className="text-accent-600 font-bold">
                  {answeredCount} su {rawQuestions.length}
                </strong>{" "}
                quesiti.
                {answeredCount < rawQuestions.length && (
                  <span className="block mt-1 text-amber-600 dark:text-amber-400 font-medium">
                    Attenzione: ci sono quesiti lasciati in bianco!
                  </span>
                )}
              </p>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowConfirmModal(false)}
                className="flex-1 rounded-xl h-10 text-xs"
              >
                Continua prova
              </Button>

              <Button
                type="button"
                onClick={() => submitMutation.mutate()}
                className="flex-1 rounded-xl h-10 text-xs font-semibold bg-accent-600 hover:bg-accent-700 text-white shadow-md gap-1.5"
              >
                <CheckCircle2 className="h-4 w-4" />
                <span>Conferma e Consegna</span>
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
export default SimulazioneRunner
