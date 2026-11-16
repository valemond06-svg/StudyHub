import { useParams, useNavigate } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { ArrowLeft, Play, BookOpen, FlaskConical, HelpCircle, Target, Zap, Settings, Download, Upload, Trash2, Edit, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Input } from "@/components/ui/input"
import { api } from "@/lib/api"
import type { Course, Lecture, Exam, ExamProfile, Simulation } from "@/types"
import { cn } from "@/lib/utils"
import { formatDistanceToNow, parseISO } from "date-fns"
import { it } from "date-fns/locale"

export function CorsoDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const courseId = Number(id)

  const { data: course } = useQuery<Course>({
    queryKey: ["course", courseId],
    queryFn: () => api.getCourse(courseId),
    enabled: !!courseId,
  })

  const { data: lectures = [] } = useQuery<Lecture[]>({
    queryKey: ["lectures", courseId],
    queryFn: () => api.getCourseLectures(courseId),
    enabled: !!courseId,
  })

  const { data: examProfile } = useQuery<ExamProfile>({
    queryKey: ["examProfile", courseId],
    queryFn: () => api.getCourseExam(courseId),
    enabled: !!courseId,
  })

  const { data: simulations = [] } = useQuery<Simulation[]>({
    queryKey: ["simulations", courseId],
    queryFn: () => api.getCourseExam(courseId).then((res: any) => res.simulations || []),
    enabled: !!courseId,
  })

  const { data: exams = [] } = useQuery<Exam[]>({
    queryKey: ["exams", courseId],
    queryFn: () => api.getExams().then((res: Exam[]) => res.filter(e => e.course_id === courseId)),
    enabled: !!courseId,
  })

  if (!course) return <div className="flex items-center justify-center h-64">Caricamento...</div>

  const upcomingExams = exams
    .filter((e) => e.date && new Date(e.date) > new Date())
    .sort((a, b) => new Date(a.date!).getTime() - new Date(b.date!).getTime())

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
                  {formatDistanceToNow(parseISO(upcomingExams[0].date!), { addSuffix: true, locale: it })}
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

          {/* Prossimo argomento */}
          <Card>
            <CardHeader>
              <CardTitle>Prossimo argomento da studiare</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="p-4 rounded-lg bg-accent-50 dark:bg-accent-900/20 border border-accent-200 dark:border-accent-800">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-accent-100 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300">
                    Capitolo 1
                  </span>
                  <Badge variant="warning">Fragile</Badge>
                </div>
                <h3 className="font-medium text-lg mb-1">Derivate e applicazioni</h3>
                <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-3">
                  Padronanza 34% · 12 domande non provate · Peso esame: 15%
                </p>
                <Button size="sm" className="gap-1" onClick={() => navigate(`/studio/${courseId}`)}>
                  <Play className="h-3 w-3" />
                  Inizia da qui
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Mappa corso */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                Mappa del corso
                <Badge variant="outline">6 capitoli · 28 argomenti</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="max-h-96">
                <div className="space-y-4">
                  {[
                    { num: 1, name: "Limiti e continuità", topics: 5, mastery: 78, weight: 12 },
                    { num: 2, name: "Derivate e applicazioni", topics: 5, mastery: 34, weight: 15 },
                    { num: 3, name: "Integrali", topics: 4, mastery: 12, weight: 18 },
                    { num: 4, name: "Equazioni differenziali", topics: 4, mastery: 0, weight: 15 },
                    { num: 5, name: "Serie e successioni", topics: 5, mastery: 0, weight: 12 },
                    { num: 6, name: "Funzioni di più variabili", topics: 5, mastery: 0, weight: 18 },
                  ].map((ch) => (
                    <div key={ch.num} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-neutral-950 dark:text-neutral-50">
                          Capitolo {ch.num}: {ch.name}
                        </span>
                        <div className="flex items-center gap-3 text-sm">
                          <Badge variant={ch.mastery >= 70 ? "success" : ch.mastery >= 40 ? "warning" : "default"}>
                            {ch.mastery}%
                          </Badge>
                          <span className="text-neutral-500 dark:text-neutral-400">Peso: {ch.weight}%</span>
                        </div>
                      </div>
                      <Progress value={ch.mastery} className="h-1.5" />
                    </div>
                  ))}
                </div>
              </ScrollArea>
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
                      <Card key={lec.id} className="hover:shadow-md transition-shadow cursor-pointer">
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
                                {lec.has_notes && (
                                  <Badge variant="outline" className="text-xs gap-1">
                                    <BookOpen className="h-2.5 w-2.5" />
                                    Appunti
                                  </Badge>
                                )}
                                {lec.has_slides && (
                                  <Badge variant="outline" className="text-xs gap-1">
                                    <Play className="h-2.5 w-2.5" />
                                    Slide
                                  </Badge>
                                )}
                              </div>
                              <h4 className="font-medium truncate">{lec.title}</h4>
                              <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
                                {formatDistanceToNow(parseISO(lec.date), { addSuffix: true, locale: it })} · {Math.round(lec.duration / 60)} min
                              </p>
                            </div>
                            <Button variant="ghost" size="icon" className="opacity-0 group-hover:opacity-100 transition-opacity">
                              <ArrowLeft className="h-5 w-5" />
                            </Button>
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
                <Button variant="outline" size="sm" onClick={() => api.generateExamProfile(courseId)}>
                  <Settings className="h-3 w-3 mr-1" />
                  Rigenera
                </Button>
              ) : (
                <Button onClick={() => api.generateExamProfile(courseId)}>
                  <Plus className="h-4 w-4 mr-1" />
                  Genera profilo
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {examProfile ? (
                <div className="space-y-6">
                  {/* Parti esame */}
                  <div>
                    <h4 className="font-medium mb-3">Struttura esame</h4>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {examProfile.parts.map((part, i) => (
                        <Card key={i} className="p-4">
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-medium">{part.name}</span>
                            <Badge variant="accent">{part.points} pt</Badge>
                          </div>
                          <div className="text-sm text-neutral-500 dark:text-neutral-400 space-y-1">
                            <div>Minimo: {part.minimum}</div>
                            <div>Peso: {part.weight}%</div>
                          </div>
                        </Card>
                      ))}
                    </div>
                  </div>

                  <Separator />

                  {/* Argomenti frequenti */}
                  <div>
                    <h4 className="font-medium mb-3">Argomenti per frequenza</h4>
                    <ScrollArea className="max-h-64">
                      <div className="space-y-2">
                        {examProfile.topics.map((topic, i) => (
                          <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-neutral-50 dark:bg-neutral-900/50">
                            <span className="font-medium">{topic.name}</span>
                            <div className="flex items-center gap-3 text-sm">
                              <Badge variant="outline">{topic.frequency}</Badge>
                              <Badge variant="accent">{topic.weight}%</Badge>
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </div>

                  <Separator />

                  {/* Esercizi tipo */}
                  <div>
                    <h4 className="font-medium mb-3">Esercizi tipo</h4>
                    <div className="space-y-2">
                      {examProfile.exercises.map((ex, i) => (
                        <div key={i} className="p-3 rounded-lg bg-neutral-50 dark:bg-neutral-900/50">
                          <div className="font-medium mb-1">{ex.type}</div>
                          <div className="text-sm text-neutral-600 dark:text-neutral-300 mb-2">Metodo: {ex.method}</div>
                          <div className="flex flex-wrap gap-1">
                            {ex.common_errors.map((err, j) => (
                              <Badge key={j} variant="destructive" className="text-xs">{err}</Badge>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <Separator />

                  {/* Teoria e consigli */}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <h4 className="font-medium mb-2">Teoria richiesta</h4>
                      <ul className="space-y-1 text-sm text-neutral-600 dark:text-neutral-300">
                        {examProfile.theory.map((t, i) => (
                          <li key={i} className="flex items-center gap-2">
                            <span className="h-1.5 w-1.5 rounded-full bg-accent-500" />
                            {t}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <h4 className="font-medium mb-2">Consigli</h4>
                      <ul className="space-y-1 text-sm text-neutral-600 dark:text-neutral-300">
                        {examProfile.advice.map((a, i) => (
                          <li key={i} className="flex items-center gap-2">
                            <HelpCircle className="h-3 w-3 text-accent-500 flex-shrink-0" />
                            {a}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
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
                  <Button onClick={() => api.generateExamProfile(courseId)} className="gap-2">
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
                <Zap className="h-5 w-5" />
                Simulazioni
              </CardTitle>
              <Button variant="outline" size="sm">
                <Plus className="h-3 w-3 mr-1" />
                Nuova simulazione
              </Button>
            </CardHeader>
            <CardContent>
              {simulations.length > 0 ? (
                <div className="space-y-3">
                  {simulations.map((sim) => (
                    <Card key={sim.id} className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium">Simulazione {sim.id.slice(0, 8)}</p>
                          <p className="text-sm text-neutral-500 dark:text-neutral-400">
                            {sim.completed_at ? "Completata" : "In corso"} · {sim.questions?.length || 0} domande
                          </p>
                        </div>
                        {sim.completed_at && sim.score !== undefined && (
                          <Badge variant={sim.passed ? "success" : "destructive"} className="text-lg px-3 py-1">
                            {sim.score}/30 {sim.passed ? "✓" : "✗"}
                          </Badge>
                        )}
                        {!sim.completed_at && (
                          <Button size="sm" variant="outline">Continua</Button>
                        )}
                      </div>
                    </Card>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <Zap className="h-10 w-10 mx-auto text-neutral-300 dark:text-neutral-600 mb-3" />
                  <p className="text-neutral-500 dark:text-neutral-400">Nessuna simulazione. Crea la prima!</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB: LAB */}
        <TabsContent value="lab" className="space-y-6">
          {/* Flashcard */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <FlaskConical className="h-5 w-5" />
                Flashcard (FSRS)
              </CardTitle>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm">
                  <Download className="h-3 w-3 mr-1" />
                  Anki
                </Button>
                <Button variant="outline" size="sm">
                  <Upload className="h-3 w-3 mr-1" />
                  Import
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-3">
                <Card className="p-4 text-center">
                  <p className="text-3xl font-bold text-success-600 dark:text-success-400">127</p>
                  <p className="text-sm text-neutral-500 dark:text-neutral-400">Mature</p>
                </Card>
                <Card className="p-4 text-center">
                  <p className="text-3xl font-bold text-warning-600 dark:text-warning-400">43</p>
                  <p className="text-sm text-neutral-500 dark:text-neutral-400">In apprendimento</p>
                </Card>
                <Card className="p-4 text-center">
                  <p className="text-3xl font-bold text-accent-600 dark:text-accent-400">18</p>
                  <p className="text-sm text-neutral-500 dark:text-neutral-400">Da rivedere oggi</p>
                </Card>
              </div>
              <div className="mt-4 flex gap-2">
                <Button className="gap-2" onClick={() => navigate("/lab?tab=flashcard&course=" + courseId)}>
                  <Play className="h-4 w-4" />
                  Ripassa ora
                </Button>
                <Button variant="outline" className="gap-2">
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
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {["Richiamo", "Multipla", "Vero/Falso", "Aperta", "Esercizio"].map((type, i) => (
                  <Card key={type} className="p-4 text-center">
                    <p className="text-2xl font-bold text-accent-600 dark:text-accent-400">
                      {Math.floor(Math.random() * 20) + 5}
                    </p>
                    <p className="text-sm text-neutral-500 dark:text-neutral-400">{type}</p>
                  </Card>
                ))}
              </div>
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
    </div>
  )
}

// Missing import
import { Brain } from "lucide-react"