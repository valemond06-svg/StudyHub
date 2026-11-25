import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  useImperativeHandle,
  forwardRef,
} from "react"
import {
  X,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Maximize2,
  Minimize2,
  Mic,
  FileText,
  Image as ImageIcon,
  Video,
  Film,
  Presentation,
  ExternalLink,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
  Search,
  Subtitles,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import * as Dialog from "@radix-ui/react-dialog"
import { cn } from "@/lib/utils"
import { api, describeError } from "@/lib/api"
import {
  toLectureMedia,
  formatTime,
  slideIndexAt,
  silenceEndAt,
  type PlayerMode,
  type TranscriptSegment,
  type SlideInfo,
  type SilenceInterval,
  type LectureMediaData,
} from "@/lib/lecture-media"

// ============================================
// Types
// ============================================

export type { PlayerMode, TranscriptSegment, SlideInfo, SilenceInterval, LectureMediaData }

export interface PlayerNote {
  id: string
  lectureId: number
  timestamp: number
  type: "transcript" | "slide" | "video" | "general"
  segmentIndex?: number
  slideIndex?: number
  text: string
  createdAt: string
}

export interface VideoPlayerProps {
  lectureId: number
  lectureTitle: string
  onClose: () => void
  initialTime?: number
}

export interface VideoPlayerHandle {
  play: () => void
  pause: () => void
  seek: (time: number) => void
  setRate: (rate: number) => void
  getCurrentTime: () => number
  getDuration: () => number
  setMode?: (mode: PlayerMode) => void
}

const SPEED_PRESETS = [0.75, 1, 1.25, 1.5, 2]
const NO_SLIDES: SlideInfo[] = []
const NO_SEGMENTS: TranscriptSegment[] = []
const NO_SILENCES: SilenceInterval[] = []

// ============================================
// Helper Functions
// ============================================

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function requestMediaPip(el: HTMLMediaElement | null) {
  if (!el) return
  const media = el as HTMLMediaElement & {
    requestPictureInPicture?: () => Promise<unknown>
  }
  media.requestPictureInPicture?.().catch(() => {})
}

function loadNotes(lectureId: number): PlayerNote[] {
  try {
    const stored = localStorage.getItem(`studyhub-notes-${lectureId}`)
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

function saveNotes(lectureId: number, notes: PlayerNote[]): void {
  try {
    localStorage.setItem(`studyhub-notes-${lectureId}`, JSON.stringify(notes))
  } catch {
    // Ignore quota errors
  }
}

// ============================================
// Sub-component: Panopto Player Iframe
// ============================================

interface PanoptoPlayerProps {
  embedUrl: string
  viewerUrl?: string
  lectureTitle: string
  currentTime: number
  duration: number
  onSeek: (time: number) => void
  onAddNote: (timestamp: number) => void
  iframeRef: React.RefObject<HTMLIFrameElement | null>
}

export function PanoptoPlayer({
  embedUrl,
  viewerUrl,
  lectureTitle,
  currentTime,
  onSeek,
  onAddNote,
  iframeRef,
}: PanoptoPlayerProps) {
  return (
    <div className="flex flex-col h-full w-full max-w-5xl mx-auto gap-3">
      {/* 16:9 Responsive Iframe Container */}
      <div className="relative w-full aspect-video bg-neutral-950 rounded-xl overflow-hidden shadow-2xl border border-neutral-800 flex items-center justify-center">
        <iframe
          ref={iframeRef}
          src={embedUrl}
          title={lectureTitle}
          allow="autoplay; fullscreen"
          allowFullScreen
          className="w-full h-full border-0"
        />
      </div>

      {/* Panopto Controls & Status Sub-bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 bg-neutral-100 dark:bg-neutral-900 rounded-lg border border-neutral-200 dark:border-neutral-800 text-sm">
        <div className="flex items-center gap-2">
          <Badge variant="accent" className="flex items-center gap-1 font-semibold">
            <Video className="h-3.5 w-3.5" />
            Panopto UniVR
          </Badge>
          <span className="text-xs text-neutral-500 dark:text-neutral-400">
            {currentTime > 0 ? (
              <>Posizione sincronizzata: <strong className="font-mono text-neutral-900 dark:text-neutral-100">{formatTime(currentTime)}</strong></>
            ) : (
              "Trascrizione Whisper sincronizzata"
            )}
          </span>
        </div>

        {/* Quick jump & Note controls */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onSeek(Math.max(0, currentTime - 30))}
            title="Salta indietro 30s"
          >
            <SkipBack className="h-4 w-4 mr-1" /> -30s
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onSeek(Math.max(0, currentTime - 5))}
            title="Salta indietro 5s"
          >
            <SkipBack className="h-4 w-4 mr-1" /> -5s
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onSeek(currentTime + 5)}
            title="Salta avanti 5s"
          >
            +5s <SkipForward className="h-4 w-4 ml-1" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onSeek(currentTime + 30)}
            title="Salta avanti 30s"
          >
            +30s <SkipForward className="h-4 w-4 ml-1" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onAddNote(currentTime)}
            className="ml-2 gap-1"
          >
            <Bookmark className="h-3.5 w-3.5 text-accent-500" />
            <span>+ Nota ({formatTime(currentTime)})</span>
          </Button>
          {viewerUrl && (
            <Button
              variant="ghost"
              size="sm"
              asChild
              className="text-xs ml-1 text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
            >
              <a href={viewerUrl} target="_blank" rel="noopener noreferrer">
                <span>Apri nel portale</span>
                <ExternalLink className="h-3.5 w-3.5 ml-1" />
              </a>
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

// ============================================
// Sub-component: HTML5 Video Player
// ============================================

interface Html5VideoPlayerProps {
  videoUrl: string
  /** Video su Moodle: il browser deve essere già autenticato su Moodle */
  isRemote?: boolean
  lectureTitle: string
  currentTime: number
  duration: number
  playbackRate: number
  volume: number
  isMuted: boolean
  isPlaying: boolean
  silenceIntervals: SilenceInterval[]
  skipSilences: boolean
  activeSubtitle?: string
  showSubtitles: boolean
  onToggleSubtitles: () => void
  onPlayPause: () => void
  onSeek: (time: number) => void
  onRateChange: (rate: number) => void
  onVolumeChange: (volume: number) => void
  onMuteToggle: () => void
  onSkipSilencesToggle: () => void
  onSeekBackward: (seconds: number) => void
  onSeekForward: (seconds: number) => void
  onAddNote: (timestamp: number) => void
  videoRef: React.RefObject<HTMLVideoElement | null>
  containerRef: React.RefObject<HTMLDivElement | null>
}

export function Html5VideoPlayer({
  videoUrl,
  isRemote = false,
  currentTime,
  duration,
  playbackRate,
  volume,
  isMuted,
  isPlaying,
  silenceIntervals,
  skipSilences,
  activeSubtitle,
  showSubtitles,
  onToggleSubtitles,
  onPlayPause,
  onSeek,
  onRateChange,
  onVolumeChange,
  onMuteToggle,
  onSkipSilencesToggle,
  onSeekBackward,
  onSeekForward,
  onAddNote,
  videoRef,
  containerRef,
}: Html5VideoPlayerProps) {
  const seekBarRef = useRef<HTMLDivElement>(null)
  const isSeekingRef = useRef(false)
  const [isFullscreen, setIsFullscreen] = useState(false)

  const handleSeekMouseDown = useCallback((e: React.MouseEvent) => {
    isSeekingRef.current = true
    const handleMove = (moveEvent: MouseEvent) => {
      if (!seekBarRef.current || duration <= 0) return
      const rect = seekBarRef.current.getBoundingClientRect()
      const percent = Math.max(0, Math.min(1, (moveEvent.clientX - rect.left) / rect.width))
      onSeek(percent * duration)
    }
    const handleUp = () => {
      isSeekingRef.current = false
      window.removeEventListener("mousemove", handleMove)
      window.removeEventListener("mouseup", handleUp)
    }
    window.addEventListener("mousemove", handleMove)
    window.addEventListener("mouseup", handleUp)
    handleMove(e.nativeEvent)
  }, [duration, onSeek])

  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {})
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {})
    }
  }, [containerRef])

  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement))
    }
    document.addEventListener("fullscreenchange", handleFsChange)
    return () => document.removeEventListener("fullscreenchange", handleFsChange)
  }, [])

  return (
    <div
      ref={containerRef}
      className="flex flex-col h-full w-full max-w-5xl mx-auto gap-3 select-none"
    >
      {isRemote && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200">
          <span>Video ospitato su Moodle: se non parte, accedi a Moodle in questo browser.</span>
          <a href={videoUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold underline underline-offset-2">
            Apri su Moodle <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      )}
      {/* 16:9 Video Canvas Wrapper */}
      <div className="relative w-full aspect-video bg-neutral-950 rounded-xl overflow-hidden shadow-2xl border border-neutral-800 flex items-center justify-center group">
        <video
          ref={videoRef}
          src={videoUrl}
          playsInline
          preload="metadata"
          onClick={onPlayPause}
          className="w-full h-full object-contain cursor-pointer"
        />

        {/* Large Play/Pause overlay icon on click/hover when paused */}
        {!isPlaying && (
          <button
            type="button"
            onClick={onPlayPause}
            aria-label="Riproduci video"
            className="absolute inset-0 flex items-center justify-center bg-black/30 hover:bg-black/40 transition-colors"
          >
            <div className="h-16 w-16 rounded-full bg-accent-500/90 text-white flex items-center justify-center shadow-lg transform hover:scale-110 transition-transform">
              <Play className="h-8 w-8 ml-1" />
            </div>
          </button>
        )}

        {/* Subtitle / Live Whisper Overlay */}
        {showSubtitles && activeSubtitle && (
          <div className="absolute bottom-4 left-6 right-6 flex justify-center pointer-events-none">
            <p className="bg-neutral-950/85 text-white text-sm font-medium px-4 py-2 rounded-lg max-w-[85%] text-center backdrop-blur-md shadow-lg border border-white/10 leading-relaxed">
              {activeSubtitle}
            </p>
          </div>
        )}
      </div>

      {/* Complete HTML5 Video Controls Bar */}
      <div className="flex flex-col gap-2.5 p-3.5 bg-neutral-100 dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800 shadow-sm">
        {/* Seek Bar with Silence Markers */}
        <div className="relative w-full">
          <div
            ref={seekBarRef}
            className="relative h-2.5 bg-neutral-300 dark:bg-neutral-700 rounded-full cursor-pointer group"
            onMouseDown={handleSeekMouseDown}
            role="slider"
            aria-label="Posizione riproduzione video"
            aria-valuemin={0}
            aria-valuemax={duration}
            aria-valuenow={currentTime}
            tabIndex={0}
          >
            {/* Silence intervals markers */}
            {silenceIntervals.map((s, i) => (
              <div
                key={i}
                className="absolute top-0 h-full bg-amber-500/40 rounded-full pointer-events-none"
                style={{
                  left: `${duration > 0 ? (s.start / duration) * 100 : 0}%`,
                  width: `${duration > 0 ? ((s.end - s.start) / duration) * 100 : 0}%`,
                }}
                title={`Silenzio: ${formatTime(s.start)} - ${formatTime(s.end)}`}
              />
            ))}
            {/* Progress track */}
            <div
              className="absolute top-0 h-full bg-accent-500 rounded-full transition-all duration-75"
              style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
            />
            {/* Scrubber thumb */}
            <div
              className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 bg-accent-500 rounded-full shadow-md border-2 border-white dark:border-neutral-900 opacity-90 group-hover:scale-125 transition-transform pointer-events-none"
              style={{ left: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
            />
          </div>
          <div className="flex justify-between text-xs font-mono text-neutral-500 dark:text-neutral-400 mt-1">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        {/* Buttons Row */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Left: Playback & Seek */}
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onSeekBackward(30)}
              aria-label="Indietro 30s"
              title="Indietro 30s (Shift+←)"
            >
              <SkipBack className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onSeekBackward(5)}
              aria-label="Indietro 5s"
              title="Indietro 5s (←)"
            >
              <SkipBack className="h-4 w-4" />
            </Button>
            <Button
              variant="default"
              size="icon"
              onClick={onPlayPause}
              aria-label={isPlaying ? "Pausa" : "Riproduci"}
              title={isPlaying ? "Pausa (Spazio)" : "Riproduci (Spazio)"}
              className="h-10 w-10 rounded-full"
            >
              {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 ml-0.5" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onSeekForward(5)}
              aria-label="Avanti 5s"
              title="Avanti 5s (→)"
            >
              <SkipForward className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onSeekForward(30)}
              aria-label="Avanti 30s"
              title="Avanti 30s (Shift+→)"
            >
              <SkipForward className="h-4 w-4" />
            </Button>
          </div>

          {/* Center: Speed Presets (0.75x, 1x, 1.25x, 1.5x, 2x) & Silence Skip */}
          <div className="flex items-center gap-3">
            {/* Speed Presets Pill Group */}
            <div
              className="flex items-center p-0.5 bg-neutral-200 dark:bg-neutral-800 rounded-lg text-xs font-medium"
              role="group"
              aria-label="Velocità riproduzione"
            >
              {SPEED_PRESETS.map((rate) => {
                const isActive = Math.abs(playbackRate - rate) < 0.01
                return (
                  <button
                    key={rate}
                    type="button"
                    onClick={() => onRateChange(rate)}
                    className={cn(
                      "px-2.5 py-1 rounded-md transition-all duration-150",
                      isActive
                        ? "bg-accent-500 text-white font-semibold shadow-sm"
                        : "text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
                    )}
                    aria-label={`Velocità ${rate}x`}
                    aria-pressed={isActive}
                  >
                    {rate}×
                  </button>
                )
              })}
            </div>

            {/* Skip Silences Switch */}
            {silenceIntervals.length > 0 && (
              <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-lg bg-neutral-200/50 dark:bg-neutral-800/50 text-xs">
                <Mic className={cn("h-3.5 w-3.5", skipSilences ? "text-accent-500" : "text-neutral-400")} />
                <Switch
                  checked={skipSilences}
                  onCheckedChange={onSkipSilencesToggle}
                  aria-label="Salta silenzi"
                  id="video-skip-silences"
                />
                <label htmlFor="video-skip-silences" className="cursor-pointer text-neutral-600 dark:text-neutral-300">
                  Salta silenzi
                </label>
              </div>
            )}
          </div>

          {/* Right: Volume, PiP, Subtitles, Fullscreen */}
          <div className="flex items-center gap-2">
            {/* Volume */}
            <div className="flex items-center gap-1.5">
              <Button
                variant="ghost"
                size="icon"
                onClick={onMuteToggle}
                aria-label={isMuted ? "Attiva audio" : "Disattiva audio"}
                title={isMuted ? "Attiva audio (M)" : "Disattiva audio (M)"}
                className="h-8 w-8"
              >
                {isMuted || volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </Button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={isMuted ? 0 : volume}
                onChange={(e) => onVolumeChange(Number(e.target.value))}
                className="w-20 h-1.5 appearance-none bg-neutral-300 dark:bg-neutral-700 rounded-full accent-accent-500 cursor-pointer"
                aria-label="Volume"
              />
            </div>

            {/* Subtitles toggle */}
            <Button
              variant="ghost"
              size="icon"
              onClick={onToggleSubtitles}
              aria-label={showSubtitles ? "Disattiva sottotitoli" : "Attiva sottotitoli"}
              title={showSubtitles ? "Disattiva sottotitoli" : "Attiva sottotitoli"}
              className={cn("h-8 w-8", showSubtitles && "text-accent-500 bg-accent-500/10")}
            >
              <Subtitles className="h-4 w-4" />
            </Button>

            {/* PiP */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => requestMediaPip(videoRef.current)}
              aria-label="Picture-in-Picture"
              title="Picture in Picture (F)"
              className="h-8 w-8"
            >
              <Maximize2 className="h-4 w-4" />
            </Button>

            {/* Fullscreen */}
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleFullscreen}
              aria-label={isFullscreen ? "Esci da schermo intero" : "Schermo intero"}
              title="Schermo intero"
              className="h-8 w-8"
            >
              {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>

            {/* Add note */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => onAddNote(currentTime)}
              className="gap-1 text-xs h-8"
            >
              <Bookmark className="h-3.5 w-3.5 text-accent-500" />
              <span>+ Nota</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================
// Sub-component: Slide & Audio Synchronized Player
// ============================================

interface SlideAudioPlayerProps {
  slides: SlideInfo[]
  hasAudio?: boolean
  activeSlideIndex: number
  audioRef: React.RefObject<HTMLAudioElement | null>
  currentTime: number
  duration: number
  playbackRate: number
  volume: number
  isMuted: boolean
  isPlaying: boolean
  silenceIntervals: SilenceInterval[]
  skipSilences: boolean
  onPlayPause: () => void
  onSeek: (time: number) => void
  onRateChange: (rate: number) => void
  onVolumeChange: (volume: number) => void
  onMuteToggle: () => void
  onSkipSilencesToggle: () => void
  onSeekBackward: (seconds: number) => void
  onSeekForward: (seconds: number) => void
  onPrevSlide: () => void
  onNextSlide: () => void
  onAddNote: (timestamp: number, slideIndex?: number) => void
}

export function SlideAudioPlayer({
  slides,
  hasAudio = true,
  activeSlideIndex,
  audioRef,
  currentTime,
  duration,
  playbackRate,
  volume,
  isMuted,
  isPlaying,
  silenceIntervals,
  skipSilences,
  onPlayPause,
  onSeek,
  onRateChange,
  onVolumeChange,
  onMuteToggle,
  onSkipSilencesToggle,
  onSeekBackward,
  onSeekForward,
  onPrevSlide,
  onNextSlide,
  onAddNote,
}: SlideAudioPlayerProps) {
  const seekBarRef = useRef<HTMLDivElement>(null)
  const isSeekingRef = useRef(false)

  const activeSlide = slides[activeSlideIndex] || slides[0]

  const handleSeekMouseDown = useCallback((e: React.MouseEvent) => {
    isSeekingRef.current = true
    const handleMove = (moveEvent: MouseEvent) => {
      if (!seekBarRef.current || duration <= 0) return
      const rect = seekBarRef.current.getBoundingClientRect()
      const percent = Math.max(0, Math.min(1, (moveEvent.clientX - rect.left) / rect.width))
      onSeek(percent * duration)
    }
    const handleUp = () => {
      isSeekingRef.current = false
      window.removeEventListener("mousemove", handleMove)
      window.removeEventListener("mouseup", handleUp)
    }
    window.addEventListener("mousemove", handleMove)
    window.addEventListener("mouseup", handleUp)
    handleMove(e.nativeEvent)
  }, [duration, onSeek])

  return (
    <div className="flex flex-col h-full w-full max-w-5xl mx-auto gap-3">
      {/* Prominent Synchronized Slide Canvas / Stage */}
      <div className="relative w-full aspect-video bg-neutral-950 rounded-xl overflow-hidden shadow-2xl border border-neutral-800 flex items-center justify-center group">
        {activeSlide ? (
          <img
            src={activeSlide.url}
            alt={`Slide ${activeSlide.index + 1}`}
            className="w-full h-full object-contain"
            onDoubleClick={() => onAddNote(activeSlide.timestamp, activeSlide.index)}
          />
        ) : (
          <div className="flex flex-col items-center justify-center text-neutral-500 gap-2">
            <Presentation className="h-12 w-12" />
            <p>Nessuna slide sincronizzata disponibile per questo istante</p>
          </div>
        )}

        {/* Slide navigation overlays */}
        {slides.length > 0 && (
          <>
            <button
              type="button"
              onClick={onPrevSlide}
              disabled={activeSlideIndex <= 0}
              className="absolute left-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/60 text-white hover:bg-black/80 disabled:opacity-30 disabled:pointer-events-none transition-all"
              aria-label="Slide precedente"
              title="Slide precedente"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
            <button
              type="button"
              onClick={onNextSlide}
              disabled={activeSlideIndex >= slides.length - 1}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/60 text-white hover:bg-black/80 disabled:opacity-30 disabled:pointer-events-none transition-all"
              aria-label="Slide successiva"
              title="Slide successiva"
            >
              <ChevronRight className="h-6 w-6" />
            </button>

            {/* Slide Index Badge Overlay */}
            <div className="absolute bottom-3 left-4 flex items-center gap-2">
              <Badge variant="secondary" className="bg-black/75 text-white backdrop-blur-sm border-0 font-mono text-xs">
                Slide {activeSlideIndex >= 0 ? activeSlideIndex + 1 : 1} / {slides.length}
              </Badge>
              {activeSlide && (
                <Badge variant="outline" className="bg-black/50 text-neutral-200 border-white/20 text-xs">
                  {formatTime(activeSlide.timestamp)}
                </Badge>
              )}
            </div>

            {/* Note prompt button on slide */}
            <button
              type="button"
              onClick={() => onAddNote(currentTime, activeSlideIndex)}
              className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity bg-black/70 hover:bg-black/90 text-white px-3 py-1 rounded-full text-xs flex items-center gap-1.5 backdrop-blur-sm"
            >
              <Bookmark className="h-3.5 w-3.5 text-accent-400" />
              <span>Aggiungi nota</span>
            </button>
          </>
        )}
      </div>

      {!hasAudio && (
        <p className="px-3 py-2 rounded-lg bg-neutral-900 border border-neutral-800 text-xs text-neutral-400">
          Audio della lezione non ancora estratto: puoi sfogliare le slide, la riproduzione non è disponibile.
        </p>
      )}
      {/* Audio Controls Bar */}
      <div className="flex flex-col gap-2.5 p-3.5 bg-neutral-100 dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800 shadow-sm">
        {/* Seek Bar */}
        <div className="relative w-full">
          <div
            ref={seekBarRef}
            className="relative h-2.5 bg-neutral-300 dark:bg-neutral-700 rounded-full cursor-pointer group"
            onMouseDown={handleSeekMouseDown}
            role="slider"
            aria-label="Posizione riproduzione audio"
            aria-valuemin={0}
            aria-valuemax={duration}
            aria-valuenow={currentTime}
            tabIndex={0}
          >
            {silenceIntervals.map((s, i) => (
              <div
                key={i}
                className="absolute top-0 h-full bg-amber-500/40 rounded-full pointer-events-none"
                style={{
                  left: `${duration > 0 ? (s.start / duration) * 100 : 0}%`,
                  width: `${duration > 0 ? ((s.end - s.start) / duration) * 100 : 0}%`,
                }}
                title={`Silenzio: ${formatTime(s.start)} - ${formatTime(s.end)}`}
              />
            ))}
            <div
              className="absolute top-0 h-full bg-accent-500 rounded-full transition-all duration-75"
              style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
            />
            <div
              className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 bg-accent-500 rounded-full shadow-md border-2 border-white dark:border-neutral-900 opacity-90 group-hover:scale-125 transition-transform pointer-events-none"
              style={{ left: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
            />
          </div>
          <div className="flex justify-between text-xs font-mono text-neutral-500 dark:text-neutral-400 mt-1">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        {/* Buttons Row */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Left: Playback & Seek */}
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onSeekBackward(30)}
              aria-label="Indietro 30s"
              title="Indietro 30s (Shift+←)"
            >
              <SkipBack className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onSeekBackward(5)}
              aria-label="Indietro 5s"
              title="Indietro 5s (←)"
            >
              <SkipBack className="h-4 w-4" />
            </Button>
            <Button
              variant="default"
              size="icon"
              onClick={onPlayPause}
              aria-label={isPlaying ? "Pausa" : "Riproduci"}
              title={isPlaying ? "Pausa (Spazio)" : "Riproduci (Spazio)"}
              className="h-10 w-10 rounded-full"
            >
              {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 ml-0.5" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onSeekForward(5)}
              aria-label="Avanti 5s"
              title="Avanti 5s (→)"
            >
              <SkipForward className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onSeekForward(30)}
              aria-label="Avanti 30s"
              title="Avanti 30s (Shift+→)"
            >
              <SkipForward className="h-4 w-4" />
            </Button>
          </div>

          {/* Center: Speed Presets & Silence Skip */}
          <div className="flex items-center gap-3">
            <div
              className="flex items-center p-0.5 bg-neutral-200 dark:bg-neutral-800 rounded-lg text-xs font-medium"
              role="group"
              aria-label="Velocità riproduzione"
            >
              {SPEED_PRESETS.map((rate) => {
                const isActive = Math.abs(playbackRate - rate) < 0.01
                return (
                  <button
                    key={rate}
                    type="button"
                    onClick={() => onRateChange(rate)}
                    className={cn(
                      "px-2.5 py-1 rounded-md transition-all duration-150",
                      isActive
                        ? "bg-accent-500 text-white font-semibold shadow-sm"
                        : "text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
                    )}
                    aria-label={`Velocità ${rate}x`}
                    aria-pressed={isActive}
                  >
                    {rate}×
                  </button>
                )
              })}
            </div>

            {silenceIntervals.length > 0 && (
              <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-lg bg-neutral-200/50 dark:bg-neutral-800/50 text-xs">
                <Mic className={cn("h-3.5 w-3.5", skipSilences ? "text-accent-500" : "text-neutral-400")} />
                <Switch
                  checked={skipSilences}
                  onCheckedChange={onSkipSilencesToggle}
                  aria-label="Salta silenzi"
                  id="slide-skip-silences"
                />
                <label htmlFor="slide-skip-silences" className="cursor-pointer text-neutral-600 dark:text-neutral-300">
                  Salta silenzi
                </label>
              </div>
            )}
          </div>

          {/* Right: Volume & PiP */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <Button
                variant="ghost"
                size="icon"
                onClick={onMuteToggle}
                aria-label={isMuted ? "Attiva audio" : "Disattiva audio"}
                title={isMuted ? "Attiva audio (M)" : "Disattiva audio (M)"}
                className="h-8 w-8"
              >
                {isMuted || volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </Button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={isMuted ? 0 : volume}
                onChange={(e) => onVolumeChange(Number(e.target.value))}
                className="w-20 h-1.5 appearance-none bg-neutral-300 dark:bg-neutral-700 rounded-full accent-accent-500 cursor-pointer"
                aria-label="Volume"
              />
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => requestMediaPip(audioRef.current)}
              aria-label="Picture-in-Picture"
              title="Picture in Picture (F)"
              className="h-8 w-8"
            >
              <Maximize2 className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onAddNote(currentTime, activeSlideIndex)}
              className="gap-1 text-xs h-8"
            >
              <Bookmark className="h-3.5 w-3.5 text-accent-500" />
              <span>+ Nota</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================
// Sub-component: Transcript Panel with Whisper Clickable Segments
// ============================================

interface TranscriptPanelProps {
  segments: TranscriptSegment[]
  currentTime: number
  onSegmentClick: (index: number) => void
  onAddNote: (segmentIndex: number, timestamp: number) => void
  notes: PlayerNote[]
}

export function TranscriptPanel({
  segments,
  currentTime,
  onSegmentClick,
  onAddNote,
  notes,
}: TranscriptPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [searchFilter, setSearchFilter] = useState("")

  const activeIndex = useMemo(() => {
    return segments.findIndex((s) => s.t_start <= currentTime && s.t_end > currentTime)
  }, [segments, currentTime])

  // Auto-scroll to active segment
  useEffect(() => {
    if (activeIndex >= 0 && containerRef.current && !searchFilter) {
      const element = containerRef.current.querySelector(`[data-segment-index="${activeIndex}"]`)
      if (element && typeof element.scrollIntoView === "function") {
        element.scrollIntoView({ behavior: "smooth", block: "center" })
      }
    }
  }, [activeIndex, searchFilter])

  const getNotesForSegment = (index: number) => {
    return notes.filter((n) => n.type === "transcript" && n.segmentIndex === index)
  }

  const filteredSegments = useMemo(() => {
    if (!searchFilter.trim()) {
      return segments.map((segment, originalIndex) => ({ segment, originalIndex }))
    }
    const query = searchFilter.toLowerCase()
    return segments
      .map((segment, originalIndex) => ({ segment, originalIndex }))
      .filter(({ segment }) => segment.text.toLowerCase().includes(query))
  }, [segments, searchFilter])

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-neutral-50/50 dark:bg-neutral-900/30">
      {/* Header and Search */}
      <div className="p-3 border-b border-neutral-200 dark:border-neutral-800 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-neutral-900 dark:text-neutral-100 flex items-center gap-2 text-sm">
            <FileText className="h-4 w-4 text-accent-500" />
            Trascrizione Whisper ({segments.length})
          </h3>
          <span className="text-xs font-mono text-neutral-500 dark:text-neutral-400">
            {activeIndex >= 0 ? `Segm. ${activeIndex + 1}` : "—"}
          </span>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-neutral-400" />
          <Input
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            placeholder="Cerca nella trascrizione..."
            className="pl-8 pr-8 h-8 text-xs bg-white dark:bg-neutral-950"
          />
          {searchFilter && (
            <button
              type="button"
              onClick={() => setSearchFilter("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Segments List */}
      <ScrollArea className="flex-1">
        <div ref={containerRef} className="p-3 space-y-2">
          {filteredSegments.length === 0 ? (
            <p className="text-neutral-500 dark:text-neutral-400 text-center py-8 text-sm">
              {searchFilter ? "Nessun segmento trovato per la ricerca" : "Nessuna trascrizione disponibile"}
            </p>
          ) : (
            filteredSegments.map(({ segment, originalIndex }) => {
              const isActive = originalIndex === activeIndex
              const segmentNotes = getNotesForSegment(originalIndex)

              return (
                <div
                  key={originalIndex}
                  data-segment-index={originalIndex}
                  onClick={() => onSegmentClick(originalIndex)}
                  onDoubleClick={() => onAddNote(originalIndex, segment.t_start)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      onSegmentClick(originalIndex)
                    }
                  }}
                  className={cn(
                    "relative group cursor-pointer transition-all duration-150 rounded-lg p-2.5 border text-left",
                    isActive
                      ? "bg-accent-500/10 dark:bg-accent-500/15 border-accent-500 shadow-sm"
                      : "bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-800 hover:border-neutral-300 dark:hover:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-850"
                  )}
                >
                  <div className="flex items-start gap-2.5">
                    <span
                      className={cn(
                        "flex-shrink-0 text-xs font-mono px-1.5 py-0.5 rounded",
                        isActive
                          ? "bg-accent-500 text-white font-semibold"
                          : "bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 group-hover:text-accent-500"
                      )}
                    >
                      {formatTime(segment.t_start)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p
                        className={cn(
                          "text-xs leading-relaxed break-words",
                          isActive
                            ? "text-neutral-950 dark:text-neutral-50 font-medium"
                            : "text-neutral-700 dark:text-neutral-300"
                        )}
                      >
                        {segment.text}
                      </p>
                      {/* Notes attached to this segment */}
                      {segmentNotes.length > 0 && (
                        <div className="mt-1.5 space-y-1">
                          {segmentNotes.map((note) => (
                            <div
                              key={note.id}
                              className="text-xs bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded p-1 text-amber-900 dark:text-amber-200"
                            >
                              📝 {note.text}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

// ============================================
// Sub-component: Slides Strip (Carousel / Thumbnails)
// ============================================

interface SlidesStripProps {
  slides: SlideInfo[]
  currentTime: number
  onSlideClick: (index: number) => void
  onAddNote: (slideIndex: number, timestamp: number) => void
  notes: PlayerNote[]
}

export function SlidesStrip({
  slides,
  currentTime,
  onSlideClick,
  onAddNote,
  notes,
}: SlidesStripProps) {
  const activeSlideIndex = useMemo(() => {
    let idx = -1
    for (let i = 0; i < slides.length; i++) {
      if (slides[i].timestamp <= currentTime) {
        idx = i
      } else {
        break
      }
    }
    return idx
  }, [slides, currentTime])

  const getNotesForSlide = (index: number) => {
    return notes.filter((n) => n.type === "slide" && n.slideIndex === index)
  }

  if (slides.length === 0) return null

  return (
    <div className="border-t border-neutral-200 dark:border-neutral-800 p-3 bg-neutral-100/60 dark:bg-neutral-900/60">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold text-neutral-900 dark:text-neutral-100 flex items-center gap-2 text-xs">
          <ImageIcon className="h-4 w-4 text-accent-500" />
          Slide sincronizzate ({slides.length})
        </h3>
        <span className="text-xs text-neutral-500 dark:text-neutral-400 font-mono">
          Attiva: {activeSlideIndex >= 0 ? `${activeSlideIndex + 1}/${slides.length}` : "—"}
        </span>
      </div>
      <div className="h-24 overflow-x-auto overflow-y-hidden">
        <div className="flex gap-2.5 pb-2 w-max" role="list" aria-label="Slide della lezione">
          {slides.map((slide, index) => {
            const isActive = index === activeSlideIndex
            const slideNotes = getNotesForSlide(index)
            return (
              <div
                key={index}
                onClick={() => onSlideClick(index)}
                onDoubleClick={() => onAddNote(index, slide.timestamp)}
                role="listitem"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    onSlideClick(index)
                  }
                }}
                className={cn(
                  "relative group flex-shrink-0 cursor-pointer rounded-lg overflow-hidden transition-all duration-150 h-20 w-32 border",
                  isActive
                    ? "ring-2 ring-accent-500 border-transparent shadow-md scale-[1.02]"
                    : "border-neutral-300 dark:border-neutral-700 hover:border-accent-400 opacity-80 hover:opacity-100"
                )}
                aria-label={`Slide ${index + 1}, ${formatTime(slide.timestamp)}`}
                aria-current={isActive ? "true" : "false"}
              >
                <img
                  src={slide.thumbnailUrl}
                  alt={`Slide ${index + 1}`}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
                <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent p-1 text-[10px] text-white font-mono flex justify-between">
                  <span>#{index + 1}</span>
                  <span>{formatTime(slide.timestamp)}</span>
                </div>
                {slideNotes.length > 0 && (
                  <div className="absolute top-1 right-1 bg-amber-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                    {slideNotes.length}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ============================================
// Sub-component: Notes Panel with Timestamp Sync
// ============================================

interface NotesPanelProps {
  notes: PlayerNote[]
  currentTime: number
  onSeek: (timestamp: number) => void
  onAddNote: (text: string, timestamp: number) => void
  onDeleteNote: (id: string) => void
}

export function NotesPanel({
  notes,
  currentTime,
  onSeek,
  onAddNote,
  onDeleteNote,
}: NotesPanelProps) {
  const [newNoteText, setNewNoteText] = useState("")

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newNoteText.trim()) return
    onAddNote(newNoteText.trim(), currentTime)
    setNewNoteText("")
  }

  const sortedNotes = useMemo(() => {
    return [...notes].sort((a, b) => a.timestamp - b.timestamp)
  }, [notes])

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-neutral-50/50 dark:bg-neutral-900/30">
      {/* Header and Quick Add Form */}
      <div className="p-3 border-b border-neutral-200 dark:border-neutral-800 space-y-2">
        <h3 className="font-semibold text-neutral-900 dark:text-neutral-100 flex items-center gap-2 text-sm">
          <Bookmark className="h-4 w-4 text-accent-500" />
          Note e Segnalibri ({notes.length})
        </h3>
        <form onSubmit={handleSubmit} className="flex gap-2">
          <Input
            value={newNoteText}
            onChange={(e) => setNewNoteText(e.target.value)}
            placeholder={`Nota a ${formatTime(currentTime)}...`}
            className="h-8 text-xs bg-white dark:bg-neutral-950 flex-1"
          />
          <Button type="submit" size="sm" className="h-8 px-3 text-xs gap-1">
            <Plus className="h-3.5 w-3.5" />
            <span>Salva</span>
          </Button>
        </form>
      </div>

      {/* Notes List */}
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-2.5">
          {sortedNotes.length === 0 ? (
            <div className="text-center py-8 text-neutral-500 dark:text-neutral-400 text-xs space-y-1">
              <p>Nessuna nota salvata per questa lezione.</p>
              <p>Scrivi una nota sopra o fai doppio click su un segmento o slide.</p>
            </div>
          ) : (
            sortedNotes.map((note) => (
              <div
                key={note.id}
                className="p-2.5 rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-sm space-y-1.5"
              >
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => onSeek(note.timestamp)}
                    className="flex items-center gap-1.5 text-xs font-mono font-semibold text-accent-600 dark:text-accent-400 hover:underline"
                    title="Salta a questo momento"
                  >
                    <Play className="h-3 w-3 fill-current" />
                    <span>{formatTime(note.timestamp)}</span>
                  </button>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-neutral-400">
                      {note.type === "transcript"
                        ? "Trascrizione"
                        : note.type === "slide"
                        ? `Slide #${(note.slideIndex || 0) + 1}`
                        : "Video"}
                    </span>
                    <button
                      type="button"
                      onClick={() => onDeleteNote(note.id)}
                      className="text-neutral-400 hover:text-red-500 p-0.5 rounded transition-colors"
                      title="Elimina nota"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <p className="text-xs text-neutral-800 dark:text-neutral-200 leading-relaxed whitespace-pre-wrap">
                  {note.text}
                </p>
                <p className="text-[10px] text-neutral-400">
                  {new Date(note.createdAt).toLocaleString("it-IT", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

// ============================================
// Main VideoPlayer Component (Hybrid 3-Source)
// ============================================

export const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(
  function VideoPlayer({ lectureId, lectureTitle, onClose, initialTime = 0 }, ref) {
    // Media & Loading State
    const [mediaData, setMediaData] = useState<LectureMediaData | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    // Player Mode State
    const [playerMode, setPlayerMode] = useState<PlayerMode>("slides")
    const [panoptoSrc, setPanoptoSrc] = useState<string>("")

    // Playback State
    const [currentTime, setCurrentTime] = useState(initialTime)
    const currentTimeRef = useRef(initialTime)
    const [duration, setDuration] = useState(0)
    const durationRef = useRef(0)
    const [isPlaying, setIsPlaying] = useState(false)
    const [playbackRate, setPlaybackRate] = useState(1)
    const [volume, setVolume] = useState(1)
    const [isMuted, setIsMuted] = useState(false)
    const [skipSilences, setSkipSilences] = useState(false)
    const [showSubtitles, setShowSubtitles] = useState(true)

    // UI Panel State
    const [showSidebar, setShowSidebar] = useState(true)
    const [showSlidesStrip, setShowSlidesStrip] = useState(true)
    const [activeTab, setActiveTab] = useState<"transcript" | "slides" | "notes">("transcript")
    const [notes, setNotes] = useState<PlayerNote[]>(() => loadNotes(lectureId))

    // Media Element Refs
    const videoRef = useRef<HTMLVideoElement | null>(null)
    const audioRef = useRef<HTMLAudioElement | null>(null)
    const panoptoIframeRef = useRef<HTMLIFrameElement | null>(null)
    const videoContainerRef = useRef<HTMLDivElement | null>(null)
    const silenceCheckInterval = useRef<number | null>(null)
    const isSeekingRef = useRef(false)
    const lastSilenceSkipRef = useRef<number>(-1)

    // Load lecture data (contratto reale del backend → lib/lecture-media.ts)
    useEffect(() => {
      let cancelled = false

      async function loadLectureData() {
        try {
          setIsLoading(true)
          const media = toLectureMedia(await api.getLecture(lectureId), lectureId)
          if (cancelled) return
          setMediaData(media)
          setPlayerMode(media.defaultMode ?? "slides")
          if (media.panoptoEmbedUrl) {
            const start = Math.max(0, Math.floor(initialTime))
            const url = /([?&])start=\d+/.test(media.panoptoEmbedUrl)
              ? media.panoptoEmbedUrl.replace(/([?&])start=\d+/, `$1start=${start}`)
              : `${media.panoptoEmbedUrl}${media.panoptoEmbedUrl.includes("?") ? "&" : "?"}start=${start}`
            setPanoptoSrc(url)
          }
          setError(null)
        } catch (err) {
          if (!cancelled) setError(describeError(err, "Errore nel caricamento della lezione"))
        } finally {
          if (!cancelled) setIsLoading(false)
        }
      }

      loadLectureData()
      return () => {
        cancelled = true
      }
    }, [lectureId, initialTime])

    // Slide: solo quelle che esistono davvero (slides.json); nessun prefetch, il browser le carica quando servono.
    const resolvedSlides: SlideInfo[] = mediaData?.slides ?? NO_SLIDES
    const transcriptSegments: TranscriptSegment[] = mediaData?.transcript ?? NO_SEGMENTS
    const silenceIntervals: SilenceInterval[] = mediaData?.silences ?? NO_SILENCES
    const audioUrl = mediaData?.audioUrl ?? null

    // Audio della modalità Slide: streaming diretto dal backend (niente copia intera in IndexedDB)
    useEffect(() => {
      if (playerMode !== "slides" || !audioUrl || audioRef.current) return

      const audio = new Audio()
      audio.preload = "metadata"
      audioRef.current = audio
      audio.src = audioUrl

      audio.addEventListener("loadedmetadata", () => {
        durationRef.current = audio.duration
        setDuration(audio.duration)
        if (currentTimeRef.current > 0) {
          audio.currentTime = currentTimeRef.current
        }
      })
      audio.addEventListener("timeupdate", () => {
        if (!isSeekingRef.current) {
          currentTimeRef.current = audio.currentTime
          setCurrentTime(audio.currentTime)
        }
      })
      audio.addEventListener("ended", () => {
        setIsPlaying(false)
      })
      audio.addEventListener("play", () => setIsPlaying(true))
      audio.addEventListener("pause", () => setIsPlaying(false))
      audio.addEventListener("ratechange", () => setPlaybackRate(audio.playbackRate))
      audio.addEventListener("volumechange", () => {
        setVolume(audio.volume)
        setIsMuted(audio.muted)
      })

      return () => {
        audio.pause()
        audio.removeAttribute("src")
        audioRef.current = null
      }
    }, [playerMode, audioUrl])


    // Initialize Video Element listeners when in video mode
    useEffect(() => {
      const video = videoRef.current
      if (playerMode !== "video" || !video) return

      const onLoaded = () => {
        durationRef.current = video.duration
        setDuration(video.duration)
        if (currentTimeRef.current > 0) video.currentTime = currentTimeRef.current
      }
      const onTime = () => {
        if (!isSeekingRef.current) {
          currentTimeRef.current = video.currentTime
          setCurrentTime(video.currentTime)
        }
      }
      const onPlay = () => setIsPlaying(true)
      const onPause = () => setIsPlaying(false)
      const onEnded = () => {
        setIsPlaying(false)
        currentTimeRef.current = 0
        setCurrentTime(0)
      }
      const onRate = () => setPlaybackRate(video.playbackRate)
      const onVol = () => {
        setVolume(video.volume)
        setIsMuted(video.muted)
      }

      video.addEventListener("loadedmetadata", onLoaded)
      video.addEventListener("timeupdate", onTime)
      video.addEventListener("play", onPlay)
      video.addEventListener("pause", onPause)
      video.addEventListener("ended", onEnded)
      video.addEventListener("ratechange", onRate)
      video.addEventListener("volumechange", onVol)

      return () => {
        video.removeEventListener("loadedmetadata", onLoaded)
        video.removeEventListener("timeupdate", onTime)
        video.removeEventListener("play", onPlay)
        video.removeEventListener("pause", onPause)
        video.removeEventListener("ended", onEnded)
        video.removeEventListener("ratechange", onRate)
        video.removeEventListener("volumechange", onVol)
      }
    }, [playerMode, isLoading, mediaData])

    // Silence Skipping Engine
    useEffect(() => {
      if (!skipSilences || !silenceIntervals.length) {
        if (silenceCheckInterval.current) {
          clearInterval(silenceCheckInterval.current)
          silenceCheckInterval.current = null
        }
        return
      }

      const checkSilences = () => {
        const activeMedia = playerMode === "video" ? videoRef.current : audioRef.current
        if (!activeMedia || !isPlaying) return

        const end = silenceEndAt(silenceIntervals, activeMedia.currentTime)
        if (end !== null && end !== lastSilenceSkipRef.current) {
          lastSilenceSkipRef.current = end
          activeMedia.currentTime = end
        }
      }

      silenceCheckInterval.current = window.setInterval(checkSilences, 100)
      return () => {
        if (silenceCheckInterval.current) {
          clearInterval(silenceCheckInterval.current)
          silenceCheckInterval.current = null
        }
      }
    }, [skipSilences, silenceIntervals, isPlaying, playerMode])

    // Playback rate sync
    useEffect(() => {
      if (playerMode === "video" && videoRef.current) {
        if (videoRef.current.playbackRate !== playbackRate) {
          videoRef.current.playbackRate = playbackRate
        }
      } else if (playerMode === "slides" && audioRef.current) {
        if (audioRef.current.playbackRate !== playbackRate) {
          audioRef.current.playbackRate = playbackRate
        }
      }
    }, [playbackRate, playerMode])

    // Volume & Mute sync
    useEffect(() => {
      const media = playerMode === "video" ? videoRef.current : audioRef.current
      if (media) {
        if (media.volume !== volume) media.volume = volume
        if (media.muted !== isMuted) media.muted = isMuted
      }
    }, [volume, isMuted, playerMode])

    // Seeking Logic across all 3 modes
    const seekPanopto = useCallback((time: number) => {
      // 1. Send postMessage to iframe
      if (panoptoIframeRef.current?.contentWindow) {
        try {
          panoptoIframeRef.current.contentWindow.postMessage({ message: "seekTo", value: time }, "*")
          panoptoIframeRef.current.contentWindow.postMessage({ action: "seek", time }, "*")
          panoptoIframeRef.current.contentWindow.postMessage(JSON.stringify({ action: "seek", time }), "*")
        } catch {}
      }

      // 2. Update iframe start parameter
      setPanoptoSrc((prev) => {
        if (!prev) return prev
        try {
          let newUrl = prev
          if (/([?&])start=\d+/.test(newUrl)) {
            newUrl = newUrl.replace(/([?&])start=\d+/, `$1start=${Math.floor(time)}`)
          } else {
            newUrl += (newUrl.includes("?") ? "&" : "?") + `start=${Math.floor(time)}`
          }
          if (newUrl.includes("autoplay=false")) {
            newUrl = newUrl.replace("autoplay=false", "autoplay=true")
          }
          return newUrl
        } catch {
          return prev
        }
      })
    }, [])

    const handleSeek = useCallback(
      (time: number) => {
        const currentDur = durationRef.current || duration
        const bounded = Math.max(0, currentDur > 0 ? Math.min(currentDur, time) : time)
        currentTimeRef.current = bounded
        setCurrentTime(bounded)

        if (playerMode === "video" && videoRef.current) {
          isSeekingRef.current = true
          videoRef.current.currentTime = bounded
          setTimeout(() => {
            isSeekingRef.current = false
          }, 100)
        } else if (playerMode === "slides" && audioRef.current) {
          isSeekingRef.current = true
          audioRef.current.currentTime = bounded
          setTimeout(() => {
            isSeekingRef.current = false
          }, 100)
        } else if (playerMode === "panopto") {
          seekPanopto(bounded)
        }
      },
      [playerMode, duration, seekPanopto]
    )

    // Mode Switching
    const handleModeChange = useCallback(
      (newMode: PlayerMode) => {
        if (newMode === playerMode) return

        // Pause existing media
        if (videoRef.current && !videoRef.current.paused) {
          videoRef.current.pause()
        }
        if (audioRef.current && !audioRef.current.paused) {
          audioRef.current.pause()
        }
        setIsPlaying(false)

        setPlayerMode(newMode)

        // Transfer current position
        if (newMode === "panopto") {
          seekPanopto(currentTime)
        } else if (newMode === "video" && videoRef.current) {
          videoRef.current.currentTime = currentTime
        } else if (newMode === "slides" && audioRef.current) {
          audioRef.current.currentTime = currentTime
        }
      },
      [playerMode, currentTime, seekPanopto]
    )

    // Play/Pause toggle
    const handlePlayPause = useCallback(() => {
      if (playerMode === "video" && videoRef.current) {
        if (videoRef.current.paused) {
          videoRef.current.play().catch(() => {})
        } else {
          videoRef.current.pause()
        }
      } else if (playerMode === "slides" && audioRef.current) {
        if (audioRef.current.paused) {
          audioRef.current.play().catch(() => {})
        } else {
          audioRef.current.pause()
        }
      }
    }, [playerMode])

    // Keyboard Shortcuts
    useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

        switch (e.key) {
          case " ":
            e.preventDefault()
            handlePlayPause()
            break
          case "ArrowLeft":
            e.preventDefault()
            handleSeek(Math.max(0, currentTime - (e.shiftKey ? 30 : 5)))
            break
          case "ArrowRight":
            e.preventDefault()
            handleSeek(duration > 0 ? Math.min(duration, currentTime + (e.shiftKey ? 30 : 5)) : currentTime + 5)
            break
          case "[":
            e.preventDefault()
            setPlaybackRate((r) => Math.max(0.5, r - 0.25))
            break
          case "]":
            e.preventDefault()
            setPlaybackRate((r) => Math.min(3, r + 0.25))
            break
          case "m":
          case "M":
            e.preventDefault()
            setIsMuted((prev) => !prev)
            break
          case "f":
          case "F":
            e.preventDefault()
            if (playerMode === "video") {
              requestMediaPip(videoRef.current)
            } else if (playerMode === "slides") {
              requestMediaPip(audioRef.current)
            }
            break
        }
      }

      window.addEventListener("keydown", handleKeyDown)
      return () => window.removeEventListener("keydown", handleKeyDown)
    }, [handlePlayPause, handleSeek, currentTime, duration, playerMode])

    // Notes Handlers
    const addNote = useCallback(
      (timestamp: number, type: "transcript" | "slide" | "video" | "general" = "general", segmentIndex?: number, slideIndex?: number, initialText?: string) => {
        const text = initialText !== undefined ? initialText : prompt("Aggiungi nota:")
        if (!text?.trim()) return

        const newNote: PlayerNote = {
          id: generateId(),
          lectureId,
          timestamp,
          type,
          segmentIndex,
          slideIndex,
          text: text.trim(),
          createdAt: new Date().toISOString(),
        }

        const updated = [...notes, newNote]
        setNotes(updated)
        saveNotes(lectureId, updated)
      },
      [lectureId, notes]
    )

    const deleteNote = useCallback(
      (id: string) => {
        const updated = notes.filter((n) => n.id !== id)
        setNotes(updated)
        saveNotes(lectureId, updated)
      },
      [lectureId, notes]
    )

    // Segment & Slide click handlers
    const handleSegmentClick = useCallback(
      (index: number) => {
        const segment = transcriptSegments[index]
        if (segment) {
          handleSeek(segment.t_start)
        }
      },
      [transcriptSegments, handleSeek]
    )

    const handleSlideClick = useCallback(
      (index: number) => {
        const slide = resolvedSlides[index]
        if (slide) {
          handleSeek(slide.timestamp)
        }
      },
      [resolvedSlides, handleSeek]
    )

    // Slide navigation index
    const activeSlideIndex = useMemo(() => slideIndexAt(resolvedSlides, currentTime), [resolvedSlides, currentTime])

    // Active transcript subtitle text
    const activeTranscriptText = useMemo(() => {
      const seg = transcriptSegments.find(
        (s) => s.t_start <= currentTime && s.t_end > currentTime
      )
      return seg?.text
    }, [transcriptSegments, currentTime])

    // Imperative handle
    useImperativeHandle(ref, () => ({
      play: () => {
        if (playerMode === "video") videoRef.current?.play().catch(() => {})
        else if (playerMode === "slides") audioRef.current?.play().catch(() => {})
      },
      pause: () => {
        if (playerMode === "video") videoRef.current?.pause()
        else if (playerMode === "slides") audioRef.current?.pause()
      },
      seek: handleSeek,
      setRate: (rate: number) => setPlaybackRate(rate),
      getCurrentTime: () => currentTimeRef.current,
      getDuration: () => durationRef.current || duration,
      setMode: (mode: PlayerMode) => handleModeChange(mode),
    }))

    // Source availability: decisa dall'adapter in base ai dati reali
    const modes = mediaData?.modes ?? []
    const isPanoptoAvailable = modes.includes("panopto")
    const isVideoAvailable = modes.includes("video")
    const isSlidesAvailable = modes.includes("slides")

    // Overlay a tutto schermo in un portal (sopra header e sidebar), con focus trap ed Esc di Radix.
    const shell = (content: React.ReactNode, label: string) => (
      <Dialog.Root open onOpenChange={(open) => { if (!open) onClose() }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[500] bg-neutral-950/85" />
          <Dialog.Content
            aria-describedby={undefined}
            className="fixed inset-0 z-[510] flex flex-col bg-neutral-950 text-neutral-100 outline-none"
            onOpenAutoFocus={(e) => {
              // Fuoco sul pulsante di chiusura: Spazio non deve finire in un campo di testo
              e.preventDefault()
              const target = e.currentTarget as HTMLElement | null
              target?.querySelector<HTMLElement>("[data-player-close]")?.focus()
            }}
          >
            <Dialog.Title className="sr-only">{label}</Dialog.Title>
            {content}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    )

    // Render loading & error
    if (isLoading) {
      return shell(
        <div className="flex-1 flex items-center justify-center">
          <div className="bg-white dark:bg-neutral-900 rounded-2xl p-8 flex flex-col items-center gap-4 min-w-[280px] shadow-2xl border border-neutral-200 dark:border-neutral-800">
            <div className="w-10 h-10 border-3 border-accent-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
              Caricamento player multimodale...
            </p>
            <Button variant="outline" size="sm" onClick={onClose} data-player-close>Chiudi</Button>
          </div>
        </div>,
        `Caricamento: ${lectureTitle}`,
      )
    }

    if (error) {
      return shell(
        <div className="flex-1 flex items-center justify-center">
          <div className="bg-white dark:bg-neutral-900 rounded-2xl p-8 max-w-md mx-4 text-center shadow-2xl border border-neutral-200 dark:border-neutral-800">
            <X className="h-12 w-12 text-error-500 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-neutral-950 dark:text-neutral-50 mb-2">Errore caricamento</h3>
            <p className="text-sm text-neutral-600 dark:text-neutral-300 mb-6">{error}</p>
            <Button onClick={onClose} data-player-close>Chiudi</Button>
          </div>
        </div>,
        `Errore: ${lectureTitle}`,
      )
    }

    if (!modes.length) {
      return shell(
        <div className="flex-1 flex items-center justify-center">
          <div className="bg-white dark:bg-neutral-900 rounded-2xl p-8 max-w-md mx-4 text-center shadow-2xl border border-neutral-200 dark:border-neutral-800">
            <Video className="h-12 w-12 text-neutral-400 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-neutral-950 dark:text-neutral-50 mb-2">Nessuna sorgente disponibile</h3>
            <p className="text-sm text-neutral-600 dark:text-neutral-300 mb-6">
              Questa lezione non ha ancora audio, slide, video Moodle o registrazione Panopto.
            </p>
            <Button onClick={onClose} data-player-close>Chiudi</Button>
          </div>
        </div>,
        `Player: ${lectureTitle}`,
      )
    }

    return shell(
      <div className="flex-1 min-h-0 flex flex-col select-none">
        {/* Header Bar */}
        <header className="flex flex-wrap items-center justify-between gap-2 px-2 sm:px-4 py-2 sm:py-3 border-b border-neutral-800 bg-neutral-950/90 backdrop-blur-md">
          {/* Left: Close & Title */}
          <div className="flex items-center gap-3 min-w-0">
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              aria-label="Chiudi player"
              title="Chiudi (Esc)"
              data-player-close
              className="shrink-0 text-neutral-400 hover:text-white hover:bg-neutral-800"
            >
              <X className="h-5 w-5" />
            </Button>
            <div className="min-w-0">
              <h2 id="player-title" className="font-semibold text-neutral-100 text-sm sm:text-base truncate max-w-[60vw] sm:max-w-md md:max-w-lg">
                {lectureTitle}
              </h2>
              <div className="hidden sm:flex items-center gap-2 text-xs text-neutral-400 font-mono">
                <span>{transcriptSegments.length} segmenti di trascrizione</span>
                <span>·</span>
                <span>{resolvedSlides.length} slide</span>
              </div>
            </div>
          </div>

          {/* Right: Pill Mode Selector & Toolbars */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Elegant Mode Switcher Pill */}
            <div
              className="flex items-center p-1 bg-neutral-900 rounded-full border border-neutral-800 shadow-inner"
              role="tablist"
              aria-label="Modalità di riproduzione"
            >
              {isPanoptoAvailable && (
                <button
                  type="button"
                  onClick={() => handleModeChange("panopto")}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-full transition-all duration-200",
                    playerMode === "panopto"
                      ? "bg-accent-500 text-white shadow-md scale-[1.02]"
                      : "text-neutral-400 hover:text-neutral-200"
                  )}
                  aria-label="Modalità Panopto"
                  aria-selected={playerMode === "panopto"}
                  role="tab"
                >
                  <Video className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Panopto</span>
                </button>
              )}
              {isVideoAvailable && (
                <button
                  type="button"
                  onClick={() => handleModeChange("video")}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-full transition-all duration-200",
                    playerMode === "video"
                      ? "bg-accent-500 text-white shadow-md scale-[1.02]"
                      : "text-neutral-400 hover:text-neutral-200"
                  )}
                  aria-label="Modalità Video MP4"
                  aria-selected={playerMode === "video"}
                  role="tab"
                >
                  <Film className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Video MP4</span>
                </button>
              )}
              {isSlidesAvailable && (
                <button
                  type="button"
                  onClick={() => handleModeChange("slides")}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-full transition-all duration-200",
                    playerMode === "slides"
                      ? "bg-accent-500 text-white shadow-md scale-[1.02]"
                      : "text-neutral-400 hover:text-neutral-200"
                  )}
                  aria-label="Modalità Slide & Audio"
                  aria-selected={playerMode === "slides"}
                  role="tab"
                >
                  <Presentation className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Slide & Audio</span>
                </button>
              )}
            </div>

            {/* Sidebar toggle buttons */}
            <div className="flex items-center gap-1 border-l border-neutral-800 pl-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowSidebar(!showSidebar)}
                aria-label={showSidebar ? "Nascondi pannello laterale" : "Mostra pannello laterale"}
                aria-pressed={showSidebar}
                className={cn("h-8 w-8 text-neutral-400 hover:text-white", showSidebar && "text-accent-400 bg-accent-500/10")}
                title="Pannello laterale (Trascrizione / Note)"
              >
                <FileText className="h-4 w-4" />
              </Button>
              {resolvedSlides.length > 0 && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowSlidesStrip(!showSlidesStrip)}
                  aria-label={showSlidesStrip ? "Nascondi barra slide" : "Mostra barra slide"}
                  aria-pressed={showSlidesStrip}
                  className={cn("h-8 w-8 text-neutral-400 hover:text-white", showSlidesStrip && "text-accent-400 bg-accent-500/10")}
                  title="Barra miniature slide"
                >
                  <ImageIcon className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </header>

        {/* Main Stage & Panels Layout */}
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
          {/* Main Media Player Stage */}
          <div className="shrink-0 lg:shrink lg:flex-1 min-w-0 flex flex-col p-2 sm:p-4 overflow-y-auto max-h-[60vh] lg:max-h-none">
            <div className="lg:flex-1 flex flex-col justify-center min-h-0">
              {playerMode === "panopto" && (
                <PanoptoPlayer
                  embedUrl={panoptoSrc || mediaData?.panoptoEmbedUrl || ""}
                  viewerUrl={mediaData?.viewerUrl ?? undefined}
                  lectureTitle={lectureTitle}
                  currentTime={currentTime}
                  duration={duration}
                  onSeek={handleSeek}
                  onAddNote={(t) => addNote(t, "video")}
                  iframeRef={panoptoIframeRef}
                />
              )}

              {playerMode === "video" && (
                <Html5VideoPlayer
                  videoUrl={mediaData?.videoUrl || ""}
                  isRemote={Boolean(mediaData?.videoIsRemote)}
                  lectureTitle={lectureTitle}
                  currentTime={currentTime}
                  duration={duration}
                  playbackRate={playbackRate}
                  volume={volume}
                  isMuted={isMuted}
                  isPlaying={isPlaying}
                  silenceIntervals={silenceIntervals}
                  skipSilences={skipSilences}
                  activeSubtitle={activeTranscriptText}
                  showSubtitles={showSubtitles}
                  onToggleSubtitles={() => setShowSubtitles((s) => !s)}
                  onPlayPause={handlePlayPause}
                  onSeek={handleSeek}
                  onRateChange={(r) => setPlaybackRate(r)}
                  onVolumeChange={(v) => {
                    setVolume(v)
                    if (v > 0) setIsMuted(false)
                  }}
                  onMuteToggle={() => setIsMuted((m) => !m)}
                  onSkipSilencesToggle={() => {
                    setSkipSilences((prev) => !prev)
                    lastSilenceSkipRef.current = -1
                  }}
                  onSeekBackward={(s) => handleSeek(Math.max(0, currentTime - s))}
                  onSeekForward={(s) => handleSeek(duration > 0 ? Math.min(duration, currentTime + s) : currentTime + s)}
                  onAddNote={(t) => addNote(t, "video")}
                  videoRef={videoRef}
                  containerRef={videoContainerRef}
                />
              )}

              {playerMode === "slides" && (
                <SlideAudioPlayer
                  slides={resolvedSlides}
                  activeSlideIndex={activeSlideIndex}
                  audioRef={audioRef}
                  hasAudio={Boolean(audioUrl)}
                  currentTime={currentTime}
                  duration={duration}
                  playbackRate={playbackRate}
                  volume={volume}
                  isMuted={isMuted}
                  isPlaying={isPlaying}
                  silenceIntervals={silenceIntervals}
                  skipSilences={skipSilences}
                  onPlayPause={handlePlayPause}
                  onSeek={handleSeek}
                  onRateChange={(r) => setPlaybackRate(r)}
                  onVolumeChange={(v) => {
                    setVolume(v)
                    if (v > 0) setIsMuted(false)
                  }}
                  onMuteToggle={() => setIsMuted((m) => !m)}
                  onSkipSilencesToggle={() => {
                    setSkipSilences((prev) => !prev)
                    lastSilenceSkipRef.current = -1
                  }}
                  onSeekBackward={(s) => handleSeek(Math.max(0, currentTime - s))}
                  onSeekForward={(s) => handleSeek(duration > 0 ? Math.min(duration, currentTime + s) : currentTime + s)}
                  onPrevSlide={() => {
                    if (activeSlideIndex > 0) {
                      handleSlideClick(activeSlideIndex - 1)
                    }
                  }}
                  onNextSlide={() => {
                    if (activeSlideIndex < resolvedSlides.length - 1) {
                      handleSlideClick(activeSlideIndex + 1)
                    }
                  }}
                  onAddNote={(t, sIdx) => addNote(t, "slide", undefined, sIdx)}
                />
              )}
            </div>

            {/* Bottom Horizontal Slides Strip (available in all modes when slides exist) */}
            {showSlidesStrip && resolvedSlides.length > 0 && (
              <div className="mt-3">
                <SlidesStrip
                  slides={resolvedSlides}
                  currentTime={currentTime}
                  onSlideClick={handleSlideClick}
                  onAddNote={(sIdx, t) => addNote(t, "slide", undefined, sIdx)}
                  notes={notes}
                />
              </div>
            )}
          </div>

          {/* Right Sidebar: Whisper Transcript & Notes */}
          {showSidebar && (
            <aside className="flex-1 min-h-0 w-full lg:flex-none lg:w-96 border-t lg:border-t-0 lg:border-l border-neutral-800 bg-neutral-900/90 flex flex-col">
              {/* Tab navigation */}
              <div className="flex border-b border-neutral-800 bg-neutral-950/60 p-1 gap-1">
                <button
                  type="button"
                  onClick={() => setActiveTab("transcript")}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-semibold rounded-md transition-colors",
                    activeTab === "transcript"
                      ? "bg-neutral-800 text-white shadow-sm"
                      : "text-neutral-400 hover:text-neutral-200"
                  )}
                >
                  <FileText className="h-3.5 w-3.5 text-accent-500" />
                  <span>Trascrizione</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("slides")}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-semibold rounded-md transition-colors",
                    activeTab === "slides"
                      ? "bg-neutral-800 text-white shadow-sm"
                      : "text-neutral-400 hover:text-neutral-200"
                  )}
                >
                  <ImageIcon className="h-3.5 w-3.5 text-accent-500" />
                  <span>Slide ({resolvedSlides.length})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("notes")}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-semibold rounded-md transition-colors",
                    activeTab === "notes"
                      ? "bg-neutral-800 text-white shadow-sm"
                      : "text-neutral-400 hover:text-neutral-200"
                  )}
                >
                  <Bookmark className="h-3.5 w-3.5 text-accent-500" />
                  <span>Note ({notes.length})</span>
                </button>
              </div>

              {/* Tab Contents */}
              <div className="flex-1 min-h-0 flex flex-col">
                {activeTab === "transcript" && (
                  <TranscriptPanel
                    segments={transcriptSegments}
                    currentTime={currentTime}
                    onSegmentClick={handleSegmentClick}
                    onAddNote={(segIdx, t) => addNote(t, "transcript", segIdx)}
                    notes={notes}
                  />
                )}

                {activeTab === "slides" && (
                  <ScrollArea className="flex-1 p-3">
                    <div className="grid grid-cols-2 gap-2.5">
                      {resolvedSlides.map((slide, i) => (
                        <div
                          key={i}
                          onClick={() => handleSlideClick(i)}
                          className={cn(
                            "cursor-pointer rounded-lg overflow-hidden border p-1 transition-all",
                            i === activeSlideIndex
                              ? "border-accent-500 bg-accent-500/10 shadow-md"
                              : "border-neutral-800 hover:border-neutral-700 bg-neutral-950"
                          )}
                        >
                          <img
                            src={slide.thumbnailUrl}
                            alt={`Slide ${i + 1}`}
                            className="w-full h-auto rounded object-cover"
                          />
                          <div className="flex justify-between text-[10px] font-mono mt-1 text-neutral-400">
                            <span>#{i + 1}</span>
                            <span>{formatTime(slide.timestamp)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}

                {activeTab === "notes" && (
                  <NotesPanel
                    notes={notes}
                    currentTime={currentTime}
                    onSeek={handleSeek}
                    onAddNote={(text, t) => addNote(t, "general", undefined, undefined, text)}
                    onDeleteNote={deleteNote}
                  />
                )}
              </div>
            </aside>
          )}
        </div>

        {/* Footer Shortcut Bar */}
        <footer className="hidden md:flex items-center justify-center gap-4 px-4 py-1.5 border-t border-neutral-900 bg-neutral-950 text-[11px] text-neutral-500">
          <span><kbd className="px-1.5 py-0.5 bg-neutral-800 rounded text-neutral-300">Spazio</kbd> Play/Pausa</span>
          <span><kbd className="px-1.5 py-0.5 bg-neutral-800 rounded text-neutral-300">←/→</kbd> ±5s</span>
          <span><kbd className="px-1.5 py-0.5 bg-neutral-800 rounded text-neutral-300">Shift+←/→</kbd> ±30s</span>
          <span><kbd className="px-1.5 py-0.5 bg-neutral-800 rounded text-neutral-300">[ / ]</kbd> Velocità ∓0.25</span>
          <span><kbd className="px-1.5 py-0.5 bg-neutral-800 rounded text-neutral-300">M</kbd> Muto</span>
          <span><kbd className="px-1.5 py-0.5 bg-neutral-800 rounded text-neutral-300">F</kbd> PiP</span>
          <span><kbd className="px-1.5 py-0.5 bg-neutral-800 rounded text-neutral-300">Esc</kbd> Chiudi</span>
        </footer>
      </div>,
      `Player: ${lectureTitle}`,
    )
  }
)

VideoPlayer.displayName = "VideoPlayer"
