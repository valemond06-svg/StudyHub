import { useState } from "react"
import { Check, X, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { RadioGroup, RadioGroupItem } from "@radix-ui/react-radio-group"
import type { SessionEntry, PhaseConfig } from "./types"

interface WarmupPhaseProps {
  entries: SessionEntry[]
  currentIndex: number
  showAnswer: boolean
  confidence: number
  currentPhaseConfig: PhaseConfig
  onAnswer: (isCorrect: boolean, confidence: number, answerData?: { choice?: number; text?: string }) => void
  onNext: () => void
  onSetShowAnswer: (v: boolean) => void
  onSetConfidence: (v: number) => void
  onReveal?: () => void
  isLoading?: boolean
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
  onSetConfidence,
  onReveal,
  isLoading = false,
}: WarmupPhaseProps) {
  const item = entries[currentIndex]
  const [userAnswer, setUserAnswer] = useState<string | number | null>(null)
  const [revealLoading, setRevealLoading] = useState(false)

  if (!item || item.t !== "domanda" || !item.question) return null
  const question = item.question

  const handleOptionClick = (option: string | number) => {
    setUserAnswer(option)
    const isCorrect = option === question.answer_md || option === question.correct
    onAnswer(isCorrect, confidence, { choice: typeof option === "number" ? option : undefined })
  }

  const handleReveal = async () => {
    if (onReveal) {
      setRevealLoading(true)
      await onReveal()
      setRevealLoading(false)
    }
    onSetShowAnswer(true)
  }

  const renderOptions = () => {
    if (question.kind === "vero_falso") {
      return (
        <div className="flex gap-3" role="radiogroup" aria-label="Scegli Vero o Falso">
          <Button
            variant={userAnswer === 1 ? "default" : "outline"}
            className="flex-1"
            onClick={() => handleOptionClick(1)}
            disabled={showAnswer || isLoading}
          >
            Vero
          </Button>
          <Button
            variant={userAnswer === 0 ? "default" : "outline"}
            className="flex-1"
            onClick={() => handleOptionClick(0)}
            disabled={showAnswer || isLoading}
          >
            Falso
          </Button>
        </div>
      )
    }

    if (question.options && question.options.length > 0) {
      return (
        <div className="space-y-3" role="radiogroup" aria-label="Scegli un'opzione">
          {question.options.map((opt, i) => (
            <Button
              key={i}
              variant={userAnswer === i ? "default" : "outline"}
              className="w-full justify-start"
              onClick={() => handleOptionClick(i)}
              disabled={showAnswer || isLoading}
            >
              {opt}
            </Button>
          ))}
        </div>
      )
    }

    return (
      <div className="space-y-2">
        <textarea
          placeholder="Scrivi la tua risposta..."
          className="w-full min-h-[100px] p-3 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900"
          rows={4}
          value={userAnswer as string || ""}
          onChange={(e) => setUserAnswer(e.target.value)}
          disabled={showAnswer || isLoading}
        />
        <Button
          onClick={() => {
            onAnswer(true, confidence, { text: userAnswer as string })
          }}
          className="w-full"
          disabled={showAnswer || isLoading || !userAnswer}
        >
          Conferma
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="text-center mb-8">
        <div className={cn("inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium", currentPhaseConfig.bg, currentPhaseConfig.color)}>
          <currentPhaseConfig.icon className="h-4 w-4" />
          {currentPhaseConfig.label} - Domanda {currentIndex + 1}/{entries.length}
        </div>
      </div>

      <Card className={cn("border-2", showAnswer ? "border-success-300 dark:border-success-700" : "border-neutral-200 dark:border-neutral-700")}>
        <CardContent className="p-8 text-center">
          <div className="flex items-center justify-center gap-2 mb-4">
            <Badge variant={question.kind === "esercizio" ? "accent" : "outline"} className="text-xs capitalize">
              {question.kind}
            </Badge>
            <Badge variant="outline" className="text-xs">
              Topic {question.topic_id}
            </Badge>
            <Badge variant={question.difficulty >= 3 ? "destructive" : question.difficulty >= 2 ? "warning" : "success"} className="text-xs">
              Difficoltà {question.difficulty}
            </Badge>
          </div>

          <p className="text-2xl font-medium text-neutral-950 dark:text-neutral-50 mb-6">{question.prompt_md}</p>

          {!showAnswer && (
            <div className="space-y-3">
              {renderOptions()}
            </div>
          )}

          {showAnswer && (
            <div className="space-y-4 text-left">
              <div className={cn("p-4 rounded-lg", question.kind === "vero_falso" ? "bg-success-50 dark:bg-success-900/20" : "bg-accent-50 dark:bg-accent-900/20")}>
                <p className="font-medium">Risposta corretta: {question.answer_md || question.correct !== undefined ? (question.correct === 1 ? "Vero" : question.correct === 0 ? "Falso" : question.answer_md) : "—"}</p>
              </div>
              <div className="p-4 rounded-lg bg-neutral-100 dark:bg-neutral-800">
                <p className="font-medium mb-2">Soluzione:</p>
                <p className="text-sm text-neutral-600 dark:text-neutral-300">{question.answer_md}</p>
              </div>
              {question.lecture_id && question.t_start && (
                <Button variant="outline" className="w-full gap-2" size="sm" onClick={onReveal}>
                  <Loader2 className="h-4 w-4" />
                  Vai al minuto {Math.floor((question.t_start || 0) / 60)}:{String((question.t_start || 0) % 60).padStart(2, '0')} della lezione
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Progress value={((currentIndex + (showAnswer ? 1 : 0)) / entries.length) * 100} className="h-2" />
    </div>
  )
}