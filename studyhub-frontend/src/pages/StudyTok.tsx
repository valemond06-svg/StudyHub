import React, { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { useNavigate, useSearchParams } from "react-router-dom"
import {
  Sparkles,
  ArrowUp,
  ArrowDown,
  RotateCw,
  BookOpen,
  Brain,
  Loader2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { FeedCard } from "@/components/feed/FeedCard"
import { api } from "@/lib/api"
import { diversifyFeed } from "@/lib/feed"
import type { FeedShort, Course } from "@/types"
import { cn } from "@/lib/utils"

export function StudyTok() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const selectedCourseId = searchParams.get("course_id")
    ? Number(searchParams.get("course_id"))
    : undefined

  const [currentIndex, setCurrentIndex] = useState(0)
  const [viewedPills, setViewedPills] = useState<Set<number>>(new Set([0]))
  const [showSpeedbump, setShowSpeedbump] = useState(false)
  const [lastSpeedbumpMilestone, setLastSpeedbumpMilestone] = useState(0)

  const containerRef = useRef<HTMLDivElement | null>(null)

  // Fetch courses for filtering
  const { data: courses = [] } = useQuery<Course[]>({
    queryKey: ["courses"],
    queryFn: () => api.getCourses(),
  })

  // Fetch feed shorts
  const {
    data: feedData,
    isLoading,
    isRefetching,
    refetch,
    error,
  } = useQuery<{ shorts: FeedShort[] }>({
    queryKey: ["feed", selectedCourseId],
    queryFn: () => api.getFeed(selectedCourseId, 40),
  })

  const shorts = useMemo(() => diversifyFeed(feedData?.shorts ?? []), [feedData])

  // Check anti-doomscrolling speedbump whenever viewed count changes
  useEffect(() => {
    const count = viewedPills.size
    if (count > 0 && count % 5 === 0 && count !== lastSpeedbumpMilestone) {
      setShowSpeedbump(true)
      setLastSpeedbumpMilestone(count)
    }
  }, [viewedPills.size, lastSpeedbumpMilestone])

  // Mark index as viewed when navigating
  const goToIndex = useCallback(
    (index: number) => {
      if (index < 0 || index >= shorts.length) return
      setCurrentIndex(index)
      setViewedPills((prev) => {
        const next = new Set(prev)
        next.add(index)
        return next
      })

      // Smooth scroll the target card into view if in scroll container
      if (containerRef.current) {
        const cardElements = containerRef.current.querySelectorAll("[data-feed-card]")
        if (cardElements[index]) {
          cardElements[index].scrollIntoView({ behavior: "smooth", block: "center" })
        }
      }
    },
    [shorts.length]
  )

  const handleNext = useCallback(() => {
    goToIndex(currentIndex + 1)
  }, [currentIndex, goToIndex])

  const handlePrev = useCallback(() => {
    goToIndex(currentIndex - 1)
  }, [currentIndex, goToIndex])

  // Keyboard navigation: ArrowUp/ArrowDown, 'k'/'j'
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Do not intercept if user is typing in an input/textarea
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return

      if (e.key === "ArrowDown" || e.key === "j" || e.key === "PageDown") {
        e.preventDefault()
        handleNext()
      } else if (e.key === "ArrowUp" || e.key === "k" || e.key === "PageUp") {
        e.preventDefault()
        handlePrev()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [handleNext, handlePrev])

  const handleCourseFilterChange = (courseId?: number) => {
    if (courseId) {
      setSearchParams({ course_id: courseId.toString() })
    } else {
      setSearchParams({})
    }
    setCurrentIndex(0)
    setViewedPills(new Set([0]))
  }

  const currentShort = shorts[currentIndex]

  return (
    <div className="relative max-w-4xl mx-auto flex flex-col min-h-[calc(100vh-5rem)]">
      {/* Top Header & Filter Bar */}
      <div className="sticky top-0 z-20 backdrop-blur-md bg-neutral-50/80 dark:bg-neutral-950/80 py-3 mb-4 border-b border-neutral-200/80 dark:border-neutral-800 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-2xl bg-accent-500/10 dark:bg-accent-500/20 text-accent-600 dark:text-accent-400 flex items-center justify-center">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-neutral-900 dark:text-neutral-50 flex items-center gap-2">
              StudyTok Feed
              <Badge variant="secondary" className="text-2xs font-mono py-0.5 px-2 bg-accent-500/10 text-accent-600">
                Micro-Concetti
              </Badge>
            </h1>
            <p className="text-2xs text-neutral-500 dark:text-neutral-400">
              Scorri verso il basso o usa i tasti freccia (↑ / ↓)
            </p>
          </div>
        </div>

        {/* Course Filter & Refresh */}
        <div className="flex items-center gap-2 ml-auto">
          <select
            value={selectedCourseId ?? ""}
            onChange={(e) =>
              handleCourseFilterChange(
                e.target.value ? Number(e.target.value) : undefined
              )
            }
            className="h-8.5 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 text-xs font-medium text-neutral-800 dark:text-neutral-200 focus:outline-none focus:ring-2 focus:ring-accent-500"
            aria-label="Filtra pillole per materia"
          >
            <option value="">Tutti i corsi</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.shortname || c.fullname}
              </option>
            ))}
          </select>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              refetch()
              setCurrentIndex(0)
              setViewedPills(new Set([0]))
            }}
            disabled={isRefetching}
            className="h-8.5 px-2.5 rounded-xl text-xs gap-1.5"
            title="Ricarica pillole"
          >
            <RotateCw
              className={cn("h-3.5 w-3.5", isRefetching && "animate-spin")}
            />
            <span className="hidden sm:inline">Aggiorna</span>
          </Button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col items-center justify-center py-2">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 space-y-4">
            <Loader2 className="h-10 w-10 animate-spin text-accent-500" />
            <p className="text-sm text-neutral-500">Caricamento pillole di studio...</p>
          </div>
        ) : error ? (
          <Card className="max-w-md mx-auto p-6 text-center space-y-3">
            <p className="text-sm text-rose-600">Errore nel caricamento del feed.</p>
            <Button onClick={() => refetch()} size="sm">
              Riprova
            </Button>
          </Card>
        ) : shorts.length === 0 ? (
          <Card className="max-w-md mx-auto p-8 text-center space-y-3">
            <Sparkles className="h-10 w-10 mx-auto text-neutral-400" />
            <h3 className="text-base font-semibold text-neutral-800 dark:text-neutral-200">
              Nessuna pillola trovata
            </h3>
            <p className="text-xs text-neutral-500">
              Non ci sono ancora micro-lezioni pronte per questo filtro. Prova a selezionare "Tutti i corsi" o prepara gli argomenti nella sezione Studio.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleCourseFilterChange(undefined)}
            >
              Mostra tutti i corsi
            </Button>
          </Card>
        ) : (
          <div className="w-full flex flex-col items-center relative">
            {/* Active Card */}
            <div data-feed-card className="w-full">
              <FeedCard
                short={shorts[currentIndex]}
                index={currentIndex}
                total={shorts.length}
                isActive={true}
                onNext={currentIndex < shorts.length - 1 ? handleNext : undefined}
                onPrev={currentIndex > 0 ? handlePrev : undefined}
              />
            </div>

            {/* Quick Floating Vertical Navigator Controls */}
            <div className="fixed right-4 sm:right-8 top-1/2 -translate-y-1/2 flex flex-col items-center gap-2.5 z-30 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-md p-2 rounded-2xl border border-neutral-200/80 dark:border-neutral-800 shadow-lg">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={currentIndex === 0}
                onClick={handlePrev}
                className="h-9 w-9 rounded-xl hover:bg-neutral-200 dark:hover:bg-neutral-800 disabled:opacity-30"
                aria-label="Pillola precedente"
                title="Pillola precedente (↑)"
              >
                <ArrowUp className="h-4 w-4" />
              </Button>

              <div className="flex flex-col items-center py-1">
                <span className="text-xs font-bold font-mono text-accent-600 dark:text-accent-400">
                  {currentIndex + 1}
                </span>
                <span className="text-3xs text-neutral-400">/</span>
                <span className="text-3xs font-mono text-neutral-400">
                  {shorts.length}
                </span>
              </div>

              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={currentIndex === shorts.length - 1}
                onClick={handleNext}
                className="h-9 w-9 rounded-xl hover:bg-neutral-200 dark:hover:bg-neutral-800 disabled:opacity-30"
                aria-label="Pillola successiva"
                title="Pillola successiva (↓)"
              >
                <ArrowDown className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* DOSSO ANTI-DOOMSCROLLING (Intermezzo Motivazionale ogni 5 pillole) */}
      {showSpeedbump && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"
        >
          <div className="relative max-w-md w-full bg-white dark:bg-neutral-900 border border-accent-500/30 rounded-3xl shadow-2xl p-6 sm:p-8 space-y-6 text-center animate-in zoom-in-95 duration-200">
            <div className="mx-auto h-16 w-16 rounded-full bg-accent-500/10 text-accent-600 dark:text-accent-400 flex items-center justify-center">
              <Brain className="h-8 w-8 animate-bounce" />
            </div>

            <div className="space-y-2">
              <Badge variant="secondary" className="text-xs font-semibold px-3 py-1 bg-accent-500/10 text-accent-600">
                Dosso Anti-Doomscrolling
              </Badge>
              <h2 className="text-xl sm:text-2xl font-bold text-neutral-900 dark:text-neutral-50">
                Hai visto {lastSpeedbumpMilestone} pillole!
              </h2>
              <p className="text-sm text-neutral-600 dark:text-neutral-300 leading-relaxed">
                Ottimo ripasso dei concetti chiave. Il consumo passivo è utile per rinfrescare le idee, ma una sessione di studio attiva fissa i contenuti per l'esame.
              </p>
            </div>

            <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
              <Button
                type="button"
                onClick={() => {
                  setShowSpeedbump(false)
                  if (currentShort) {
                    navigate(`/studio/${currentShort.course_id}?topic=${currentShort.topic_id}`)
                  } else {
                    navigate("/corsi")
                  }
                }}
                className="w-full sm:w-auto flex-1 gap-2 h-11 rounded-xl bg-accent-600 hover:bg-accent-700 text-white font-semibold shadow-md"
              >
                <BookOpen className="h-4 w-4" />
                <span>Prepara una sessione di studio</span>
              </Button>

              <Button
                type="button"
                variant="outline"
                onClick={() => setShowSpeedbump(false)}
                className="w-full sm:w-auto h-11 rounded-xl text-neutral-700 dark:text-neutral-300"
              >
                Continua nel feed
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
export default StudyTok
