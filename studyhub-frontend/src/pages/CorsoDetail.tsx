import { Link, useLocation, useParams, useNavigate, useSearchParams } from "react-router-dom"
import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowLeft, Play, BookOpen, FlaskConical, HelpCircle, Target, Zap, Download, Upload, Plus, ListMusic, Image as ImageIcon, Loader2, RotateCcw, Video, FileText, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { VideoPlayer } from "@/components/player/VideoPlayer"
import { MathMarkdown, MathInline } from "@/components/ui/math-markdown"
import { api, describeError } from "@/lib/api"
import { canOpenLecture } from "@/lib/lecture-media"
import { toExamProfile, toExamSims, EXAM_WEIGHT_LABEL } from "@/lib/exam-profile"
import { readinessInfo } from "@/lib/readiness"
import { ReadinessBadge } from "@/components/study/ReadinessBadge"
import { CourseVerdict } from "@/components/course/CourseVerdict"
import { CoursePrepare } from "@/components/course/CoursePrepare"
import { TopicMap } from "@/components/course/TopicMap"
import { CourseMaterials } from "@/components/course/CourseMaterials"
import { CourseExams } from "@/components/course/CourseExams"
import { CourseArchetype } from "@/components/course/CourseArchetype"
import { useToast } from "@/hooks/use-toast"
import type { Course, Lecture, Exam, PlanData, StudyTopic } from "@/types"
import { cn, safeFormatDistance } from "@/lib/utils"
import { LecturePanel } from "@/components/study/LecturePanel"
import { useFocusDraft } from "@/lib/study-navigation"

type LectureRow = Lecture & { has_notes: boolean }

function lectureDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return "durata n.d."
  return `${Math.round(seconds / 60)} min`
}

/** Prima le lezioni con data (più recenti in alto), poi quelle senza data. */
function sortLectures(rows: LectureRow[]): LectureRow[] {
  return [...rows].sort((a, b) => {
    if (a.date && b.date) return b.date.localeCompare(a.date) || (b.number ?? 0) - (a.number ?? 0)
    if (a.date) return -1
    if (b.date) return 1
    return a.title.localeCompare(b.title)
  })
}

export function CorsoDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { hash } = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const courseId = Number(id)
  const validId = Number.isSafeInteger(courseId) && courseId > 0
  const openFocus = useFocusDraft((state) => state.openFocus)

  // Apertura diretta di una lezione al secondo esatto (dalla ricerca): /corsi/7?lezione=190&t=754
  const lectureParam = Number(searchParams.get("lezione"))
  const timeParam = Math.max(0, Number(searchParams.get("t")) || 0)
  const [today] = useState(() => new Date().toISOString().slice(0, 10))
  const [playerLecture, setPlayerLecture] = useState<{ id: number; title: string; t: number } | null>(null)
  const openFromUrl = Number.isSafeInteger(lectureParam) && lectureParam > 0 ? lectureParam : null
  const materialId = Number(searchParams.get("materiale"))
  const tab = searchParams.get("tab")
  const selectedTab = openFromUrl ? "lezioni" : tab && ["studia", "lezioni", "materiali", "esame", "lab"].includes(tab) ? tab : "studia"

  function selectTab(value: string) {
    const next = new URLSearchParams(searchParams)
    next.set("tab", value)
    setSearchParams(next, { replace: true })
  }

  function toggleMaterial(lectureId: number) {
    const next = new URLSearchParams(searchParams)
    next.set("tab", "lezioni")
    if (materialId === lectureId) next.delete("materiale")
    else next.set("materiale", String(lectureId))
    setSearchParams(next, { replace: true })
  }

  const { data: course, isLoading: courseLoading, isError: courseError, refetch: refetchCourse } = useQuery<Course>({
    queryKey: ["course", courseId],
    queryFn: () => api.getCourse(courseId),
    enabled: validId,
  })

  const { data: lectureRows = [] } = useQuery<Lecture[]>({
    queryKey: ["lectures", courseId],
    queryFn: () => api.getCourseLectures(courseId),
    enabled: validId,
  })
  const { data: notesIndex = [] } = useQuery<number[]>({
    queryKey: ["notesIndex", courseId],
    queryFn: () => api.getNotesIndex(courseId),
    enabled: validId,
  })
  const withNotes = new Set(notesIndex)
  const lectures: LectureRow[] = lectureRows.map((l) => ({ ...l, has_notes: withNotes.has(l.id) }))

  const { data: courseExam } = useQuery<{ profile: unknown; profile_md: string | null; sims: unknown }>({
    queryKey: ["examProfile", courseId],
    queryFn: () => api.getCourseExam(courseId),
    enabled: validId,
  })
  const profile = toExamProfile(courseExam?.profile)
  const simulations = toExamSims(courseExam?.sims)
  useEffect(() => {
    if (selectedTab === "lezioni" && course && materialId && lectureRows.some((lecture) => lecture.id === materialId)) {
      document.getElementById(`materiale-${materialId}`)?.scrollIntoView?.({ block: "start" })
    }
    if (selectedTab === "esame" && course && hash === "#simulazioni") {
      document.getElementById("simulazioni")?.scrollIntoView?.({ block: "start" })
    }
  }, [selectedTab, materialId, lectureRows, course, courseExam, hash])
  const profileMutation = useMutation({
    mutationFn: (force: boolean) => api.generateExamProfile(courseId, force),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["examProfile", courseId] }),
    onError: (err) => toast({ variant: "destructive", title: "Profilo d'esame non generato", description: describeError(err) }),
  })
  const simMutation = useMutation({
    mutationFn: () => api.generateSimulation(courseId),
    onSuccess: async (res: { id?: number } | undefined) => {
      if (res?.id) navigate(`/simulazione/${res.id}`)
      else await queryClient.invalidateQueries({ queryKey: ["examProfile", courseId] })
    },
    onError: (err) => toast({ variant: "destructive", title: "Simulazione non generata", description: describeError(err) }),
  })

  // Padronanza reale (mastery.overview) da /api/study/{id}
  const { data: studyData } = useQuery<any>({
    queryKey: ["study", courseId],
    queryFn: () => api.getStudyCourseStats(courseId),
    enabled: validId,
    // Mentre la preparazione è in corso (avviata solo dal pulsante) lo stato si aggiorna da solo.
    refetchInterval: (q) => ((q.state.data as any)?.prepare?.status === "in_corso" ? 5000 : false),
  })
  const readiness = readinessInfo(studyData)
  const { data: excludedChapters = [] } = useQuery<string[]>({
    queryKey: ["excludedChapters", courseId],
    queryFn: () => api.getExcludedChapters(courseId),
    enabled: validId,
  })

  const { data: chapters = [] } = useQuery<{ name: string; topics: number; weight: number; mastery: number; mastery_exam: number }[]>({
    queryKey: ["studyChapters", courseId],
    queryFn: () => api.getStudyChapters(courseId),
    enabled: validId,
  })

  const { data: flashcardStats } = useQuery<any>({
    queryKey: ["flashcardStats", courseId],
    queryFn: () => api.getFlashcardStats(courseId),
    enabled: validId,
  })
  const importMutation = useMutation({
    mutationFn: () => api.importFlashcards(courseId),
    onSuccess: (res) => {
      toast({ title: "Flashcard importate", description: `${res?.added ?? 0} nuove carte dagli appunti del corso.` })
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: ["flashcardStats"] }),
        queryClient.invalidateQueries({ queryKey: ["flashcards-due"] }),
        queryClient.invalidateQueries({ queryKey: ["study-cards"] }),
        queryClient.invalidateQueries({ queryKey: ["review-today"] }),
        queryClient.invalidateQueries({ queryKey: ["study-week"] }),
      ])
    },
    onError: (err) => toast({ variant: "destructive", title: "Importazione non riuscita", description: describeError(err) }),
  })
  const exportMutation = useMutation({
    mutationFn: () => api.exportAnki(courseId),
    onError: (err) => toast({ variant: "destructive", title: "Download Anki non riuscito", description: describeError(err) }),
  })
  const pdfMutation = useMutation({
    mutationFn: () => api.downloadCoursePdf(courseId),
    onError: (err) => toast({ variant: "destructive", title: "Dispensa PDF non creata", description: describeError(err) }),
  })

  const { data: plan } = useQuery<PlanData>({
    queryKey: ["plan"],
    queryFn: api.getPlan,
    enabled: validId,
  })
  const exams = (plan?.exams ?? []).filter((e: Exam) => e.course_id === courseId)

  const urlLecture = openFromUrl ? lectures.find((l) => l.id === openFromUrl) : undefined
  const activePlayer = playerLecture ?? (openFromUrl ? { id: openFromUrl, title: urlLecture?.title ?? "Lezione", t: timeParam } : null)
  const closePlayer = () => {
    setPlayerLecture(null)
    if (openFromUrl) {
      const next = new URLSearchParams(searchParams)
      next.delete("lezione")
      next.delete("t")
      setSearchParams(next, { replace: true })
    }
  }

  if (!validId) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center space-y-4">
        <p className="text-neutral-600 dark:text-neutral-400">Indirizzo del corso non valido.</p>
        <Button variant="outline" onClick={() => navigate("/corsi")}>Torna ai corsi</Button>
      </div>
    )
  }

  if (courseLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-neutral-500">
        <Loader2 className="h-8 w-8 animate-spin text-accent-500" />
        <p className="text-sm">Caricamento corso...</p>
      </div>
    )
  }

  if (courseError || !course) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center space-y-4">
        <p className="text-neutral-600 dark:text-neutral-400">Impossibile caricare il corso.</p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate("/corsi")}>Torna ai corsi</Button>
          <Button onClick={() => refetchCourse()}>Riprova</Button>
        </div>
      </div>
    )
  }

  const upcomingExams = exams
    .filter((e: Exam) => e.date && e.date >= today)
    .sort((a: Exam, b: Exam) => a.date.localeCompare(b.date))

  const notesCount = lectures.filter((l) => l.has_notes).length
  const groups = [
    { key: "notes", title: "Con appunti AI", items: lectures.filter((l) => l.has_notes) },
    { key: "trascritta", title: "Trascritte, senza appunti", items: lectures.filter((l) => !l.has_notes && l.status === "trascritta") },
    { key: "media_ok", title: "Audio pronto, da trascrivere", items: lectures.filter((l) => !l.has_notes && l.status === "media_ok") },
    { key: "nuova", title: "Nuove (da scaricare)", items: lectures.filter((l) => !l.has_notes && l.status === "nuova") },
    { key: "errore", title: "Errori", items: lectures.filter((l) => !l.has_notes && l.status === "errore") },
  ].map((g) => ({ ...g, items: sortLectures(g.items) }))
  const toProcess = lectures.length - notesCount

  const topics: StudyTopic[] = studyData?.topics ?? []
  const untried = topics.filter((t) => !t.tried)
  const nextTopic: StudyTopic | undefined = untried[0] ?? (topics.length ? topics.reduce((min, t) => (t.m ?? 0) < (min.m ?? 0) ? t : min, topics[0]) : undefined)

  return (
    <div className="space-y-6 min-w-0">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <Button variant="ghost" size="icon" onClick={() => navigate("/corsi")} aria-label="Torna ai corsi" className="shrink-0">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-accent-100 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300">
                {course.year_of_study ? `${course.year_of_study}° anno` : "Anno non indicato"}
              </span>
              {course.passed ? <Badge variant="success">Superato</Badge> : course.active ? <Badge variant="outline">Attivo</Badge> : <Badge variant="outline">Non attivo</Badge>}
              {course.priority > 0 && (
                <Badge variant="accent" className="gap-1">
                  <Target className="h-3 w-3" />
                  Prioritario
                </Badge>
              )}
            </div>
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-neutral-950 dark:text-neutral-50 break-words">
              {course.fullname}
            </h1>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <Button variant="outline" onClick={() => openFocus({ courseId })}>Avvia focus</Button>
          <Button variant="outline" className="gap-1" disabled={pdfMutation.isPending} onClick={() => pdfMutation.mutate()}>
            {pdfMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Dispensa PDF
          </Button>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-neutral-500 dark:text-neutral-400" title="Padronanza stimata al giorno dell'esame, dalle tue risposte">Prontezza</span>
              <ReadinessBadge info={readiness} />
            </div>
            <Progress value={readiness.reliable ? readiness.pct ?? 0 : 0} className="h-2" />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-neutral-500 dark:text-neutral-400">Lezioni con appunti</span>
              <span className="font-semibold text-2xl">{notesCount}</span>
            </div>
            <Progress value={lectures.length ? (notesCount / lectures.length) * 100 : 0} className="h-1.5" />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-neutral-500 dark:text-neutral-400">Senza appunti</span>
              <span className="font-semibold text-2xl text-warning-600 dark:text-warning-400">{toProcess}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-neutral-500 dark:text-neutral-400">Prossimo appello</span>
              <span className="font-semibold text-right">
                {upcomingExams[0] ? safeFormatDistance(upcomingExams[0].date) : "—"}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card className="col-span-2 lg:col-span-1">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-neutral-500 dark:text-neutral-400">Simulazioni</span>
              <span className="font-semibold text-2xl">{simulations.length}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={selectedTab} onValueChange={selectTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="studia">
            <BookOpen className="h-4 w-4 sm:mr-2" />
            <span className="sr-only sm:not-sr-only">Studia</span>
          </TabsTrigger>
          <TabsTrigger value="lezioni">
            <Play className="h-4 w-4 sm:mr-2" />
            <span className="sr-only sm:not-sr-only">Lezioni</span>
          </TabsTrigger>
          <TabsTrigger value="materiali">
            <FileText className="h-4 w-4 sm:mr-2" />
            <span className="sr-only sm:not-sr-only">Materiali</span>
          </TabsTrigger>
          <TabsTrigger value="esame">
            <Target className="h-4 w-4 sm:mr-2" />
            <span className="sr-only sm:not-sr-only">Esame</span>
          </TabsTrigger>
          <TabsTrigger value="lab">
            <FlaskConical className="h-4 w-4 sm:mr-2" />
            <span className="sr-only sm:not-sr-only">Lab</span>
          </TabsTrigger>
        </TabsList>

        {/* TAB: STUDIA */}
        <TabsContent value="studia" className="space-y-6">
          <CourseVerdict courseId={courseId} data={studyData} />
          <CoursePrepare courseId={courseId} prepare={studyData?.prepare} />
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-accent-500" />
                Sessione di studio
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-neutral-600 dark:text-neutral-300">
                Scegli la durata: nella pagina successiva confermi argomento e avvio. Nessuna sessione parte senza il tuo clic.
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  { duration: 25, label: "Breve", desc: "Un argomento, ripasso mirato" },
                  { duration: 45, label: "Standard", desc: "Sessione completa bilanciata" },
                  { duration: 90, label: "Lunga", desc: "Più argomenti, più pratica" },
                ].map((opt) => (
                  <Button
                    key={opt.duration}
                    variant="outline"
                    className="h-auto flex-col items-start text-left gap-1 py-4"
                    onClick={() => navigate(`/studio/${courseId}?duration=${opt.duration}`)}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-semibold">{opt.duration} min</span>
                      <Badge variant="outline" className="text-xs">{opt.label}</Badge>
                    </div>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400 whitespace-normal">{opt.desc}</p>
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Prossimo argomento da studiare</CardTitle>
            </CardHeader>
            <CardContent>
              {nextTopic ? (
                <div className="p-4 rounded-lg bg-accent-50 dark:bg-accent-900/20 border border-accent-200 dark:border-accent-800">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-accent-100 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300">
                      {nextTopic.chapter || "Senza capitolo"}
                    </span>
                    <Badge variant={!nextTopic.tried ? "default" : (nextTopic.level ?? 0) >= 3 ? "success" : (nextTopic.level ?? 0) >= 2 ? "warning" : "destructive"}>
                      {nextTopic.tried ? (nextTopic.level_name || "In crescita") : "Mai provato"}
                    </Badge>
                  </div>
                  <h3 className="font-medium text-lg mb-1"><MathInline content={nextTopic.name} /></h3>
                  <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-3">
                    Padronanza {Math.round((nextTopic.m ?? 0) * 100)}% · {nextTopic.n_items ?? 0} domande · Peso {nextTopic.weight}/3
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" asChild><Link to={`/impara/${nextTopic.id}`}>Impara</Link></Button>
                    <Button size="sm" className="gap-1" onClick={() => navigate(`/studio/${courseId}?topic=${nextTopic.id}&duration=25`)}>
                      <Play className="h-3 w-3" />
                      Prepara una sessione
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-neutral-500 dark:text-neutral-400">
                  Nessuna domanda in banca: il materiale del corso non è ancora stato analizzato.
                </p>
              )}
            </CardContent>
          </Card>

          <TopicMap courseId={courseId} topics={topics} chapters={chapters} excluded={excludedChapters} />
        </TabsContent>

        {/* TAB: MATERIALI */}
        <TabsContent value="materiali" className="space-y-6">
          {selectedTab === "materiali" && <CourseMaterials courseId={courseId} />}
        </TabsContent>

        {/* TAB: LEZIONI */}
        <TabsContent value="lezioni" className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {groups.map((g) => (
              <Badge key={g.key} variant={g.key === "errore" ? "destructive" : g.key === "notes" ? "success" : "outline"}>
                {g.title} ({g.items.length})
              </Badge>
            ))}
          </div>

          {lectures.length === 0 ? (
            <p className="text-neutral-500 dark:text-neutral-400 text-center py-8">Nessuna lezione registrata per questo corso.</p>
          ) : (
            <div className="space-y-5">
              {groups.map((group) => group.items.length === 0 ? null : (
                <div key={group.key} className="space-y-2">
                  <h4 className="text-sm font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
                    {group.title}
                  </h4>
                  {group.items.map((lec) => {
                    const openable = canOpenLecture(lec)
                    return (
                      <Card key={lec.id} id={`materiale-${lec.id}`} className={cn("scroll-mt-20 transition-shadow", openable && "hover:shadow-md")}>
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex flex-wrap items-center gap-1.5 mb-1">
                                {lec.has_audio && (
                                  <Badge variant="outline" className="text-xs gap-1"><ListMusic className="h-2.5 w-2.5" />Audio</Badge>
                                )}
                                {(lec.n_slides ?? 0) > 0 && (
                                  <Badge variant="outline" className="text-xs gap-1"><ImageIcon className="h-2.5 w-2.5" />Slide</Badge>
                                )}
                                {lec.video_type === "panopto" && (
                                  <Badge variant="outline" className="text-xs gap-1"><Video className="h-2.5 w-2.5" />Panopto</Badge>
                                )}
                                {lec.video_type === "moodle" && (
                                  <Badge variant="outline" className="text-xs gap-1"><Video className="h-2.5 w-2.5" />Video Moodle</Badge>
                                )}
                                {lec.has_notes && (
                                  <Badge variant="success" className="text-xs gap-1"><FileText className="h-2.5 w-2.5" />Appunti</Badge>
                                )}
                              </div>
                              <h4 className="font-medium break-words">{lec.title}</h4>
                              <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
                                {lec.date ? safeFormatDistance(lec.date) : "senza data"} · {lectureDuration(lec.duration)}
                              </p>
                              {lec.status === "errore" && lec.error && (
                                <p className="mt-1 text-xs text-error-600 dark:text-error-400 flex items-start gap-1 break-words">
                                  <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />{lec.error}
                                </p>
                              )}
                            </div>
                            {openable ? (
                              <Button
                                variant="outline"
                                size="sm"
                                className="gap-1 shrink-0"
                                onClick={() => setPlayerLecture({ id: lec.id, title: lec.title, t: 0 })}
                                aria-label={`Apri ${lec.title}`}
                              >
                                <Play className="h-4 w-4" />
                                <span className="hidden sm:inline">Apri</span>
                              </Button>
                            ) : (
                              <span className="text-xs text-neutral-400 shrink-0">Nessuna sorgente</span>
                            )}
                          </div>
                          <Button variant="ghost" size="sm" className="mt-2" aria-expanded={materialId === lec.id} onClick={() => toggleMaterial(lec.id)}>
                            {materialId === lec.id ? "Chiudi appunti e quiz" : "Appunti e quiz"}
                          </Button>
                          {materialId === lec.id && <LecturePanel key={lec.id} lectureId={lec.id} />}
                        </CardContent>
                      </Card>
                    )
                  })}
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* TAB: ESAME */}
        <TabsContent value="esame" className="space-y-6">
          <CourseExams courseId={courseId} exams={exams} />
          {selectedTab === "esame" && <CourseArchetype courseId={courseId} />}
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2">
                <Target className="h-5 w-5" />
                Profilo d'esame
              </CardTitle>
              {profile ? (
                <Button variant="outline" size="sm" disabled={profileMutation.isPending} onClick={() => profileMutation.mutate(true)} className="gap-1">
                  {profileMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                  Rigenera
                </Button>
              ) : (
                <Button disabled={profileMutation.isPending} onClick={() => profileMutation.mutate(false)} className="gap-1">
                  {profileMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  Genera profilo
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {profile ? (
                <div className="space-y-6">
                  {profile.summaryMd && (
                    <div className="text-sm">
                      <MathMarkdown content={profile.summaryMd} />
                    </div>
                  )}

                  {/* Formato */}
                  <div className="grid gap-3 sm:grid-cols-2 text-sm">
                    <div className="p-3 rounded-lg bg-neutral-50 dark:bg-neutral-900/50">
                      <p className="text-neutral-500 dark:text-neutral-400">Durata</p>
                      <p className="font-medium">{profile.durationMin ? `${profile.durationMin} minuti` : "Non indicata"}</p>
                    </div>
                    {profile.allowedMaterial && (
                      <div className="p-3 rounded-lg bg-neutral-50 dark:bg-neutral-900/50">
                        <p className="text-neutral-500 dark:text-neutral-400">Materiale consentito</p>
                        <p className="font-medium">{profile.allowedMaterial}</p>
                      </div>
                    )}
                    {profile.oral && (
                      <div className="p-3 rounded-lg bg-neutral-50 dark:bg-neutral-900/50">
                        <p className="text-neutral-500 dark:text-neutral-400">Orale</p>
                        <p className="font-medium">{profile.oral}</p>
                      </div>
                    )}
                    {profile.gradingRules && (
                      <div className="p-3 rounded-lg bg-neutral-50 dark:bg-neutral-900/50">
                        <p className="text-neutral-500 dark:text-neutral-400">Voto</p>
                        <p className="font-medium">{profile.gradingRules}</p>
                      </div>
                    )}
                  </div>

                  {profile.parts.length > 0 && (
                    <div>
                      <h4 className="font-medium mb-3">Struttura della prova</h4>
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {profile.parts.map((part, i) => (
                          <Card key={i} className="p-4">
                            <div className="flex items-center justify-between gap-2 mb-2">
                              <span className="font-medium">{part.name}</span>
                              {part.points != null && <Badge variant="accent">{part.points} punti</Badge>}
                            </div>
                            <div className="text-sm text-neutral-500 dark:text-neutral-400 space-y-1">
                              {part.description && <MathInline content={part.description} className="text-xs" />}
                              {part.minimum != null && <div>Minimo: {part.minimum}</div>}
                            </div>
                          </Card>
                        ))}
                      </div>
                    </div>
                  )}

                  {profile.topics.length > 0 && (
                    <>
                      <Separator />
                      <div>
                        <h4 className="font-medium mb-3">Argomenti per frequenza</h4>
                        <div className="space-y-2">
                          {profile.topics.map((topic, i) => (
                            <div key={i} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-lg bg-neutral-50 dark:bg-neutral-900/50">
                              <div className="min-w-0">
                                <span className="font-medium"><MathInline content={topic.name} /></span>
                                {topic.notes && <p className="text-xs text-neutral-500 mt-0.5"><MathInline content={topic.notes} /></p>}
                              </div>
                              <div className="flex flex-wrap items-center gap-2 text-sm shrink-0">
                                {topic.frequency && <Badge variant="outline">{topic.frequency}</Badge>}
                                {topic.weight && (
                                  <Badge variant={topic.weight === "alto" ? "destructive" : topic.weight === "medio" ? "warning" : "default"}>
                                    {EXAM_WEIGHT_LABEL[topic.weight]}
                                  </Badge>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  )}

                  {profile.exercises.length > 0 && (
                    <>
                      <Separator />
                      <div>
                        <h4 className="font-medium mb-3">Esercizi tipo</h4>
                        <div className="space-y-3">
                          {profile.exercises.map((ex, i) => (
                            <div key={i} className="p-3 rounded-lg bg-neutral-50 dark:bg-neutral-900/50">
                              <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                                <span className="font-medium"><MathInline content={ex.title || `Esercizio ${i + 1}`} /></span>
                                {ex.frequency && <Badge variant="outline">{ex.frequency}</Badge>}
                              </div>
                              {ex.methodMd && <div className="text-sm"><MathMarkdown content={ex.methodMd} /></div>}
                              {ex.commonErrors && (
                                <p className="mt-2 text-xs text-error-700 dark:text-error-400">
                                  Errori tipici: <MathInline content={ex.commonErrors} />
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  )}

                  {(profile.theory.length > 0 || profile.adviceMd) && (
                    <>
                      <Separator />
                      <div className="grid gap-4 sm:grid-cols-2">
                        {profile.theory.length > 0 && (
                          <div>
                            <h4 className="font-medium mb-2">Teoria richiesta</h4>
                            <ul className="space-y-1 text-sm text-neutral-600 dark:text-neutral-300">
                              {profile.theory.map((t, i) => (
                                <li key={i} className="flex items-start gap-2">
                                  <span className="h-1.5 w-1.5 rounded-full bg-accent-500 shrink-0 mt-2" />
                                  <MathInline content={t} />
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {profile.adviceMd && (
                          <div>
                            <h4 className="font-medium mb-2 flex items-center gap-2"><HelpCircle className="h-4 w-4 text-accent-500" />Consigli</h4>
                            <div className="text-sm"><MathMarkdown content={profile.adviceMd} /></div>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <div className="text-center py-10">
                  <Target className="h-12 w-12 mx-auto text-neutral-300 dark:text-neutral-600 mb-4" />
                  <h3 className="text-lg font-medium text-neutral-950 dark:text-neutral-50 mb-2">Nessun profilo d'esame</h3>
                  <p className="text-neutral-500 dark:text-neutral-400">
                    «Genera profilo» chiede all'AI di analizzare appelli passati e programma del corso.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card id="simulazioni" className="scroll-mt-20">
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-accent-500" />
                Simulazioni d'esame
              </CardTitle>
              <Button variant="outline" size="sm" onClick={() => simMutation.mutate()} disabled={simMutation.isPending} className="gap-1.5">
                {simMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                <span>{simMutation.isPending ? "Generazione..." : "Nuova simulazione"}</span>
              </Button>
            </CardHeader>
            <CardContent>
              {simulations.length > 0 ? (
                <div className="space-y-3">
                  {simulations.map((sim) => {
                    const done = sim.bestGrade !== null
                    return (
                      <Card key={sim.id} className="p-4">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-semibold text-neutral-900 dark:text-neutral-100 break-words">{sim.title}</p>
                            <p className="text-xs text-neutral-500 dark:text-neutral-400">
                              {done ? "Svolta" : "Da svolgere"}{sim.durationMin ? ` · ${sim.durationMin} min` : ""}
                            </p>
                          </div>
                          <div className="flex items-center gap-3">
                            {done && (
                              <Badge variant={(sim.bestGrade ?? 0) >= 18 ? "success" : "destructive"} className="font-mono">
                                Migliore: {sim.bestGrade}/30
                              </Badge>
                            )}
                            <Button size="sm" variant={done ? "outline" : "default"} onClick={() => navigate(`/simulazione/${sim.id}`)}>
                              {done ? "Rifai o rivedi" : "Apri simulazione"}
                            </Button>
                          </div>
                        </div>
                      </Card>
                    )
                  })}
                </div>
              ) : (
                <p className="text-sm text-neutral-500 dark:text-neutral-400 text-center py-6">
                  Nessuna simulazione per questo corso. «Nuova simulazione» la fa preparare all'AI dal profilo d'esame.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB: LAB */}
        <TabsContent value="lab" className="space-y-6">
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2">
                <FlaskConical className="h-5 w-5" />
                Flashcard (FSRS)
              </CardTitle>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={exportMutation.isPending} onClick={() => exportMutation.mutate()} aria-label="Anki">
                  <Download className="h-3 w-3 mr-1" />
                  Anki
                </Button>
                <Button variant="outline" size="sm" disabled={importMutation.isPending} onClick={() => importMutation.mutate()} aria-label="Import" title="Crea le flashcard dagli appunti AI delle lezioni">
                  <Upload className="h-3 w-3 mr-1" />
                  Import
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 grid-cols-3">
                <Card className="p-4 text-center">
                  <p className="text-3xl font-bold">{flashcardStats?.totale ?? "—"}</p>
                  <p className="text-sm text-neutral-500 dark:text-neutral-400">Totali</p>
                </Card>
                <Card className="p-4 text-center">
                  <p className="text-3xl font-bold text-warning-600 dark:text-warning-400">{flashcardStats?.ripassate_oggi ?? "—"}</p>
                  <p className="text-sm text-neutral-500 dark:text-neutral-400">Ripassate oggi</p>
                </Card>
                <Card className="p-4 text-center">
                  <p className="text-3xl font-bold text-accent-600 dark:text-accent-400">{flashcardStats?.da_ripassare ?? "—"}</p>
                  <p className="text-sm text-neutral-500 dark:text-neutral-400">Da rivedere oggi</p>
                </Card>
              </div>
              <div className="mt-4">
                <Button className="gap-2" onClick={() => navigate("/lab?tab=flashcard&course=" + courseId)}>
                  <Play className="h-4 w-4" />
                  Ripassa ora
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {activePlayer && (
        <VideoPlayer
          key={`${activePlayer.id}:${activePlayer.t}`}
          lectureId={activePlayer.id}
          lectureTitle={activePlayer.title}
          initialTime={activePlayer.t}
          onClose={closePlayer}
          onQuickNote={(seconds) => {
            setPlayerLecture(null)
            navigate(`/quaderno?nuova=1&corso=${courseId}&lezione=${activePlayer.id}&t=${seconds}`)
          }}
        />
      )}
    </div>
  )
}
