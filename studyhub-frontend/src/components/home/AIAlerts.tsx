import { AlertTriangle, XCircle } from "lucide-react"
import type { AIProblem } from "@/lib/ai-health"
import { cn } from "@/lib/utils"

/** Problemi reali dell'AI (abbonamento Claude rifiutato, job falliti, coda in pausa). */
export function AIAlerts({ problems, className }: { problems: AIProblem[]; className?: string }) {
  if (!problems.length) return null
  return (
    <div className={cn("space-y-2", className)} role="region" aria-label="Problemi dell'AI">
      {problems.map((p) => (
        <div
          key={p.id}
          role={p.level === "error" ? "alert" : "status"}
          className={cn(
            "flex items-start gap-3 rounded-xl border p-3 text-sm",
            p.level === "error"
              ? "border-error-200 bg-error-50 text-error-800 dark:border-error-900/50 dark:bg-error-950/30 dark:text-error-200"
              : "border-warning-200 bg-warning-50 text-warning-800 dark:border-warning-900/50 dark:bg-warning-950/30 dark:text-warning-200"
          )}
        >
          {p.level === "error" ? <XCircle className="h-4 w-4 mt-0.5 shrink-0" /> : <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />}
          <div className="min-w-0">
            <p className="font-medium">{p.title}</p>
            {p.detail && <p className="mt-0.5 break-words opacity-90">{p.detail}</p>}
            {p.hint && <p className="mt-1 text-xs opacity-80">{p.hint}</p>}
          </div>
        </div>
      ))}
    </div>
  )
}
