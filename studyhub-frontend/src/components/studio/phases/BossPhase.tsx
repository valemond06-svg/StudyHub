import { useState } from "react"
import { Flag, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { MathMarkdown } from "@/components/ui/math-markdown"
import type { SessionEntry } from "./types"

interface BossPhaseProps {
  entry: SessionEntry
  showAnswer: boolean
  onAnswer: (isCorrect: boolean, confidence: number, answerData?: { text?: string }) => void
  onSetShowAnswer: (v: boolean) => void
  isLoading?: boolean
}

export function BossPhase({
  entry,
  showAnswer,
  onAnswer,
  onSetShowAnswer,
  isLoading = false,
}: BossPhaseProps) {
  const [userAnswer, setUserAnswer] = useState<string>("")
  const [revealLoading, setRevealLoading] = useState(false)

  if (!entry || !entry.question) return null

  const item = entry.question

  const handleSubmit = () => {
    if (userAnswer.trim()) {
      onAnswer(true, 3, { text: userAnswer })
    }
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto text-center">
      <div className="p-6 rounded-2xl bg-error-50 dark:bg-error-900/20 border-2 border-error-200 dark:border-error-800">
        <Flag className="h-12 w-12 mx-auto text-error-500 mb-4" />
        <h2 className="text-2xl font-bold text-error-700 dark:text-error-400 mb-2">Boss Finale</h2>
        <p className="text-error-600 dark:text-error-300">Domanda stile esame. Dimostra di aver imparato!</p>
      </div>

      <Card className={cn("border-2", showAnswer ? "border-success-300 dark:border-success-700" : "border-error-200 dark:border-error-700")}>
        <CardContent className="p-8">
          <div className="flex items-center justify-center gap-2 mb-6">
            <Badge variant="destructive" className="text-sm">ESAME</Badge>
            <Badge variant="accent" className="text-sm">Topic {item.topic_id}</Badge>
            <Badge variant={item.difficulty >= 3 ? "destructive" : "warning"} className="text-sm">
              Difficoltà {item.difficulty}
            </Badge>
          </div>

          <p className="text-lg font-medium text-neutral-950 dark:text-neutral-50 mb-6">
            <MathMarkdown content={item.prompt_md || ""} />
          </p>

          {!showAnswer && (
            <div className="space-y-4">
              <textarea
                placeholder="Scrivi la tua soluzione completa..."
                className="w-full min-h-[150px] p-4 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 font-mono text-sm"
                rows={6}
                value={userAnswer}
                onChange={(e) => setUserAnswer(e.target.value)}
                disabled={isLoading}
              />
              <Button onClick={handleSubmit} className="w-full" size="lg" disabled={isLoading || !userAnswer.trim()}>
                Consegna
              </Button>
            </div>
          )}

          {showAnswer && (
            <div className="space-y-4">
              <div className="p-4 rounded-lg bg-success-50 dark:bg-success-900/20 border border-success-200 dark:border-success-800">
                <p className="font-medium text-success-700 dark:text-success-400 mb-2">✓ Consegnato per correzione</p>
                <p className="text-sm text-neutral-600 dark:text-neutral-300">La correzione AI arriverà tra pochi secondi...</p>
              </div>
              <div className="p-4 rounded-lg bg-neutral-100 dark:bg-neutral-800">
                <p className="font-medium mb-2">Soluzione di riferimento:</p>
                <p className="text-sm text-neutral-600 dark:text-neutral-300 font-mono whitespace-pre-wrap">{item.answer_md}</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}