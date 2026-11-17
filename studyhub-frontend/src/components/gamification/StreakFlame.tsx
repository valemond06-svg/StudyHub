import { Flame } from "lucide-react"
import { cn } from "@/lib/utils"

interface StreakFlameProps {
  /** Current streak length in days. */
  streak: number
  /** Optional label suffix. Defaults to "giorni". */
  suffix?: string
  /** Show the day counter (default true). */
  showCount?: boolean
}

type StreakLevel = "low" | "ok" | "good" | "great" | "legend"

const STREAK_LEVELS: Array<{ min: number; level: StreakLevel; color: string; ring: string }> = [
  { min: 60, level: "legend", color: "text-error-500", ring: "ring-error-500/30" },
  { min: 30, level: "great", color: "text-warning-500", ring: "ring-warning-500/30" },
  { min: 14, level: "good", color: "text-warning-600", ring: "ring-warning-600/30" },
  { min: 7, level: "ok", color: "text-accent-500", ring: "ring-accent-500/30" },
  { min: 0, level: "low", color: "text-neutral-400", ring: "ring-neutral-400/30" },
]

function getLevel(streak: number) {
  return STREAK_LEVELS.find((l) => streak >= l.min) ?? STREAK_LEVELS[STREAK_LEVELS.length - 1]
}

/**
 * Flame indicator with a day counter. Intensity/color scales with streak length.
 * Pulses gently when the streak is short (at risk of resetting).
 */
export function StreakFlame({
  streak,
  suffix = "giorni",
  showCount = true,
}: StreakFlameProps) {
  const level = getLevel(streak)
  const atRisk = streak > 0 && streak < 7

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-neutral-100 px-3 py-1.5 ring-1 ring-inset dark:bg-neutral-800",
        level.ring
      )}
      title={`Streak: ${streak} ${suffix}`}
    >
      <Flame
        className={cn(
          "h-4 w-4",
          level.color,
          atRisk && "animate-pulse"
        )}
        aria-hidden="true"
        strokeWidth={2.5}
      />
      {showCount && (
        <span
          className={cn(
            "font-mono font-semibold tabular-nums",
            level.color
          )}
          aria-label={`${streak} ${suffix}`}
        >
          {streak}
        </span>
      )}
    </div>
  )
}