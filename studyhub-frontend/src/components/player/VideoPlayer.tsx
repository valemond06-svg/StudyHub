import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  useImperativeHandle,
  forwardRef,
} from "react"
import { X, Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Maximize2, MousePointer, Mic, FileText, Image, Settings } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { api } from "@/lib/api"
import type { Lecture } from "@/types"

// ============================================
// Types
// ============================================

export interface TranscriptSegment {
  t_start: number
  t_end: number
  text: string
}

export interface SlideInfo {
  index: number
  timestamp: number
  url: string
  thumbnailUrl: string
}

export interface SilenceInterval {
  start: number
  end: number
}

export interface PlayerNote {
  id: string
  lectureId: number
  timestamp: number
  type: "transcript" | "slide"
  segmentIndex?: number
  slideIndex?: number
  text: string
  createdAt: string
}

export interface LectureMediaData {
  audio_path?: string
  slides_path?: string
  transcript_segments?: TranscriptSegment[]
  silence_intervals?: SilenceInterval[]
  slides?: SlideInfo[]
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
}

// ============================================
// IndexedDB Cache for Offline-First
// ============================================

const DB_NAME = "studyhub-media-cache"
const DB_VERSION = 1
const AUDIO_STORE = "audio"
const SLIDES_STORE = "slides"

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(AUDIO_STORE)) {
        db.createObjectStore(AUDIO_STORE)
      }
      if (!db.objectStoreNames.contains(SLIDES_STORE)) {
        db.createObjectStore(SLIDES_STORE)
      }
    }
  })
}

async function cacheBlob(storeName: string, key: string, blob: Blob): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite")
    const store = tx.objectStore(storeName)
    const request = store.put(blob, key)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

async function getCachedBlob(storeName: string, key: string): Promise<Blob | null> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly")
    const store = tx.objectStore(storeName)
    const request = store.get(key)
    request.onsuccess = () => resolve(request.result || null)
    request.onerror = () => reject(request.error)
  })
}

async function fetchWithCache(url: string, storeName: string, cacheKey: string): Promise<Blob> {
  // Try cache first
  const cached = await getCachedBlob(storeName, cacheKey)
  if (cached) return cached

  // Fetch and cache
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to fetch ${url}`)
  const blob = await response.blob()
  await cacheBlob(storeName, cacheKey, blob)
  return blob
}

// ============================================
// Helper Functions
// ============================================

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, "0")}`
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

// HTMLAudioElement doesn't natively expose Picture-in-Picture in TS lib types
// but it is supported in modern browsers. Cast to access it safely.
function requestAudioPip(audio: HTMLAudioElement | null) {
  if (!audio) return
  const el = audio as HTMLAudioElement & {
    requestPictureInPicture?: () => Promise<unknown>
  }
  el.requestPictureInPicture?.().catch(() => {})
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
// Sub-component: Audio Player Controls
// ============================================

interface AudioPlayerProps {
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
}

function AudioPlayer({
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
}: AudioPlayerProps) {
  const seekBarRef = useRef<HTMLDivElement>(null)
  const isSeekingRef = useRef(false)

  const handleSeekMouseDown = useCallback((e: React.MouseEvent) => {
    isSeekingRef.current = true
    const handleMove = (moveEvent: MouseEvent) => {
      if (!seekBarRef.current) return
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

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault()
      onSeek(Math.max(0, currentTime - 5))
    } else if (e.key === "ArrowRight") {
      e.preventDefault()
      onSeek(Math.min(duration, currentTime + 5))
    } else if (e.key === " " || e.key === "Space") {
      e.preventDefault()
      onPlayPause()
    }
  }, [currentTime, duration, onPlayPause, onSeek])

  const silenceBeforeCurrent = useMemo(() => {
    return silenceIntervals.find((s) => s.start <= currentTime && s.end > currentTime)
  }, [silenceIntervals, currentTime])

  const nextSilence = useMemo(() => {
    return silenceIntervals.find((s) => s.start > currentTime)
  }, [silenceIntervals, currentTime])

  return (
    <div className="flex flex-col gap-3 w-full max-w-4xl mx-auto">
      {/* Seek Bar with Silence Indicators */}
      <div className="relative">
        <div
          ref={seekBarRef}
          className="relative h-2 bg-neutral-200 dark:bg-neutral-700 rounded-full cursor-pointer group"
          onMouseDown={handleSeekMouseDown}
          onKeyDown={handleKeyDown}
          tabIndex={0}
          role="slider"
          aria-label="Posizione riproduzione"
          aria-valuemin={0}
          aria-valuemax={duration}
          aria-valuenow={currentTime}
        >
          {/* Silence intervals background */}
          {silenceIntervals.map((s, i) => (
            <div
              key={i}
              className="absolute top-0 h-full bg-warning-500/20 dark:bg-warning-500/10 rounded-full"
              style={{
                left: `${(s.start / duration) * 100}%`,
                width: `${((s.end - s.start) / duration) * 100}%`,
              }}
              title={`Silenzio: ${formatTime(s.start)} - ${formatTime(s.end)}`}
            />
          ))}
          {/* Progress */}
          <div
            className="absolute top-0 h-full bg-accent-500 rounded-full transition-all duration-75"
            style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
          />
          {/* Current time indicator */}
          <div
            className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-accent-500 rounded-full shadow-lg border-2 border-white dark:border-neutral-900 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
            style={{ left: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-neutral-500 dark:text-neutral-400 mt-1">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Left: Playback controls */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onSeekBackward(30)}
            aria-label="Indietro 30s"
            title="Indietro 30s (Shift+←)"
          >
            <SkipBack className="h-5 w-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onSeekBackward(5)}
            aria-label="Indietro 5s"
            title="Indietro 5s (←)"
          >
            <SkipBack className="h-5 w-5" />
          </Button>
          <Button
            variant="default"
            size="lg"
            onClick={onPlayPause}
            aria-label={isPlaying ? "Pausa" : "Riproduci"}
            title={isPlaying ? "Pausa (Spazio)" : "Riproduci (Spazio)"}
            className="h-12 w-12"
          >
            {isPlaying ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onSeekForward(5)}
            aria-label="Avanti 5s"
            title="Avanti 5s (→)"
          >
            <SkipForward className="h-5 w-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onSeekForward(30)}
            aria-label="Avanti 30s"
            title="Avanti 30s (Shift+→)"
          >
            <SkipForward className="h-5 w-5" />
          </Button>
        </div>

        {/* Center: Time & Silence Skip */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-2 py-1 rounded-lg bg-neutral-100 dark:bg-neutral-800">
            <Mic className={cn("h-4 w-4", skipSilences ? "text-accent-500" : "text-neutral-400")} />
            <Switch
              checked={skipSilences}
              onCheckedChange={onSkipSilencesToggle}
              aria-label="Salta silenzi"
            />
            <span className="text-sm text-neutral-600 dark:text-neutral-300">Salta silenzi</span>
            {silenceBeforeCurrent && skipSilences && (
              <span className="text-xs text-warning-600 dark:text-warning-400">
                Saltando: {formatTime(silenceBeforeCurrent.start)} → {formatTime(silenceBeforeCurrent.end)}
              </span>
            )}
          </div>
        </div>

        {/* Right: Volume, Speed, PiP */}
        <div className="flex items-center gap-2">
          {/* Volume */}
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={onMuteToggle}
              aria-label={isMuted ? "Attiva audio" : "Disattiva audio"}
              title={isMuted ? "Attiva audio (M)" : "Disattiva audio (M)"}
            >
              {isMuted || volume === 0 ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
            </Button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={isMuted ? 0 : volume}
              onChange={(e) => onVolumeChange(Number(e.target.value))}
              className="w-24 h-1.5 appearance-none bg-neutral-200 dark:bg-neutral-700 rounded-full accent-accent-500"
              aria-label="Volume"
            />
          </div>

          {/* Playback Rate */}
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onRateChange(Math.max(0.5, playbackRate - 0.25))}
              aria-label="Rallenta"
              title="Rallenta ([)"
            >
              <Settings className="h-4 w-4" />
            </Button>
            <span className="text-sm font-mono text-neutral-600 dark:text-neutral-300 w-14 text-center">
              {playbackRate.toFixed(2)}×
            </span>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onRateChange(Math.min(3, playbackRate + 0.25))}
              aria-label="Accelera"
              title="Accelera (])"
            >
              <Settings className="h-4 w-4 rotate-180" />
            </Button>
          </div>

          {/* PiP */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => requestAudioPip(audioRef.current)}
            aria-label="Picture in Picture"
            title="Picture in Picture"
            disabled={!document.pictureInPictureEnabled}
          >
            <Maximize2 className="h-5 w-5" />
          </Button>
        </div>
      </div>
    </div>
  )
}

// ============================================
// Sub-component: Transcript Panel
// ============================================

interface TranscriptPanelProps {
  segments: TranscriptSegment[]
  currentTime: number
  onSegmentClick: (index: number) => void
  onAddNote: (segmentIndex: number, timestamp: number) => void
  notes: PlayerNote[]
}

function TranscriptPanel({
  segments,
  currentTime,
  onSegmentClick,
  onAddNote,
  notes,
}: TranscriptPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const activeIndex = useMemo(() => {
    return segments.findIndex((s) => s.t_start <= currentTime && s.t_end > currentTime)
  }, [segments, currentTime])

  // Auto-scroll to active segment
  useEffect(() => {
    if (activeIndex >= 0 && containerRef.current) {
      const element = containerRef.current.querySelector(`[data-segment-index="${activeIndex}"]`)
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "center" })
      }
    }
  }, [activeIndex])

  const getNotesForSegment = (index: number) => {
    return notes.filter((n) => n.type === "transcript" && n.segmentIndex === index)
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center justify-between p-3 border-b border-neutral-200 dark:border-neutral-700">
        <h3 className="font-medium text-neutral-950 dark:text-neutral-50 flex items-center gap-2">
          <FileText className="h-5 w-5 text-accent-500" />
          Trascrizione ({segments.length})
        </h3>
        <span className="text-xs text-neutral-500 dark:text-neutral-400">
          {activeIndex >= 0 ? `Segmento ${activeIndex + 1}` : "—"}
        </span>
      </div>
      <ScrollArea className="flex-1">
        <div ref={containerRef} className="p-3 space-y-2">
          {segments.length === 0 ? (
            <p className="text-neutral-500 dark:text-neutral-400 text-center py-8">
              Nessuna trascrizione disponibile
            </p>
          ) : (
            segments.map((segment, index) => {
              const isActive = index === activeIndex
              const segmentNotes = getNotesForSegment(index)
              return (
                <div
                  key={index}
                  data-segment-index={index}
                  className={cn(
                    "relative group cursor-pointer transition-all duration-150 rounded-lg p-3",
                    isActive
                      ? "bg-accent-50 dark:bg-accent-900/20 border border-accent-200 dark:border-accent-800 shadow-sm"
                      : "bg-transparent hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
                  )}
                  onClick={() => onSegmentClick(index)}
                  onDoubleClick={() => onAddNote(index, segment.t_start)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      onSegmentClick(index)
                    }
                  }}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-20 text-right text-xs text-neutral-400 dark:text-neutral-500 font-mono">
                      {formatTime(segment.t_start)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={cn(
                        "text-sm leading-relaxed break-words",
                        isActive ? "text-neutral-950 dark:text-neutral-50 font-medium" : "text-neutral-700 dark:text-neutral-300"
                      )}>
                        {segment.text}
                      </p>
                      {/* Notes for this segment */}
                      {segmentNotes.length > 0 && (
                        <div className="mt-2 space-y-1">
                          {segmentNotes.map((note) => (
                            <div
                              key={note.id}
                              className="text-xs bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded p-1.5 text-yellow-800 dark:text-yellow-200"
                            >
                              📝 {note.text}
                            </div>
                          ))}
                        </div>
                      )}
                      {/* Add note hint */}
                      <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        Doppio click per aggiungere nota
                      </p>
                    </div>
                    {isActive && (
                      <div className="flex-shrink-0 w-2 h-full bg-accent-500 rounded-r-lg" />
                    )}
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
// Sub-component: Slides Strip
// ============================================

interface SlidesStripProps {
  slides: SlideInfo[]
  currentTime: number
  onSlideClick: (index: number) => void
  onAddNote: (slideIndex: number, timestamp: number) => void
  notes: PlayerNote[]
  lectureId: number
}

function SlidesStrip({
  slides,
  currentTime,
  onSlideClick,
  onAddNote,
  notes,
  lectureId,
}: SlidesStripProps) {
  const [previewSlide, setPreviewSlide] = useState<SlideInfo | null>(null)
  const previewRectRef = useRef<DOMRect | null>(null)
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

  const handleSlideHover = (slide: SlideInfo, e: React.MouseEvent<HTMLDivElement>) => {
    setPreviewSlide(slide)
    previewRectRef.current = e.currentTarget.getBoundingClientRect()
  }

  const handleSlideLeave = () => {
    setPreviewSlide(null)
  }

  if (slides.length === 0) return null

  return (
    <>
      <div className="border-t border-neutral-200 dark:border-neutral-700 p-3">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-medium text-neutral-950 dark:text-neutral-50 flex items-center gap-2">
            <Image className="h-5 w-5 text-accent-500" />
            Slide ({slides.length})
          </h3>
          <span className="text-xs text-neutral-500 dark:text-neutral-400">
            Slide attiva: {activeSlideIndex >= 0 ? activeSlideIndex + 1 : "—"}
          </span>
        </div>
        <div className="h-28 overflow-x-auto overflow-y-hidden">
          <div className="flex gap-2 pb-2 w-max" role="list" aria-label="Slide della lezione">
            {slides.map((slide, index) => {
              const isActive = index === activeSlideIndex
              const slideNotes = getNotesForSlide(index)
              return (
                <div
                  key={index}
                  className={cn(
                    "relative group flex-shrink-0 cursor-pointer transition-all duration-150 rounded-lg overflow-hidden",
                    isActive
                      ? "ring-2 ring-accent-500 shadow-lg"
                      : "ring-1 ring-neutral-200 dark:ring-neutral-700 hover:ring-accent-300 dark:hover:ring-accent-700"
                  )}
                  onClick={() => onSlideClick(index)}
                  onDoubleClick={() => onAddNote(index, slide.timestamp)}
                  onMouseEnter={(e) => handleSlideHover(slide, e)}
                  onMouseLeave={handleSlideLeave}
                  role="listitem"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      onSlideClick(index)
                    }
                  }}
                  aria-label={`Slide ${index + 1}, ${formatTime(slide.timestamp)}`}
                  aria-current={isActive ? "true" : "false"}
                >
                  <img
                    src={slide.thumbnailUrl}
                    alt={`Slide ${index + 1}`}
                    className="w-24 h-auto object-cover"
                    loading="lazy"
                  />
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-1.5 text-xs text-white">
                    {formatTime(slide.timestamp)}
                  </div>
                  {isActive && (
                    <div className="absolute inset-0 bg-accent-500/10 pointer-events-none" />
                  )}
                  {slideNotes.length > 0 && (
                    <div className="absolute top-1 right-1 bg-yellow-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                      {slideNotes.length}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
        {activeSlideIndex >= 0 && getNotesForSlide(activeSlideIndex).length > 0 && (
          <div className="mt-2 space-y-1">
            {getNotesForSlide(activeSlideIndex).map((note) => (
              <div
                key={note.id}
                className="text-xs bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded p-1.5 text-yellow-800 dark:text-yellow-200"
              >
                📝 Slide {note.slideIndex! + 1}: {note.text}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Preview Tooltip */}
      {previewSlide && previewRectRef.current && (
        <div
          className="fixed z-50 pointer-events-none"
          style={{
            left: previewRectRef.current.left + window.scrollX,
            top: previewRectRef.current.top + window.scrollY - 200,
            transform: "translateX(-50%)",
          }}
        >
          <div className="bg-neutral-950 dark:bg-neutral-50 rounded-lg shadow-xl p-2 border border-neutral-200 dark:border-neutral-700 max-w-xs">
            <img
              src={previewSlide.url}
              alt={`Preview Slide ${previewSlide.index + 1}`}
              className="w-full h-auto rounded-md"
            />
            <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-1 text-center">
              Slide {previewSlide.index + 1} · {formatTime(previewSlide.timestamp)}
            </p>
          </div>
        </div>
      )}
    </>
  )
}

// ============================================
// Main VideoPlayer Component
// ============================================

export const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(
  function VideoPlayer({ lectureId, lectureTitle, onClose, initialTime = 0 }, ref) {
    // State
    const [mediaData, setMediaData] = useState<LectureMediaData | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const [currentTime, setCurrentTime] = useState(initialTime)
    const [duration, setDuration] = useState(0)
    const [isPlaying, setIsPlaying] = useState(false)
    const [playbackRate, setPlaybackRate] = useState(1)
    const [volume, setVolume] = useState(1)
    const [isMuted, setIsMuted] = useState(false)
    const [skipSilences, setSkipSilences] = useState(false)
    const [showTranscript, setShowTranscript] = useState(true)
    const [showSlides, setShowSlides] = useState(true)
    const [notes, setNotes] = useState<PlayerNote[]>(() => loadNotes(lectureId))
    const [activePanel, setActivePanel] = useState<"transcript" | "slides" | "notes">("transcript")
    const [slideObjectUrls, setSlideObjectUrls] = useState<Record<string, string>>({})

    // Refs
    const audioRef = useRef<HTMLAudioElement>(null)
    const silenceCheckInterval = useRef<number | null>(null)
    const isSeekingRef = useRef(false)
    const lastSilenceSkipRef = useRef<number>(-1)

    // Load lecture data
    useEffect(() => {
      let cancelled = false

      async function loadLectureData() {
        try {
          setIsLoading(true)
          const data = (await api.getLecture(lectureId)) as Lecture & Partial<LectureMediaData>

          // Build slide list. Prefer backend-provided `slides`; otherwise synthesize
          // from transcript segments (one slide per segment boundary when slides exist).
          let slides: SlideInfo[] | undefined = data.slides

          if (!slides?.length && data.transcript_segments?.length) {
            // If the backend doesn't give an explicit slide list, derive timestamps
            // from the start of each transcript segment.
            slides = data.transcript_segments.map((seg, i) => ({
              index: i,
              timestamp: seg.t_start,
              url: `/media/${lectureId}/slides/${i + 1}.png`,
              thumbnailUrl: `/media/${lectureId}/slides/${i + 1}.png`,
            }))
          }

          if (!cancelled) {
            setMediaData({
              audio_path: data.audio_path,
              slides_path: data.slides_path,
              transcript_segments: data.transcript_segments,
              silence_intervals: data.silence_intervals,
              slides,
            })
            setError(null)
          }
        } catch (err) {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : "Errore nel caricamento")
          }
        } finally {
          if (!cancelled) setIsLoading(false)
        }
      }

      loadLectureData()
      return () => {
        cancelled = true
      }
    }, [lectureId])

    // Initialize audio when media data is ready
    useEffect(() => {
      if (!mediaData?.audio_path || audioRef.current) return

      let disposed = false
      const audio = new Audio()
      audio.preload = "metadata"
      audio.crossOrigin = "anonymous"
      audioRef.current = audio

      // Offline-first: try IndexedDB cache, fall back to network (and cache).
      const audioUrl = `/media/${lectureId}/audio.opus`
      fetchWithCache(audioUrl, AUDIO_STORE, `lecture-${lectureId}`)
        .then((blob) => {
          if (disposed) return
          audio.src = URL.createObjectURL(blob)
        })
        .catch(() => {
          if (!disposed) audio.src = audioUrl
        })

      audio.addEventListener("loadedmetadata", () => {
        setDuration(audio.duration)
        if (initialTime > 0) {
          audio.currentTime = initialTime
        }
      })

      audio.addEventListener("timeupdate", () => {
        if (!isSeekingRef.current) {
          setCurrentTime(audio.currentTime)
        }
      })

      audio.addEventListener("ended", () => {
        setIsPlaying(false)
        setCurrentTime(0)
      })

      audio.addEventListener("play", () => setIsPlaying(true))
      audio.addEventListener("pause", () => setIsPlaying(false))
      audio.addEventListener("ratechange", () => setPlaybackRate(audio.playbackRate))
      audio.addEventListener("volumechange", () => {
        setVolume(audio.volume)
        setIsMuted(audio.muted)
      })

      audio.addEventListener("error", (e) => {
        console.error("Audio error:", e)
        setError("Errore nella riproduzione audio")
      })

      return () => {
        disposed = true
        audio.pause()
        audio.src = ""
        audioRef.current = null
      }
    }, [mediaData?.audio_path, lectureId, initialTime])

    // Offline-first: pre-cache slide blobs in IndexedDB
    useEffect(() => {
      const slides = mediaData?.slides
      if (!slides?.length) return

      slides.forEach((slide, i) => {
        const cacheKey = `lecture-${lectureId}-slide-${i + 1}`
        fetchWithCache(slide.url, SLIDES_STORE, cacheKey).catch(() => {
          // Ignore slide cache failures (e.g. missing slide files)
        })
      })
    }, [mediaData?.slides, lectureId])

    // Resolve slide object URLs from cache (offline-first) so <img> can use them
    useEffect(() => {
      const slides = mediaData?.slides
      if (!slides?.length) return

      let cancelled = false
      const urls: Record<string, string> = {}
      Promise.all(
        slides.map(async (slide, i) => {
          const cacheKey = `lecture-${lectureId}-slide-${i + 1}`
          const blob = await getCachedBlob(SLIDES_STORE, cacheKey)
          if (blob) urls[i] = URL.createObjectURL(blob)
        })
      ).then(() => {
        if (!cancelled) setSlideObjectUrls((prev) => ({ ...prev, ...urls }))
      })

      return () => {
        cancelled = true
      }
    }, [mediaData?.slides, lectureId])

const resolvedSlides = useMemo(() => {
  if (!mediaData?.slides) return []
  return mediaData.slides.map((s, i) => ({
    ...s,
    url: slideObjectUrls[i] || s.url,
    thumbnailUrl: slideObjectUrls[i] || s.thumbnailUrl,
  }))
}, [mediaData?.slides, slideObjectUrls])

    // Silence skipping logic
    useEffect(() => {
      if (!skipSilences || !mediaData?.silence_intervals?.length || !audioRef.current) {
        if (silenceCheckInterval.current) {
          clearInterval(silenceCheckInterval.current)
          silenceCheckInterval.current = null
        }
        return
      }

      const checkSilences = () => {
        const audio = audioRef.current
        if (!audio || !isPlaying) return

        const silence = mediaData.silence_intervals!.find(
          (s) => s.start <= audio.currentTime && s.end > audio.currentTime
        )

        if (silence && silence.start !== lastSilenceSkipRef.current) {
          lastSilenceSkipRef.current = silence.start
          audio.currentTime = silence.end
        }
      }

      silenceCheckInterval.current = window.setInterval(checkSilences, 100)
      return () => {
        if (silenceCheckInterval.current) {
          clearInterval(silenceCheckInterval.current)
          silenceCheckInterval.current = null
        }
      }
    }, [skipSilences, mediaData?.silence_intervals, isPlaying, currentTime])

    // Sync audio properties
    useEffect(() => {
      const audio = audioRef.current
      if (!audio) return
      if (audio.playbackRate !== playbackRate) audio.playbackRate = playbackRate
    }, [playbackRate])

    useEffect(() => {
      const audio = audioRef.current
      if (!audio) return
      if (audio.volume !== volume) audio.volume = volume
    }, [volume])

    useEffect(() => {
      const audio = audioRef.current
      if (!audio) return
      if (audio.muted !== isMuted) audio.muted = isMuted
    }, [isMuted])

    // Keyboard shortcuts
    useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        // Ignore if typing in input
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

        const audio = audioRef.current
        if (!audio) return

        switch (e.key) {
          case " ":
            e.preventDefault()
            audio.paused ? audio.play().catch(() => {}) : audio.pause()
            break
          case "ArrowLeft":
            e.preventDefault()
            audio.currentTime = Math.max(0, audio.currentTime - (e.shiftKey ? 30 : 5))
            break
          case "ArrowRight":
            e.preventDefault()
            audio.currentTime = Math.min(audio.duration, audio.currentTime + (e.shiftKey ? 30 : 5))
            break
          case "[":
            e.preventDefault()
            audio.playbackRate = Math.max(0.5, audio.playbackRate - 0.25)
            break
          case "]":
            e.preventDefault()
            audio.playbackRate = Math.min(3, audio.playbackRate + 0.25)
            break
          case "m":
          case "M":
            e.preventDefault()
            audio.muted = !audio.muted
            break
          case "f":
          case "F":
            e.preventDefault()
            requestAudioPip(audio)
            break
        }
      }

      window.addEventListener("keydown", handleKeyDown)
      return () => window.removeEventListener("keydown", handleKeyDown)
    }, [])

    // Note handling
    const addNote = useCallback(
      (timestamp: number, type: "transcript" | "slide", segmentIndex?: number, slideIndex?: number) => {
        const text = prompt("Aggiungi nota:")
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

    // Handlers
    const handlePlayPause = useCallback(() => {
      const audio = audioRef.current
      if (!audio) return
      audio.paused ? audio.play().catch(() => {}) : audio.pause()
    }, [])

    const handleSeek = useCallback((time: number) => {
      const audio = audioRef.current
      if (!audio) return
      isSeekingRef.current = true
      audio.currentTime = Math.max(0, Math.min(audio.duration, time))
      setCurrentTime(audio.currentTime)
      // Reset seeking flag after a tick
      requestAnimationFrame(() => {
        isSeekingRef.current = false
      })
    }, [])

    const handleSeekBackward = useCallback((seconds: number) => {
      const audio = audioRef.current
      if (!audio) return
      audio.currentTime = Math.max(0, audio.currentTime - seconds)
    }, [])

    const handleSeekForward = useCallback((seconds: number) => {
      const audio = audioRef.current
      if (!audio) return
      audio.currentTime = Math.min(audio.duration, audio.currentTime + seconds)
    }, [])

    const handleRateChange = useCallback((rate: number) => {
      const audio = audioRef.current
      if (!audio) return
      audio.playbackRate = Math.max(0.5, Math.min(3, rate))
    }, [])

    const handleVolumeChange = useCallback((vol: number) => {
      const audio = audioRef.current
      if (!audio) return
      audio.volume = Math.max(0, Math.min(1, vol))
      if (vol > 0) audio.muted = false
    }, [])

    const handleMuteToggle = useCallback(() => {
      const audio = audioRef.current
      if (!audio) return
      audio.muted = !audio.muted
    }, [])

    const handleSkipSilencesToggle = useCallback(() => {
      setSkipSilences((prev) => !prev)
      lastSilenceSkipRef.current = -1
    }, [])

    const handleSegmentClick = useCallback((index: number) => {
      const segment = mediaData?.transcript_segments?.[index]
      if (segment) handleSeek(segment.t_start)
    }, [mediaData?.transcript_segments, handleSeek])

    const handleSlideClick = useCallback((index: number) => {
      const slide = mediaData?.slides?.[index]
      if (slide) handleSeek(slide.timestamp)
    }, [mediaData?.slides, handleSeek])

    const handleTranscriptNote = useCallback((segmentIndex: number) => {
      const segment = mediaData?.transcript_segments?.[segmentIndex]
      if (segment) addNote(segment.t_start, "transcript", segmentIndex)
    }, [mediaData?.transcript_segments, addNote])

    const handleSlideNote = useCallback((slideIndex: number) => {
      const slide = mediaData?.slides?.[slideIndex]
      if (slide) addNote(slide.timestamp, "slide", undefined, slideIndex)
    }, [mediaData?.slides, addNote])

    // Imperative handle for ref
    useImperativeHandle(ref, () => ({
      play: () => {
        audioRef.current?.play().catch(() => {})
      },
      pause: () => {
        audioRef.current?.pause()
      },
      seek: handleSeek,
      setRate: handleRateChange,
      getCurrentTime: () => currentTime,
      getDuration: () => duration,
    }))

    // Render
    if (isLoading) {
      return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/80 backdrop-blur-sm">
          <div className="bg-neutral-50 dark:bg-neutral-900 rounded-xl p-8 flex flex-col items-center gap-4 min-w-[300px]">
            <div className="w-10 h-10 border-3 border-accent-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-neutral-600 dark:text-neutral-300">Caricamento lezione...</p>
          </div>
        </div>
      )
    }

    if (error) {
      return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/80 backdrop-blur-sm">
          <div className="bg-neutral-50 dark:bg-neutral-900 rounded-xl p-8 max-w-md mx-4 text-center">
            <X className="h-12 w-12 text-error-500 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-neutral-950 dark:text-neutral-50 mb-2">Errore</h3>
            <p className="text-neutral-600 dark:text-neutral-300 mb-6">{error}</p>
            <Button onClick={onClose}>Chiudi</Button>
          </div>
        </div>
      )
    }

    return (
      <div
        className="fixed inset-0 z-50 flex flex-col bg-neutral-50 dark:bg-neutral-950"
        role="dialog"
        aria-modal="true"
        aria-labelledby="player-title"
      >
        {/* Header */}
        <header className="flex items-center justify-between p-4 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50/80 dark:bg-neutral-950/80 backdrop-blur-sm sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Chiudi player">
              <X className="h-5 w-5" />
            </Button>
            <div>
              <h2 id="player-title" className="font-semibold text-neutral-950 dark:text-neutral-50 truncate max-w-md">
                {lectureTitle}
              </h2>
              <p className="text-sm text-neutral-500 dark:text-neutral-400">
                {mediaData?.transcript_segments?.length || 0} segmenti ·{" "}
                {mediaData?.slides?.length || 0} slide ·{" "}
                {mediaData?.silence_intervals?.length || 0} intervalli silenzio
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowTranscript(!showTranscript)}
              aria-label={showTranscript ? "Nascondi trascrizione" : "Mostra trascrizione"}
              aria-pressed={showTranscript}
              className={cn(showTranscript && "text-accent-500")}
            >
              <FileText className="h-5 w-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowSlides(!showSlides)}
              aria-label={showSlides ? "Nascondi slide" : "Mostra slide"}
              aria-pressed={showSlides}
              className={cn(showSlides && "text-accent-500")}
            >
              <Image className="h-5 w-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => requestAudioPip(audioRef.current)}
              aria-label="Picture in Picture"
              disabled={!document.pictureInPictureEnabled}
            >
              <Maximize2 className="h-5 w-5" />
            </Button>
          </div>
        </header>

        {/* Main Content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Audio Player (always visible at top on mobile, left on desktop) */}
          <div className="w-full p-4 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/50">
            <AudioPlayer
              audioRef={audioRef}
              currentTime={currentTime}
              duration={duration}
              playbackRate={playbackRate}
              volume={volume}
              isMuted={isMuted}
              isPlaying={isPlaying}
              silenceIntervals={mediaData?.silence_intervals || []}
              skipSilences={skipSilences}
              onPlayPause={handlePlayPause}
              onSeek={handleSeek}
              onRateChange={handleRateChange}
              onVolumeChange={handleVolumeChange}
              onMuteToggle={handleMuteToggle}
              onSkipSilencesToggle={handleSkipSilencesToggle}
              onSeekBackward={handleSeekBackward}
              onSeekForward={handleSeekForward}
            />
          </div>

          {/* Panels */}
          <div className="flex-1 flex overflow-hidden">
            {/* Left: Transcript / Slides */}
            <div className={cn(
              "flex-1 flex flex-col overflow-hidden transition-all duration-300",
              showTranscript || showSlides ? "lg:w-2/3" : "lg:w-full"
            )}>
              <div className="flex-1 flex flex-col overflow-hidden">
                {/* Panel Tabs */}
                <div className="flex border-b border-neutral-200 dark:border-neutral-700 bg-neutral-50/50 dark:bg-neutral-900/50">
                  {showTranscript && (
                    <Button
                      variant={activePanel === "transcript" ? "default" : "ghost"}
                      size="sm"
                      className="rounded-none border-0 border-b-2 border-transparent data-[state=on]:border-accent-500"
                      onClick={() => setActivePanel("transcript")}
                    >
                      <FileText className="h-4 w-4 mr-1" />
                      Trascrizione
                    </Button>
                  )}
                  {showSlides && (
                    <Button
                      variant={activePanel === "slides" ? "default" : "ghost"}
                      size="sm"
                      className="rounded-none border-0 border-b-2 border-transparent data-[state=on]:border-accent-500"
                      onClick={() => setActivePanel("slides")}
                    >
                      <Image className="h-4 w-4 mr-1" />
                      Slide
                    </Button>
                  )}
                  <Button
                    variant={activePanel === "notes" ? "default" : "ghost"}
                    size="sm"
                    className="rounded-none border-0 border-b-2 border-transparent data-[state=on]:border-accent-500"
                    onClick={() => setActivePanel("notes")}
                  >
                    <MousePointer className="h-4 w-4 mr-1" />
                    Note ({notes.length})
                  </Button>
                </div>

                {/* Panel Content */}
                <div className="flex-1 overflow-hidden">
                  {activePanel === "transcript" && showTranscript && (
                    <TranscriptPanel
                      segments={mediaData?.transcript_segments || []}
                      currentTime={currentTime}
                      onSegmentClick={handleSegmentClick}
                      onAddNote={handleTranscriptNote}
                      notes={notes}
                    />
                  )}
                  {activePanel === "slides" && showSlides && (
                    <SlidesStrip
                      slides={resolvedSlides}
                      currentTime={currentTime}
                      onSlideClick={handleSlideClick}
                      onAddNote={handleSlideNote}
                      notes={notes}
                      lectureId={lectureId}
                    />
                  )}
                  {activePanel === "notes" && (
                    <div className="flex-1 flex flex-col p-4 overflow-auto">
                      <h3 className="font-medium text-neutral-950 dark:text-neutral-50 mb-4 flex items-center gap-2">
                        <MousePointer className="h-5 w-5 text-accent-500" />
                        Tutte le note ({notes.length})
                      </h3>
                      {notes.length === 0 ? (
                        <p className="text-neutral-500 dark:text-neutral-400 text-center py-8">
                          Nessuna nota. Doppio click su un segmento o slide per aggiungere.
                        </p>
                      ) : (
                        <div className="space-y-3">
                          {notes
                            .slice()
                            .sort((a, b) => a.timestamp - b.timestamp)
                            .map((note) => (
                              <div
                                key={note.id}
                                className="p-3 rounded-lg bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 hover:border-accent-300 dark:hover:border-accent-700 transition-colors"
                              >
                                <div className="flex items-start justify-between gap-2 mb-1">
                                  <span className="text-xs font-mono text-accent-500 bg-accent-50 dark:bg-accent-900/30 px-2 py-0.5 rounded">
                                    {formatTime(note.timestamp)}
                                  </span>
                                  <span className="text-xs text-neutral-500 dark:text-neutral-400">
                                    {note.type === "transcript" ? "📝 Trascrizione" : "🖼️ Slide"}
                                  </span>
                                </div>
                                <p className="text-sm text-neutral-950 dark:text-neutral-50 mb-2">{note.text}</p>
                                <div className="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
                                  <span>{new Date(note.createdAt).toLocaleString("it-IT")}</span>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-6 w-6 p-0"
                                    onClick={() => {
                                      const updated = notes.filter((n) => n.id !== note.id)
                                      setNotes(updated)
                                      saveNotes(lectureId, updated)
                                    }}
                                    aria-label="Elimina nota"
                                  >
                                    <X className="h-3 w-3" />
                                  </Button>
                                </div>
                              </div>
                            ))}
                        </div>
                      )}
                    </div>
                  )}
                  {(!showTranscript && !showSlides && activePanel !== "notes") && (
                    <div className="flex-1 flex items-center justify-center">
                      <p className="text-neutral-500 dark:text-neutral-400">
                        Attiva trascrizione o slide dalla toolbar
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Right: Slide Preview (optional, only on desktop) */}
            {showSlides && resolvedSlides.length && (
              <div className="hidden lg:block w-72 border-l border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/50">
                <div className="p-3 border-b border-neutral-200 dark:border-neutral-700">
                  <h4 className="font-medium text-neutral-950 dark:text-neutral-50 flex items-center gap-2">
                    <Image className="h-4 w-4 text-accent-500" />
                    Slide corrente
                  </h4>
                </div>
                <div className="flex-1 flex items-center justify-center p-4">
                  {(() => {
                    let idx = -1
                    for (let i = 0; i < resolvedSlides.length; i++) {
                      if (resolvedSlides[i].timestamp <= currentTime) {
                        idx = i
                      } else {
                        break
                      }
                    }
                    return idx >= 0 && resolvedSlides[idx] ? (
                    <img
                      src={resolvedSlides[idx].url}
                      alt={`Slide ${idx + 1}`}
                      className="max-w-full max-h-[400px] rounded-lg shadow-lg"
                    />
                    ) : (
                    <p className="text-neutral-500 dark:text-neutral-400 text-center">Nessuna slide per questo momento</p>
                    )
                  })()}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Keyboard shortcuts hint */}
        <div className="hidden lg:flex px-4 py-2 border-t border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/50 text-xs text-neutral-500 dark:text-neutral-400 flex-wrap gap-4 justify-center">
          <kbd className="px-2 py-0.5 bg-neutral-200 dark:bg-neutral-800 rounded">Spazio</kbd> Play/Pausa
          <kbd className="px-2 py-0.5 bg-neutral-200 dark:bg-neutral-800 rounded">←/→</kbd> ±5s
          <kbd className="px-2 py-0.5 bg-neutral-200 dark:bg-neutral-800 rounded">Shift+←/→</kbd> ±30s
          <kbd className="px-2 py-0.5 bg-neutral-200 dark:bg-neutral-800 rounded">[ / ]</kbd> Velocità ∓0.25
          <kbd className="px-2 py-0.5 bg-neutral-200 dark:bg-neutral-800 rounded">M</kbd> Muto
          <kbd className="px-2 py-0.5 bg-neutral-200 dark:bg-neutral-800 rounded">F</kbd> PiP
        </div>
      </div>
    )
  }
)

VideoPlayer.displayName = "VideoPlayer"