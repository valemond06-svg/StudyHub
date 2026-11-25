import React, { useState, useRef, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import {
  Play,
  Pause,
  RotateCcw,
  Volume2,
  VolumeX,
  AlertTriangle,
  Flame,
  BookOpen,
  Sparkles,
  ChevronDown,
  ChevronUp,
  FileText,
  Target,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { MathMarkdown } from "@/components/ui/math-markdown"
import type { FeedShort } from "@/types"
import { cn } from "@/lib/utils"

export interface FeedCardProps {
  short: FeedShort
  index: number
  total: number
  isActive?: boolean
  onNext?: () => void
  onPrev?: () => void
}

const CLIP_DURATION = 25 // 25 seconds clip

export function FeedCard({
  short,
  index,
  total,
  isActive = false,
  onNext,
  onPrev,
}: FeedCardProps) {
  const navigate = useNavigate()
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [audioError, setAudioError] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [showTrap, setShowTrap] = useState(false)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const startSec = short.audio?.start_s ?? 0
  const endSec = startSec + CLIP_DURATION

  // Reset audio state when card or short changes
  useEffect(() => {
    setIsPlaying(false)
    setCurrentTime(0)
    setAudioError(false)
    setShowTrap(false)
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.currentTime = startSec
    }
  }, [short.id, startSec])

  // Pause audio when card becomes inactive
  useEffect(() => {
    if (!isActive && isPlaying && audioRef.current) {
      audioRef.current.pause()
      setIsPlaying(false)
    }
  }, [isActive, isPlaying])

  const togglePlay = () => {
    if (!audioRef.current || !short.audio) return

    if (isPlaying) {
      audioRef.current.pause()
      setIsPlaying(false)
    } else {
      // If we reached the end of the 25s window or haven't started, reset to start_s
      if (
        audioRef.current.currentTime < startSec ||
        audioRef.current.currentTime >= endSec
      ) {
        audioRef.current.currentTime = startSec
      }

      audioRef.current
        .play()
        .then(() => {
          setIsPlaying(true)
          setAudioError(false)
        })
        .catch((err) => {
          console.warn("Audio play error:", err)
          setAudioError(true)
          setIsPlaying(false)
        })
    }
  }

  const handleTimeUpdate = () => {
    if (!audioRef.current) return
    const cur = audioRef.current.currentTime

    // Check if 25s clip finished
    if (cur >= endSec) {
      audioRef.current.pause()
      audioRef.current.currentTime = startSec
      setIsPlaying(false)
      setCurrentTime(CLIP_DURATION)
    } else {
      const clipElapsed = Math.max(0, Math.min(CLIP_DURATION, cur - startSec))
      setCurrentTime(clipElapsed)
    }
  }

  const handleReplay = () => {
    if (!audioRef.current || !short.audio) return
    audioRef.current.currentTime = startSec
    setCurrentTime(0)
    audioRef.current
      .play()
      .then(() => {
        setIsPlaying(true)
        setAudioError(false)
      })
      .catch(() => {
        setIsPlaying(false)
      })
  }

  const toggleMute = () => {
    if (!audioRef.current) return
    audioRef.current.muted = !isMuted
    setIsMuted(!isMuted)
  }

  // Format seconds into MM:SS
  const formatTime = (secs: number) => {
    const s = Math.floor(secs)
    const m = Math.floor(s / 60)
    const rem = s % 60
    return `${m}:${rem.toString().padStart(2, "0")}`
  }

  const audioProgressPercent = Math.min(100, Math.max(0, (currentTime / CLIP_DURATION) * 100))

  return (
    <Card className="w-full max-w-xl mx-auto shadow-xl border border-neutral-200 dark:border-neutral-800 bg-white/95 dark:bg-neutral-900/95 backdrop-blur-md overflow-hidden rounded-3xl transition-all duration-300">
      {/* Top Header Bar */}
      <div className="p-4 sm:p-5 border-b border-neutral-100 dark:border-neutral-800/80 bg-neutral-50/70 dark:bg-neutral-900/50 flex items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant="secondary"
            className="font-medium text-xs px-2.5 py-1 bg-accent-100/80 dark:bg-accent-950/40 text-accent-700 dark:text-accent-300 border border-accent-200 dark:border-accent-800/50"
          >
            {short.course_name}
          </Badge>

          {short.archetipo_nome && (
            <Badge
              variant="outline"
              className="text-2xs font-mono text-neutral-600 dark:text-neutral-400 border-neutral-300 dark:border-neutral-700"
            >
              <Target className="h-3 w-3 mr-1 text-primary-500" />
              {short.archetipo_nome}
            </Badge>
          )}

          {short.slide && (
            <Badge
              variant="outline"
              className="text-2xs text-neutral-500 dark:text-neutral-400 border-neutral-300 dark:border-neutral-700"
            >
              <FileText className="h-3 w-3 mr-1" />
              p. {short.slide.page}
            </Badge>
          )}
        </div>

        <span className="text-2xs font-mono text-neutral-400 bg-neutral-100 dark:bg-neutral-800 px-2.5 py-1 rounded-full shrink-0">
          {index + 1} / {total}
        </span>
      </div>

      <CardContent className="p-5 sm:p-6 space-y-5">
        {/* Title */}
        <div>
          <h2 className="text-lg sm:text-xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50 leading-snug">
            {short.title}
          </h2>
        </div>

        {/* Audio Player Compacto (25s) */}
        {short.audio && (
          <div className="rounded-2xl p-3.5 bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 space-y-2.5">
            <audio
              ref={audioRef}
              src={`/media/${short.audio.lecture_id}/audio.opus`}
              preload="metadata"
              onTimeUpdate={handleTimeUpdate}
              onEnded={() => setIsPlaying(false)}
              onError={() => {
                setAudioError(true)
                setIsPlaying(false)
              }}
            />

            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <Button
                  type="button"
                  size="icon"
                  variant={isPlaying ? "default" : "outline"}
                  onClick={togglePlay}
                  className={cn(
                    "h-10 w-10 rounded-full shrink-0 shadow-xs transition-all",
                    isPlaying
                      ? "bg-accent-600 hover:bg-accent-700 text-white animate-pulse"
                      : "hover:border-accent-500 hover:text-accent-600 dark:text-neutral-100"
                  )}
                  aria-label={isPlaying ? "Metti in pausa clip audio" : "Riproduci clip audio docente"}
                >
                  {isPlaying ? (
                    <Pause className="h-4 w-4" />
                  ) : (
                    <Play className="h-4 w-4 ml-0.5" />
                  )}
                </Button>

                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold text-neutral-900 dark:text-neutral-100 truncate">
                      Clip del Docente ({CLIP_DURATION}s)
                    </span>
                    {isPlaying && (
                      <span className="flex h-2 w-2 relative">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-accent-500"></span>
                      </span>
                    )}
                  </div>
                  <p className="text-2xs text-neutral-600 dark:text-neutral-300 truncate">
                    {short.audio.lecture_title}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={handleReplay}
                  className="h-8 w-8 text-neutral-600 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-white rounded-full"
                  title="Ricomincia clip"
                  aria-label="Ricomincia clip da capo"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </Button>

                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={toggleMute}
                  className="h-8 w-8 text-neutral-600 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-white rounded-full"
                  title={isMuted ? "Riattiva audio" : "Silenzia audio"}
                  aria-label={isMuted ? "Riattiva volume" : "Silenzia volume"}
                >
                  {isMuted ? (
                    <VolumeX className="h-3.5 w-3.5 text-rose-500" />
                  ) : (
                    <Volume2 className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
            </div>

            {/* Audio Progress Bar */}
            <div className="space-y-1">
              <div className="h-1.5 w-full bg-neutral-200 dark:bg-neutral-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent-500 transition-all duration-100 rounded-full"
                  style={{ width: `${audioProgressPercent}%` }}
                />
              </div>
              <div className="flex justify-between text-2xs font-mono text-neutral-500 dark:text-neutral-400">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(CLIP_DURATION)}</span>
              </div>
            </div>

            {audioError && (
              <p className="text-2xs text-amber-600 dark:text-amber-400 italic">
                Nota: File audio non scaricato in locale per questa lezione.
              </p>
            )}
          </div>
        )}

        {/* Punto Chiave con MathMarkdown */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-bold text-accent-700 dark:text-accent-300 uppercase tracking-wider">
            <Sparkles className="h-3.5 w-3.5 text-accent-500" />
            <span>Punto Chiave</span>
          </div>

          <div className="p-4 sm:p-5 rounded-2xl bg-neutral-100 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 text-sm leading-relaxed max-h-56 overflow-y-auto text-neutral-900 dark:text-neutral-50 shadow-inner">
            <MathMarkdown content={short.hook_md} className="text-neutral-900 dark:text-neutral-50" />
          </div>
        </div>

        {/* Tranello d'Esame: solo se il backend lo conosce davvero (niente testo di ripiego generico) */}
        {short.exam_trick && (
        <div className="space-y-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setShowTrap((prev) => !prev)}
            className={cn(
              "w-full justify-between h-10 px-4 rounded-xl border text-xs font-semibold transition-all",
              showTrap
                ? "bg-rose-500/15 border-rose-500/40 text-rose-800 dark:text-rose-200 hover:bg-rose-500/25"
                : "bg-neutral-50 dark:bg-neutral-800/80 border-neutral-300 dark:border-neutral-700 text-neutral-800 dark:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-700"
            )}
          >
            <span className="flex items-center gap-2">
              <Flame
                className={cn(
                  "h-4 w-4",
                  showTrap ? "text-rose-500 animate-bounce" : "text-amber-500"
                )}
              />
              <span>{showTrap ? "Nascondi Tranello d'Esame" : "Svela Tranello d'Esame"}</span>
            </span>
            {showTrap ? (
              <ChevronUp className="h-4 w-4 text-neutral-500 dark:text-neutral-300" />
            ) : (
              <ChevronDown className="h-4 w-4 text-neutral-500 dark:text-neutral-300" />
            )}
          </Button>

          {showTrap && (
            <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-900 text-xs sm:text-sm text-rose-950 dark:text-rose-100 space-y-2 animate-in fade-in slide-in-from-top-2 duration-200">
              <div className="flex items-center gap-1.5 font-bold text-rose-700 dark:text-rose-400">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>Tranello del Docente & Errori Tipici</span>
              </div>
              <div className="leading-relaxed text-rose-950 dark:text-rose-100">
                <MathMarkdown
                  content={short.exam_trick}
                  className="text-rose-950 dark:text-rose-100"
                />
              </div>
            </div>
          )}
        </div>
        )}

        {/* Footer: Pulsanti di Navigazione & "Studia argomento completo" */}
        <div className="pt-3 border-t border-neutral-200 dark:border-neutral-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {onPrev && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onPrev}
                disabled={index === 0}
                className="text-xs h-9 px-3 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-800 text-neutral-800 dark:text-neutral-100 hover:bg-neutral-200 dark:hover:bg-neutral-700 disabled:opacity-30"
              >
                Precedente
              </Button>
            )}
            {onNext && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onNext}
                disabled={index === total - 1}
                className="text-xs h-9 px-3 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-800 text-neutral-800 dark:text-neutral-100 hover:bg-neutral-200 dark:hover:bg-neutral-700 disabled:opacity-30"
              >
                Successivo
              </Button>
            )}
          </div>

          <Button
            type="button"
            size="sm"
            onClick={() =>
              navigate(`/studio/${short.course_id}?topic=${short.topic_id}`)
            }
            className="gap-1.5 text-xs font-semibold h-9 px-3.5 rounded-xl bg-accent-600 hover:bg-accent-700 text-white shadow-sm"
          >
            <BookOpen className="h-3.5 w-3.5" />
            <span>Prepara una sessione</span>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
