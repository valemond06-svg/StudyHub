import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useSearchParams } from "react-router-dom"
import { Brain, FlaskConical, HelpCircle, Download, Upload, Flame, Award, Zap, Play, Cpu, Grid3X3, Radio, Compass, BookOpen, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { MathMarkdown } from "@/components/ui/math-markdown"
import { api, describeError } from "@/lib/api"
import { useToast } from "@/hooks/use-toast"
import type { Course, Flashcard } from "@/types"
import { cn, safeFormatDistance } from "@/lib/utils"
import { FlashcardReviewModal } from "@/components/flashcards/FlashcardReviewModal"
import { InteractiveEngine, type EngineType } from "@/components/engines"
import { TutorPanel } from "@/components/tutor/TutorPanel"

const TABS = ["flashcard", "quiz", "simulazioni", "tutor", "export"] as const
type LabTab = (typeof TABS)[number]

const ENGINES: Array<{ id: EngineType; title: string; tag: string; desc: string; icon: typeof Grid3X3 }> = [
  { id: "linear_2d", title: "Spazio 2D e determinante", tag: "Algebra lineare", desc: "Griglia deformata e det(A) in tempo reale.", icon: Grid3X3 },
  { id: "pole_zero", title: "Piano s e risposta", tag: "Controlli", desc: "Poli e zeri, stabilità e risposta al gradino.", icon: Radio },
  { id: "vector_field", title: "Campi vettoriali", tag: "Analisi 2 e fisica", desc: "Particelle lungo il campo, divergenza e rotore.", icon: Compass },
  { id: "circuit_sim", title: "Op-amp e oscilloscopio", tag: "Elettronica", desc: "Guadagno e saturazione su un circuito interattivo.", icon: Zap },
]

/** GET /api/quizzes/history/list: {id, quiz_id, title, lecture_id, course_id, score, max_score, created_at, lecture_title} */
interface QuizAttempt { id: number; title: string | null; score: number; max_score: number; created_at: string | null; lecture_title: string | null }

export function Lab() {
  const [searchParams, setSearchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const tabParam = searchParams.get("tab")
  const activeTab: LabTab = (TABS as readonly string[]).includes(tabParam ?? "") ? (tabParam as LabTab) : "flashcard"
  const courseFilter = searchParams.get("course")
  const courseId = courseFilter ? Number(courseFilter) : undefined
  const threadParam = Number(searchParams.get("thread"))
  const threadId = Number.isSafeInteger(threadParam) && threadParam > 0 ? threadParam : null

  const setParam = (key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams)
    if (value === null) params.delete(key)
    else params.set(key, value)
    setSearchParams(params, { replace: true })
  }

  const { data: courses = [] } = useQuery<Course[]>({ queryKey: ["courses"], queryFn: api.getCourses })
  const activeCourses = courses.filter((c) => !c.passed)

  const [reviewModalOpen, setReviewModalOpen] = useState(false)
  const [activeEngine, setActiveEngine] = useState<EngineType>("linear_2d")

  const { data: flashcardStats } = useQuery<any>({
    queryKey: ["flashcardStats", courseFilter ?? "all"],
    queryFn: () => api.getFlashcardStats(courseId),
  })
  const { data: dueFlashcards } = useQuery<any>({
    queryKey: ["flashcards-due", courseFilter ?? "all"],
    queryFn: () => api.getDueFlashcards(courseId),
    enabled: activeTab === "flashcard",
  })
  const dueCards: Flashcard[] = dueFlashcards?.cards ?? []

  const { data: quizHistory = [] } = useQuery<QuizAttempt[]>({
    queryKey: ["quizHistory", courseFilter ?? "all"],
    queryFn: () => api.getQuizHistory(courseId),
    enabled: activeTab === "quiz",
  })

  const importMutation = useMutation({
    mutationFn: () => api.importFlashcards(courseId),
    onSuccess: (res) => {
      toast({ title: "Flashcard importate", description: `${res?.added ?? 0} nuove carte dagli appunti AI.` })
      void queryClient.invalidateQueries({ queryKey: ["flashcardStats"] })
      void queryClient.invalidateQueries({ queryKey: ["flashcards-due"] })
      void queryClient.invalidateQueries({ queryKey: ["study-cards"] })
      void queryClient.invalidateQueries({ queryKey: ["review-today"] })
    },
    onError: (err) => toast({ variant: "destructive", title: "Importazione non riuscita", description: describeError(err) }),
  })
  const download = (fn: () => Promise<void>, what: string) =>
    fn().catch((err) => toast({ variant: "destructive", title: `${what} non riuscito`, description: describeError(err) }))

  return (
    <div className="space-y-6 min-w-0">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-neutral-950 dark:text-neutral-50">Lab</h1>
          <p className="text-neutral-500 dark:text-neutral-400 mt-1">Flashcard, quiz, tutor, laboratori grafici, esportazioni</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to={`/lab/feed${courseId ? `?course_id=${courseId}` : ""}`}><Sparkles className="size-4" /> StudyTok</Link>
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1 self-start"
            disabled={importMutation.isPending}
            onClick={() => importMutation.mutate()}
            title="Crea flashcard dagli appunti AI delle lezioni"
          >
            <Upload className="h-4 w-4" />
            Importa dagli appunti
          </Button>
        </div>
      </div>

      <Select value={courseFilter || "all"} onValueChange={(v) => setParam("course", v === "all" ? null : v)}>
        <SelectTrigger className="w-full sm:w-72" aria-label="Filtra per corso">
          <SelectValue placeholder="Tutti i corsi" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Tutti i corsi</SelectItem>
          {activeCourses.map((c) => (
            <SelectItem key={c.id} value={String(c.id)}>{c.fullname}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Tabs value={activeTab} onValueChange={(v) => setParam("tab", v)} className="space-y-6">
        <TabsList className="grid w-full grid-cols-3 sm:grid-cols-5 h-auto p-1 gap-1">
          <TabsTrigger value="flashcard"><FlaskConical className="h-4 w-4 mr-1.5" />Flashcard</TabsTrigger>
          <TabsTrigger value="quiz"><HelpCircle className="h-4 w-4 mr-1.5" />Quiz</TabsTrigger>
          <TabsTrigger value="simulazioni"><Cpu className="h-4 w-4 mr-1.5" />Laboratori</TabsTrigger>
          <TabsTrigger value="tutor"><Brain className="h-4 w-4 mr-1.5" />Tutor</TabsTrigger>
          <TabsTrigger value="export"><Download className="h-4 w-4 mr-1.5" />Export</TabsTrigger>
        </TabsList>

        <TabsContent value="flashcard" className="space-y-6">
          <div className="grid gap-3 grid-cols-3">
            <StatCard label="Totali" value={flashcardStats?.totale} icon={<Award className="h-5 w-5 text-success-500" />} />
            <StatCard label="Ripassate oggi" value={flashcardStats?.ripassate_oggi} icon={<Brain className="h-5 w-5 text-warning-500" />} />
            <StatCard label="Da rivedere" value={flashcardStats?.da_ripassare} icon={<Flame className="h-5 w-5 text-error-500" />} />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Flame className="h-5 w-5 text-error-500" />Ripasso FSRS</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-neutral-600 dark:text-neutral-300 text-sm leading-relaxed">
                  {dueCards.length
                    ? <>Ci sono <strong>{dueCards.length}</strong> carte da rivedere in questa coda (al massimo 50 per volta). Le carte votate «Di nuovo» tornano in fondo alla coda.</>
                    : "Nessuna carta da rivedere adesso."}
                </p>
                <Button className="gap-2" size="lg" onClick={() => setReviewModalOpen(true)} disabled={dueCards.length === 0}>
                  <Play className="h-4 w-4 fill-current" />
                  Inizia ripasso
                </Button>
                <p className="text-xs text-neutral-400">Spazio gira la carta · 1-4 voto · Esc esce</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Gestisci flashcard</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-neutral-500 dark:text-neutral-400">Crea carte, modifica testi e fonti o sospendi le carte dal ripasso.</p>
                <Button variant="outline" asChild><Link to={`/flashcard${courseId ? `?corso=${courseId}` : ""}`}>Apri gestione flashcard</Link></Button>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-2">
                Carte in scadenza
                <Badge variant="outline">{dueCards.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="max-h-[32rem] overflow-y-auto space-y-3 pr-1">
                {dueCards.map((card) => <FlashcardItem key={card.id} card={card} />)}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="quiz" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Quiz svolti</CardTitle>
            </CardHeader>
            <CardContent>
              {quizHistory.length > 0 ? (
                <div className="space-y-3">
                  {quizHistory.map((q) => (
                    <div key={q.id} className="flex items-center justify-between gap-3 p-3 rounded-lg bg-neutral-50 dark:bg-neutral-900/50">
                      <div className="min-w-0">
                        <p className="font-medium truncate">{q.lecture_title || q.title || "Quiz"}</p>
                        <p className="text-sm text-neutral-500 dark:text-neutral-400">{safeFormatDistance(q.created_at)}</p>
                      </div>
                      <Badge variant={q.max_score && q.score >= q.max_score * 0.7 ? "success" : "destructive"}>
                        {q.score}/{q.max_score}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-neutral-500 dark:text-neutral-400 text-center py-8">Nessun quiz svolto.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tutor" className="space-y-6">
          <TutorPanel courseId={courseId} threadId={threadId} onOpenThread={(id) => setParam("thread", id === null ? null : String(id))} />
        </TabsContent>

        <TabsContent value="export" className="space-y-4">
          <Card>
            <CardContent className="p-5 space-y-3">
              <p className="text-sm text-neutral-600 dark:text-neutral-300">
                {courseId ? "Esporta il materiale del corso selezionato." : "Senza filtro corso le flashcard sono di tutti i corsi."}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button className="gap-2" onClick={() => download(() => api.exportAnkiApkg(courseId), "Download Anki")}>
                  <FlaskConical className="h-4 w-4" />Flashcard per Anki (.apkg)
                </Button>
                <Button variant="outline" className="gap-2" onClick={() => download(() => api.exportAnki(courseId), "Download TSV")}>
                  <FlaskConical className="h-4 w-4" />Flashcard in testo (.tsv)
                </Button>
                <Button variant="outline" className="gap-2" disabled={!courseId} onClick={() => courseId && download(() => api.downloadCoursePdf(courseId), "Dispensa PDF")} title={courseId ? undefined : "Scegli prima un corso"}>
                  <BookOpen className="h-4 w-4" />Dispensa del corso (PDF)
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="simulazioni" className="space-y-6">
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            Laboratori grafici generici, non legati a un corso: sperimenta prima della formula.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {ENGINES.map((e) => (
              <button
                key={e.id}
                type="button"
                aria-pressed={activeEngine === e.id}
                onClick={() => setActiveEngine(e.id)}
                className={cn(
                  "text-left p-4 rounded-xl border transition-all",
                  activeEngine === e.id
                    ? "border-accent-500 ring-1 ring-accent-500/50 bg-accent-500/[0.04]"
                    : "border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 hover:border-neutral-400"
                )}
              >
                <div className="flex items-start justify-between mb-2">
                  <e.icon className="h-4 w-4 text-accent-500" />
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">{e.tag}</Badge>
                </div>
                <p className="font-semibold text-sm">{e.title}</p>
                <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">{e.desc}</p>
              </button>
            ))}
          </div>
          <InteractiveEngine type={activeEngine} key={activeEngine} />
        </TabsContent>
      </Tabs>

      <FlashcardReviewModal
        isOpen={reviewModalOpen}
        onClose={() => setReviewModalOpen(false)}
        cards={dueCards}
        onSessionComplete={() => {
          void queryClient.invalidateQueries({ queryKey: ["flashcards-due"] })
          void queryClient.invalidateQueries({ queryKey: ["flashcardStats"] })
          void queryClient.invalidateQueries({ queryKey: ["review-today"] })
        }}
      />
    </div>
  )
}

function StatCard({ label, value, icon }: { label: string; value: number | undefined; icon: React.ReactNode }) {
  return (
    <Card className="p-3 sm:p-4 text-center">
      <div className="flex items-center justify-center mb-1">{icon}</div>
      <p className="text-2xl sm:text-3xl font-bold">{value ?? "—"}</p>
      <p className="text-xs font-medium text-neutral-500">{label}</p>
    </Card>
  )
}

function FlashcardItem({ card }: { card: Flashcard }) {
  const [flipped, setFlipped] = useState(false)
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2 mb-3 text-xs">
          <span className="text-neutral-500 truncate">{card.lecture_title || card.course || "Flashcard"}</span>
          <Badge variant="outline" className="text-xs shrink-0">{card.reps ?? 0} ripetizioni</Badge>
        </div>
        <button
          type="button"
          className="w-full min-h-[100px] p-4 rounded-lg bg-neutral-50 dark:bg-neutral-900/50 border border-neutral-200 dark:border-neutral-700 text-left"
          onClick={() => setFlipped(!flipped)}
          aria-label={flipped ? "Mostra la domanda" : "Mostra la risposta"}
        >
          <MathMarkdown content={flipped ? card.retro : card.fronte} />
          <p className="text-xs text-neutral-400 mt-2">{flipped ? "Risposta · clic per la domanda" : "Clic per la risposta"}</p>
        </button>
        <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
          Scadenza: {safeFormatDistance(card.due_date, "nessuna")}
        </p>
      </CardContent>
    </Card>
  )
}
