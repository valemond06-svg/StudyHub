import { Heart, Zap, HelpCircle, Check, X } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { StatCard } from "./StatCard"
import { cn } from "@/lib/utils"

interface CooldownPhaseProps {
  xpEarned: number
  streak: number
  questionsAnswered: number
  correctAnswers: number
  topicsUp?: Array<{ name: string; from: number; to: number; level_name: string }>
  wrongItems?: Array<{ prompt_md: string; topic: string }>
}

export function CooldownPhase({
  xpEarned,
  streak,
  questionsAnswered,
  correctAnswers,
  topicsUp = [],
  wrongItems = [],
}: CooldownPhaseProps) {
  return (
    <div className="space-y-6 max-w-3xl mx-auto text-center">
      <div className="p-8 rounded-2xl bg-success-50 dark:bg-success-900/20 border-2 border-success-200 dark:border-success-800">
        <Heart className="h-12 w-12 mx-auto text-success-500 mb-4" />
        <h2 className="text-2xl font-bold text-success-700 dark:text-success-400 mb-2">Sessione completata!</h2>
        <p className="text-success-600 dark:text-success-300">Ottimo lavoro. Ecco il riepilogo.</p>
      </div>

      <Card>
        <CardContent className="p-6 space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <StatCard label="XP guadagnati" value={xpEarned} icon={<Zap className="h-5 w-5 text-warning-500" />} />
            <StatCard label="Domande" value={`${questionsAnswered} risposte`} icon={<HelpCircle className="h-5 w-5 text-accent-500" />} />
            <StatCard label="Corrette" value={`${correctAnswers} / ${questionsAnswered}`} icon={<Check className="h-5 w-5 text-success-500" />} />
          </div>

          {topicsUp.length > 0 && (
            <>
              <Separator />
              <div className="space-y-3 text-left">
                <h4 className="font-medium">Argomenti migliorati:</h4>
                <ul className="space-y-1 text-sm text-neutral-600 dark:text-neutral-300">
                  {topicsUp.slice(0, 5).map((topic, i) => (
                    <li key={i} className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-success-500" />
                      {topic.name}: {Math.round(topic.from * 100)}% → {Math.round(topic.to * 100)}% ({topic.level_name})
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}

          {wrongItems.length > 0 && (
            <>
              <Separator />
              <div className="space-y-3 text-left">
                <h4 className="font-medium">Da rivedere:</h4>
                <ul className="space-y-1 text-sm text-neutral-600 dark:text-neutral-300">
                  {wrongItems.slice(0, 3).map((item, i) => (
                    <li key={i} className="flex items-center gap-2">
                      <X className="h-3 w-3 text-error-500" />
                      {item.topic}: {item.prompt_md.substring(0, 60)}...
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}