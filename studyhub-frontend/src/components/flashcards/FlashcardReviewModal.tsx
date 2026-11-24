import React, { useState, useEffect, useCallback, useMemo, useRef } from "react"
import {
  X,
  RotateCw,
  Clock,
  Sparkles,
  Trophy,
  Flame,
  Award,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  ArrowRight,
  BookOpen,
  Volume2,
  VolumeX,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { MathMarkdown } from "@/components/ui/math-markdown"
import { api } from "@/lib/api"
import type { Flashcard } from "@/types"
import { cn } from "@/lib/utils"

export interface FlashcardReviewModalProps {
  isOpen: boolean
  onClose: () => void
  cards: Flashcard[]
  onSessionComplete?: () => void
}

interface ReviewStats {
  again: number
  hard: number
  good: number
  easy: number
  totalReviews: number
}

export function FlashcardReviewModal({
  isOpen,
  onClose,
  cards,
  onSessionComplete,
}: FlashcardReviewModalProps) {
  // Session queue state
  const [queue, setQueue] = useState<Flashcard[]>([])
  const [initialTotal, setInitialTotal] = useState<number>(0)
  const [isFlipped, setIsFlipped] = useState<boolean>(false)
  const [showConfirmExit, setShowConfirmExit] = useState<boolean>(false)
  const [isCompleted, setIsCompleted] = useState<boolean>(false)

  // Tracking metrics
  const [completedCardIds, setCompletedCardIds] = useState<Set<number>>(new Set())
  const [againCardIds, setAgainCardIds] = useState<Set<number>>(new Set())
  const [firstAttemptCorrect, setFirstAttemptCorrect] = useState<number>(0)
  const [stats, setStats] = useState<ReviewStats>({
    again: 0,
    hard: 0,
    good: 0,
    easy: 0,
    totalReviews: 0,
  })

  // Elapsed timer
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0)
  const timerRef = useRef<number | null>(null)

  // Initialize session whenever modal opens with cards
  useEffect(() => {
    if (isOpen) {
      const validCards = cards && Array.isArray(cards) ? [...cards] : []
      setQueue(validCards)
      setInitialTotal(validCards.length)
      setIsFlipped(false)
      setShowConfirmExit(false)
      setIsCompleted(validCards.length === 0)
      setCompletedCardIds(new Set())
      setAgainCardIds(new Set())
      setFirstAttemptCorrect(0)
      setStats({ again: 0, hard: 0, good: 0, easy: 0, totalReviews: 0 })
      setElapsedSeconds(0)

      timerRef.current = window.setInterval(() => {
        setElapsedSeconds((prev) => prev + 1)
      }, 1000)
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [isOpen, cards])

  // Stop timer when completed
  useEffect(() => {
    if (isCompleted && timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
      onSessionComplete?.()
    }
  }, [isCompleted, onSessionComplete])

  // Current card being reviewed
  const currentCard = queue[0] || null

  // Format seconds to mm:ss
  const formattedTime = useMemo(() => {
    const mins = Math.floor(elapsedSeconds / 60)
    const secs = elapsedSeconds % 60
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`
  }, [elapsedSeconds])

  // Handle rating submission
  const handleRating = useCallback(
    async (rating: 1 | 2 | 3 | 4) => {
      if (!currentCard || !isFlipped) return

      const cardId = currentCard.id

      // Optimistic API review call (non-blocking)
      api.reviewFlashcard(cardId, rating).catch((err) => {
        console.error(`Errore nel salvataggio della review per la carta ${cardId}:`, err)
      })

      // Track first attempt performance (if never seen before in this session)
      const isFirstAttempt = !completedCardIds.has(cardId) && !againCardIds.has(cardId)
      if (isFirstAttempt && (rating === 3 || rating === 4)) {
        setFirstAttemptCorrect((prev) => prev + 1)
      }

      // Update counters
      setStats((prev) => ({
        ...prev,
        again: prev.again + (rating === 1 ? 1 : 0),
        hard: prev.hard + (rating === 2 ? 1 : 0),
        good: prev.good + (rating === 3 ? 1 : 0),
        easy: prev.easy + (rating === 4 ? 1 : 0),
        totalReviews: prev.totalReviews + 1,
      }))

      // Reset flip state for the upcoming card
      setIsFlipped(false)

      if (rating === 1) {
        // Continuous flow FSRS: Re-insert card at the bottom of the queue
        setAgainCardIds((prev) => new Set(prev).add(cardId))
        setQueue((prevQueue) => {
          const rest = prevQueue.slice(1)
          return [...rest, currentCard]
        })
      } else {
        // Card mastered for this session: Remove from queue
        setCompletedCardIds((prev) => new Set(prev).add(cardId))
        setQueue((prevQueue) => {
          const nextQueue = prevQueue.slice(1)
          if (nextQueue.length === 0) {
            setIsCompleted(true)
          }
          return nextQueue
        })
      }
    },
    [currentCard, isFlipped, completedCardIds, againCardIds]
  )

  // Handle keyboard shortcuts
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      // If modal exit confirmation is displayed
      if (showConfirmExit) {
        if (e.key === "Escape") {
          setShowConfirmExit(false)
        }
        return
      }

      // Escape key handles exit
      if (e.key === "Escape") {
        e.preventDefault()
        if (queue.length > 0 && !isCompleted) {
          setShowConfirmExit(true)
        } else {
          onClose()
        }
        return
      }

      // Space or Enter flips the card
      if (e.code === "Space" || e.key === "Enter") {
        e.preventDefault()
        if (!isFlipped && currentCard) {
          setIsFlipped(true)
        }
        return
      }

      // Keys 1, 2, 3, 4 trigger ratings only when flipped
      if (isFlipped && currentCard) {
        if (e.key === "1") {
          e.preventDefault()
          handleRating(1)
        } else if (e.key === "2") {
          e.preventDefault()
          handleRating(2)
        } else if (e.key === "3") {
          e.preventDefault()
          handleRating(3)
        } else if (e.key === "4") {
          e.preventDefault()
          handleRating(4)
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [isOpen, showConfirmExit, isFlipped, currentCard, queue.length, isCompleted, onClose, handleRating])

  if (!isOpen) return null

  // Progress calculations
  const uniqueCompleted = completedCardIds.size
  const progressPercent = initialTotal > 0 ? Math.round((uniqueCompleted / initialTotal) * 100) : 100
  const retentionPercent =
    initialTotal > 0 ? Math.round((firstAttemptCorrect / initialTotal) * 100) : 100

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white/95 dark:bg-neutral-950/95 backdrop-blur-md transition-all duration-200 select-none">
      {/* Top Header Bar */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-neutral-200/80 dark:border-neutral-800/80">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center h-9 w-9 rounded-xl bg-accent-50 dark:bg-accent-950/40 text-accent-600 dark:text-accent-400 border border-accent-200/50 dark:border-accent-800/40">
            <Flame className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-50 flex items-center gap-2">
              Ripasso FSRS a Flusso Continuo
              {againCardIds.size > 0 && !isCompleted && (
                <Badge variant="outline" className="text-2xs text-warning-600 dark:text-warning-400 border-warning-300 dark:border-warning-800">
                  {againCardIds.size} da risovvenire
                </Badge>
              )}
            </h2>
            <div className="flex items-center gap-3 text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
              <span>
                Completate: <strong>{uniqueCompleted}</strong> di {initialTotal}
              </span>
              <span>•</span>
              <span className="flex items-center gap-1 font-mono">
                <Clock className="h-3 w-3" />
                {formattedTime}
              </span>
            </div>
          </div>
        </div>

        {/* Center Progress Bar */}
        <div className="hidden sm:flex flex-col items-center gap-1.5 w-64 max-w-xs">
          <div className="flex justify-between w-full text-2xs text-neutral-500 font-medium">
            <span>Progresso sessione</span>
            <span>{progressPercent}%</span>
          </div>
          <Progress value={progressPercent} className="h-2 w-full" />
        </div>

        {/* Close Button */}
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (queue.length > 0 && !isCompleted) {
                setShowConfirmExit(true)
              } else {
                onClose()
              }
            }}
            className="rounded-full text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-50 h-9 w-9 p-0"
            title="Chiudi sessione (Esc)"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>
      </header>

      {/* Main Runner Area */}
      <main className="flex-1 overflow-y-auto flex items-center justify-center p-4 sm:p-6 md:p-8">
        {isCompleted ? (
          /* =========================================================
             COMPLETION SCREEN
             ========================================================= */
          <div className="max-w-md w-full text-center space-y-6 py-8 animate-in fade-in-50 zoom-in-95 duration-200">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-600 dark:text-emerald-400 shadow-elevated">
              <Trophy className="h-10 w-10" />
            </div>

            <div className="space-y-2">
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-neutral-950 dark:text-neutral-50">
                Sessione completata!
              </h1>
              <p className="text-sm text-neutral-600 dark:text-neutral-400">
                Hai memorizzato tutte le flashcard previste per questo ripasso. Ottimo lavoro con l'algoritmo FSRS!
              </p>
            </div>

            {/* Metrics Grid */}
            <div className="grid grid-cols-2 gap-3 text-left">
              <div className="p-4 rounded-2xl bg-neutral-100/70 dark:bg-neutral-900/60 border border-neutral-200/80 dark:border-neutral-800">
                <p className="text-2xs text-neutral-500 uppercase tracking-wider font-semibold">Carte uniche</p>
                <p className="text-2xl font-bold text-neutral-900 dark:text-neutral-100 mt-1">{initialTotal}</p>
                <p className="text-xs text-neutral-400 mt-0.5">Tutte padroneggiate</p>
              </div>

              <div className="p-4 rounded-2xl bg-neutral-100/70 dark:bg-neutral-900/60 border border-neutral-200/80 dark:border-neutral-800">
                <p className="text-2xs text-neutral-500 uppercase tracking-wider font-semibold">Ripassi totali</p>
                <p className="text-2xl font-bold text-accent-600 dark:text-accent-400 mt-1">{stats.totalReviews}</p>
                <p className="text-xs text-neutral-400 mt-0.5">Interazioni FSRS</p>
              </div>

              <div className="p-4 rounded-2xl bg-neutral-100/70 dark:bg-neutral-900/60 border border-neutral-200/80 dark:border-neutral-800">
                <p className="text-2xs text-neutral-500 uppercase tracking-wider font-semibold">Retention 1° colpo</p>
                <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">{retentionPercent}%</p>
                <p className="text-xs text-neutral-400 mt-0.5">{firstAttemptCorrect} su {initialTotal} carte</p>
              </div>

              <div className="p-4 rounded-2xl bg-neutral-100/70 dark:bg-neutral-900/60 border border-neutral-200/80 dark:border-neutral-800">
                <p className="text-2xs text-neutral-500 uppercase tracking-wider font-semibold">Tempo impiegato</p>
                <p className="text-2xl font-bold text-neutral-900 dark:text-neutral-100 font-mono mt-1">{formattedTime}</p>
                <p className="text-xs text-neutral-400 mt-0.5">Durata totale</p>
              </div>
            </div>

            {/* Rating breakdown pill badges */}
            <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
              <Badge variant="outline" className="text-xs px-2.5 py-1 text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-900/50">
                Di nuovo: {stats.again}
              </Badge>
              <Badge variant="outline" className="text-xs px-2.5 py-1 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-900/50">
                Difficile: {stats.hard}
              </Badge>
              <Badge variant="outline" className="text-xs px-2.5 py-1 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-900/50">
                Bene: {stats.good}
              </Badge>
              <Badge variant="outline" className="text-xs px-2.5 py-1 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900/50">
                Facile: {stats.easy}
              </Badge>
            </div>

            {/* Actions */}
            <div className="pt-4 flex flex-col sm:flex-row gap-3 justify-center">
              <Button size="lg" onClick={onClose} className="w-full sm:w-auto px-8 gap-2 font-medium">
                Chiudi sessione
              </Button>
            </div>
          </div>
        ) : currentCard ? (
          /* =========================================================
             ACTIVE FLASHCARD CARD
             ========================================================= */
          <div className="w-full max-w-2xl flex flex-col items-center">
            {/* Card Badge Bar */}
            <div className="w-full flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400 mb-3 px-1">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="font-mono text-2xs">
                  Lezione #{currentCard.lecture_id}
                </Badge>
                {againCardIds.has(currentCard.id) && (
                  <Badge variant="outline" className="text-2xs bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border-amber-300 dark:border-amber-800">
                    Da memorizzare
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-3">
                <span>
                  Ripetizioni: <strong>{currentCard.reps}</strong>
                </span>
                <span>•</span>
                <span>
                  In coda: <strong>{queue.length}</strong>
                </span>
              </div>
            </div>

            {/* Flashcard container with Apple style aesthetics */}
            <div
              onClick={() => {
                if (!isFlipped) setIsFlipped(true)
              }}
              className={cn(
                "w-full min-h-[340px] sm:min-h-[400px] flex flex-col justify-between p-6 sm:p-8 rounded-3xl",
                "bg-white dark:bg-neutral-900 border border-neutral-200/90 dark:border-neutral-800",
                "shadow-modal hover:border-neutral-300 dark:hover:border-neutral-700 transition-all duration-200 cursor-pointer select-text relative overflow-hidden"
              )}
            >
              {/* Question Front */}
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-neutral-100 dark:border-neutral-800/80 pb-3">
                  <span className="text-2xs uppercase tracking-wider font-semibold text-neutral-400 dark:text-neutral-500">
                    Domanda
                  </span>
                  <span className="text-2xs text-neutral-400 dark:text-neutral-500">
                    {isFlipped ? "Risposta mostrata" : "Clicca per girare la carta"}
                  </span>
                </div>

                <div className="text-lg sm:text-xl font-medium leading-relaxed text-neutral-900 dark:text-neutral-50">
                  <MathMarkdown content={currentCard.fronte} />
                </div>
              </div>

              {/* Answer Retro (Revealed when flipped) */}
              {isFlipped ? (
                <div className="mt-6 pt-6 border-t border-neutral-200 dark:border-neutral-800 space-y-3 animate-in fade-in-50 slide-in-from-bottom-2 duration-200">
                  <div className="flex items-center justify-between">
                    <span className="text-2xs uppercase tracking-wider font-semibold text-accent-600 dark:text-accent-400">
                      Risposta
                    </span>
                    <Badge variant="outline" className="text-2xs font-mono text-neutral-400">
                      EF: {((currentCard.ease_factor ?? 2500) > 100 ? (currentCard.ease_factor ?? 2500) / 1000 : (currentCard.ease_factor ?? 2.5)).toFixed(1)}
                    </Badge>
                  </div>

                  <div className="text-base sm:text-lg text-neutral-850 dark:text-neutral-100 leading-relaxed font-normal">
                    <MathMarkdown content={currentCard.retro} />
                  </div>
                </div>
              ) : (
                /* Unflipped hint */
                <div className="mt-8 pt-4 flex items-center justify-center text-xs text-neutral-400 dark:text-neutral-500 gap-2">
                  <span>Premi</span>
                  <kbd className="px-2 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 font-mono text-xs border border-neutral-200 dark:border-neutral-700">
                    Spazio
                  </kbd>
                  <span>o</span>
                  <kbd className="px-2 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 font-mono text-xs border border-neutral-200 dark:border-neutral-700">
                    Invio
                  </kbd>
                  <span>per vedere la risposta</span>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Empty state */
          <div className="text-center space-y-4 max-w-sm">
            <CheckCircle2 className="h-12 w-12 text-emerald-500 mx-auto" />
            <h3 className="text-lg font-semibold">Nessuna flashcard in scadenza</h3>
            <p className="text-sm text-neutral-500">
              Hai completato tutti i ripassi programmati per oggi. Ottimo lavoro!
            </p>
            <Button onClick={onClose}>Chiudi</Button>
          </div>
        )}
      </main>

      {/* Footer Controls / Rating Bar */}
      {!isCompleted && currentCard && (
        <footer className="border-t border-neutral-200/80 dark:border-neutral-800/80 bg-white/70 dark:bg-neutral-950/70 p-4 sm:p-6 backdrop-blur-sm">
          <div className="max-w-2xl mx-auto">
            {!isFlipped ? (
              /* Turn Card Button */
              <Button
                size="lg"
                onClick={() => setIsFlipped(true)}
                className="w-full h-12 text-base font-medium gap-2 shadow-sm"
              >
                <span>Mostra risposta</span>
                <kbd className="ml-2 px-2 py-0.5 rounded bg-white/20 text-white font-mono text-xs">
                  Spazio
                </kbd>
              </Button>
            ) : (
              /* FSRS Rating Buttons (1, 2, 3, 4) */
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3">
                {/* 1 - Di nuovo (Again) */}
                <button
                  type="button"
                  onClick={() => handleRating(1)}
                  className={cn(
                    "flex flex-col items-center justify-center p-3 rounded-2xl border transition-all duration-150 cursor-pointer",
                    "border-rose-300 dark:border-rose-900/60 bg-rose-50/80 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300",
                    "hover:bg-rose-100 dark:hover:bg-rose-900/50 hover:border-rose-400 active:scale-[0.98]"
                  )}
                >
                  <div className="flex items-center gap-1.5 font-semibold text-sm">
                    <kbd className="px-1.5 py-0.2 rounded bg-rose-200/80 dark:bg-rose-900/80 text-rose-800 dark:text-rose-200 text-2xs font-mono">
                      1
                    </kbd>
                    <span>Di nuovo</span>
                  </div>
                  <span className="text-2xs text-rose-600/80 dark:text-rose-400/80 mt-0.5">
                    Ripeti in coda
                  </span>
                </button>

                {/* 2 - Difficile (Hard) */}
                <button
                  type="button"
                  onClick={() => handleRating(2)}
                  className={cn(
                    "flex flex-col items-center justify-center p-3 rounded-2xl border transition-all duration-150 cursor-pointer",
                    "border-amber-300 dark:border-amber-900/60 bg-amber-50/80 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300",
                    "hover:bg-amber-100 dark:hover:bg-amber-900/50 hover:border-amber-400 active:scale-[0.98]"
                  )}
                >
                  <div className="flex items-center gap-1.5 font-semibold text-sm">
                    <kbd className="px-1.5 py-0.2 rounded bg-amber-200/80 dark:bg-amber-900/80 text-amber-800 dark:text-amber-200 text-2xs font-mono">
                      2
                    </kbd>
                    <span>Difficile</span>
                  </div>
                  <span className="text-2xs text-amber-600/80 dark:text-amber-400/80 mt-0.5">
                    Intervallo breve
                  </span>
                </button>

                {/* 3 - Bene (Good) */}
                <button
                  type="button"
                  onClick={() => handleRating(3)}
                  className={cn(
                    "flex flex-col items-center justify-center p-3 rounded-2xl border transition-all duration-150 cursor-pointer",
                    "border-blue-300 dark:border-blue-900/60 bg-blue-50/80 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300",
                    "hover:bg-blue-100 dark:hover:bg-blue-900/50 hover:border-blue-400 active:scale-[0.98]"
                  )}
                >
                  <div className="flex items-center gap-1.5 font-semibold text-sm">
                    <kbd className="px-1.5 py-0.2 rounded bg-blue-200/80 dark:bg-blue-900/80 text-blue-800 dark:text-blue-200 text-2xs font-mono">
                      3
                    </kbd>
                    <span>Bene</span>
                  </div>
                  <span className="text-2xs text-blue-600/80 dark:text-blue-400/80 mt-0.5">
                    Consigliato
                  </span>
                </button>

                {/* 4 - Facile (Easy) */}
                <button
                  type="button"
                  onClick={() => handleRating(4)}
                  className={cn(
                    "flex flex-col items-center justify-center p-3 rounded-2xl border transition-all duration-150 cursor-pointer",
                    "border-emerald-300 dark:border-emerald-900/60 bg-emerald-50/80 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300",
                    "hover:bg-emerald-100 dark:hover:bg-emerald-900/50 hover:border-emerald-400 active:scale-[0.98]"
                  )}
                >
                  <div className="flex items-center gap-1.5 font-semibold text-sm">
                    <kbd className="px-1.5 py-0.2 rounded bg-emerald-200/80 dark:bg-emerald-900/80 text-emerald-800 dark:text-emerald-200 text-2xs font-mono">
                      4
                    </kbd>
                    <span>Facile</span>
                  </div>
                  <span className="text-2xs text-emerald-600/80 dark:text-emerald-400/80 mt-0.5">
                    Intervallo lungo
                  </span>
                </button>
              </div>
            )}
          </div>
        </footer>
      )}

      {/* Confirmation Exit Overlay Dialog */}
      {showConfirmExit && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in-50 duration-150">
          <div className="max-w-md w-full bg-white dark:bg-neutral-900 rounded-3xl p-6 shadow-modal border border-neutral-200 dark:border-neutral-800 space-y-4">
            <div className="flex items-center gap-3 text-warning-600 dark:text-warning-400">
              <AlertCircle className="h-6 w-6" />
              <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">
                Terminare la sessione di ripasso?
              </h3>
            </div>
            <p className="text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed">
              Hai ancora <strong>{queue.length}</strong> carte in coda. I voti assegnati finora sono già stati registrati con l'algoritmo FSRS.
            </p>
            <div className="flex flex-col-reverse sm:flex-row gap-2 pt-2 justify-end">
              <Button
                variant="outline"
                onClick={() => setShowConfirmExit(false)}
                className="w-full sm:w-auto"
              >
                Continua ripasso
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  setShowConfirmExit(false)
                  onClose()
                }}
                className="w-full sm:w-auto"
              >
                Esci comunque
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
