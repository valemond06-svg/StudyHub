"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import * as Dialog from "@radix-ui/react-dialog"
import {
  Search,
  BookOpen,
  FileText,
  HelpCircle,
  Target,
  FlaskConical,
  Plus,
  Settings,
  Zap,
  Loader2,
  X,
  AlertCircle,
  ChevronRight,
} from "lucide-react"
import { useNavigate } from "react-router-dom"
import { cn } from "@/lib/utils"
import { api } from "@/lib/api"
import { useUIStore } from "@/store/ui"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"

interface SearchResult {
  id: string | number
  type: "lecture" | "document" | "topic" | "quiz" | "flashcard" | "course"
  title: string
  subtitle?: string
  courseId?: number
  courseName?: string
  lectureId?: number
  action?: () => void
  href?: string
}

interface QuickAction {
  label: string
  description: string
  icon: React.ReactNode
  shortcut?: string
  action: () => void
  keywords: string[]
}

const TYPE_CONFIG: Record<SearchResult["type"], { icon: React.ReactNode; label: string; color: string }> = {
  lecture: { icon: <BookOpen className="h-4 w-4" />, label: "Lezioni", color: "text-accent-500" },
  document: { icon: <FileText className="h-4 w-4" />, label: "Documenti", color: "text-success-500" },
  topic: { icon: <Target className="h-4 w-4" />, label: "Argomenti", color: "text-warning-500" },
  quiz: { icon: <HelpCircle className="h-4 w-4" />, label: "Quiz", color: "text-error-500" },
  flashcard: { icon: <FlaskConical className="h-4 w-4" />, label: "Flashcard", color: "text-purple-500" },
  course: { icon: <Zap className="h-4 w-4" />, label: "Corsi", color: "text-orange-500" },
}

function debounce<T extends (...args: never[]) => void>(fn: T, ms: number): T {
  let timeoutId: ReturnType<typeof setTimeout>
  return ((...args: never[]) => {
    clearTimeout(timeoutId)
    timeoutId = setTimeout(() => fn(...args), ms)
  }) as T
}

export function CommandPalette() {
  const { commandPaletteOpen, setCommandPaletteOpen } = useUIStore()
  const navigate = useNavigate()
  const [query, setQuery] = useState("")
  const [groupedResults, setGroupedResults] = useState<Record<string, SearchResult[]>>({})
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showQuickActions, setShowQuickActions] = useState(true)
  const inputRef = useRef<HTMLInputElement>(null)
  const itemsRef = useRef<HTMLDivElement[]>([])

  const quickActions: QuickAction[] = [
    {
      label: "Nuova sessione di studio",
      description: "Avvia una sessione FSRS per le flashcard in scadenza",
      icon: <FlaskConical className="h-4 w-4" />,
      shortcut: "⌘N",
      keywords: ["nuova", "sessione", "studio", "fsrs", "flashcard", "ripasso"],
      action: () => navigate("/lab?tab=flashcard&new=1"),
    },
    {
      label: "Vai ai Corsi",
      description: "Visualizza tutti i corsi e il loro stato",
      icon: <BookOpen className="h-4 w-4" />,
      shortcut: "⌘1",
      keywords: ["corsi", "corso", "materie", "esami"],
      action: () => navigate("/corsi"),
    },
    {
      label: "Apri Lab",
      description: "Flashcard, Quiz, Tutor, Ricerca, Export",
      icon: <FlaskConical className="h-4 w-4" />,
      shortcut: "⌘2",
      keywords: ["lab", "flashcard", "quiz", "tutor", "export"],
      action: () => navigate("/lab"),
    },
    {
      label: "Impostazioni",
      description: "Tema, backup, account, preferenze",
      icon: <Settings className="h-4 w-4" />,
      shortcut: "⌘,",
      keywords: ["impostazioni", "settings", "tema", "backup", "account"],
      action: () => navigate("/impostazioni"),
    },
    {
      label: "Nuova conversazione Tutor",
      description: "Inizia una chat RAG con i tuoi appunti",
      icon: <Plus className="h-4 w-4" />,
      keywords: ["tutor", "chat", "rag", "nuova", "conversazione", "domanda"],
      action: () => navigate("/lab?tab=tutor&new=1"),
    },
  ]

  const runSearch = useCallback(
    async (q: string) => {
      if (!q.trim()) {
        setGroupedResults({})
        setShowQuickActions(true)
        setError(null)
        setIsLoading(false)
        return
      }

      setIsLoading(true)
      setError(null)
      setShowQuickActions(false)

      try {
        const data = await api.search(q)
        const searchResults: SearchResult[] = []

        if (data.lectures?.length) {
          data.lectures.forEach((lecture: any) => {
            searchResults.push({
              id: lecture.id,
              type: "lecture",
              title: lecture.title,
              subtitle: lecture.course_name || `Corso ${lecture.course_id}`,
              courseId: lecture.course_id,
              lectureId: lecture.id,
              action: () => navigate(`/corsi/${lecture.course_id}`),
            })
          })
        }

        if (data.documents?.length) {
          data.documents.forEach((doc: any) => {
            searchResults.push({
              id: doc.id,
              type: "document",
              title: doc.title,
              subtitle: doc.course_name || `Corso ${doc.course_id}`,
              courseId: doc.course_id,
              action: () => navigate(`/corsi/${doc.course_id}`),
            })
          })
        }

        if (data.topics?.length) {
          data.topics.forEach((topic: any) => {
            searchResults.push({
              id: topic.id,
              type: "topic",
              title: topic.name,
              subtitle: `${topic.chapter ? `Cap. ${topic.chapter} · ` : ""}${topic.course_name || `Corso ${topic.course_id}`}`,
              courseId: topic.course_id,
              action: () => navigate(`/corsi/${topic.course_id}`),
            })
          })
        }

        if (data.quizzes?.length) {
          data.quizzes.forEach((quiz: any) => {
            searchResults.push({
              id: quiz.id,
              type: "quiz",
              title: quiz.prompt?.slice(0, 80) || `Quiz ${quiz.id}`,
              subtitle: quiz.lecture_title || `Lezione ${quiz.lecture_id}`,
              lectureId: quiz.lecture_id,
              courseId: quiz.course_id,
              action: () => navigate("/lab?tab=quiz"),
            })
          })
        }

        if (data.flashcards?.length) {
          data.flashcards.forEach((card: any) => {
            searchResults.push({
              id: card.id,
              type: "flashcard",
              title: card.fronte?.slice(0, 80) || `Flashcard ${card.id}`,
              subtitle: card.lecture_title || `Lezione ${card.lecture_id}`,
              lectureId: card.lecture_id,
              courseId: card.course_id,
              action: () => navigate("/lab?tab=flashcard"),
            })
          })
        }

        if (data.courses?.length) {
          data.courses.forEach((course: any) => {
            searchResults.push({
              id: course.id,
              type: "course",
              title: course.fullname,
              subtitle: course.shortname,
              courseId: course.id,
              action: () => navigate(`/corsi/${course.id}`),
            })
          })
        }


        const grouped = searchResults.reduce((acc, r) => {
          const type = TYPE_CONFIG[r.type].label
          if (!acc[type]) acc[type] = []
          acc[type].push(r)
          return acc
        }, {} as Record<string, SearchResult[]>)

        setGroupedResults(grouped)
        setSelectedIndex(0)
      } catch (err) {
        console.error("Search error:", err)
        setError("Errore durante la ricerca. Verifica la connessione al backend.")
        setGroupedResults({})
      } finally {
        setIsLoading(false)
      }
    },
    [navigate]
  )

  // Debounced search
  const searchDebounced = useRef(debounce((q: string) => runSearch(q), 200))

  useEffect(() => {
    if (commandPaletteOpen) {
      // eslint-disable-next-line react/set-state-in-effect -- reset state on palette open
      setQuery("")
      setGroupedResults({})
      setSelectedIndex(0)
      setShowQuickActions(true)
      setError(null)
      setIsLoading(false)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [commandPaletteOpen])

  useEffect(() => {
    searchDebounced.current(query)
  }, [query])

  const filterQuickActions = (q: string) => {
    const lower = q.toLowerCase()
    return quickActions.filter(
      (a) =>
        a.label.toLowerCase().includes(lower) ||
        a.description.toLowerCase().includes(lower) ||
        a.keywords.some((k) => k.includes(lower))
    )
  }

  const filteredQuickActions = query ? filterQuickActions(query) : quickActions

  const groupedEntries = Object.entries(groupedResults)
  const hasResults = groupedEntries.length > 0

  const quickActionsCount = showQuickActions ? filteredQuickActions.length : 0
  const resultCount = hasResults ? Object.values(groupedResults).flat().length : 0
  const totalItems = quickActionsCount + resultCount

  const itemAt = (index: number): { action?: () => void } | undefined => {
    if (index < quickActionsCount) return filteredQuickActions[index]
    if (index < quickActionsCount + resultCount) {
      const flat = Object.values(groupedResults).flat()
      return flat[index - quickActionsCount]
    }
    return undefined
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case "Escape":
        e.preventDefault()
        setCommandPaletteOpen(false)
        break
      case "ArrowDown":
        e.preventDefault()
        setSelectedIndex((prev) => Math.min(prev + 1, Math.max(totalItems - 1, 0)))
        break
      case "ArrowUp":
        e.preventDefault()
        setSelectedIndex((prev) => Math.max(prev - 1, 0))
        break
      case "Enter": {
        e.preventDefault()
        const item = itemAt(selectedIndex)
        if (item?.action) {
          item.action()
          setCommandPaletteOpen(false)
        }
        break
      }
      case "Tab":
        e.preventDefault()
        setSelectedIndex((prev) => (totalItems ? (prev + 1) % totalItems : 0))
        break
    }
  }

  const handleResultClick = (result: SearchResult) => {
    if (result.action) {
      result.action()
      setCommandPaletteOpen(false)
    }
  }

  const handleQuickActionClick = (action: QuickAction) => {
    action.action()
    setCommandPaletteOpen(false)
  }

  // Scroll selected item into view
  useEffect(() => {
    const item = itemsRef.current[selectedIndex]
    if (item) item.scrollIntoView({ block: "nearest" })
  }, [selectedIndex])

  if (!commandPaletteOpen) return null

  return (
    <Dialog.Root open={commandPaletteOpen} onOpenChange={setCommandPaletteOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[400] bg-black/40 backdrop-blur-sm" />
        <Dialog.Content
          className={cn(
            "fixed left-1/2 top-20 z-[400] w-full max-w-3xl -translate-x-1/2 rounded-xl border border-neutral-200 bg-white/95 dark:border-neutral-700 dark:bg-neutral-950/95 backdrop-blur-xl shadow-modal",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
            "data-[state=closed]:slide-out-to-top-4 data-[state=open]:slide-in-from-top-4"
          )}
          onKeyDown={handleKeyDown}
        >
          <div className="flex flex-col">
            {/* Search Input */}
            <div className="flex items-center gap-3 p-4 border-b border-neutral-200 dark:border-neutral-700">
              <div className="relative flex-1">
                <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-neutral-400" aria-hidden="true" />
                <Input
                  ref={inputRef}
                  placeholder="Cerca lezioni, documenti, argomenti, quiz, flashcard…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="pl-12 pr-12 text-lg py-3 bg-neutral-50 dark:bg-neutral-900 border-neutral-200 dark:border-neutral-700 focus:border-accent-500"
                  autoFocus
                />
              </div>
              {query && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setQuery("")}
                  aria-label="Pulisci ricerca"
                  className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
                >
                  <X className="h-5 w-5" />
                </Button>
              )}
            </div>

            {/* Results */}
            <ScrollArea className="flex-1 max-h-[60vh] p-2">
              <div className="space-y-2">
                {/* Quick Actions */}
                {showQuickActions && filteredQuickActions.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
                      <Zap className="h-3.5 w-3.5" />
                      Azioni rapide
                    </div>
                    {filteredQuickActions.map((action, index) => (
                      <div
                        key={action.label}
                        ref={(el) => {
                          if (el) itemsRef.current[index] = el
                        }}
                        className={cn(
                          "flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors",
                          "hover:bg-neutral-100 dark:hover:bg-neutral-800",
                          selectedIndex === index && "bg-accent-50 dark:bg-accent-900/30"
                        )}
                        onClick={() => handleQuickActionClick(action)}
                        onMouseEnter={() => setSelectedIndex(index)}
                        role="option"
                        aria-selected={selectedIndex === index}
                      >
                        <div className="p-1.5 rounded-lg bg-accent-100 dark:bg-accent-900/30 text-accent-600 dark:text-accent-400">
                          {action.icon}
                        </div>
                        <div className="flex-1 min-w-0 text-left">
                          <p className="font-medium text-neutral-950 dark:text-neutral-50 truncate">{action.label}</p>
                          <p className="text-xs text-neutral-500 dark:text-neutral-400 truncate">{action.description}</p>
                        </div>
                        {action.shortcut && (
                          <kbd className="px-2 py-0.5 text-[10px] font-mono text-neutral-400 bg-neutral-100 dark:bg-neutral-800 rounded">
                            {action.shortcut}
                          </kbd>
                        )}
                      </div>
                    ))}
                    {filteredQuickActions.length === 0 && query && (
                      <div className="px-3 py-4 text-center text-sm text-neutral-500 dark:text-neutral-400">
                        Nessuna azione rapida per &ldquo;{query}&rdquo;
                      </div>
                    )}
                  </div>
                )}

                {/* Search Results */}
                {hasResults && (
                  <>
                    {showQuickActions && filteredQuickActions.length > 0 && <Separator className="my-2" />}
                    {groupedEntries.map(([typeLabel, items], groupIndex) => (
                      <div key={typeLabel}>
                        <div className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
                          {TYPE_CONFIG[items[0].type].icon}
                          {typeLabel}
                          <span className="ml-auto px-2 py-0.5 text-[10px] font-medium bg-neutral-100 dark:bg-neutral-800 rounded-full text-neutral-600 dark:text-neutral-400">
                            {items.length}
                          </span>
                        </div>
                        {items.map((result, itemIndex) => {
                          const flatBefore = Object.values(groupedResults)
                            .slice(0, groupIndex)
                            .flat().length
                          const globalIndex = quickActionsCount + flatBefore + itemIndex
                          return (
                            <div
                              key={`${result.type}-${result.id}`}
                              ref={(el) => {
                                if (el) itemsRef.current[globalIndex] = el
                              }}
                              className={cn(
                                "flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors",
                                "hover:bg-neutral-100 dark:hover:bg-neutral-800",
                                selectedIndex === globalIndex && "bg-accent-50 dark:bg-accent-900/30"
                              )}
                              onClick={() => handleResultClick(result)}
                              onMouseEnter={() => setSelectedIndex(globalIndex)}
                              role="option"
                              aria-selected={selectedIndex === globalIndex}
                            >
                              <div className={cn("p-1.5 rounded-lg flex-shrink-0", TYPE_CONFIG[result.type].color)}>
                                {TYPE_CONFIG[result.type].icon}
                              </div>
                              <div className="flex-1 min-w-0 text-left">
                                <p className="font-medium text-neutral-950 dark:text-neutral-50 truncate">{result.title}</p>
                                {result.subtitle && (
                                  <p className="text-xs text-neutral-500 dark:text-neutral-400 truncate">{result.subtitle}</p>
                                )}
                              </div>
                              <ChevronRight className="h-4 w-4 text-neutral-300 dark:text-neutral-600 flex-shrink-0" />
                            </div>
                          )
                        })}
                      </div>
                    ))}
                  </>
                )}

                {/* Loading State */}
                {isLoading && !hasResults && (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-accent-500" />
                    <span className="ml-2 text-sm text-neutral-500 dark:text-neutral-400">Ricerca in corso…</span>
                  </div>
                )}

                {/* Empty State */}
                {!isLoading && !hasResults && !showQuickActions && query && !error && (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <Search className="h-12 w-12 text-neutral-300 dark:text-neutral-600 mb-3" />
                    <p className="text-neutral-600 dark:text-neutral-400">
                      Nessun risultato per &ldquo;<span className="font-medium text-neutral-950 dark:text-neutral-50">{query}</span>&rdquo;
                    </p>
                    <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
                      Prova con parole diverse o controlla la connessione al backend
                    </p>
                  </div>
                )}

                {/* Error State */}
                {error && (
                  <div className="flex items-center gap-3 px-3 py-4 rounded-lg bg-error-50 dark:bg-error-900/20 border border-error-200 dark:border-error-800">
                    <AlertCircle className="h-5 w-5 text-error-500 flex-shrink-0" />
                    <p className="text-sm text-error-700 dark:text-error-400">{error}</p>
                  </div>
                )}

                {/* Initial hint */}
                {showQuickActions && !query && (
                  <div className="pt-2">
                    <p className="px-3 py-2 text-xs text-neutral-400 dark:text-neutral-500 text-center">
                      <kbd className="px-1.5 py-0.5 bg-neutral-100 dark:bg-neutral-800 rounded text-[10px] font-mono">↑↓</kbd> naviga ·{" "}
                      <kbd className="px-1.5 py-0.5 bg-neutral-100 dark:bg-neutral-800 rounded text-[10px] font-mono">Invio</kbd> apre ·{" "}
                      <kbd className="px-1.5 py-0.5 bg-neutral-100 dark:bg-neutral-800 rounded text-[10px] font-mono">Esc</kbd> chiude
                    </p>
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}