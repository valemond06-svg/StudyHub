import { useEffect, useState } from "react"
import { Zap } from "lucide-react"
import { cn } from "@/lib/utils"

interface XpPillProps {
  /** Amount of XP to show, e.g. "+25". */
  xp: number
  /** Called after the pill animates out (~1.5s). */
  onComplete?: () => void
  /** Override the display duration in ms. Default 1500. */
  duration?: number
}

/**
 * Animated pill that slides up and fades out after gaining XP.
 * Mount it with a changing `key` to replay the animation on each gain.
 */
export function XpPill({ xp, onComplete, duration = 1500 }: XpPillProps) {
  // Fade/slide-in on mount, then out after `duration`.
  const [shown, setShown] = useState(false)
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    // Small delay so the entrance transition plays from the initial hidden state.
    const raf = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  useEffect(() => {
    const t = setTimeout(() => setLeaving(true), duration - 250)
    return () => clearTimeout(t)
  }, [duration])

  useEffect(() => {
    if (!leaving) return
    const t = setTimeout(() => onComplete?.(), 250)
    return () => clearTimeout(t)
  }, [leaving, onComplete])

  return (
    <div
      role="status"
      aria-label={`+${xp} punti esperienza`}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-accent-500 px-3 py-1.5 font-mono text-sm font-semibold text-white shadow-elevated transition-all duration-300 ease-out motion-reduce:transition-none motion-reduce:opacity-100 motion-reduce:translate-y-0",
        leaving && "opacity-0 translate-y-[-6px]",
        shown && !leaving && "opacity-100 translate-y-0",
        !shown && "opacity-0 translate-y-[-6px]"
      )}
    >
      <Zap className="h-4 w-4" aria-hidden="true" />
      <span>+{xp}</span>
    </div>
  )
}