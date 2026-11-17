import { Check, Zap } from "lucide-react"
import { cn } from "@/lib/utils"

export interface Objective {
  id: string
  title: string
  xp: number
  type: "daily" | "weekly" | "custom"
}

interface ObjectiveCardProps {
  objective: Objective
  completed: boolean
  onComplete: (id: string) => void
}

/**
 * A single daily/weekly objective with a checkbox and an XP reward.
 * Fades slightly and shows a checkmark when completed.
 */
export function ObjectiveCard({ objective, completed, onComplete }: ObjectiveCardProps) {
  const toggle = () => {
    if (!completed) onComplete(objective.id)
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={completed}
      aria-pressed={completed}
      className={cn(
        "group flex w-full items-center gap-3 rounded-lg border border-neutral-200 bg-white p-3 text-left shadow-subtle transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 dark:border-neutral-700 dark:bg-neutral-900",
        completed
          ? "cursor-default opacity-60"
          : "hover:border-accent-300 hover:shadow-default dark:hover:border-accent-700"
      )}
    >
      {/* Checkbox */}
      <span
        className={cn(
          "flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border transition-all duration-150",
          completed
            ? "border-accent-500 bg-accent-500 text-white"
            : "border-neutral-300 bg-white text-transparent group-hover:border-accent-400 dark:border-neutral-600 dark:bg-neutral-800"
        )}
        aria-hidden="true"
      >
        <Check className="h-3.5 w-3.5" strokeWidth={3} />
      </span>

      {/* Title */}
      <span className="flex-1">
        <span
          className={cn(
            "block text-sm font-medium text-neutral-800 dark:text-neutral-100",
            completed && "line-through decoration-neutral-400"
          )}
        >
          {objective.title}
        </span>
        <span className="mt-0.5 block text-xs capitalize text-neutral-400 dark:text-neutral-500">
          {objective.type}
        </span>
      </span>

      {/* XP reward */}
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-xs font-semibold transition-colors",
          completed
            ? "bg-neutral-100 text-neutral-400 dark:bg-neutral-800 dark:text-neutral-500"
            : "bg-accent-50 text-accent-600 dark:bg-accent-900/30 dark:text-accent-300"
        )}
        aria-label={`Vale ${objective.xp} punti esperienza`}
      >
        <Zap className="h-3 w-3" aria-hidden="true" />
        +{objective.xp}
      </span>
    </button>
  )
}