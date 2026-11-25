import { useState, useEffect, useRef, useMemo } from "react"
import * as Dialog from "@radix-ui/react-dialog"
import {
  Search,
  BookOpen,
  FileText,
  FlaskConical,
  Settings,
  Sparkles,
  Loader2,
  X,
  AlertCircle,
  ChevronRight,
  PlayCircle,
  Code2,
  StickyNote,
  Zap,
} from "lucide-react"
import { useNavigate } from "react-router-dom"
import { cn } from "@/lib/utils"
import { api, describeError } from "@/lib/api"
import {
  groupSearchHits,
  searchTarget,
  searchWhere,
  splitSnippet,
  type SearchGroup,
  type SearchHit,
} from "@/lib/search"
import { shortcutLabel } from "@/lib/platform"
import { useUIStore } from "@/store/ui"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

interface QuickAction {
  label: string
  description: string
  icon: React.ReactNode
  action: () => void
  keywords: string[]
}

const GROUP_ICON: Record<SearchGroup, React.ReactNode> = {
  lezioni: <PlayCircle className="h-4 w-4" />,
  documenti: <FileText className="h-4 w-4" />,
  appunti: <StickyNote className="h-4 w-4" />,
  codice: <Code2 className="h-4 w-4" />,
}

const MIN_QUERY = 2

/** Ctrl/Cmd+K ovunque nell'app (non solo con il fuoco nella barra di ricerca). */
function useGlobalPaletteShortcut(toggle: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault()
        toggle()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [toggle])
}

function Snippet({ text }: { text: string }) {
  return (
    <>
      {splitSnippet(text).map((part, i) =>
        part.mark ? (
          <mark key={i} className="bg-accent-100 text-accent-800 dark:bg-accent-900/50 dark:text-accent-200 rounded px-0.5">
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        )
      )}
    </>
  )
}

export function CommandPalette() {
  const commandPaletteOpen = useUIStore((s) => s.commandPaletteOpen)
  const setCommandPaletteOpen = useUIStore((s) => s.setCommandPaletteOpen)
  const navigate = useNavigate()

  const toggle = useMemo(
    () => () => setCommandPaletteOpen(!useUIStore.getState().commandPaletteOpen),
    [setCommandPaletteOpen]
  )
  useGlobalPaletteShortcut(toggle)

  if (!commandPaletteOpen) return null
  return <PaletteDialog onClose={() => setCommandPaletteOpen(false)} navigate={navigate} />
}

function PaletteDialog({ onClose, navigate }: { onClose: () => void; navigate: ReturnType<typeof useNavigate> }) {
  const [query, setQuery] = useState("")
  const [hits, setHits] = useState<SearchHit[]>([])
  const [semantic, setSemantic] = useState(true)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [semanticPending, setSemanticPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const itemsRef = useRef<Array<HTMLDivElement | null>>([])
  const seqRef = useRef(0)

  const quickActions: QuickAction[] = [
    {
      label: "Ripassa le flashcard",
      description: "Apri il ripasso FSRS delle carte in scadenza",
      icon: <FlaskConical className="h-4 w-4" />,
      keywords: ["ripasso", "flashcard", "fsrs", "carte"],
      action: () => navigate("/lab?tab=flashcard"),
    },
    {
      label: "Vai ai Corsi",
      description: "Tutti i corsi con prontezza e appelli",
      icon: <BookOpen className="h-4 w-4" />,
      keywords: ["corsi", "corso", "materie", "esami"],
      action: () => navigate("/corsi"),
    },
    {
      label: "Apri StudyTok",
      description: "Pillole brevi sugli argomenti dei corsi attivi",
      icon: <Sparkles className="h-4 w-4" />,
      keywords: ["studytok", "feed", "pillole"],
      action: () => navigate("/feed"),
    },
    {
      label: "Apri Lab",
      description: "Flashcard, quiz, laboratori grafici, export",
      icon: <Zap className="h-4 w-4" />,
      keywords: ["lab", "flashcard", "quiz", "export", "simulazioni"],
      action: () => navigate("/lab"),
    },
    {
      label: "Impostazioni",
      description: "Stato dell'AI, login, spazio, tema",
      icon: <Settings className="h-4 w-4" />,
      keywords: ["impostazioni", "tema", "stato", "login"],
      action: () => navigate("/impostazioni"),
    },
  ]

  const trimmed = query.trim()
  const searching = trimmed.length >= MIN_QUERY

  const onQueryChange = (value: string) => {
    setQuery(value)
    if (value.trim() === trimmed) return
    seqRef.current++
    setHits([])
    setError(null)
    setIsLoading(value.trim().length >= MIN_QUERY)
    setSemanticPending(value.trim().length >= MIN_QUERY)
    setSelectedIndex(0)
  }

  useEffect(() => {
    if (!searching) return
    const seq = seqRef.current
    const controller = new AbortController()
    const opts = { limit: 20, signal: controller.signal }
    let lexical: SearchHit[] | undefined
    let hybrid: SearchHit[] | undefined
    let lexicalError: string | null = null
    let pending = true
    const publish = () => {
      if (seq !== seqRef.current || controller.signal.aborted) return
      const seen = new Set(lexical?.map((hit) => `${hit.kind}:${hit.id}`))
      const added = hybrid?.filter((hit) => !seen.has(`${hit.kind}:${hit.id}`)) ?? []
      setHits(lexical ? [...lexical, ...added] : added)
      setSemantic(hybrid !== undefined)
      setError(!pending && hybrid === undefined ? lexicalError : null)
      setIsLoading(lexical === undefined && hybrid === undefined && lexicalError === null)
      setSemanticPending(pending)
    }
    const timer = setTimeout(() => {
      void api.search(trimmed, opts).then((res) => {
        lexical = res.results
      }, (err) => {
        lexicalError = describeError(err, "Errore durante la ricerca.")
      }).finally(publish)
      void api.searchSemantic(trimmed, opts).then((res) => {
        if (res.semantic) hybrid = res.results
      }, () => {
        // I risultati lessicali restano disponibili anche se il POST fallisce.
      }).finally(() => {
        pending = false
        publish()
      })
    }, 250)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [trimmed, searching])

  const filteredQuickActions = trimmed
    ? quickActions.filter((a) => {
        const lower = trimmed.toLowerCase()
        return a.label.toLowerCase().includes(lower) || a.keywords.some((k) => k.includes(lower))
      })
    : quickActions

  const shownHits = searching ? hits : []
  const groups = groupSearchHits(shownHits)
  const flatHits = groups.flatMap((g) => g.hits)
  const totalItems = filteredQuickActions.length + flatHits.length

  const openHit = async (hit: SearchHit) => {
    const target = searchTarget(hit)
    onClose()
    if (target.type === "document" || target.type === "note") {
      navigate(target.url)
      return
    }
    let courseId = target.courseId
    if (courseId === null) {
      try {
        const lec = await api.getLecture(target.lectureId)
        courseId = typeof lec?.course_id === "number" ? lec.course_id : null
      } catch {
        courseId = null
      }
    }
    if (courseId !== null) navigate(`/corsi/${courseId}?lezione=${target.lectureId}&t=${target.t}`)
  }

  const runItem = (index: number) => {
    if (index < filteredQuickActions.length) {
      filteredQuickActions[index].action()
      onClose()
      return
    }
    const hit = flatHits[index - filteredQuickActions.length]
    if (hit) void openHit(hit)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault()
        setSelectedIndex((prev) => Math.min(prev + 1, Math.max(totalItems - 1, 0)))
        break
      case "ArrowUp":
        e.preventDefault()
        setSelectedIndex((prev) => Math.max(prev - 1, 0))
        break
      case "Enter":
        e.preventDefault()
        runItem(selectedIndex)
        break
    }
  }

  useEffect(() => {
    itemsRef.current[selectedIndex]?.scrollIntoView?.({ block: "nearest" })
  }, [selectedIndex])

  const itemClass = (active: boolean) =>
    cn(
      "flex items-start gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors",
      "hover:bg-neutral-100 dark:hover:bg-neutral-800",
      active && "bg-accent-50 dark:bg-accent-900/30"
    )

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[600] bg-black/40 backdrop-blur-sm" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-4 sm:top-20 z-[610] w-[calc(100%-1rem)] max-w-3xl -translate-x-1/2 rounded-xl border border-neutral-200 bg-white/95 dark:border-neutral-700 dark:bg-neutral-950/95 backdrop-blur-xl shadow-modal outline-none"
          onKeyDown={handleKeyDown}
        >
          <Dialog.Title className="sr-only">Cerca in StudyHub</Dialog.Title>
          <div className="flex flex-col">
            {/* Search Input */}
            <div className="flex items-center gap-3 p-3 sm:p-4 border-b border-neutral-200 dark:border-neutral-700">
              <div className="relative flex-1">
                <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-neutral-400" aria-hidden="true" />
                <Input
                  placeholder="Cerca in lezioni, PDF, appunti…"
                  aria-label="Cerca nel materiale"
                  value={query}
                  onChange={(e) => onQueryChange(e.target.value)}
                  className="pl-12 pr-4 text-base sm:text-lg py-3 bg-neutral-50 dark:bg-neutral-900 border-neutral-200 dark:border-neutral-700 focus:border-accent-500"
                  autoFocus
                />
              </div>
              <Button variant="ghost" size="icon" onClick={onClose} aria-label="Chiudi ricerca" className="text-neutral-400">
                <X className="h-5 w-5" />
              </Button>
            </div>

            <div className="max-h-[70vh] sm:max-h-[60vh] overflow-y-auto p-2" role="listbox" aria-label="Risultati">
              {filteredQuickActions.length > 0 && (
                <div>
                  <div className="px-3 py-2 text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
                    Azioni rapide
                  </div>
                  {filteredQuickActions.map((action, index) => (
                    <div
                      key={action.label}
                      ref={(el) => { itemsRef.current[index] = el }}
                      className={itemClass(selectedIndex === index)}
                      onClick={() => runItem(index)}
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
                    </div>
                  ))}
                </div>
              )}

              {groups.map((group) => (
                <div key={group.group} className="mt-2" data-testid={`gruppo-${group.group}`}>
                  <div className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
                    {GROUP_ICON[group.group]}
                    {group.label}
                    <span className="ml-auto px-2 py-0.5 text-[10px] bg-neutral-100 dark:bg-neutral-800 rounded-full">
                      {group.hits.length}
                    </span>
                  </div>
                  {group.hits.map((hit) => {
                    const index = filteredQuickActions.length + flatHits.indexOf(hit)
                    return (
                      <div
                        key={`${hit.kind}:${hit.id}`}
                        ref={(el) => { itemsRef.current[index] = el }}
                        className={itemClass(selectedIndex === index)}
                        onClick={() => void openHit(hit)}
                        onMouseEnter={() => setSelectedIndex(index)}
                        role="option"
                        aria-selected={selectedIndex === index}
                      >
                        <div className="p-1.5 rounded-lg text-accent-600 dark:text-accent-400 shrink-0">
                          {GROUP_ICON[hit.group]}
                        </div>
                        <div className="flex-1 min-w-0 text-left">
                          <p className="font-medium text-neutral-950 dark:text-neutral-50 truncate">{hit.title}</p>
                          <p className="text-xs text-neutral-500 dark:text-neutral-400 truncate">
                            {searchWhere(hit)}{hit.course ? ` · ${hit.course}` : ""}
                          </p>
                          {hit.snippet && (
                            <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-300 line-clamp-2 break-words">
                              <Snippet text={hit.snippet} />
                            </p>
                          )}
                        </div>
                        <ChevronRight className="h-4 w-4 mt-1 text-neutral-300 dark:text-neutral-600 shrink-0" />
                      </div>
                    )
                  })}
                </div>
              ))}

              {searching && isLoading && (
                <div className="flex items-center justify-center py-6" role="status">
                  <Loader2 className="h-5 w-5 animate-spin text-accent-500" />
                  <span className="ml-2 text-sm text-neutral-500 dark:text-neutral-400">Ricerca in corso…</span>
                </div>
              )}

              {!isLoading && searching && semanticPending && shownHits.length === 0 && (
                <p className="py-6 text-center text-sm text-neutral-500" role="status">
                  Ricerca per significato in corso…
                </p>
              )}

              {!isLoading && searching && !semanticPending && !error && shownHits.length === 0 && (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <Search className="h-10 w-10 text-neutral-300 dark:text-neutral-600 mb-3" />
                  <p className="text-neutral-600 dark:text-neutral-400">
                    Nessun risultato per &ldquo;<span className="font-medium text-neutral-950 dark:text-neutral-50">{trimmed}</span>&rdquo;
                  </p>
                </div>
              )}

              {!isLoading && searching && shownHits.length > 0 && !semantic && (
                <p className="px-3 pt-2 text-[11px] text-neutral-400">
                  Risultati della ricerca per parole.
                </p>
              )}

              {searching && error && (
                <div role="alert" className="flex items-center gap-3 px-3 py-4 rounded-lg bg-error-50 dark:bg-error-900/20 border border-error-200 dark:border-error-800">
                  <AlertCircle className="h-5 w-5 text-error-500 flex-shrink-0" />
                  <p className="text-sm text-error-700 dark:text-error-400">{error}</p>
                </div>
              )}

              {!trimmed && (
                <p className="px-3 py-2 text-xs text-neutral-400 dark:text-neutral-500 text-center">
                  <kbd className="px-1.5 py-0.5 bg-neutral-100 dark:bg-neutral-800 rounded text-[10px] font-mono">↑↓</kbd> naviga ·{" "}
                  <kbd className="px-1.5 py-0.5 bg-neutral-100 dark:bg-neutral-800 rounded text-[10px] font-mono">Invio</kbd> apre ·{" "}
                  <kbd className="px-1.5 py-0.5 bg-neutral-100 dark:bg-neutral-800 rounded text-[10px] font-mono">Esc</kbd> chiude ·{" "}
                  <kbd className="px-1.5 py-0.5 bg-neutral-100 dark:bg-neutral-800 rounded text-[10px] font-mono">{shortcutLabel()}</kbd> apre e chiude
                </p>
              )}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
