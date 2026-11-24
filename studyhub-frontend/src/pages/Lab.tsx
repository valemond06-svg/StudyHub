import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useSearchParams, useNavigate } from "react-router-dom"
import { Brain, FlaskConical, HelpCircle, Target, Zap, Download, Upload, Search, Settings, Filter, ChevronRight, Clock, Flame, BookOpen, Award, TrendingUp, RotateCcw, Volume2, VolumeX, SkipForward, RotateCw, Play, Plus, Cpu, Grid3X3, Radio, Compass } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { api } from "@/lib/api"
import { useUIStore } from "@/store/ui"
import type { Course, Flashcard, Quiz } from "@/types"
import { cn, safeFormatDistance } from "@/lib/utils"
import { FlashcardReviewModal } from "@/components/flashcards/FlashcardReviewModal"
import { PomodoroTimer } from "@/components/pomodoro/PomodoroTimer"
import { InteractiveEngine, type EngineType } from "@/components/engines"

export function Lab() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const { commandPaletteOpen, setCommandPaletteOpen } = useUIStore()

  const queryClient = useQueryClient()
  const initialTab = searchParams.get("tab") || "flashcard"
  const courseFilter = searchParams.get("course")

  const { data: courses = [] } = useQuery({ queryKey: ["courses"], queryFn: api.getCourses })
  const activeCourses = courses.filter((c: Course) => !c.passed)

  const [activeTab, setActiveTab] = useState(initialTab)
  const [searchQuery, setSearchQuery] = useState("")
  const [reviewModalOpen, setReviewModalOpen] = useState(false)
  const [activeEngine, setActiveEngine] = useState<EngineType>("linear_2d")

  // Flashcard stats (real from /api/flashcards/stats)
  const { data: flashcardStats } = useQuery({
    queryKey: ["flashcardStats", courseFilter ?? "all"],
    queryFn: () => api.getFlashcardStats(courseFilter ? Number(courseFilter) : undefined),
  })

  // Due flashcards (real from /api/flashcards/due)
  const { data: dueFlashcards } = useQuery({
    queryKey: ["flashcards-due", courseFilter ?? "all"],
    queryFn: () => api.getDueFlashcards(courseFilter ? Number(courseFilter) : undefined),
    enabled: activeTab === "flashcard",
  })
  const dueCards: Flashcard[] = dueFlashcards?.cards || dueFlashcards?.flashcards || []

  // Quiz history (real from /api/quizzes/history/list)
  const { data: quizHistory } = useQuery({
    queryKey: ["quizHistory", courseFilter ?? "all"],
    queryFn: () => api.getQuizHistory(courseFilter ? Number(courseFilter) : undefined),
    enabled: activeTab === "quiz",
  })

  // Tutor threads (real from /api/tutor/threads)
  const { data: tutorThreads = [] } = useQuery({
    queryKey: ["tutorThreads", courseFilter ?? "all"],
    queryFn: () => api.getTutorThreads(courseFilter ? Number(courseFilter) : undefined),
    enabled: activeTab === "tutor",
  })

  // Mock quiz type counts (backend doesn't expose this yet)
  const quizTypeCounts = {
    richiamo: 0,
    multipla: 0,
    vero_falso: 0,
    aperta: 0,
    esercizio: 0,
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-neutral-950 dark:text-neutral-50">
            Lab
          </h1>
          <p className="text-neutral-500 dark:text-neutral-400 mt-1">
            Strumenti trasversali per lo studio: flashcard, quiz, tutor, ricerca, export
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setCommandPaletteOpen(true)} className="gap-1">
            <Search className="h-4 w-4" />
            <kbd className="hidden sm:inline-flex px-1.5 text-[10px] font-mono text-neutral-400">⌘K</kbd>
          </Button>
          <Button variant="outline" size="sm" className="gap-1">
            <Download className="h-4 w-4" />
            Export Anki
          </Button>
          <Button variant="outline" size="sm" className="gap-1">
            <Upload className="h-4 w-4" />
            Import
          </Button>
        </div>
      </div>

      {/* Course filter + Search */}
      <div className="flex flex-col sm:flex-row gap-3">
        <Select value={courseFilter || "all"} onValueChange={(v) => {
          const params = new URLSearchParams(searchParams)
          if (v === "all") params.delete("course")
          else params.set("course", v)
          setSearchParams(params)
        }}>
          <SelectTrigger className="w-full sm:w-64">
            <SelectValue placeholder="Tutti i corsi" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tutti i corsi</SelectItem>
            {activeCourses.map((c: Course) => (
              <SelectItem key={c.id} value={String(c.id)}>{c.fullname}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          <Input
            placeholder="Cerca flashcard, quiz, note… (⌘K)"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
            onFocus={() => setCommandPaletteOpen(true)}
          />
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 h-auto p-1 gap-1">
          <TabsTrigger value="flashcard">
            <FlaskConical className="h-4 w-4 mr-2" />
            Flashcard
            <Badge variant="outline" className="ml-1 h-5">{flashcardStats?.da_ripassare ?? 0} da rivedere</Badge>
          </TabsTrigger>
          <TabsTrigger value="quiz">
            <HelpCircle className="h-4 w-4 mr-2" />
            Quiz
            <Badge variant="outline" className="ml-1 h-5">{(quizHistory?.length ?? 0)} tentativi</Badge>
          </TabsTrigger>
          <TabsTrigger value="simulazioni" className="gap-1.5">
            <Cpu className="h-4 w-4 text-sky-500" />
            Simulazioni
            <Badge variant="accent" className="ml-1 text-[10px] px-1.5 py-0 h-4">4 Motori</Badge>
          </TabsTrigger>
          <TabsTrigger value="tutor">
            <Brain className="h-4 w-4 mr-2" />
            Tutor
          </TabsTrigger>
          <TabsTrigger value="search">
            <Search className="h-4 w-4 mr-2" />
            Ricerca
          </TabsTrigger>
          <TabsTrigger value="export">
            <Download className="h-4 w-4 mr-2" />
            Export
          </TabsTrigger>
        </TabsList>

{/* FLASHCARD TAB */}
        <TabsContent value="flashcard" className="space-y-6">
          {/* Stats (reali da /api/flashcards/stats) */}
          <div className="grid gap-4 sm:grid-cols-4">
            {flashcardStats ? (
              <>
                <StatCard label="Totali" value={flashcardStats.totale} icon={<Award className="h-5 w-5 text-success-500" />} color="success" />
                <StatCard label="Ripassate oggi" value={flashcardStats.ripassate_oggi ?? 0} icon={<Brain className="h-5 w-5 text-warning-500" />} color="warning" />
                <StatCard label="Da rivedere oggi" value={flashcardStats.da_ripassare} icon={<Flame className="h-5 w-5 text-error-500" />} color="error" />
                <StatCard label="Mature" value={flashcardStats.totale - flashcardStats.da_ripassare - (flashcardStats.ripassate_oggi ?? 0)} icon={<Zap className="h-5 w-5 text-accent-500" />} color="accent" />
              </>
            ) : (
              <>
                <StatCard label="Totali" value={0} icon={<Award className="h-5 w-5 text-success-500" />} color="success" />
                <StatCard label="Ripassate oggi" value={0} icon={<Brain className="h-5 w-5 text-warning-500" />} color="warning" />
                <StatCard label="Da rivedere oggi" value={0} icon={<Flame className="h-5 w-5 text-error-500" />} color="error" />
                <StatCard label="Mature" value={0} icon={<Zap className="h-5 w-5 text-accent-500" />} color="accent" />
              </>
            )}
          </div>

          {/* Review session + Pomodoro Widget */}
          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2 flex flex-col justify-between">
              <div>
                <CardHeader className="flex flex-row items-center justify-between pb-3">
                  <CardTitle className="flex items-center gap-2">
                    <Flame className="h-5 w-5 text-error-500" />
                    Sessione di ripasso FSRS
                  </CardTitle>
                  <Badge variant="outline" className="text-xs">
                    Flusso Continuo
                  </Badge>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-neutral-600 dark:text-neutral-300 text-sm leading-relaxed">
                    Hai <strong>{flashcardStats?.da_ripassare ?? dueCards.length}</strong> flashcard in scadenza. L'algoritmo FSRS ottimizza l'intervallo per la retention al 90%, reinserendo automaticamente le carte difficili in coda finché non vengono memorizzate.
                  </p>
                  <div className="flex flex-wrap gap-3 pt-1">
                    <Button
                      className="gap-2 shadow-sm font-medium"
                      size="lg"
                      onClick={() => setReviewModalOpen(true)}
                      disabled={dueCards.length === 0}
                    >
                      <Play className="h-4 w-4 fill-current" />
                      Inizia ripasso ({dueCards.length} carte)
                    </Button>
                    <Button variant="outline" className="gap-2 font-medium" size="lg">
                      <BookOpen className="h-4 w-4" />
                      Sfoglia tutte
                    </Button>
                  </div>
                </CardContent>
              </div>

              <div className="px-6 pb-5 pt-2">
                <div className="text-xs text-neutral-400 dark:text-neutral-500 flex items-center gap-2 flex-wrap">
                  <span className="flex items-center gap-1">
                    <kbd className="px-1.5 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 font-mono text-2xs border border-neutral-200 dark:border-neutral-700">Spazio</kbd> gira carta
                  </span>
                  <span>•</span>
                  <span className="flex items-center gap-1">
                    <kbd className="px-1.5 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 font-mono text-2xs border border-neutral-200 dark:border-neutral-700">1-4</kbd> assegna rating
                  </span>
                  <span>•</span>
                  <span>
                    Riproposizione automatica se voti <strong className="text-rose-500">1 (Di nuovo)</strong>
                  </span>
                </div>
              </div>
            </Card>

            {/* Pomodoro Timer Widget */}
            <div className="lg:col-span-1">
              <PomodoroTimer />
            </div>
          </div>

          {/* Flashcard list (reali da /api/flashcards/due) */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                Flashcard in scadenza
                <Badge variant="outline">{(dueFlashcards?.cards ?? []).length} carte</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="max-h-96">
                <div className="space-y-3">
                  {(dueFlashcards?.cards ?? []).map((card: Flashcard) => (
                    <FlashcardItem key={card.id} card={card} />
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        {/* QUIZ TAB */}
        <TabsContent value="quiz" className="space-y-6">
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            I quiz vengono generati per lezione. I tentativi completati sono mostrati qui sotto.
          </p>

          {/* Recent quiz attempts (reali da /api/quizzes/history/list) */}
          <Card>
            <CardHeader>
              <CardTitle>Quiz recenti</CardTitle>
            </CardHeader>
            <CardContent>
              {(quizHistory?.length ?? 0) > 0 ? (
                <div className="space-y-3">
                  {quizHistory.map((q: any) => (
                    <div key={q.id} className="flex items-center justify-between p-3 rounded-lg bg-neutral-50 dark:bg-neutral-900/50">
                      <div className="flex items-center gap-3">
                        <Badge variant="outline" className="capitalize">{q.title || "Quiz"}</Badge>
                        <div>
                          <p className="font-medium">{q.lecture_title || "Lezione"}</p>
                          <p className="text-sm text-neutral-500 dark:text-neutral-400">{safeFormatDistance(q.created_at)}</p>
                        </div>
                      </div>
                      <Badge variant={q.score >= q.max_score * 0.7 ? "success" : "destructive"}>
                        {q.score}/{q.max_score}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-neutral-500 dark:text-neutral-400 text-center py-8">
                  Nessun quiz completato. Genera un quiz da una lezione per iniziare.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Target className="h-5 w-5" />
                Genera quiz personalizzato
              </CardTitle>
              <Button>Genera</Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Argomenti</label>
                  <Select>
                    <SelectTrigger><SelectValue placeholder="Seleziona argomenti…" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="limiti">Limiti e continuità</SelectItem>
                      <SelectItem value="derivate">Derivate e regole</SelectItem>
                      <SelectItem value="applicazioni">Applicazioni derivate</SelectItem>
                      <SelectItem value="integrali">Integrali</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Tipi di domanda</label>
                  <div className="flex flex-wrap gap-2">
                    {["richiamo", "multipla", "vero_falso", "aperta", "esercizio"].map((t) => (
                      <Button key={t} variant="outline" size="sm" className="capitalize">{t.replace("_", " ")}</Button>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Difficoltà</label>
                  <Select>
                    <SelectTrigger><SelectValue placeholder="Tutte" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">Facile (1)</SelectItem>
                      <SelectItem value="2">Media (2)</SelectItem>
                      <SelectItem value="3">Difficile (3)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Numero domande</label>
                  <Input type="number" defaultValue="10" min="5" max="50" className="w-24" />
                </div>
              </div>
              <Button className="w-full gap-2" size="lg">
                <Target className="h-4 w-4" />
                Genera quiz
              </Button>
            </CardContent>
          </Card>

          {/* Recent quizzes */}
          <Card>
            <CardHeader>
              <CardTitle>Quiz recenti</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {[
                  { id: "q1", type: "multipla", topic: "Derivate", score: "8/10", date: "2026-11-15", passed: true },
                  { id: "q2", type: "esercizio", topic: "Ottimizzazione", score: "6/10", date: "2026-11-14", passed: false },
                  { id: "q3", type: "richiamo", topic: "Limiti", score: "9/10", date: "2026-11-13", passed: true },
                ].map((q) => (
                  <div key={q.id} className="flex items-center justify-between p-3 rounded-lg bg-neutral-50 dark:bg-neutral-900/50">
                    <div className="flex items-center gap-3">
                      <Badge variant={q.type === "esercizio" ? "accent" : "outline"} className="capitalize">{q.type.replace("_", " ")}</Badge>
                      <div>
                        <p className="font-medium">{q.topic}</p>
                        <p className="text-sm text-neutral-500 dark:text-neutral-400">{safeFormatDistance(q.date)}</p>
                      </div>
                    </div>
                    <Badge variant={q.passed ? "success" : "destructive"}>{q.score}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* TUTOR TAB */}
        <TabsContent value="tutor" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Brain className="h-5 w-5" />
                Tutor RAG (Retrieval-Augmented Generation)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="p-4 rounded-lg bg-accent-50 dark:bg-accent-900/20 border border-accent-200 dark:border-accent-800">
                <h4 className="font-medium mb-2">Come funziona</h4>
                <ul className="space-y-1 text-sm text-neutral-600 dark:text-neutral-300">
                  <li>• Cerca nei tuoi appunti, trascrizioni e PDF (BM25 + vettori)</li>
                  <li>• Risponde citando le fonti esatte [lezione, minuto, pagina]</li>
                  <li>• Modalità socratica: ti guida senza dare la risposta diretta</li>
                  <li>• Conversazioni salvate per corso</li>
                </ul>
              </div>

              <div className="space-y-3">
                <h4 className="font-medium">Le tue conversazioni</h4>
                {(tutorThreads.length > 0) ? (
                  <div className="space-y-2">
                    {tutorThreads.map((t: any) => (
                      <Card key={t.id} className="p-4 hover:shadow-md transition-shadow cursor-pointer">
                        <div className="flex items-center justify-between">
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate">{t.title || "Nuova conversazione"}</p>
                            <p className="text-sm text-neutral-500 dark:text-neutral-400 flex items-center gap-2">
                              <span>{t.course_name || "Corso"}</span>
                              <span>·</span>
                              <span>{t.message_count ?? 0} messaggi</span>
                              <span>·</span>
                              <span>{safeFormatDistance(t.updated_at, "Mai")}</span>
                            </p>
                          </div>
                          <Button variant="ghost" size="sm" onClick={() => navigate(`/lab?tab=tutor&thread=${t.id}`)}>
                            Continua
                          </Button>
                        </div>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <p className="text-neutral-500 dark:text-neutral-400 text-center py-8">
                    Nessuna conversazione salvata. Inizia una nuova chat con il tutor.
                  </p>
                )}
              </div>

              <Button className="w-full gap-2" size="lg" onClick={() => navigate("/lab?tab=tutor&new=1")}>
                <Plus className="h-4 w-4" />
                Nuova conversazione
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* SEARCH TAB */}
        <TabsContent value="search" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Search className="h-5 w-5" />
                Ricerca universale
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="relative">
                <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-neutral-400" />
                <Input
                  placeholder="Cerca in appunti, lezioni, PDF, quiz, flashcard… (⌘K)"
                  className="pl-12 text-lg py-4"
                  onFocus={() => setCommandPaletteOpen(true)}
                />
              </div>

              <div className="flex flex-wrap gap-2">
                {["Appunti", "Lezioni", "PDF", "Quiz", "Flashcard", "Appelli"].map((filter) => (
                  <Button key={filter} variant="outline" size="sm">{filter}</Button>
                ))}
              </div>

              <p className="text-neutral-500 dark:text-neutral-400 text-center py-8">
                La ricerca ibrida combina BM25 (parole chiave) + similarità vettoriale (significato).
                I risultati sono rankati con Reciprocal Rank Fusion (k=60).
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* EXPORT TAB */}
        <TabsContent value="export" className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <ExportCard
              title="Flashcard → Anki"
              desc="Esporta tutte le flashcard in formato .apkg per Anki. LaTeX convertito in MathJax, GUID stabili per reimport senza duplicati."
              icon={<FlaskConical className="h-8 w-8 text-accent-500" />}
              action="Esporta .apkg"
              onAction={() => api.exportAnki()}
            />
            <ExportCard
              title="Appunti → PDF"
              desc="Genera PDF degli appunti di una lezione o dispensa completa del corso (copertina, indice, profilo, lezioni). Stampato con KaTeX."
              icon={<BookOpen className="h-8 w-8 text-success-500" />}
              action="Genera PDF"
              onAction={() => {}}
            />
            <ExportCard
              title="Quiz → TSV"
              desc="Esporta quiz e simulazioni in formato TSV per analisi offline o import in altri strumenti."
              icon={<HelpCircle className="h-8 w-8 text-warning-500" />}
              action="Esporta .tsv"
              onAction={() => {}}
            />
            <ExportCard
              title="Profilo Esame → PDF"
              desc="Esporta il profilo d'esame completo con parti, argomenti, esercizi tipo, teoria e consigli."
              icon={<Target className="h-8 w-8 text-error-500" />}
              action="Genera PDF"
              onAction={() => {}}
            />
            <ExportCard
              title="Simulazione → PDF"
              desc="Esporta la simulazione completa con domande, soluzioni e criteri di correzione."
              icon={<Zap className="h-8 w-8 text-accent-500" />}
              action="Genera PDF"
              onAction={() => {}}
            />
            <ExportCard
              title="Backup completo"
              desc="Backup di tutto il database (SQLite + file) in formato ZIP. Include metadati, vettori, progressi FSRS."
              icon={<Download className="h-8 w-8 text-neutral-500" />}
              action="Crea backup"
              onAction={() => {}}
            />
          </div>

          <Card className="border-warning-200 bg-warning-50/50 dark:border-warning-900/30 dark:bg-warning-950/20">
            <CardContent className="p-6">
              <div className="flex items-start gap-4">
                <Zap className="h-6 w-6 text-warning-500 flex-shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-medium mb-1">Export automatico programmato</h4>
                  <p className="text-sm text-neutral-600 dark:text-neutral-300 mb-3">
                    Configura backup giornalieri su Google Drive o cartella locale. I backup includono solo i delta dall'ultimo backup (incrementali).
                  </p>
                  <Button variant="outline" size="sm">Configura backup</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* SIMULAZIONI TAB (StudyHub Graphic Engines) */}
        <TabsContent value="simulazioni" className="space-y-6">
          {/* Header intro */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-5 rounded-2xl bg-neutral-50 dark:bg-neutral-900/40 border border-neutral-200 dark:border-neutral-800">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Cpu className="h-5 w-5 text-sky-500" />
                <h2 className="text-xl font-semibold text-neutral-950 dark:text-neutral-50">
                  Laboratori Grafici Interattivi
                </h2>
                <Badge variant="accent" className="text-xs">Fisica & Visual Intuition</Badge>
              </div>
              <p className="text-sm text-neutral-600 dark:text-neutral-400">
                L'intuizione visiva prima della formula: sperimenta in tempo reale con trasformazioni 2D, analisi nel piano s, campi di vettori e circuiti analogici.
              </p>
            </div>
          </div>

          {/* Selector cards for the 4 engines */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Linear 2D */}
            <Card
              className={cn(
                "p-4 cursor-pointer transition-all border hover:border-neutral-400 dark:hover:border-neutral-600",
                activeEngine === "linear_2d"
                  ? "border-sky-500/80 bg-sky-500/[0.04] shadow-sm ring-1 ring-sky-500/50"
                  : "border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900"
              )}
              onClick={() => setActiveEngine("linear_2d")}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="p-2 rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-400">
                  <Grid3X3 className="h-4 w-4" />
                </div>
                <Badge variant="accent" className="text-[10px] px-1.5 py-0">Algebra Lineare</Badge>
              </div>
              <h4 className="font-semibold text-sm text-neutral-900 dark:text-neutral-100">
                Spazio 2D & Determinante
              </h4>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1 line-clamp-2">
                Griglia deformata, calcolo det(A) in tempo reale, collasso e inversione di orientamento.
              </p>
            </Card>

            {/* Pole-Zero */}
            <Card
              className={cn(
                "p-4 cursor-pointer transition-all border hover:border-neutral-400 dark:hover:border-neutral-600",
                activeEngine === "pole_zero"
                  ? "border-emerald-500/80 bg-emerald-500/[0.04] shadow-sm ring-1 ring-emerald-500/50"
                  : "border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900"
              )}
              onClick={() => setActiveEngine("pole_zero")}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <Radio className="h-4 w-4" />
                </div>
                <Badge variant="warning" className="text-[10px] px-1.5 py-0">Controlli & Robotica</Badge>
              </div>
              <h4 className="font-semibold text-sm text-neutral-900 dark:text-neutral-100">
                Piano Complesso s & Risposta
              </h4>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1 line-clamp-2">
                Poli e zeri interattivi, diagnosi stabilità semipiano LHP/RHP e risposta y(t) al gradino.
              </p>
            </Card>

            {/* Vector Field */}
            <Card
              className={cn(
                "p-4 cursor-pointer transition-all border hover:border-neutral-400 dark:hover:border-neutral-600",
                activeEngine === "vector_field"
                  ? "border-indigo-500/80 bg-indigo-500/[0.04] shadow-sm ring-1 ring-indigo-500/50"
                  : "border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900"
              )}
              onClick={() => setActiveEngine("vector_field")}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                  <Compass className="h-4 w-4" />
                </div>
                <Badge variant="success" className="text-[10px] px-1.5 py-0">Analisi 2 & Fisica</Badge>
              </div>
              <h4 className="font-semibold text-sm text-neutral-900 dark:text-neutral-100">
                Campi Vettoriali & Flusso
              </h4>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1 line-clamp-2">
                Particelle animate lungo il campo, vortici, divergenza e simulazione evitamento ostacolo.
              </p>
            </Card>

            {/* Circuit Sim */}
            <Card
              className={cn(
                "p-4 cursor-pointer transition-all border hover:border-neutral-400 dark:hover:border-neutral-600",
                activeEngine === "circuit_sim"
                  ? "border-amber-500/80 bg-amber-500/[0.04] shadow-sm ring-1 ring-amber-500/50"
                  : "border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900"
              )}
              onClick={() => setActiveEngine("circuit_sim")}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="p-2 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
                  <Zap className="h-4 w-4" />
                </div>
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Elettronica</Badge>
              </div>
              <h4 className="font-semibold text-sm text-neutral-900 dark:text-neutral-100">
                Op-Amp & Oscilloscopio
              </h4>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1 line-clamp-2">
                Schema circuitale interattivo, calcolo guadagno Av e oscilloscopio live con saturazione rails.
              </p>
            </Card>
          </div>

          {/* Active Interactive Engine */}
          <InteractiveEngine type={activeEngine} key={activeEngine} />
        </TabsContent>
      </Tabs>

      {/* Flashcard FSRS Review Modal */}
      <FlashcardReviewModal
        isOpen={reviewModalOpen}
        onClose={() => setReviewModalOpen(false)}
        cards={dueCards}
        onSessionComplete={() => {
          queryClient.invalidateQueries({ queryKey: ["flashcards-due"] })
          queryClient.invalidateQueries({ queryKey: ["flashcardStats"] })
        }}
      />
    </div>
  )
}

// Helper components

function StatCard({ label, value, icon, color }: { label: string; value: number; icon: React.ReactNode; color: "success" | "warning" | "error" | "accent" }) {
  const colors = {
    success: "bg-success-50 dark:bg-success-900/20 border-success-200 dark:border-success-800 text-success-700 dark:text-success-400",
    warning: "bg-warning-50 dark:bg-warning-900/20 border-warning-200 dark:border-warning-800 text-warning-700 dark:text-warning-400",
    error: "bg-error-50 dark:bg-error-900/20 border-error-200 dark:border-error-800 text-error-700 dark:text-error-400",
    accent: "bg-accent-50 dark:bg-accent-900/20 border-accent-200 dark:border-accent-800 text-accent-700 dark:text-accent-400",
  }

  return (
    <Card className={cn("p-4 text-center", colors[color])}>
      <div className="flex items-center justify-center gap-1 mb-1">{icon}</div>
      <p className="text-3xl font-bold">{value}</p>
      <p className="text-xs font-medium">{label}</p>
    </Card>
  )
}

function FlashcardItem({ card }: { card: Flashcard }) {
  const [flipped, setFlipped] = useState(false)

  return (
    <Card className="overflow-hidden transition-all hover:shadow-md">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <Badge variant="outline" className="text-xs">Lezione {card.lecture_id}</Badge>
          <Badge variant={(card.reps ?? 0) >= 5 ? "success" : (card.reps ?? 0) >= 2 ? "warning" : "default"} className="text-xs">
            {card.reps} rip.
          </Badge>
        </div>

        <div
          className="min-h-[120px] flex items-center justify-center p-4 rounded-lg bg-neutral-50 dark:bg-neutral-900/50 border border-neutral-200 dark:border-neutral-700 cursor-pointer transition-all duration-300"
          onClick={() => setFlipped(!flipped)}
          style={{ transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)" }}
        >
          {!flipped ? (
            <div className="text-center w-full">
              <p className="font-medium text-lg text-neutral-950 dark:text-neutral-50">{card.fronte}</p>
              <p className="text-xs text-neutral-400 mt-2">Clicca per vedere la risposta →</p>
            </div>
          ) : (
            <div className="text-center w-full" style={{ transform: "rotateY(180deg)" }}>
              <p className="font-medium text-lg text-neutral-950 dark:text-neutral-50">{card.retro}</p>
              <p className="text-xs text-neutral-400 mt-2">Intervallo: {card.interval}g · EF: {card.ease_factor}</p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between mt-3 pt-3 border-t border-neutral-200 dark:border-neutral-700">
          <span className="text-xs text-neutral-500 dark:text-neutral-400">
            Scadenza: {safeFormatDistance(card.due_date, "Nessuna")}
          </span>
          <div className="flex gap-1">
            <Button variant="ghost" size="icon" className="h-8 w-8"><VolumeX className="h-4 w-4" /></Button>
            <Button variant="ghost" size="icon" className="h-8 w-8"><RotateCcw className="h-4 w-4" /></Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function ExportCard({ title, desc, icon, action, onAction }: { title: string; desc: string; icon: React.ReactNode; action: string; onAction: () => void }) {
  return (
    <Card className="p-6 h-full hover:shadow-lg transition-shadow">
      <div className="flex items-start gap-4">
        <div className="p-3 rounded-xl bg-accent-100 dark:bg-accent-900/30">{icon}</div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-lg mb-1">{title}</h3>
          <p className="text-sm text-neutral-600 dark:text-neutral-300 mb-4">{desc}</p>
          <Button size="sm" onClick={onAction} className="gap-1">
            <Download className="h-3.5 w-3.5" />
            {action}
          </Button>
        </div>
      </div>
    </Card>
  )
}

