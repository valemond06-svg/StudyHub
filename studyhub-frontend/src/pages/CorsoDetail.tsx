import { useParams, useNavigate } from "react-router-dom"
import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowLeft, Play, BookOpen, FlaskConical, HelpCircle, Target, Zap, Settings, Download, Upload, Edit, Plus, ListMusic, Image as ImageIcon, Brain, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
import { VideoPlayer } from "@/components/player/VideoPlayer"
import { MathMarkdown } from "@/components/ui/math-markdown"
import { api } from "@/lib/api"
import type { Course, Lecture, Exam, ExamProfile, Simulation, PlanData, StudyTopic } from "@/types"
import { cn, safeFormatDistance } from "@/lib/utils"

export function CorsoDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const courseId = Number(id)

  const [playerLecture, setPlayerLecture] = useState<Lecture | null>(null)
  const [isCreatingSim, setIsCreatingSim] = useState(false)

  const handleCreateSim = async () => {
    try {
      setIsCreatingSim(true)
      const res = await api.generateSimulations(courseId, 1)
      if (res?.id) {
        navigate(`/simulazione/${res.id}`)
      } else {
        await queryClient.invalidateQueries({ queryKey: ["examProfile", courseId] })
      }
    } catch (err: any) {
      alert(err?.message || "Errore nella generazione della simulazione")
    } finally {
      setIsCreatingSim(false)
    }
  }

  const { data: course, isLoading: courseLoading, isError: courseError, refetch: refetchCourse } = useQuery<Course>({
    queryKey: ["course", courseId],
    queryFn: () => api.getCourse(courseId),
    enabled: !!courseId,
  })

  const { data: lectures = [] } = useQuery<Lecture[]>({
    queryKey: ["lectures", courseId],
    queryFn: () => api.getCourseLectures(courseId),
    enabled: !!courseId,
  })

  const { data: courseExam } = useQuery<{ profile: ExamProfile | null; profile_md: string | null; sims: Simulation[] }>({
    queryKey: ["examProfile", courseId],
    queryFn: () => api.getCourseExam(courseId),
    enabled: !!courseId,
  })
  const examProfile = courseExam?.profile ?? null
  const simulations = courseExam?.sims ?? []
  const profileMutation = useMutation({
    mutationFn: (force: boolean) => api.generateExamProfile(courseId, force),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["examProfile", courseId] }),
  })

  const examProfileRaw = (courseExam?.profile as any) ?? null
  const examMarkdown = courseExam?.profile_md || examProfileRaw?.sintesi_md || null

  const examParts: any[] = (examProfileRaw?.parts || examProfileRaw?.formato?.parti || []).map((p: any) => ({
    name: p.name || p.nome || "Parte",
    points: p.points ?? p.punti ?? null,
    minimum: p.minimum ?? p.minimo ?? null,
    weight: p.weight ?? p.peso ?? null,
    description: p.description ?? p.descrizione ?? "",
  }))

  const examTopics: any[] = (examProfileRaw?.topics || examProfileRaw?.argomenti || []).map((t: any) => ({
    name: t.name || t.nome || "Argomento",
    frequency: t.frequency || t.frequenza || "Standard",
    weight: t.weight || t.peso || null,
    notes: t.notes || t.note || "",
  }))

  const examExercises: any[] = (examProfileRaw?.exercises || examProfileRaw?.esercizi_tipo || []).map((e: any) => ({
    type: e.type || e.tipo || "Esercizio",
    method: e.method || e.metodo_risolutivo || "",
    common_errors: Array.isArray(e.common_errors) ? e.common_errors : (Array.isArray(e.errori_tipici) ? e.errori_tipici : []),
  }))

  const examTheory: string[] = Array.isArray(examProfileRaw?.theory) 
    ? examProfileRaw.theory 
    : (Array.isArray(examProfileRaw?.teoria_richiesta) ? examProfileRaw.teoria_richiesta : [])

  const examAdvice: string[] = Array.isArray(examProfileRaw?.advice)
    ? examProfileRaw.advice
    : Array.isArray(examProfileRaw?.consigli)
      ? examProfileRaw.consigli
      : (typeof examProfileRaw?.consigli === "object" && examProfileRaw?.consigli !== null)
        ? [
            ...(Array.isArray(examProfileRaw.consigli.studio) ? examProfileRaw.consigli.studio : []),
            ...(examProfileRaw.consigli.tempo ? [examProfileRaw.consigli.tempo] : []),
            ...(Array.isArray(examProfileRaw.consigli.verifiche) ? examProfileRaw.consigli.verifiche : []),
          ]
        : []

  // Study overview: topics, mastery, streak, XP (real data from /api/study/{id})
  const { data: studyData } = useQuery<any>({
    queryKey: ["study", courseId],
    queryFn: () => api.getStudyCourseStats(courseId),
    enabled: !!courseId,
  })

  // Chapters with real mastery (from /api/study/{id}/chapters)
  const { data: chapters = [] } = useQuery<{ name: string; topics: number; weight: number; mastery: number; mastery_exam: number }[]>({
    queryKey: ["studyChapters", courseId],
    queryFn: () => api.getStudyChapters(courseId),
    enabled: !!courseId,
  })

  // Flashcard stats for this course (from /api/flashcards/stats)
  const { data: flashcardStats } = useQuery<any>({
    queryKey: ["flashcardStats", courseId],
    queryFn: () => api.getFlashcardStats(courseId),
    enabled: !!courseId,
  })
  const importMutation = useMutation({
    mutationFn: () => api.importFlashcards(courseId),
    onSuccess: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: ["flashcardStats"] }),
      queryClient.invalidateQueries({ queryKey: ["flashcards-due"] }),
    ]),
  })
  const exportMutation = useMutation({ mutationFn: () => api.exportAnki(courseId) })

  // Exams: get from plan or use the course_exam endpoint which might have it
  const { data: plan } = useQuery<PlanData>({
    queryKey: ["plan"],
    queryFn: api.getPlan,
    enabled: !!courseId,
  })
  const exams = (plan?.exams ?? []).filter((e: Exam) => e.course_id === courseId)

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
        <p className="text-neutral-600 dark:text-neutral-400">Impossibile caricare il corso #{courseId}.</p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate("/corsi")}>Torna ai corsi</Button>
          <Button onClick={() => refetchCourse()}>Riprova</Button>
        </div>
      </div>
    )
  }

  const upcomingExams = exams
    .filter((e: Exam) => e.date && new Date(e.date) > new Date())
    .sort((a: Exam, b: Exam) => new Date(a.date!).getTime() - new Date(b.date!).getTime())

  const lecturesByStatus = {
    nuova: lectures.filter(l => l.status === "nuova"),
    media_ok: lectures.filter(l => l.status === "media_ok"),
    trascritta: lectures.filter(l => l.status === "trascritta"),
    pronta: lectures.filter(l => l.status === "pronta"),
    errore: lectures.filter(l => l.status === "errore"),
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="flex items-start gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate("/corsi")} aria-label="Indietro">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-accent-100 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300">
                {course.year_of_study}° anno · {course.semester}° semestre
              </span>
              {course.priority > 0 && (
                <Badge variant="accent" className="gap-1">
                  <Target className="h-3 w-3" />
                  Prioritario
                </Badge>
              )}
            </div>
            <h1 className="text-3xl font-semibold tracking-tight text-neutral-950 dark:text-neutral-50">
              {course.fullname}
            </h1>
            <p className="text-neutral-500 dark:text-neutral-400 mt-1">{course.shortname}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:ml-auto">
          <Button variant="outline" className="gap-1">
            <Download className="h-4 w-4" />
            Export
          </Button>
          <Button variant="outline" className="gap-1">
            <Settings className="h-4 w-4" />
            Impostazioni
          </Button>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-neutral-500 dark:text-neutral-400">Prontezza</span>
              <Badge variant={(course.readiness || 0) >= 80 ? "success" : (course.readiness || 0) >= 50 ? "warning" : "default"}>
                {(course.readiness || 0)}%
              </Badge>
            </div>
            <Progress value={course.readiness || 0} className="h-2" />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-neutral-500 dark:text-neutral-400">Lezioni pronte</span>
              <span className="font-semibold text-2xl">{lecturesByStatus.pronta.length}</span>
            </div>
            <Progress value={lectures.length ? (lecturesByStatus.pronta.length / lectures.length) * 100 : 0} className="h-1.5" />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-neutral-500 dark:text-neutral-400">Da elaborare</span>
              <span className="font-semibold text-2xl text-warning-600 dark:text-warning-400">
                {lecturesByStatus.nuova.length + lecturesByStatus.media_ok.length + lecturesByStatus.trascritta.length}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-neutral-500 dark:text-neutral-400">Prossimo appello</span>
              {upcomingExams[0] ? (
                <span className="font-semibold">
                  {safeFormatDistance(upcomingExams[0].date)}
                </span>
              ) : (
                <span className="font-semibold text-neutral-500">—</span>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-neutral-500 dark:text-neutral-400">Simulazioni</span>
              <span className="font-semibold text-2xl">{simulations.length}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="studia" className="space-y-4">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="studia">
            <BookOpen className="h-4 w-4 mr-2" />
            Studia
          </TabsTrigger>
          <TabsTrigger value="lezioni">
            <Play className="h-4 w-4 mr-2" />
            Lezioni
          </TabsTrigger>
          <TabsTrigger value="esame">
            <Target className="h-4 w-4 mr-2" />
            Esame
          </TabsTrigger>
          <TabsTrigger value="lab">
            <FlaskConical className="h-4 w-4 mr-2" />
            Lab
          </TabsTrigger>
        </TabsList>

        {/* TAB: STUDIA */}
        <TabsContent value="studia" className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Zap className="h-5 w-5 text-accent-500" />
                  Sessione di studio
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-neutral-600 dark:text-neutral-300">
                Scegli la durata e inizia una sessione guidata: ripasso flashcard → lezione interattiva → pratica → boss finale.
              </p>
              <div className="flex flex-wrap gap-3">
                {[
                  { duration: 25, label: "Pomodoro", desc: "Focus breve, 1 argomento" },
                  { duration: 45, label: "Standard", desc: "Sessione completa bilanciata" },
                  { duration: 90, label: "Deep Work", desc: "Immersione profonda, più argomenti" },
                ].map((opt) => (
                  <Button
                    key={opt.duration}
                    variant="outline"
                    className="flex-1 min-w-[150px] flex-col items-start text-left gap-1 py-4"
                    onClick={() => navigate(`/studio/${courseId}?duration=${opt.duration}`)}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-semibold">{opt.duration} min</span>
                      <Badge variant="outline" className="text-xs">{opt.label}</Badge>
                    </div>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400">{opt.desc}</p>
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Prossimo argomento (reali da /api/study/{id}) */}
          {studyData?.topics?.length ? (
            (() => {
              // Il prossimo argomento è il primo non ancora provato,
              // o quello con padronanza più bassa se tutti sono stati provati.
              const topics: StudyTopic[] = studyData.topics
              const untried = topics.filter(t => !t.tried)
              const next: StudyTopic = untried[0] ?? topics.reduce((min, t) => (t.m ?? 0) < (min.m ?? 0) ? t : min, topics[0])
              if (!next) return null
              return (
                <Card>
                  <CardHeader>
                    <CardTitle>Prossimo argomento da studiare</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="p-4 rounded-lg bg-accent-50 dark:bg-accent-900/20 border border-accent-200 dark:border-accent-800">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-accent-100 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300">
                          {next.chapter || "Senza capitolo"}
                        </span>
                        <Badge variant={!next.tried ? "default" : (next.level ?? 0) >= 3 ? "success" : (next.level ?? 0) >= 2 ? "warning" : "destructive"}>
                          {next.tried ? (next.level_name || "In crescita") : "Mai provato"}
                        </Badge>
                      </div>
                      <h3 className="font-medium text-lg mb-1">{next.name}</h3>
                      <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-3">
                        Padronanza {Math.round((next.m ?? 0) * 100)}% · {next.n_items ?? 0} domande · Peso: {next.weight}/3
                      </p>
                      <Button size="sm" className="gap-1" onClick={() => navigate(`/studio/${courseId}`)}>
                        <Play className="h-3 w-3" />
                        Inizia da qui
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )
            })()
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Prossimo argomento da studiare</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-neutral-500 dark:text-neutral-400">
                  Nessuna domanda in banca. Avvia l'analisi del materiale per generare i contenuti di studio.
                </p>
              </CardContent>
            </Card>
          )}

          {/* Mappa corso (reali da /api/study/{id}/chapters) */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                Mappa del corso
                <Badge variant="outline">{chapters.length} capitoli · {studyData?.topics?.length ?? 0} argomenti</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {chapters.length > 0 ? (
                <ScrollArea className="max-h-96">
                  <div className="space-y-4">
                    {chapters.map((ch) => (
                      <div key={ch.name} className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-neutral-950 dark:text-neutral-50">
                            {ch.name}
                          </span>
                          <div className="flex items-center gap-3 text-sm">
                            <Badge variant={ch.mastery >= 0.7 ? "success" : ch.mastery >= 0.4 ? "warning" : "default"}>
                              {Math.round(ch.mastery * 100)}%
                            </Badge>
                            <span className="text-neutral-500 dark:text-neutral-400">{ch.topics} argomenti</span>
                          </div>
                        </div>
                        <Progress value={Math.round(ch.mastery * 100)} className="h-1.5" />
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              ) : studyData?.topics?.length ? (
                <ScrollArea className="max-h-96">
                  <div className="space-y-3">
                    {studyData.topics.map((t: StudyTopic) => (
                      <div key={t.id} className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-neutral-950 dark:text-neutral-50">{t.name}</span>
                          <div className="flex items-center gap-2 text-xs">
                            <Badge variant={t.tried ? ((t.level ?? 0) >= 3 ? "success" : (t.level ?? 0) >= 2 ? "warning" : "destructive") : "default"}>
                              {t.tried ? (t.level_name || "") : "Mai provato"}
                            </Badge>
                          </div>
                        </div>
                        <Progress value={Math.round((t.m ?? 0) * 100)} className="h-1" />
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              ) : (
                <p className="text-neutral-500 dark:text-neutral-400 text-center py-8">
                  Nessun dato di studio disponibile. Avvia l'analisi del materiale.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB: LEZIONI */}
        <TabsContent value="lezioni" className="space-y-4">
          <div className="flex flex-wrap gap-2 mb-4">
            {[
              { status: "pronta", label: "Pronte", count: lecturesByStatus.pronta.length, color: "success" },
              { status: "trascritta", label: "Trascritte", count: lecturesByStatus.trascritta.length, color: "accent" },
              { status: "media_ok", label: "Media OK", count: lecturesByStatus.media_ok.length, color: "warning" },
              { status: "nuova", label: "Nuove", count: lecturesByStatus.nuova.length, color: "default" },
              { status: "errore", label: "Errori", count: lecturesByStatus.errore.length, color: "destructive" },
            ].map((s) => (
              <Badge key={s.status} variant={s.color as any} className="gap-1">
                {s.label} ({s.count})
              </Badge>
            ))}
          </div>

          <ScrollArea className="h-[calc(100vh-320px)]">
            <div className="space-y-3">
              {[
                { status: "pronta", title: "Pronte per lo studio", items: lecturesByStatus.pronta },
                { status: "trascritta", title: "Trascritte (mancano appunti)", items: lecturesByStatus.trascritta },
                { status: "media_ok", title: "Media pronte (manca trascrizione)", items: lecturesByStatus.media_ok },
                { status: "nuova", title: "Nuove (da scaricare/elaborare)", items: lecturesByStatus.nuova },
                { status: "errore", title: "Errori", items: lecturesByStatus.errore },
              ].map((group) => {
                if (group.items.length === 0) return null
                return (
                  <div key={group.status} className="space-y-2">
                    <h4 className="text-sm font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
                      {group.title}
                    </h4>
                    {group.items.map((lec) => (
                      <Card
                        key={lec.id}
                        className={cn(
                          "transition-shadow cursor-pointer",
                          lec.has_audio
                            ? "hover:shadow-md group"
                            : "hover:shadow-none cursor-default"
                        )}
                        onClick={() => {
                          if (lec.has_audio) setPlayerLecture(lec)
                        }}
                      >
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <Badge
                                  variant={
                                    lec.status === "pronta" ? "success" :
                                    lec.status === "trascritta" ? "accent" :
                                    lec.status === "media_ok" ? "warning" :
                                    lec.status === "nuova" ? "default" : "destructive"
                                  }
                                  className="text-xs"
                                >
                                  {lec.status}
                                </Badge>
                                {lec.has_audio && (
                                  <Badge variant="outline" className="text-xs gap-1">
                                    <ListMusic className="h-2.5 w-2.5" />
                                    Audio
                                  </Badge>
                                )}
                                {lec.has_notes && (
                                  <Badge variant="outline" className="text-xs gap-1">
                                    <BookOpen className="h-2.5 w-2.5" />
                                    Appunti
                                  </Badge>
                                )}
                                {lec.has_slides && (
                                  <Badge variant="outline" className="text-xs gap-1">
                                    <ImageIcon className="h-2.5 w-2.5" />
                                    Slide
                                  </Badge>
                                )}
                              </div>
                              <h4 className="font-medium truncate">{lec.title}</h4>
                              <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
                                {safeFormatDistance(lec.date)} · {Math.round(lec.duration / 60)} min
                              </p>
                            </div>
                            {lec.has_audio && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="opacity-0 group-hover:opacity-100 transition-opacity"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setPlayerLecture(lec)
                                }}
                                aria-label={`Riproduci ${lec.title}`}
                              >
                                <Play className="h-5 w-5" />
                              </Button>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )
              })}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* TAB: ESAME */}
        <TabsContent value="esame" className="space-y-6">
          {/* Profilo esame */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Target className="h-5 w-5" />
                Profilo d'esame
              </CardTitle>
              {examProfile ? (
                <Button variant="outline" size="sm" disabled={profileMutation.isPending} onClick={() => profileMutation.mutate(true)}>
                  <Settings className="h-3 w-3 mr-1" />
                  Rigenera
                </Button>
              ) : (
                <Button disabled={profileMutation.isPending} onClick={() => profileMutation.mutate(false)}>
                  <Plus className="h-4 w-4 mr-1" />
                  Genera profilo
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {profileMutation.isError && <p role="alert">Errore nella generazione del profilo. Riprova.</p>}
              {examProfileRaw ? (
                <div className="space-y-6">
                  {/* Sintesi / Guida Esame Markdown */}
                  {examMarkdown && (
                    <div className="p-4 rounded-lg bg-neutral-50 dark:bg-neutral-900/50 border border-neutral-200 dark:border-neutral-800">
                      <h4 className="font-semibold mb-2 flex items-center gap-2">
                        <BookOpen className="h-4 w-4 text-accent-500" />
                        Sintesi e note d'esame
                      </h4>
                      <div className="max-h-96 overflow-y-auto pr-2 text-sm">
                        <MathMarkdown content={examMarkdown} />
                      </div>
                    </div>
                  )}

                  {/* Parti esame */}
                  {examParts.length > 0 && (
                    <div>
                      <h4 className="font-medium mb-3">Struttura esame</h4>
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {examParts.map((part, i) => (
                          <Card key={i} className="p-4">
                            <div className="flex items-center justify-between mb-2">
                              <span className="font-medium">{part.name}</span>
                              {part.points != null && <Badge variant="accent">{part.points} pt</Badge>}
                            </div>
                            <div className="text-sm text-neutral-500 dark:text-neutral-400 space-y-1">
                              {part.description && <p className="text-xs line-clamp-3">{part.description}</p>}
                              {part.minimum != null && <div>Minimo: {part.minimum}</div>}
                              {part.weight != null && <div>Peso: {part.weight}%</div>}
                            </div>
                          </Card>
                        ))}
                      </div>
                    </div>
                  )}

                  {examParts.length > 0 && examTopics.length > 0 && <Separator />}

                  {/* Argomenti frequenti */}
                  {examTopics.length > 0 && (
                    <div>
                      <h4 className="font-medium mb-3">Argomenti per frequenza</h4>
                      <ScrollArea className="max-h-64">
                        <div className="space-y-2">
                          {examTopics.map((topic, i) => (
                            <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-neutral-50 dark:bg-neutral-900/50">
                              <div className="flex-1 mr-4">
                                <span className="font-medium">{topic.name}</span>
                                {topic.notes && <p className="text-xs text-neutral-400 mt-0.5 line-clamp-1">{topic.notes}</p>}
                              </div>
                              <div className="flex items-center gap-2 text-sm shrink-0">
                                <Badge variant="outline">{topic.frequency}</Badge>
                                {topic.weight != null && <Badge variant="accent">{topic.weight}%</Badge>}
                              </div>
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    </div>
                  )}

                  {examTopics.length > 0 && examExercises.length > 0 && <Separator />}

                  {/* Esercizi tipo */}
                  {examExercises.length > 0 && (
                    <div>
                      <h4 className="font-medium mb-3">Esercizi tipo</h4>
                      <div className="space-y-2">
                        {examExercises.map((ex, i) => (
                          <div key={i} className="p-3 rounded-lg bg-neutral-50 dark:bg-neutral-900/50">
                            <div className="font-medium mb-1">{ex.type}</div>
                            {ex.method && <div className="text-sm text-neutral-600 dark:text-neutral-300 mb-2">Metodo: {ex.method}</div>}
                            {ex.common_errors?.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {ex.common_errors.map((err: string, j: number) => (
                                  <Badge key={j} variant="destructive" className="text-xs">{err}</Badge>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {(examExercises.length > 0 || examTopics.length > 0) && (examTheory.length > 0 || examAdvice.length > 0) && <Separator />}

                  {/* Teoria e consigli */}
                  {(examTheory.length > 0 || examAdvice.length > 0) && (
                    <div className="grid gap-4 sm:grid-cols-2">
                      {examTheory.length > 0 && (
                        <div>
                          <h4 className="font-medium mb-2">Teoria richiesta</h4>
                          <ul className="space-y-1 text-sm text-neutral-600 dark:text-neutral-300">
                            {examTheory.map((t, i) => (
                              <li key={i} className="flex items-center gap-2">
                                <span className="h-1.5 w-1.5 rounded-full bg-accent-500 shrink-0" />
                                <span>{t}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {examAdvice.length > 0 && (
                        <div>
                          <h4 className="font-medium mb-2">Consigli</h4>
                          <ul className="space-y-1 text-sm text-neutral-600 dark:text-neutral-300">
                            {examAdvice.map((a, i) => (
                              <li key={i} className="flex items-start gap-2">
                                <HelpCircle className="h-3 w-3 text-accent-500 shrink-0 mt-1" />
                                <span>{a}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-12">
                  <Target className="h-12 w-12 mx-auto text-neutral-300 dark:text-neutral-600 mb-4" />
                  <h3 className="text-lg font-medium text-neutral-950 dark:text-neutral-50 mb-2">
                    Nessun profilo d'esame
                  </h3>
                  <p className="text-neutral-500 dark:text-neutral-400 mb-6">
                    Genera il profilo analizzando appelli passati e programma del corso
                  </p>
                  <Button disabled={profileMutation.isPending} onClick={() => profileMutation.mutate(false)} className="gap-2">
                    <Plus className="h-4 w-4" />
                    Genera profilo
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Simulazioni */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-accent-500" />
                Simulazioni d'Esame
              </CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCreateSim}
                disabled={isCreatingSim}
                className="gap-1.5"
              >
                {isCreatingSim ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Plus className="h-3.5 w-3.5" />
                )}
                <span>{isCreatingSim ? "Generazione..." : "Nuova simulazione"}</span>
              </Button>
            </CardHeader>
            <CardContent>
              {simulations.length > 0 ? (
                <div className="space-y-3">
                  {simulations.map((sim) => {
                    const simIdStr = String(sim.id)
                    const title = sim.titolo || sim.title || `Simulazione #${simIdStr.slice(0, 8)}`
                    const questionCount = sim.domande?.length || sim.questions?.length || 0
                    const grade = sim.best ?? (sim.score !== undefined ? sim.score : null)
                    const isDone = grade !== null && grade !== undefined

                    return (
                      <Card key={simIdStr} className="p-4 hover:border-neutral-300 dark:hover:border-neutral-700 transition-all">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div>
                            <p className="font-semibold text-neutral-900 dark:text-neutral-100">{title}</p>
                            <p className="text-xs text-neutral-500 dark:text-neutral-400">
                              {isDone ? "Completata" : "Pronta"} · {sim.durata_min || sim.duration_min || 60} min
                              {questionCount > 0 ? ` · ${questionCount} quesiti` : ""}
                            </p>
                          </div>
                          <div className="flex items-center gap-3">
                            {isDone && (
                              <Badge
                                variant={grade >= 18 ? "default" : "destructive"}
                                className={cn(
                                  "text-sm font-mono font-bold px-2.5 py-0.5",
                                  grade >= 18 && "bg-emerald-600 text-white"
                                )}
                              >
                                {grade}/30 {grade >= 18 ? "✓" : "✗"}
                              </Badge>
                            )}
                            <Button
                              size="sm"
                              variant={isDone ? "outline" : "default"}
                              onClick={() => navigate(`/simulazione/${sim.id}`)}
                              className={cn(
                                "text-xs rounded-xl",
                                !isDone && "bg-accent-600 hover:bg-accent-700 text-white"
                              )}
                            >
                              {isDone ? "Rivedi correzione" : "Avvia simulazione"}
                            </Button>
                          </div>
                        </div>
                      </Card>
                    )
                  })}
                </div>
              ) : (
                <div className="text-center py-8 space-y-3">
                  <Zap className="h-10 w-10 mx-auto text-neutral-300 dark:text-neutral-600" />
                  <p className="text-sm text-neutral-500 dark:text-neutral-400">
                    Nessuna simulazione disponibile per questo corso.
                  </p>
                  <Button
                    onClick={handleCreateSim}
                    disabled={isCreatingSim}
                    size="sm"
                    className="gap-1.5"
                  >
                    {isCreatingSim ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Plus className="h-4 w-4" />
                    )}
                    <span>{isCreatingSim ? "Generazione in corso..." : "Genera la prima simulazione"}</span>
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

{/* TAB: LAB */}
        <TabsContent value="lab" className="space-y-6">
          {/* Flashcard (reali da /api/flashcards/stats) */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <FlaskConical className="h-5 w-5" />
                Flashcard (FSRS)
              </CardTitle>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={exportMutation.isPending} onClick={() => exportMutation.mutate()}>
                  <Download className="h-3 w-3 mr-1" />
                  Anki
                </Button>
                <Button variant="outline" size="sm" disabled={importMutation.isPending} onClick={() => importMutation.mutate()}>
                  <Upload className="h-3 w-3 mr-1" />
                  Import
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {importMutation.isError && <p role="alert">Errore nell’importazione delle flashcard. Riprova.</p>}
              {exportMutation.isError && <p role="alert">Errore nel download Anki. Riprova.</p>}
              {flashcardStats ? (
                <div className="grid gap-4 sm:grid-cols-3">
                  <Card className="p-4 text-center">
                    <p className="text-3xl font-bold text-success-600 dark:text-success-400">{flashcardStats.totale - flashcardStats.da_ripassare - (flashcardStats.ripassate_oggi ?? 0)}</p>
                    <p className="text-sm text-neutral-500 dark:text-neutral-400">Mature</p>
                  </Card>
                  <Card className="p-4 text-center">
                    <p className="text-3xl font-bold text-warning-600 dark:text-warning-400">{flashcardStats.ripassate_oggi ?? 0}</p>
                    <p className="text-sm text-neutral-500 dark:text-neutral-400">Ripassate oggi</p>
                  </Card>
                  <Card className="p-4 text-center">
                    <p className="text-3xl font-bold text-accent-600 dark:text-accent-400">{flashcardStats.da_ripassare}</p>
                    <p className="text-sm text-neutral-500 dark:text-neutral-400">Da rivedere oggi</p>
                  </Card>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-3">
                  <Card className="p-4 text-center"><p className="text-3xl font-bold">—</p><p className="text-sm text-neutral-500">Mature</p></Card>
                  <Card className="p-4 text-center"><p className="text-3xl font-bold">—</p><p className="text-sm text-neutral-500">Ripassate oggi</p></Card>
                  <Card className="p-4 text-center"><p className="text-3xl font-bold">—</p><p className="text-sm text-neutral-500">Da rivedere oggi</p></Card>
                </div>
              )}
              <div className="mt-4 flex gap-2">
                <Button className="gap-2" onClick={() => navigate("/lab?tab=flashcard&course=" + courseId)}>
                  <Play className="h-4 w-4" />
                  Ripassa ora
                </Button>
                <Button variant="outline" className="gap-2" onClick={() => navigate("/lab?tab=flashcard&course=" + courseId)}>
                  <BookOpen className="h-4 w-4" />
                  Sfoglia tutte
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Quiz */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <HelpCircle className="h-5 w-5" />
                Quiz adattivi
              </CardTitle>
              <Button variant="outline" size="sm">Genera quiz</Button>
            </CardHeader>
            <CardContent>
              <p className="text-neutral-600 dark:text-neutral-300 mb-4">
                I quiz vengono generati per lezione. Vai alla scheda <strong>Lezioni</strong> per generarne uno.
              </p>
            </CardContent>
          </Card>

          {/* Tutor */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Brain className="h-5 w-5" />
                Tutor RAG
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-neutral-600 dark:text-neutral-300 mb-4">
                Fai domande sul materiale del corso. Il tutor usa ricerca ibrida (BM25 + vettori) e cita le fonti.
              </p>
              <Button variant="outline" className="w-full gap-2" onClick={() => navigate(`/lab?tab=tutor&course=${courseId}`)}>
                <Brain className="h-4 w-4" />
                Apri Tutor
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* VideoPlayer Modal */}
      {playerLecture && (
        <VideoPlayer
          lectureId={playerLecture.id}
          lectureTitle={playerLecture.title}
          onClose={() => setPlayerLecture(null)}
        />
      )}
    </div>
  )
}

