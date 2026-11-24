import { Flag, Check, Loader2, BookOpen } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { SessionEntry, OnAnswerCallback } from "./types"

interface LearnPhaseProps {
  entries: SessionEntry[]
  currentIndex: number
  showAnswer: boolean
  confidence: number
  onAnswer: OnAnswerCallback
  onSetShowAnswer: (v: boolean) => void
  isLoading?: boolean
}

export function LearnPhase({
  entries,
  currentIndex,
  showAnswer,
  confidence,
  onAnswer,
  onSetShowAnswer,
  isLoading = false,
}: LearnPhaseProps) {
  const entry = entries[currentIndex]

  if (!entry || entry.t !== "scheda") return null

  const schedaEntries = entries.filter(e => e.t === "scheda")
  const schedaIndex = schedaEntries.indexOf(entry)

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <Card>
        <CardContent className="p-6 space-y-6">
          {/* Step header */}
          <div className="flex items-center gap-3">
            <Badge variant="accent" className="text-sm">
              Argomento {schedaIndex + 1}/{schedaEntries.length}
            </Badge>
            <h2 className="text-xl font-semibold text-neutral-950 dark:text-neutral-50">
              Topic #{entry.topic}
            </h2>
          </div>

          <div className="p-4 rounded-lg bg-accent-50 dark:bg-accent-900/20 border border-accent-200 dark:border-accent-800">
            <div className="flex items-start gap-3">
              <BookOpen className="h-5 w-5 text-accent-600 dark:text-accent-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-medium text-neutral-900 dark:text-neutral-100 mb-1">Studia questo argomento</p>
                <p className="text-sm text-neutral-600 dark:text-neutral-300">
                  Leggi il materiale del topic {entry.topic} prima di rispondere alle domande di pratica.
                  Prenditi il tempo necessario per comprendere bene i concetti.
                </p>
              </div>
            </div>
          </div>

          <Button onClick={() => onAnswer(true, confidence)} className="w-full" size="lg" disabled={isLoading}>
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Ho studiato — passa al prossimo
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}