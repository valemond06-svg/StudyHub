import React, { useState, useEffect, useRef, useCallback } from "react"
import { Play, Pause, RotateCcw, SkipForward, Volume2, VolumeX, Coffee, Brain } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

export type PomodoroMode = "study" | "break"

export interface PomodoroTimerProps {
  className?: string
  compact?: boolean
  initialStudyMinutes?: number
  initialBreakMinutes?: number
  onSessionFinish?: (mode: PomodoroMode) => void
}

/**
 * Synthesizes a delicate, harmonic Apple-style notification chime
 * using the native Web Audio API (zero external mp3/audio files).
 */
function playNativeChime(frequencyStart = 440, frequencyEnd = 880) {
  try {
    const AudioContextClass =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!AudioContextClass) return

    const ctx = new AudioContextClass()
    if (ctx.state === "suspended") {
      ctx.resume()
    }

    const now = ctx.currentTime
    const osc1 = ctx.createOscillator()
    const osc2 = ctx.createOscillator()
    const gainNode = ctx.createGain()

    osc1.type = "sine"
    osc2.type = "sine"

    // Harmonic two-tone chord ramp (440Hz -> 880Hz, with third harmonic 660Hz -> 1320Hz)
    osc1.frequency.setValueAtTime(frequencyStart, now)
    osc1.frequency.exponentialRampToValueAtTime(frequencyEnd, now + 0.18)

    osc2.frequency.setValueAtTime(frequencyStart * 1.5, now)
    osc2.frequency.exponentialRampToValueAtTime(frequencyEnd * 1.5, now + 0.18)

    // Gentle bell-like envelope with soft attack and exponential decay
    gainNode.gain.setValueAtTime(0.0001, now)
    gainNode.gain.exponentialRampToValueAtTime(0.2, now + 0.04)
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.9)

    osc1.connect(gainNode)
    osc2.connect(gainNode)
    gainNode.connect(ctx.destination)

    osc1.start(now)
    osc2.start(now + 0.02)
    osc1.stop(now + 0.9)
    osc2.stop(now + 0.9)
  } catch (err) {
    console.warn("Impossibile riprodurre la notifica Web Audio:", err)
  }
}

export function PomodoroTimer({
  className,
  compact = false,
  initialStudyMinutes = 25,
  initialBreakMinutes = 5,
  onSessionFinish,
}: PomodoroTimerProps) {
  const [mode, setMode] = useState<PomodoroMode>("study")
  const [isRunning, setIsRunning] = useState<boolean>(false)
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true)
  const [completedCycles, setCompletedCycles] = useState<number>(0)

  const studyDuration = initialStudyMinutes * 60
  const breakDuration = initialBreakMinutes * 60

  const [timeLeft, setTimeLeft] = useState<number>(studyDuration)
  const totalDuration = mode === "study" ? studyDuration : breakDuration

  const timerRef = useRef<number | null>(null)

  // Clear timer helper
  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  // Timer tick effect
  useEffect(() => {
    if (isRunning) {
      timerRef.current = window.setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            // Mode finished!
            if (soundEnabled) {
              if (mode === "study") {
                playNativeChime(440, 880)
              } else {
                playNativeChime(660, 440)
              }
            }

            const nextMode: PomodoroMode = mode === "study" ? "break" : "study"
            setMode(nextMode)
            if (mode === "study") {
              setCompletedCycles((c) => c + 1)
            }
            onSessionFinish?.(mode)

            return nextMode === "study" ? studyDuration : breakDuration
          }
          return prev - 1
        })
      }, 1000)
    } else {
      stopTimer()
    }

    return () => stopTimer()
  }, [isRunning, mode, soundEnabled, studyDuration, breakDuration, onSessionFinish, stopTimer])

  // Play / Pause toggle
  const togglePlay = () => {
    setIsRunning((prev) => !prev)
  }

  // Reset current timer
  const handleReset = () => {
    setIsRunning(false)
    stopTimer()
    setTimeLeft(mode === "study" ? studyDuration : breakDuration)
  }

  // Skip or switch between study and break
  const handleSwitchMode = () => {
    setIsRunning(false)
    stopTimer()
    const nextMode: PomodoroMode = mode === "study" ? "break" : "study"
    setMode(nextMode)
    setTimeLeft(nextMode === "study" ? studyDuration : breakDuration)
  }

  // Formatted mm:ss
  const minutes = Math.floor(timeLeft / 60)
  const seconds = timeLeft % 60
  const formattedTime = `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`

  // SVG Circular progress math
  const radius = compact ? 42 : 58
  const strokeWidth = compact ? 5 : 7
  const circumference = 2 * Math.PI * radius
  const progressRatio = totalDuration > 0 ? timeLeft / totalDuration : 0
  const strokeDashoffset = circumference - progressRatio * circumference

  if (compact) {
    /* Compact layout variant (e.g. for header or sidebars) */
    return (
      <div
        className={cn(
          "flex items-center gap-3 p-2 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200/80 dark:border-neutral-800 shadow-xs",
          className
        )}
      >
        <div className="relative flex items-center justify-center">
          <svg
            className="transform -rotate-90"
            width={radius * 2 + strokeWidth * 2}
            height={radius * 2 + strokeWidth * 2}
          >
            <circle
              cx={radius + strokeWidth}
              cy={radius + strokeWidth}
              r={radius}
              stroke="currentColor"
              strokeWidth={strokeWidth}
              fill="transparent"
              className="text-neutral-100 dark:text-neutral-800"
            />
            <circle
              cx={radius + strokeWidth}
              cy={radius + strokeWidth}
              r={radius}
              stroke="currentColor"
              strokeWidth={strokeWidth}
              fill="transparent"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
              className={cn(
                "transition-all duration-300",
                mode === "study" ? "text-accent-500" : "text-emerald-500"
              )}
            />
          </svg>
          <span className="absolute font-mono text-xs font-semibold tracking-tight text-neutral-800 dark:text-neutral-200">
            {formattedTime}
          </span>
        </div>

        <div className="flex flex-col">
          <div className="flex items-center gap-1.5">
            <Badge
              variant="outline"
              className={cn(
                "text-3xs px-1.5 py-0",
                mode === "study"
                  ? "border-accent-200 dark:border-accent-900 text-accent-600 dark:text-accent-400"
                  : "border-emerald-200 dark:border-emerald-900 text-emerald-600 dark:text-emerald-400"
              )}
            >
              {mode === "study" ? "Studio" : "Pausa"}
            </Badge>
          </div>
          <div className="flex items-center gap-1 mt-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-neutral-600 dark:text-neutral-300"
              onClick={togglePlay}
            >
              {isRunning ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-neutral-400 hover:text-neutral-600"
              onClick={handleReset}
            >
              <RotateCcw className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </div>
    )
  }

  /* Full circular widget card layout */
  return (
    <div
      className={cn(
        "flex flex-col items-center p-6 rounded-3xl bg-white dark:bg-neutral-900 border border-neutral-200/90 dark:border-neutral-800 shadow-sm",
        className
      )}
    >
      {/* Top Header Mode & Sound Toggle */}
      <div className="flex items-center justify-between w-full mb-4">
        <div className="flex items-center gap-2">
          {mode === "study" ? (
            <div className="flex items-center gap-1.5 text-accent-600 dark:text-accent-400">
              <Brain className="h-4 w-4" />
              <span className="text-xs font-semibold uppercase tracking-wider">Sessione Studio</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
              <Coffee className="h-4 w-4" />
              <span className="text-xs font-semibold uppercase tracking-wider">Pausa Relax</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
            onClick={() => setSoundEnabled((prev) => !prev)}
            title={soundEnabled ? "Suono attivo (disattiva)" : "Suono disattivato (attiva)"}
          >
            {soundEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* Circular Timer Ring */}
      <div className="relative flex items-center justify-center my-2">
        <svg
          className="transform -rotate-90"
          width={radius * 2 + strokeWidth * 2}
          height={radius * 2 + strokeWidth * 2}
        >
          {/* Track background */}
          <circle
            cx={radius + strokeWidth}
            cy={radius + strokeWidth}
            r={radius}
            stroke="currentColor"
            strokeWidth={strokeWidth}
            fill="transparent"
            className="text-neutral-100 dark:text-neutral-800"
          />
          {/* Animated active stroke */}
          <circle
            cx={radius + strokeWidth}
            cy={radius + strokeWidth}
            r={radius}
            stroke="currentColor"
            strokeWidth={strokeWidth}
            fill="transparent"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            className={cn(
              "transition-all duration-300",
              mode === "study" ? "text-accent-500" : "text-emerald-500"
            )}
          />
        </svg>

        {/* Center Display */}
        <div className="absolute flex flex-col items-center justify-center text-center">
          <span className="text-3xl font-bold font-mono tracking-tight text-neutral-900 dark:text-neutral-50">
            {formattedTime}
          </span>
          <span className="text-2xs text-neutral-400 dark:text-neutral-500 uppercase tracking-wider font-medium mt-0.5">
            {mode === "study" ? "25 min focus" : "5 min break"}
          </span>
        </div>
      </div>

      {/* Cycle Indicator Dots */}
      <div className="flex items-center gap-1.5 my-3">
        {[0, 1, 2, 3].map((idx) => {
          const filled = idx < completedCycles % 4
          return (
            <div
              key={idx}
              className={cn(
                "h-2 w-2 rounded-full transition-all duration-200",
                filled
                  ? "bg-accent-500 dark:bg-accent-400 scale-110"
                  : "bg-neutral-200 dark:bg-neutral-700"
              )}
            />
          )
        })}
        {completedCycles > 0 && (
          <span className="text-2xs font-mono text-neutral-400 ml-1.5">
            +{completedCycles}
          </span>
        )}
      </div>

      {/* Action Controls */}
      <div className="flex items-center gap-2 mt-2 w-full justify-center">
        {/* Reset */}
        <Button
          variant="outline"
          size="icon"
          className="h-10 w-10 rounded-xl text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
          onClick={handleReset}
          title="Ripristina timer"
        >
          <RotateCcw className="h-4 w-4" />
        </Button>

        {/* Play / Pause Primary */}
        <Button
          size="default"
          className={cn(
            "h-10 px-6 rounded-xl font-medium gap-2 shadow-sm transition-all",
            mode === "study"
              ? "bg-accent-500 hover:bg-accent-600 text-white"
              : "bg-emerald-600 hover:bg-emerald-700 text-white"
          )}
          onClick={togglePlay}
        >
          {isRunning ? (
            <>
              <Pause className="h-4 w-4 fill-current" />
              <span>Pausa</span>
            </>
          ) : (
            <>
              <Play className="h-4 w-4 fill-current ml-0.5" />
              <span>Avvia</span>
            </>
          )}
        </Button>

        {/* Skip to other phase */}
        <Button
          variant="outline"
          size="icon"
          className="h-10 w-10 rounded-xl text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
          onClick={handleSwitchMode}
          title={mode === "study" ? "Passa alla pausa (5m)" : "Torna a studio (25m)"}
        >
          <SkipForward className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
