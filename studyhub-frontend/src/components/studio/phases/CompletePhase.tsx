import { Check, Zap, Heart, Target, RotateCcw, ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { StatCard } from "./StatCard"
import { useNavigate } from "react-router-dom"

interface CompletePhaseProps {
  xpEarned: number
  streak: number
  questionsAnswered: number
  correctAnswers: number
  courseId: string
  duration: number
  verdict?: string
  nextRecommendations?: Array<{ type: string; text: string }>
}

export function CompletePhase({
  xpEarned,
  streak,
  questionsAnswered,
  correctAnswers,
  courseId,
  duration,
  verdict = "Hai completato la sessione. I risultati sono stati salvati.",
  nextRecommendations = [],
}: CompletePhaseProps) {
  const navigate = useNavigate()

  return (
    <div className="space-y-6 max-w-3xl mx-auto text-center">
      <div className="p-8 rounded-2xl bg-success-50 dark:bg-success-900/20 border-2 border-success-200 dark:border-success-800">
        <Check className="h-16 w-16 mx-auto text-success-500 mb-4" />
        <h2 className="text-3xl font-bold text-success-700 dark:text-success-400 mb-2">Complimenti! 🎉</h2>
        <p className="text-success-600 dark:text-success-300 text-lg">{verdict}</p>
      </div>

      <Card>
        <CardContent className="p-6 space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <StatCard label="XP totali" value={xpEarned} icon={<Zap className="h-5 w-5 text-warning-500" />} />
            <StatCard label="Streak" value={`${streak} 🔥`} icon={<Heart className="h-5 w-5 text-error-500" />} />
            <StatCard label="Precisione" value={`${questionsAnswered ? Math.round(correctAnswers / questionsAnswered * 100) : 0}%`} icon={<Target className="h-5 w-5 text-accent-500" />} />
          </div>

          <Separator />

          <div className="space-y-3">
            <h4 className="font-medium">Prossimi passi consigliati:</h4>
            <ul className="space-y-2 text-left">
              {nextRecommendations.length > 0 ? (
                nextRecommendations.map((rec, i) => (
                  <li key={i} className="p-3 rounded-lg bg-accent-50 dark:bg-accent-900/20 border border-accent-200 dark:border-accent-800">
                    {rec.text}
                  </li>
                ))
              ) : (
                <>
                  <li className="p-3 rounded-lg bg-warning-50 dark:bg-warning-900/20 border border-warning-200 dark:border-warning-800">
                    Rivedi gli argomenti con errori
                  </li>
                  <li className="p-3 rounded-lg bg-accent-50 dark:bg-accent-900/20 border border-accent-200 dark:border-accent-800">
                    Prossima lezione suggerita
                  </li>
                  <li className="p-3 rounded-lg bg-success-50 dark:bg-success-900/20 border border-success-200 dark:border-success-800">
                    Flashcard in scadenza da ripassare
                  </li>
                </>
              )}
            </ul>
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" onClick={() => navigate(`/corsi/${courseId}`)}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Torna al corso
        </Button>
        <Button className="flex-1" onClick={() => navigate(`/studio/${courseId}?duration=${duration}`)}>
          <RotateCcw className="h-4 w-4 mr-1" />
          Nuova sessione
        </Button>
      </div>
    </div>
  )
}