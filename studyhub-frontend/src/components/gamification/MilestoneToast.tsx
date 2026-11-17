import { useEffect, useState } from "react"
import { Trophy, X } from "lucide-react"
import type { Milestone } from "@/hooks/use-gamification"
import { cn } from "@/lib/utils"

interface MilestoneToastProps {
  milestone: Milestone
  onClose?: () => void
  /** Auto-dismiss after this many ms. Default 4500. Set 0 to disable. */
  duration?: number
}

/**
 * Self-contained milestone toast (custom, not tied to the shared toast API whose
 * `title` typing only accepts strings). Slides in, shows trophy + title + description,
 * and auto-dismisses. Mount it when a milestone unlocks.
 */
export function MilestoneToast({
  milestone,
  onClose,
  duration = 4500,
}: MilestoneToastProps) {
  const [visible, setVisible] = useState(false)
  const [leaving, setLeaving] = useState(false)

  // Entrance animation.
  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  // Auto-dismiss.
  useEffect(() => {
    if (duration <= 0) return
    const t = setTimeout(() => setLeaving(true), duration - 250)
    return () => clearTimeout(t)
  }, [duration])

  // Notify parent once the exit transition ends.
  useEffect(() => {
    if (!leaving) return
    const t = setTimeout(() => {
      setVisible(false)
      onClose?.()
    }, 250)
    return () => clearTimeout(t)
  }, [leaving, onClose])

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed bottom-6 left-1/2 z-600 -translate-x-1/2 sm:left-auto sm:right-6 sm:translate-x-0"
    >
      <div
        className={cn(
          "pointer-events-auto flex items-center gap-4 rounded-lg border border-accent-200 bg-white p-4 shadow-modal transition-all duration-300 ease-out dark:border-accent-800 dark:bg-neutral-900 motion-reduce:transition-none motion-reduce:opacity-100 motion-reduce:translate-y-0",
          visible && !leaving && "translate-y-0 opacity-100",
          leaving && "translate-y-2 opacity-0",
          !visible && "translate-y-4 opacity-0"
        )}
      >
        <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-accent-50 dark:bg-accent-900/30">
          <Trophy className="h-5 w-5 text-accent-500" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-accent-600 dark:text-accent-300">
            {milestone.name}
          </p>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            {milestone.description}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setLeaving(true)}
          className="ml-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          aria-label="Chiudi notifica"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}