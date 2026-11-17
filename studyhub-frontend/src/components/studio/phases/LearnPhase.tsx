import { Zap, Flag, X, Check, Brain, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import type { SessionEntry, PhaseConfig, OnAnswerCallback } from "./types"

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

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <Card>
        <CardContent className="p-6 space-y-6">
          {/* Step header */}
          <div className="flex items-center gap-3">
            <Badge variant="accent" className="text-sm">
              Argomento {currentIndex + 1}/{entries.filter(e => e.t === "scheda").length}
            </Badge>
            <h2 className="text-xl font-semibold">Caricamento lezione...</h2>
          </div>

          <div className="p-4 rounded-lg bg-accent-50 dark:bg-accent-900/20 border border-accent-200 dark:border-accent-800">
            <p className="text-neutral-700 dark:text-neutral-300">
              La lezione interattiva per questo argomento sta caricando.
              Include: spiegazione, verifica immediata, esempio d'esame, errori tipici e riepilogo.
            </p>
          </div>

          <Button onClick={() => onAnswer(true, confidence)} className="w-full" size="lg" disabled={isLoading}>
            Passo successivo
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}