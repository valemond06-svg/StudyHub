import { cn } from "@/lib/utils"

interface LevelRingProps {
  /** Current player level. */
  level: number
  /** Total XP earned. */
  xp: number
  /** XP required to reach the next level. */
  xpToNext: number
  /** Ring size in px. Default 64. */
  size?: number
  /** Stroke width in px. Default 6. */
  strokeWidth?: number
}

const RADIUS = 45

/** Total XP accumulated up to (but not including) `level`. Mirrors the gamification hook. */
function levelStartXp(level: number): number {
  let total = 0
  for (let l = 1; l < level; l++) total += 100 * l
  return total
}

/**
 * SVG progress ring showing the current level and progress toward the next one.
 * Accessible: exposes the numeric progress via aria attributes.
 */
export function LevelRing({
  level,
  xp,
  xpToNext,
  size = 64,
  strokeWidth = 6,
}: LevelRingProps) {
  const circumference = 2 * Math.PI * RADIUS
  // XP required to reach this level (sum of all prior level thresholds).
  // xpToNext varies per level, so we derive the level's starting XP.
  const levelStart = levelStartXp(level)
  const progressWithinLevel = xpToNext > 0 ? (xp - levelStart) / xpToNext : 0
  const clamped = Math.min(Math.max(progressWithinLevel, 0), 1)
  const offset = circumference * (1 - clamped)
  const percent = Math.round(clamped * 100)

  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Livello ${level}, ${percent}% verso il livello ${level + 1}`}
    >
      <svg
        viewBox="0 0 100 100"
        width={size}
        height={size}
        className="rotate-[-90deg]"
        aria-hidden="true"
      >
        {/* Track */}
        <circle
          cx="50"
          cy="50"
          r={RADIUS}
          fill="none"
          strokeWidth={strokeWidth}
          className="stroke-neutral-200 dark:stroke-neutral-700"
        />
        {/* Progress */}
        <circle
          cx="50"
          cy="50"
          r={RADIUS}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="stroke-accent-500 transition-[stroke-dashoffset] duration-300 ease-out"
        />
      </svg>
      <div
        className="absolute inset-0 flex items-center justify-center"
        aria-hidden="true"
      >
        <span className={cn("font-mono font-bold leading-none text-accent-500", size <= 56 ? "text-xs" : "text-sm")}>
          {level}
        </span>
      </div>
      <span className="sr-only">Totale {xp} XP</span>
    </div>
  )
}