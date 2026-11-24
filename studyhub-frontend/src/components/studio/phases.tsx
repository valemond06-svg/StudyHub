import React, { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import {
  Check,
  X,
  Zap,
  Brain,
  Target,
  Flag,
  Heart,
  Sparkles,
  Trophy,
  Flame,
  BookOpen,
  ArrowRight,
  PenTool,
  CheckCircle2,
  XCircle,
  RotateCcw,
  HelpCircle,
  Lightbulb,
  Award,
  Camera,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { MathMarkdown } from "@/components/ui/math-markdown"
import { PhotoUpload } from "@/components/camera/PhotoUpload"
import { cn } from "@/lib/utils"

// ==========================================
// Types
// ==========================================

export interface PhaseConfig {
  label: string
  icon: any
  color: string
  bg: string
  duration: number
}

export interface SessionQuestion {
  id?: number
  prompt?: string
  text?: string
  question?: string
  kind?: "multipla" | "vero_falso" | "aperta" | "esercizio" | "richiamo" | string
  choices?: string[]
  options?: string[]
  answer?: string | number
  solution?: string
  explanation?: string
  hint?: string
  topic_title?: string
  topic_id?: number
  difficulty?: number
}

export interface SessionScheda {
  id?: number
  title?: string
  content?: string
  summary?: string
  key_points?: string[]
  topic_title?: string
  topic_id?: number
}

export interface SessionEntry {
  id: number
  t: "domanda" | "scheda" | string
  boss?: boolean
  question?: SessionQuestion
  scheda?: SessionScheda
  // Direct fields support
  title?: string
  content?: string
  prompt?: string
  text?: string
  options?: string[]
  choices?: string[]
  answer?: string | number
  solution?: string
  explanation?: string
  hint?: string
  kind?: string
  summary?: string
  key_points?: string[]
  topic_id?: number
  topic_title?: string
  topic_name?: string
  user_answer?: any
  is_correct?: boolean
}

export interface StatCardProps {
  label: string
  value: string | number
  subtext?: string
  icon?: React.ComponentType<{ className?: string }>
  iconColor?: string
  iconBg?: string
  trend?: "up" | "down" | "neutral"
  trendValue?: string
  className?: string
}

// ==========================================
// StatCard Component
// ==========================================

export function StatCard({
  label,
  value,
  subtext,
  icon: Icon,
  iconColor = "text-accent-500",
  iconBg = "bg-accent-50 dark:bg-accent-950/40",
  trend,
  trendValue,
  className,
}: StatCardProps) {
  return (
    <div
      className={cn(
        "flex flex-col p-4 sm:p-5 rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-neutral-900/90 shadow-2xs transition-all hover:border-neutral-300 dark:hover:border-neutral-700",
        className
      )}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
          {label}
        </span>
        {Icon && (
          <div className={cn("p-2 rounded-xl", iconBg, iconColor)}>
            <Icon className="h-4 w-4" />
          </div>
        )}
      </div>
      <div className="text-2xl sm:text-3xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50 font-mono">
        {value}
      </div>
      {(subtext || trendValue) && (
        <div className="mt-1.5 flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
          {trendValue && (
            <span
              className={cn(
                "font-medium",
                trend === "up" && "text-emerald-600 dark:text-emerald-400",
                trend === "down" && "text-rose-600 dark:text-rose-400"
              )}
            >
              {trendValue}
            </span>
          )}
          {subtext && <span>{subtext}</span>}
        </div>
      )}
    </div>
  )
}

// ==========================================
// Helper: Extract Question Data
// ==========================================

function parseQuestionData(entry: SessionEntry) {
  const q: any = entry.question || entry
  const prompt = q.prompt_md || q.prompt || q.text_md || q.text || q.domanda || ""

  let choicesList: string[] = []
  const rawChoices = q.choices || q.options
  if (Array.isArray(rawChoices)) {
    choicesList = rawChoices
  } else if (typeof rawChoices === "string" && rawChoices.trim()) {
    try {
      const parsed = JSON.parse(rawChoices)
      if (Array.isArray(parsed)) {
        choicesList = parsed
      }
    } catch {
      if (rawChoices.includes("\n")) {
        choicesList = rawChoices.split("\n").map((s: string) => s.trim()).filter(Boolean)
      } else {
        const mathMatches = rawChoices.match(/\$[^$]+\$/g)
        if (mathMatches && mathMatches.length > 1) {
          choicesList = mathMatches
        } else {
          choicesList = [rawChoices]
        }
      }
    }
  }

  const kind = q.kind || (choicesList.length > 0 ? "multipla" : "aperta")
  const explanation = q.answer_md || q.explanation_md || q.solution_md || q.explanation || q.solution || ""
  const hint = q.hint_md || q.hint || ""
  const topicTitle = q.topic_title || entry.topic_title || (entry as any).topic_name || (q.topic_id ? `Topic ${q.topic_id}` : "")
  const correctAnswer = q.correct_choice ?? q.correct_answer ?? q.answer ?? q.answer_md

  return { prompt, choices: choicesList, kind, explanation, hint, topicTitle, correctAnswer }
}

const OPTION_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"]

// ==========================================
// 1. WarmupPhase
// ==========================================

export interface WarmupPhaseProps {
  entries: SessionEntry[]
  currentIndex: number
  showAnswer: boolean
  confidence: number
  currentPhaseConfig?: PhaseConfig
  onAnswer: (isCorrect: boolean, conf: number, answerData?: { choice?: number; text?: string; photos?: string[] }) => void
  onNext: () => void
  onSetShowAnswer: (show: boolean) => void
  onSetConfidence: (conf: number) => void
  onReveal?: () => void | Promise<void>
  isLoading?: boolean
  sessionId?: number
  onPhotoUpload?: (photo: string, entryId: number) => Promise<void> | void
}

export function WarmupPhase({
  entries,
  currentIndex,
  showAnswer,
  confidence,
  currentPhaseConfig,
  onAnswer,
  onNext,
  onSetShowAnswer,
  onReveal,
  isLoading,
  sessionId,
  onPhotoUpload,
}: WarmupPhaseProps) {
  const entry = entries[currentIndex]
  const [selectedChoice, setSelectedChoice] = useState<number | null>(null)
  const [textAnswer, setTextAnswer] = useState("")
  const [notebookMode, setNotebookMode] = useState(false)
  const [showHint, setShowHint] = useState(false)
  const [photos, setPhotos] = useState<string[]>([])
  const [showPhotoUpload, setShowPhotoUpload] = useState(false)

  // Reset local state when entry changes
  useEffect(() => {
    setSelectedChoice(null)
    setTextAnswer("")
    setNotebookMode(false)
    setShowHint(false)
    setPhotos([])
    setShowPhotoUpload(false)
  }, [currentIndex, entry?.id])

  if (!entry) return null

  const { prompt, choices, kind, explanation, hint, topicTitle, correctAnswer } = parseQuestionData(entry)
  const isMultiple = (kind === "multipla" || kind === "vero_falso" || choices.length > 0)

  const handleSelectChoice = (index: number) => {
    if (showAnswer || isLoading) return
    setSelectedChoice(index)
  }

  const handlePhotosChange = (newPhotos: string[]) => {
    if (newPhotos.length > photos.length && onPhotoUpload && entry) {
      const latestPhoto = newPhotos[newPhotos.length - 1]
      onPhotoUpload(latestPhoto, entry.id)
    }
    setPhotos(newPhotos)
  }

  const handleSubmit = (overrideCorrect?: boolean) => {
    if (isLoading) return
    let isCorrect = false

    if (overrideCorrect !== undefined) {
      isCorrect = overrideCorrect
    } else if (isMultiple && selectedChoice !== null) {
      if (typeof correctAnswer === "number") {
        isCorrect = selectedChoice === correctAnswer
      } else if (typeof correctAnswer === "string") {
        // Compare with choice text or letter
        const choiceText = choices[selectedChoice]
        const letter = OPTION_LETTERS[selectedChoice]
        isCorrect =
          correctAnswer.trim().toLowerCase() === choiceText?.trim().toLowerCase() ||
          correctAnswer.trim().toUpperCase() === letter
      } else {
        isCorrect = true
      }
    } else if (notebookMode || textAnswer.trim() || photos.length > 0) {
      isCorrect = true
    }

    onAnswer(isCorrect, confidence, {
      choice: selectedChoice ?? undefined,
      text: notebookMode ? "Svolto su quaderno" : textAnswer.trim() || (photos.length > 0 ? "Svolto a mano sul quaderno (foto allegata)" : undefined),
      photos: photos.length > 0 ? photos : undefined,
    })
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Top Header Card */}
      <div className="rounded-3xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-neutral-900/90 p-6 sm:p-8 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
              <Zap className="h-3.5 w-3.5" />
              Riscaldamento
            </span>
            {topicTitle && (
              <Badge variant="outline" className="text-2xs text-neutral-600 dark:text-neutral-400">
                {topicTitle}
              </Badge>
            )}
          </div>
          <span className="text-xs font-mono font-medium text-neutral-400">
            {currentIndex + 1} / {entries.length}
          </span>
        </div>

        {/* Question Prompt */}
        <div className="mb-6">
          <MathMarkdown content={prompt} className="text-base sm:text-lg font-medium leading-relaxed" />
        </div>

        {/* Hint toggle if available */}
        {hint && (
          <div className="mb-6">
            {!showHint ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowHint(true)}
                className="text-xs text-amber-600 dark:text-amber-400 hover:text-amber-700 p-0 h-auto gap-1.5 font-normal"
              >
                <Lightbulb className="h-3.5 w-3.5" />
                Mostra un suggerimento
              </Button>
            ) : (
              <div className="p-3.5 rounded-2xl bg-amber-500/5 border border-amber-500/20 text-xs text-amber-800 dark:text-amber-300">
                <span className="font-semibold block mb-1">Suggerimento:</span>
                <MathMarkdown content={hint} />
              </div>
            )}
          </div>
        )}

        {/* Multiple Choice Answers */}
        {isMultiple && (
          <div className="space-y-3">
            {choices.map((choice, idx) => {
              const letter = OPTION_LETTERS[idx] || `${idx + 1}`
              const isSelected = selectedChoice === idx

              let choiceStyle =
                "border-neutral-200/90 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900 hover:border-neutral-300 dark:hover:border-neutral-700 text-neutral-900 dark:text-neutral-100"

              if (isSelected && !showAnswer) {
                choiceStyle =
                  "border-accent-500 ring-2 ring-accent-500/20 bg-accent-500/5 text-accent-700 dark:text-accent-300"
              }

              if (showAnswer) {
                const isThisCorrect =
                  typeof correctAnswer === "number"
                    ? correctAnswer === idx
                    : typeof correctAnswer === "string"
                    ? correctAnswer.trim().toLowerCase() === choice.trim().toLowerCase() ||
                      correctAnswer.trim().toUpperCase() === letter
                    : false

                if (isThisCorrect) {
                  choiceStyle =
                    "border-emerald-500/80 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 ring-1 ring-emerald-500/30"
                } else if (isSelected && !isThisCorrect) {
                  choiceStyle =
                    "border-rose-500/80 bg-rose-500/10 text-rose-800 dark:text-rose-300 ring-1 ring-rose-500/30"
                }
              }

              return (
                <button
                  key={idx}
                  type="button"
                  disabled={showAnswer || isLoading}
                  onClick={() => handleSelectChoice(idx)}
                  className={cn(
                    "w-full flex items-start gap-3.5 p-4 rounded-2xl border text-left transition-all duration-150 active:scale-[0.99] disabled:cursor-default",
                    choiceStyle
                  )}
                >
                  <span
                    className={cn(
                      "flex items-center justify-center h-6 w-6 rounded-lg text-xs font-semibold shrink-0 transition-colors",
                      isSelected
                        ? "bg-accent-500 text-white"
                        : "bg-neutral-200/70 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400"
                    )}
                  >
                    {letter}
                  </span>
                  <div className="flex-1 pt-0.5 text-sm sm:text-base leading-snug">
                    <MathMarkdown content={choice} />
                  </div>
                </button>
              )
            })}
          </div>
        )}

        {/* Open Question / Notebook Mode */}
        {!isMultiple && (
          <div className="space-y-4">
            <div className="flex gap-2">
              <Button
                type="button"
                variant={notebookMode ? "secondary" : "outline"}
                size="sm"
                onClick={() => setNotebookMode(!notebookMode)}
                className="gap-1.5 text-xs rounded-xl"
              >
                <PenTool className="h-3.5 w-3.5" />
                {notebookMode ? "Svolto sul quaderno ✓" : "Svolgo sul quaderno"}
              </Button>
            </div>

            {!notebookMode && (
              <textarea
                value={textAnswer}
                disabled={showAnswer || isLoading}
                onChange={(e) => setTextAnswer(e.target.value)}
                placeholder="Inserisci la tua risposta o procedimento..."
                rows={4}
                className="w-full rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900 p-4 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent transition-all placeholder:text-neutral-400"
              />
            )}
          </div>
        )}

        {/* Bridge Carta e Penna: Svolgi a mano sul quaderno e allega foto */}
        <div className="pt-2 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant={showPhotoUpload || photos.length > 0 ? "secondary" : "outline"}
              size="sm"
              onClick={() => setShowPhotoUpload((prev) => !prev)}
              className="gap-2 text-xs rounded-xl"
            >
              <Camera className="h-3.5 w-3.5 text-accent-500" />
              <span>Svolgi a mano sul quaderno e allega foto</span>
              {photos.length > 0 && (
                <Badge variant="secondary" className="ml-1 text-2xs px-1.5 py-0 bg-accent-500 text-white font-mono">
                  {photos.length}
                </Badge>
              )}
            </Button>
          </div>

          {(showPhotoUpload || photos.length > 0) && (
            <div className="p-4 rounded-2xl bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 space-y-3 animate-in fade-in duration-200 text-neutral-900 dark:text-neutral-50">
              <PhotoUpload
                photos={photos}
                onPhotosChange={handlePhotosChange}
                maxPhotos={4}
                label="Foto svolgimento quaderno"
                disabled={showAnswer || isLoading}
              />
              {photos.length > 0 && (
                <div className="flex items-center gap-2 p-3 rounded-xl bg-accent-500/10 border border-accent-500/20 text-xs text-accent-700 dark:text-accent-300">
                  <Sparkles className="h-4 w-4 shrink-0 text-accent-500" />
                  <span>Foto allegata: l'AI analizzerà i passaggi durante la correzione</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Direct Action Bar when not yet answered */}
        {!showAnswer && (
          <div className="mt-6 pt-5 border-t border-neutral-100 dark:border-neutral-800 flex flex-wrap items-center justify-between gap-3">
            {onReveal ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onReveal()}
                disabled={isLoading}
                className="text-xs text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200 gap-1"
              >
                <HelpCircle className="h-3.5 w-3.5" />
                Rivela risposta
              </Button>
            ) : <div />}

            <Button
              size="default"
              disabled={isLoading || (isMultiple && selectedChoice === null && !notebookMode && photos.length === 0)}
              onClick={() => handleSubmit()}
              className="rounded-xl px-5 text-sm font-medium"
            >
              Conferma risposta
            </Button>
          </div>
        )}

        {/* Feedback & Explanation Card */}
        {showAnswer && (
          <div className="mt-6 pt-6 border-t border-neutral-100 dark:border-neutral-800 space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-200">
            <div className="p-4 rounded-2xl bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-neutral-900 dark:text-neutral-50">
              <span className="text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 block mb-2">
                Spiegazione e Soluzione
              </span>
              <MathMarkdown
                content={explanation || "Nessuna spiegazione dettagliata disponibile per questa domanda."}
                className="text-sm leading-relaxed"
              />
            </div>

            <div className="flex justify-end pt-2">
              <Button onClick={onNext} className="rounded-xl px-6 gap-2">
                {currentIndex < entries.length - 1 ? "Prossima domanda" : "Fase successiva"}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ==========================================
// 2. LearnPhase
// ==========================================

export interface LearnPhaseProps {
  entries: SessionEntry[]
  currentIndex: number
  showAnswer: boolean
  confidence: number
  onAnswer: (isCorrect: boolean, conf: number, answerData?: { choice?: number; text?: string }) => void
  onSetShowAnswer: (show: boolean) => void
  isLoading?: boolean
  onNext?: () => void
}

export function LearnPhase({
  entries,
  currentIndex,
  showAnswer,
  confidence,
  onAnswer,
  onSetShowAnswer,
  isLoading,
  onNext,
}: LearnPhaseProps) {
  const entry = entries[currentIndex]
  const [understood, setUnderstood] = useState<boolean | null>(null)

  useEffect(() => {
    setUnderstood(null)
  }, [currentIndex, entry?.id])

  if (!entry) return null

  const s = entry.scheda || entry
  const title = s.title || (s as any).name || "Scheda di Apprendimento"
  const content = s.content || s.summary || (s as any).summary_md || (entry as any).prompt || ""
  const keyPoints = s.key_points || []
  const topicTitle = s.topic_title || entry.topic_title || ""

  const handleConfirmUnderstanding = (ok: boolean) => {
    setUnderstood(ok)
    onSetShowAnswer(true)
    onAnswer(ok, ok ? 5 : 2)
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="rounded-3xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-neutral-900/90 p-6 sm:p-8 shadow-xs">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-accent-500/10 text-accent-600 dark:text-accent-400 border border-accent-500/20">
              <Brain className="h-3.5 w-3.5" />
              Teoria & Concetti
            </span>
            {topicTitle && (
              <Badge variant="outline" className="text-2xs text-neutral-600 dark:text-neutral-400">
                {topicTitle}
              </Badge>
            )}
          </div>
          <span className="text-xs font-mono font-medium text-neutral-400">
            {currentIndex + 1} / {entries.length}
          </span>
        </div>

        {/* Concept Title */}
        <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50 mb-4">
          {title}
        </h2>

        {/* Concept Body */}
        <div className="mb-6 leading-relaxed">
          <MathMarkdown content={content} className="text-neutral-800 dark:text-neutral-200 text-sm sm:text-base" />
        </div>

        {/* Key Points */}
        {keyPoints.length > 0 && (
          <div className="my-6 p-4 rounded-2xl bg-neutral-50 dark:bg-neutral-850/70 border border-neutral-200/80 dark:border-neutral-800">
            <span className="text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 block mb-3">
              Punti Chiave
            </span>
            <ul className="space-y-2">
              {keyPoints.map((pt: string, pIdx: number) => (
                <li key={pIdx} className="flex items-start gap-2.5 text-xs sm:text-sm text-neutral-700 dark:text-neutral-300">
                  <CheckCircle2 className="h-4 w-4 text-accent-500 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <MathMarkdown content={pt} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Comprehension check action */}
        <div className="mt-8 pt-6 border-t border-neutral-100 dark:border-neutral-800">
          {!showAnswer ? (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <span className="text-xs sm:text-sm text-neutral-500 dark:text-neutral-400">
                Hai compreso i concetti di questa scheda?
              </span>
              <div className="flex items-center gap-2.5 w-full sm:w-auto">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isLoading}
                  onClick={() => handleConfirmUnderstanding(false)}
                  className="flex-1 sm:flex-none rounded-xl text-xs gap-1.5"
                >
                  <RotateCcw className="h-3.5 w-3.5 text-neutral-400" />
                  Da rivedere
                </Button>
                <Button
                  size="sm"
                  disabled={isLoading}
                  onClick={() => handleConfirmUnderstanding(true)}
                  className="flex-1 sm:flex-none rounded-xl text-xs gap-1.5"
                >
                  <Check className="h-3.5 w-3.5" />
                  Ho compreso
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-neutral-500">
                {understood ? "Salvato come appreso ✓" : "Segnato per il ripasso"}
              </span>
              <Button onClick={() => (onNext ? onNext() : onAnswer(true, confidence))} className="rounded-xl px-5 text-sm gap-1.5">
                Prossima scheda
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ==========================================
// 3. PracticePhase
// ==========================================

export interface PracticePhaseProps {
  entries: SessionEntry[]
  currentIndex: number
  showAnswer: boolean
  confidence: number
  onAnswer: (isCorrect: boolean, conf: number, answerData?: { choice?: number; text?: string; photos?: string[] }) => void
  onNext: () => void
  onSetShowAnswer: (show: boolean) => void
  onSetConfidence: (conf: number) => void
  onReveal?: () => void | Promise<void>
  isLoading?: boolean
  xpEarned?: number
  streak?: number
  combo?: number
  questionsAnswered?: number
  correctAnswers?: number
  sessionId?: number
  onPhotoUpload?: (photo: string, entryId: number) => Promise<void> | void
}

export function PracticePhase({
  entries,
  currentIndex,
  showAnswer,
  confidence,
  onAnswer,
  onNext,
  onSetShowAnswer,
  onReveal,
  isLoading,
  xpEarned = 0,
  streak = 0,
  combo = 0,
  questionsAnswered = 0,
  correctAnswers = 0,
  sessionId,
  onPhotoUpload,
}: PracticePhaseProps) {
  const entry = entries[currentIndex]
  const [selectedChoice, setSelectedChoice] = useState<number | null>(null)
  const [textAnswer, setTextAnswer] = useState("")
  const [notebookMode, setNotebookMode] = useState(false)
  const [showHint, setShowHint] = useState(false)
  const [photos, setPhotos] = useState<string[]>([])
  const [showPhotoUpload, setShowPhotoUpload] = useState(false)

  useEffect(() => {
    setSelectedChoice(null)
    setTextAnswer("")
    setNotebookMode(false)
    setShowHint(false)
    setPhotos([])
    setShowPhotoUpload(false)
  }, [currentIndex, entry?.id])

  if (!entry) return null

  const { prompt, choices, kind, explanation, hint, topicTitle, correctAnswer } = parseQuestionData(entry)
  const isMultiple = (kind === "multipla" || kind === "vero_falso" || choices.length > 0)

  const handleSelectChoice = (idx: number) => {
    if (showAnswer || isLoading) return
    setSelectedChoice(idx)
  }

  const handlePhotosChange = (newPhotos: string[]) => {
    if (newPhotos.length > photos.length && onPhotoUpload && entry) {
      const latestPhoto = newPhotos[newPhotos.length - 1]
      onPhotoUpload(latestPhoto, entry.id)
    }
    setPhotos(newPhotos)
  }

  const handleSubmit = (overrideCorrect?: boolean) => {
    if (isLoading) return
    let isCorrect = false

    if (overrideCorrect !== undefined) {
      isCorrect = overrideCorrect
    } else if (isMultiple && selectedChoice !== null) {
      if (typeof correctAnswer === "number") {
        isCorrect = selectedChoice === correctAnswer
      } else if (typeof correctAnswer === "string") {
        const choiceText = choices[selectedChoice]
        const letter = OPTION_LETTERS[selectedChoice]
        isCorrect =
          correctAnswer.trim().toLowerCase() === choiceText?.trim().toLowerCase() ||
          correctAnswer.trim().toUpperCase() === letter
      } else {
        isCorrect = true
      }
    } else if (notebookMode || textAnswer.trim() || photos.length > 0) {
      isCorrect = true
    }

    onAnswer(isCorrect, confidence, {
      choice: selectedChoice ?? undefined,
      text: notebookMode ? "Svolto su quaderno" : textAnswer.trim() || (photos.length > 0 ? "Svolto a mano sul quaderno (foto allegata)" : undefined),
      photos: photos.length > 0 ? photos : undefined,
    })
  }

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      {/* Mini Status Pill Bar */}
      <div className="flex items-center justify-between px-2">
        <div className="flex items-center gap-2">
          {combo > 1 && (
            <span className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
              <Flame className="h-3.5 w-3.5 text-amber-500" />
              Combo x{combo}
            </span>
          )}
          {streak > 0 && (
            <span className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
              <Heart className="h-3.5 w-3.5 text-rose-500" />
              {streak} streak
            </span>
          )}
        </div>
        <span className="text-xs font-mono font-medium text-neutral-500">
          Esercizio {currentIndex + 1} / {entries.length}
        </span>
      </div>

      {/* Main Question Card */}
      <div className="rounded-3xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-neutral-900/90 p-6 sm:p-8 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
              <Target className="h-3.5 w-3.5" />
              Esercitazione
            </span>
            {topicTitle && (
              <Badge variant="outline" className="text-2xs text-neutral-600 dark:text-neutral-400">
                {topicTitle}
              </Badge>
            )}
          </div>
        </div>

        {/* Prompt */}
        <div className="mb-6">
          <MathMarkdown content={prompt} className="text-base sm:text-lg font-medium leading-relaxed" />
        </div>

        {/* Hint */}
        {hint && (
          <div className="mb-6">
            {!showHint ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowHint(true)}
                className="text-xs text-amber-600 dark:text-amber-400 hover:text-amber-700 p-0 h-auto gap-1.5 font-normal"
              >
                <Lightbulb className="h-3.5 w-3.5" />
                Suggerimento
              </Button>
            ) : (
              <div className="p-3.5 rounded-2xl bg-amber-500/5 border border-amber-500/20 text-xs text-amber-800 dark:text-amber-300">
                <span className="font-semibold block mb-1">Suggerimento:</span>
                <MathMarkdown content={hint} />
              </div>
            )}
          </div>
        )}

        {/* Choices */}
        {isMultiple && (
          <div className="space-y-3">
            {choices.map((choice, idx) => {
              const letter = OPTION_LETTERS[idx] || `${idx + 1}`
              const isSelected = selectedChoice === idx

              let choiceStyle =
                "border-neutral-200/90 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900 hover:border-neutral-300 dark:hover:border-neutral-700 text-neutral-900 dark:text-neutral-100"

              if (isSelected && !showAnswer) {
                choiceStyle =
                  "border-accent-500 ring-2 ring-accent-500/20 bg-accent-500/5 text-accent-700 dark:text-accent-300"
              }

              if (showAnswer) {
                const isThisCorrect =
                  typeof correctAnswer === "number"
                    ? correctAnswer === idx
                    : typeof correctAnswer === "string"
                    ? correctAnswer.trim().toLowerCase() === choice.trim().toLowerCase() ||
                      correctAnswer.trim().toUpperCase() === letter
                    : false

                if (isThisCorrect) {
                  choiceStyle =
                    "border-emerald-500/80 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 ring-1 ring-emerald-500/30"
                } else if (isSelected && !isThisCorrect) {
                  choiceStyle =
                    "border-rose-500/80 bg-rose-500/10 text-rose-800 dark:text-rose-300 ring-1 ring-rose-500/30"
                }
              }

              return (
                <button
                  key={idx}
                  type="button"
                  disabled={showAnswer || isLoading}
                  onClick={() => handleSelectChoice(idx)}
                  className={cn(
                    "w-full flex items-start gap-3.5 p-4 rounded-2xl border text-left transition-all duration-150 active:scale-[0.99] disabled:cursor-default",
                    choiceStyle
                  )}
                >
                  <span
                    className={cn(
                      "flex items-center justify-center h-6 w-6 rounded-lg text-xs font-semibold shrink-0 transition-colors",
                      isSelected
                        ? "bg-accent-500 text-white"
                        : "bg-neutral-200/70 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400"
                    )}
                  >
                    {letter}
                  </span>
                  <div className="flex-1 pt-0.5 text-sm sm:text-base leading-snug">
                    <MathMarkdown content={choice} />
                  </div>
                </button>
              )
            })}
          </div>
        )}

        {/* Open Question or Notebook */}
        {!isMultiple && (
          <div className="space-y-4">
            <div className="flex gap-2">
              <Button
                type="button"
                variant={notebookMode ? "secondary" : "outline"}
                size="sm"
                onClick={() => setNotebookMode(!notebookMode)}
                className="gap-1.5 text-xs rounded-xl"
              >
                <PenTool className="h-3.5 w-3.5" />
                {notebookMode ? "Svolto sul quaderno ✓" : "Svolgo sul quaderno"}
              </Button>
            </div>

            {!notebookMode && (
              <textarea
                value={textAnswer}
                disabled={showAnswer || isLoading}
                onChange={(e) => setTextAnswer(e.target.value)}
                placeholder="Digita qui lo svolgimento o il risultato finale..."
                rows={4}
                className="w-full rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900 p-4 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent transition-all placeholder:text-neutral-400"
              />
            )}
          </div>
        )}

        {/* Bridge Carta e Penna: Svolgi a mano sul quaderno e allega foto */}
        <div className="pt-2 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant={showPhotoUpload || photos.length > 0 ? "secondary" : "outline"}
              size="sm"
              onClick={() => setShowPhotoUpload((prev) => !prev)}
              className="gap-2 text-xs rounded-xl"
            >
              <Camera className="h-3.5 w-3.5 text-accent-500" />
              <span>Svolgi a mano sul quaderno e allega foto</span>
              {photos.length > 0 && (
                <Badge variant="secondary" className="ml-1 text-2xs px-1.5 py-0 bg-accent-500 text-white font-mono">
                  {photos.length}
                </Badge>
              )}
            </Button>
          </div>

          {(showPhotoUpload || photos.length > 0) && (
            <div className="p-4 rounded-2xl bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 space-y-3 animate-in fade-in duration-200 text-neutral-900 dark:text-neutral-50">
              <PhotoUpload
                photos={photos}
                onPhotosChange={handlePhotosChange}
                maxPhotos={4}
                label="Foto svolgimento quaderno"
                disabled={showAnswer || isLoading}
              />
              {photos.length > 0 && (
                <div className="flex items-center gap-2 p-3 rounded-xl bg-accent-500/10 border border-accent-500/20 text-xs text-accent-700 dark:text-accent-300">
                  <Sparkles className="h-4 w-4 shrink-0 text-accent-500" />
                  <span>Foto allegata: l'AI analizzerà i passaggi durante la correzione</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Submit action within card */}
        {!showAnswer && (
          <div className="mt-6 pt-5 border-t border-neutral-100 dark:border-neutral-800 flex flex-wrap items-center justify-between gap-3">
            {onReveal ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onReveal()}
                disabled={isLoading}
                className="text-xs text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200 gap-1"
              >
                <HelpCircle className="h-3.5 w-3.5" />
                Rivela
              </Button>
            ) : <div />}

            <Button
              size="default"
              disabled={isLoading || (isMultiple && selectedChoice === null && !notebookMode && photos.length === 0)}
              onClick={() => handleSubmit()}
              className="rounded-xl px-5 text-sm font-medium"
            >
              Verifica risposta
            </Button>
          </div>
        )}

        {/* Feedback Section */}
        {showAnswer && (
          <div className="mt-6 pt-6 border-t border-neutral-100 dark:border-neutral-800 space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-200">
            <div className="p-4 rounded-2xl bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-neutral-900 dark:text-neutral-50">
              <span className="text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 block mb-2">
                Soluzione Dettagliata
              </span>
              <MathMarkdown
                content={explanation || "Spiegazione completata. Procedi per consolidare l'apprendimento."}
                className="text-sm leading-relaxed"
              />
            </div>

            <div className="flex justify-end pt-2">
              <Button onClick={onNext} className="rounded-xl px-6 gap-2">
                {currentIndex < entries.length - 1 ? "Prossimo esercizio" : "Fase successiva"}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ==========================================
// 4. BossPhase
// ==========================================

export interface BossPhaseProps {
  entry: SessionEntry
  showAnswer: boolean
  onAnswer: (isCorrect: boolean, conf: number, answerData?: { choice?: number; text?: string; photos?: string[] }) => void
  onSetShowAnswer: (show: boolean) => void
  isLoading?: boolean
  onNext?: () => void
  sessionId?: number
  onPhotoUpload?: (photo: string, entryId: number) => Promise<void> | void
}

export function BossPhase({
  entry,
  showAnswer,
  onAnswer,
  onSetShowAnswer,
  isLoading,
  onNext,
  sessionId,
  onPhotoUpload,
}: BossPhaseProps) {
  const [selectedChoice, setSelectedChoice] = useState<number | null>(null)
  const [textAnswer, setTextAnswer] = useState("")
  const [notebookMode, setNotebookMode] = useState(false)
  const [photos, setPhotos] = useState<string[]>([])
  const [showPhotoUpload, setShowPhotoUpload] = useState(false)

  useEffect(() => {
    setSelectedChoice(null)
    setTextAnswer("")
    setNotebookMode(false)
    setPhotos([])
    setShowPhotoUpload(false)
  }, [entry?.id])

  if (!entry) return null

  const { prompt, choices, kind, explanation, hint, topicTitle, correctAnswer } = parseQuestionData(entry)
  const isMultiple = (kind === "multipla" || kind === "vero_falso" || choices.length > 0)

  const handlePhotosChange = (newPhotos: string[]) => {
    if (newPhotos.length > photos.length && onPhotoUpload && entry) {
      const latestPhoto = newPhotos[newPhotos.length - 1]
      onPhotoUpload(latestPhoto, entry.id)
    }
    setPhotos(newPhotos)
  }

  const handleSubmit = (overrideCorrect?: boolean) => {
    if (isLoading) return
    let isCorrect = false

    if (overrideCorrect !== undefined) {
      isCorrect = overrideCorrect
    } else if (isMultiple && selectedChoice !== null) {
      if (typeof correctAnswer === "number") {
        isCorrect = selectedChoice === correctAnswer
      } else if (typeof correctAnswer === "string") {
        const choiceText = choices[selectedChoice]
        const letter = OPTION_LETTERS[selectedChoice]
        isCorrect =
          correctAnswer.trim().toLowerCase() === choiceText?.trim().toLowerCase() ||
          correctAnswer.trim().toUpperCase() === letter
      } else {
        isCorrect = true
      }
    } else {
      isCorrect = true
    }

    onAnswer(isCorrect, 4, {
      choice: selectedChoice ?? undefined,
      text: notebookMode ? "Svolto su quaderno" : textAnswer.trim() || (photos.length > 0 ? "Svolto a mano sul quaderno (foto allegata)" : undefined),
      photos: photos.length > 0 ? photos : undefined,
    })
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Boss Card with dark/red accent styling */}
      <div className="rounded-3xl border border-rose-500/30 dark:border-rose-900/40 bg-gradient-to-b from-rose-500/5 via-white to-white dark:from-rose-950/20 dark:via-neutral-900 dark:to-neutral-950 p-6 sm:p-8 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-rose-500 text-white shadow-xs">
              <Flag className="h-3.5 w-3.5" />
              Boss Finale · Livello Esame
            </span>
            {topicTitle && (
              <Badge variant="outline" className="text-2xs border-rose-500/20 text-rose-700 dark:text-rose-300">
                {topicTitle}
              </Badge>
            )}
          </div>
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400">
            +50 XP in palio
          </span>
        </div>

        {/* Prompt */}
        <div className="mb-6">
          <MathMarkdown content={prompt} className="text-base sm:text-lg font-medium leading-relaxed" />
        </div>

        {/* Choices */}
        {isMultiple && (
          <div className="space-y-3">
            {choices.map((choice, idx) => {
              const letter = OPTION_LETTERS[idx] || `${idx + 1}`
              const isSelected = selectedChoice === idx

              let choiceStyle =
                "border-neutral-200 dark:border-neutral-800 bg-white/70 dark:bg-neutral-900/60 hover:border-rose-300 dark:hover:border-rose-800 text-neutral-800 dark:text-neutral-200"

              if (isSelected && !showAnswer) {
                choiceStyle =
                  "border-rose-500 ring-2 ring-rose-500/20 bg-rose-500/10 text-rose-900 dark:text-rose-100"
              }

              if (showAnswer) {
                const isThisCorrect =
                  typeof correctAnswer === "number"
                    ? correctAnswer === idx
                    : typeof correctAnswer === "string"
                    ? correctAnswer.trim().toLowerCase() === choice.trim().toLowerCase() ||
                      correctAnswer.trim().toUpperCase() === letter
                    : false

                if (isThisCorrect) {
                  choiceStyle =
                    "border-emerald-500 bg-emerald-500/15 text-emerald-800 dark:text-emerald-200 ring-1 ring-emerald-500/40"
                } else if (isSelected && !isThisCorrect) {
                  choiceStyle =
                    "border-rose-500 bg-rose-500/15 text-rose-800 dark:text-rose-200 ring-1 ring-rose-500/40"
                }
              }

              return (
                <button
                  key={idx}
                  type="button"
                  disabled={showAnswer || isLoading}
                  onClick={() => !showAnswer && setSelectedChoice(idx)}
                  className={cn(
                    "w-full flex items-start gap-3.5 p-4 rounded-2xl border text-left transition-all duration-150 active:scale-[0.99] disabled:cursor-default",
                    choiceStyle
                  )}
                >
                  <span
                    className={cn(
                      "flex items-center justify-center h-6 w-6 rounded-lg text-xs font-semibold shrink-0",
                      isSelected
                        ? "bg-rose-500 text-white"
                        : "bg-neutral-200/70 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400"
                    )}
                  >
                    {letter}
                  </span>
                  <div className="flex-1 pt-0.5 text-sm sm:text-base leading-snug">
                    <MathMarkdown content={choice} />
                  </div>
                </button>
              )
            })}
          </div>
        )}

        {/* Open Question or Notebook */}
        {!isMultiple && (
          <div className="space-y-4">
            <div className="flex gap-2">
              <Button
                type="button"
                variant={notebookMode ? "secondary" : "outline"}
                size="sm"
                onClick={() => setNotebookMode(!notebookMode)}
                className="gap-1.5 text-xs rounded-xl"
              >
                <PenTool className="h-3.5 w-3.5" />
                {notebookMode ? "Svolto sul quaderno ✓" : "Svolgo sul quaderno"}
              </Button>
            </div>

            {!notebookMode && (
              <textarea
                value={textAnswer}
                disabled={showAnswer || isLoading}
                onChange={(e) => setTextAnswer(e.target.value)}
                placeholder="Inserisci la dimostrazione o la soluzione finale..."
                rows={5}
                className="w-full rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white/50 dark:bg-neutral-900 p-4 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500 transition-all"
              />
            )}
          </div>
        )}

        {/* Bridge Carta e Penna: Svolgi a mano sul quaderno e allega foto */}
        <div className="pt-2 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant={showPhotoUpload || photos.length > 0 ? "secondary" : "outline"}
              size="sm"
              onClick={() => setShowPhotoUpload((prev) => !prev)}
              className="gap-2 text-xs rounded-xl"
            >
              <Camera className="h-3.5 w-3.5 text-rose-500" />
              <span>Svolgi a mano sul quaderno e allega foto</span>
              {photos.length > 0 && (
                <Badge variant="secondary" className="ml-1 text-2xs px-1.5 py-0 bg-rose-500 text-white font-mono">
                  {photos.length}
                </Badge>
              )}
            </Button>
          </div>

          {(showPhotoUpload || photos.length > 0) && (
            <div className="p-4 rounded-2xl bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 space-y-3 animate-in fade-in duration-200 text-neutral-900 dark:text-neutral-50">
              <PhotoUpload
                photos={photos}
                onPhotosChange={handlePhotosChange}
                maxPhotos={6}
                label="Foto svolgimento dimostrazione / quaderno"
                disabled={showAnswer || isLoading}
              />
              {photos.length > 0 && (
                <div className="flex items-center gap-2 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-700 dark:text-rose-300">
                  <Sparkles className="h-4 w-4 shrink-0 text-rose-500" />
                  <span>Foto allegata: l'AI analizzerà i passaggi durante la correzione</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Submit action */}
        {!showAnswer && (
          <div className="mt-6 pt-5 border-t border-neutral-200/60 dark:border-neutral-800 flex justify-end">
            <Button
              size="default"
              disabled={isLoading || (isMultiple && selectedChoice === null && !notebookMode && photos.length === 0)}
              onClick={() => handleSubmit()}
              className="bg-rose-600 hover:bg-rose-700 text-white rounded-xl px-6 text-sm font-semibold shadow-xs"
            >
              Affronta il Boss
            </Button>
          </div>
        )}

        {/* Solution feedback */}
        {showAnswer && (
          <div className="mt-6 pt-6 border-t border-neutral-200/60 dark:border-neutral-800 space-y-4">
            <div className="p-4 rounded-2xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800">
              <span className="text-xs font-bold uppercase tracking-wider text-neutral-500 block mb-2">
                Svolgimento Ufficiale d'Esame
              </span>
              <MathMarkdown
                content={explanation || "Hai completato la sfida finale del boss!"}
                className="text-sm leading-relaxed"
              />
            </div>
            <div className="flex justify-end">
              <Button onClick={() => (onNext ? onNext() : onAnswer(true, 5))} className="rounded-xl px-6 gap-2">
                Termina sfida
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ==========================================
// 5. CooldownPhase
// ==========================================

export interface CooldownPhaseProps {
  xpEarned: number
  streak: number
  questionsAnswered: number
  correctAnswers: number
  topicsUp?: any[]
  wrongItems?: any[]
}

export function CooldownPhase({
  xpEarned,
  streak,
  questionsAnswered,
  correctAnswers,
  topicsUp = [],
  wrongItems = [],
}: CooldownPhaseProps) {
  const accuracy = questionsAnswered > 0 ? Math.round((correctAnswers / questionsAnswered) * 100) : 100

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Serene Apple Card */}
      <div className="rounded-3xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-neutral-900/90 p-6 sm:p-8 shadow-xs text-center">
        <div className="inline-flex p-3 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 mb-3">
          <Heart className="h-7 w-7" />
        </div>
        <h2 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50 mb-1">
          Defaticamento & Recupero
        </h2>
        <p className="text-sm text-neutral-500 dark:text-neutral-400 max-w-md mx-auto">
          Ottimo lavoro! La tua mente sta consolidando i percorsi sinaptici appresi in questa sessione.
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <StatCard
          label="XP Guadagnati"
          value={`+${xpEarned}`}
          icon={Zap}
          iconColor="text-amber-500"
          iconBg="bg-amber-500/10"
        />
        <StatCard
          label="Precisione"
          value={`${accuracy}%`}
          icon={Target}
          iconColor="text-emerald-500"
          iconBg="bg-emerald-500/10"
        />
        <StatCard
          label="Corrette"
          value={`${correctAnswers}/${questionsAnswered}`}
          icon={CheckCircle2}
          iconColor="text-accent-500"
          iconBg="bg-accent-500/10"
        />
        <StatCard
          label="Serie Attiva"
          value={`${streak}`}
          icon={Flame}
          iconColor="text-rose-500"
          iconBg="bg-rose-500/10"
        />
      </div>

      {/* Topics Strengthened */}
      {topicsUp.length > 0 && (
        <div className="rounded-3xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-neutral-900/90 p-6 shadow-xs">
          <h3 className="text-sm font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 mb-4 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-accent-500" />
            Argomenti Rinforzati
          </h3>
          <div className="flex flex-wrap gap-2">
            {topicsUp.map((topic, tIdx) => {
              const name = typeof topic === "string" ? topic : topic?.name || topic?.title || `Argomento ${tIdx + 1}`
              return (
                <span
                  key={tIdx}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20"
                >
                  <Check className="h-3.5 w-3.5 text-emerald-500" />
                  {name}
                </span>
              )
            })}
          </div>
        </div>
      )}

      {/* Review Areas if any */}
      {wrongItems.length > 0 && (
        <div className="rounded-3xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-neutral-900/90 p-6 shadow-xs">
          <h3 className="text-sm font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 mb-3 flex items-center gap-2">
            <RotateCcw className="h-4 w-4 text-amber-500" />
            Punti da Rivedere Successivamente
          </h3>
          <ul className="space-y-2 text-xs sm:text-sm text-neutral-600 dark:text-neutral-400">
            {wrongItems.map((item, iIdx) => (
              <li key={iIdx} className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                {typeof item === "string" ? item : item?.title || item?.name || "Concetto da ripassare"}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

// ==========================================
// 6. CompletePhase
// ==========================================

export interface CompletePhaseProps {
  xpEarned: number
  streak: number
  questionsAnswered: number
  correctAnswers: number
  courseId: string
  duration: number
  verdict?: string
  nextRecommendations?: any[]
}

export function CompletePhase({
  xpEarned,
  streak,
  questionsAnswered,
  correctAnswers,
  courseId,
  duration,
  verdict = "Sessione completata con successo!",
  nextRecommendations = [],
}: CompletePhaseProps) {
  const navigate = useNavigate()
  const accuracy = questionsAnswered > 0 ? Math.round((correctAnswers / questionsAnswered) * 100) : 100

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Celebration Banner */}
      <div className="rounded-3xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-neutral-900/90 p-8 sm:p-10 shadow-xs text-center relative overflow-hidden">
        <div className="inline-flex p-4 rounded-3xl bg-amber-500/10 text-amber-500 border border-amber-500/20 mb-4 animate-in zoom-in-50 duration-300">
          <Trophy className="h-10 w-10" />
        </div>
        <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-neutral-900 dark:text-neutral-50 mb-2">
          Sessione Completata!
        </h2>
        <p className="text-sm sm:text-base text-neutral-500 dark:text-neutral-400 max-w-lg mx-auto">
          {verdict}
        </p>

        {/* XP Badge */}
        <div className="mt-5 inline-flex items-center gap-2 px-4 py-2 rounded-2xl bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20 font-mono font-bold text-base sm:text-lg">
          <Zap className="h-5 w-5 text-amber-500" />
          +{xpEarned} XP Aggiunti al tuo profilo
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <StatCard
          label="Precisione"
          value={`${accuracy}%`}
          icon={Target}
          iconColor="text-emerald-500"
          iconBg="bg-emerald-500/10"
        />
        <StatCard
          label="Domande Risolte"
          value={`${correctAnswers}/${questionsAnswered}`}
          icon={CheckCircle2}
          iconColor="text-accent-500"
          iconBg="bg-accent-500/10"
        />
        <StatCard
          label="Tempo Studio"
          value={`${duration}m`}
          icon={Brain}
          iconColor="text-blue-500"
          iconBg="bg-blue-500/10"
        />
        <StatCard
          label="Streak Attiva"
          value={`${streak} gg`}
          icon={Flame}
          iconColor="text-rose-500"
          iconBg="bg-rose-500/10"
        />
      </div>

      {/* Next Recommendations if any */}
      {nextRecommendations.length > 0 && (
        <div className="rounded-3xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-neutral-900/90 p-6 shadow-xs">
          <h3 className="text-sm font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 mb-3 flex items-center gap-2">
            <Award className="h-4 w-4 text-accent-500" />
            Consigli per il Prossimo Step
          </h3>
          <ul className="space-y-2 text-xs sm:text-sm text-neutral-700 dark:text-neutral-300">
            {nextRecommendations.map((rec, rIdx) => (
              <li key={rIdx} className="flex items-start gap-2">
                <span className="text-accent-500 font-bold">•</span>
                <span>{typeof rec === "string" ? rec : rec?.text || rec?.title}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Direct Action Buttons */}
      <div className="flex flex-col sm:flex-row gap-3 pt-2">
        <Button
          variant="outline"
          size="lg"
          onClick={() => navigate(`/corsi/${courseId}`)}
          className="flex-1 rounded-2xl h-12 text-sm font-medium"
        >
          Torna alla Panoramica Corso
        </Button>
        <Button
          size="lg"
          onClick={() => navigate(`/studio/${courseId}?duration=${duration}`)}
          className="flex-1 rounded-2xl h-12 text-sm font-medium gap-2"
        >
          <RotateCcw className="h-4 w-4" />
          Avvia Nuova Sessione
        </Button>
      </div>
    </div>
  )
}
