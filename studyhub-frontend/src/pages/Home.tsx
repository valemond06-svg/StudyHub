import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate } from "react-router-dom"
import { Flame, Award, BookOpen, TrendingUp, AlertCircle, ChevronRight, Loader2, RefreshCw, CheckCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { AIPanelWidget } from "@/components/home/AIPanelWidget"
import { AIAlerts } from "@/components/home/AIAlerts"
import { OggiStudy } from "@/components/home/OggiStudy"
import { api } from "@/lib/api"
import { summarizeAIProblems } from "@/lib/ai-health"
import { averageReadiness, MIN_TRIED_ITEMS, processedMaterial, readinessInfo, READY_THRESHOLD } from "@/lib/readiness"
import { filterCourses } from "@/lib/courses"
import { ReadinessBadge } from "@/components/study/ReadinessBadge"
import { dedupeNotifications } from "@/lib/notifications"
import type { AIStatusResponse, Course, PlanData, NotificationItem, StudyCourseOverview, AIPanelData, SetupStatus } from "@/types"
import { cn, safeFormatDistance } from "@/lib/utils"

function getLevelInfo(totalXP: number) {
  // Formula progressiva: 1 livello ogni 500 XP
  const level = Math.floor(totalXP / 500) + 1
  const xpInLevel = totalXP % 500
  const progress = Math.round((xpInLevel / 500) * 100)

  let label = "Matricola"
  if (level === 2) label = "Apprendista"
  else if (level === 3) label = "Costante"
  else if (level === 4) label = "Esperto"
  else if (level === 5) label = "Veterano"
  else if (level >= 6) label = "Maestro"

  return { level, progress, label, xpInLevel }
}

export function Home() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const {
    data: courses = [],
    isPending: coursesLoading,
    isError: coursesError,
    refetch: refetchCourses,
  } = useQuery<Course[]>({ queryKey: ["courses"], queryFn: api.getCourses })

  const {
    data: studyCourses = [],
    isPending: studyCoursesLoading,
    refetch: refetchStudyCourses,
  } = useQuery<StudyCourseOverview[]>({
    queryKey: ["studyCourses"],
    queryFn: api.getStudyCourses,
  })

  const {
    data: plan,
    isPending: planLoading,
    isError: planError,
    refetch: refetchPlan,
  } = useQuery<PlanData>({ queryKey: ["plan"], queryFn: api.getPlan })

  const {
    data: notifications = [],
    isPending: notificationsLoading,
  } = useQuery<NotificationItem[]>({
    queryKey: ["notifications"],
    queryFn: api.getNotifications,
  })

  const {
    data: aiPanel,
    isPending: aiPanelLoading,
    isFetching: aiPanelFetching,
    refetch: refetchAIPanel,
  } = useQuery<AIPanelData>({
    queryKey: ["aiPanel"],
    queryFn: api.getAIPanel,
    refetchInterval: 30_000,
  })

  const { data: aiStatus } = useQuery<AIStatusResponse>({
    queryKey: ["aiStatus"],
    queryFn: api.getAIStatus,
    refetchInterval: 60_000,
  })
  const aiProblems = summarizeAIProblems(aiStatus, aiPanel)
  const { data: setup } = useQuery<SetupStatus>({ queryKey: ["setup"], queryFn: api.getSetupStatus, staleTime: 5 * 60_000 })

  const markRead = useMutation({
    mutationFn: api.markNotificationsRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  })

  const loading = coursesLoading || planLoading || notificationsLoading || studyCoursesLoading
  const hasError = coursesError || planError

  // Metriche Gamification reali dai corsi attivi
  const totalXP = studyCourses.reduce((sum, c) => sum + (c.xp_total || 0), 0)
  const levelInfo = getLevelInfo(totalXP)
  const currentStreak = studyCourses.length
    ? Math.max(...studyCourses.map((c) => c.streak ?? 0), 0)
    : 0
  const bestStreak = studyCourses.length
    ? Math.max(...studyCourses.map((c) => c.best_streak ?? c.streak ?? 0), currentStreak)
    : 0
  const weekProgress =
    plan?.week_progress?.label ??
    (plan?.week_progress ? `${plan.week_progress.completed}/${plan.week_progress.total}` : "0/7")

  // Corsi da seguire (stato "corrente" in corsi.yaml) con l'appello più vicino in testa; gli arretrati a parte.
  const studyById = new Map(studyCourses.map((s) => [s.id, s]))
  const daysToExam = new Map(studyCourses.map((s) => [s.id, s.exam?.days_left ?? null]))
  const activeCourses = filterCourses(courses, "seguo", daysToExam)
  const backlogCourses = filterCourses(courses, "arretrati", daysToExam)
  const infoById = new Map(courses.map((c) => [c.id, readinessInfo(studyById.get(c.id))]))

  // Prontezza media solo sui corsi con abbastanza risposte: il resto è "dati insufficienti", non 0% e non 100%.
  const reliable = activeCourses.map((c) => infoById.get(c.id)!).filter((i) => i.reliable && i.pct !== null)
  const knownReadiness = reliable.map((i) => i.pct!)
  const avgReadiness = averageReadiness(knownReadiness)
  const readyForExam = knownReadiness.filter((v) => v >= READY_THRESHOLD).length
  const insufficient = activeCourses.length - reliable.length
  const startHere = activeCourses.slice(0, 3)

  // Novità reali da /api/notifications, senza ripetizioni
  const groupedNews = dedupeNotifications(notifications)
  const unreadNews = groupedNews.filter((n) => !n.read)
  const newItems = (unreadNews.length ? unreadNews : groupedNews).slice(0, 5)

  // Collega ogni corso attivo al suo appello (da plan.courses) per la griglia.
  const planCourseByCourseId = new Map((plan?.courses ?? []).map((pc) => [pc.course_id, pc]))
  const courseExamByCourseId = new Map((plan?.exams ?? []).map((e) => [e.course_id, e]))

  const loadingState = loading && (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-accent-500" />
      </div>
  )

  const errorState = hasError && (
      <div className="flex flex-col items-center justify-center h-64 gap-4 text-center">
        <div className="p-3 rounded-full bg-destructive-100 dark:bg-destructive-900/30">
          <AlertCircle className="h-8 w-8 text-destructive-600 dark:text-destructive-400" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-neutral-950 dark:text-neutral-50">Impossibile caricare i dati</h2>
          <p className="text-neutral-500 dark:text-neutral-400 mt-1 max-w-sm">
            Il backend non risponde o è in errore. Controlla che il server StudyHub sia attivo, poi riprova.
          </p>
        </div>
        <Button variant="outline" className="gap-2" onClick={() => { refetchCourses(); refetchStudyCourses(); refetchPlan(); refetchAIPanel(); }}>
          <RefreshCw className="h-4 w-4" />
          Riprova
        </Button>
      </div>
  )

  return (
    <div className="space-y-6">
      {/* Header with stats */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-neutral-950 dark:text-neutral-50">
            Oggi
          </h1>
          {!!activeCourses.length && <p className="text-neutral-500 dark:text-neutral-400 mt-1">
            {activeCourses.length} corsi da seguire{backlogCourses.length ? ` · ${backlogCourses.length} arretrati` : ""} · Prontezza media {avgReadiness === null ? "dati insufficienti" : `${avgReadiness}% su ${reliable.length} corsi misurati`}
          </p>}
        </div>
      </div>

      {setup && !setup.ready && (
        <div role="status" className="flex flex-col gap-2 rounded-xl border border-warning-300 bg-warning-50 p-4 text-sm dark:border-warning-800 dark:bg-warning-900/20 sm:flex-row sm:items-center sm:justify-between">
          <span>L'installazione non è completa: {setup.checks.filter((c) => c.required && !c.ok).map((c) => c.label).join(", ")}.</span>
          <Button size="sm" asChild><Link to="/benvenuto">Completa il primo avvio</Link></Button>
        </div>
      )}

      {!loading && !hasError && startHere.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Da dove partire oggi</CardTitle>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">I corsi che segui adesso, dall'appello più vicino.</p>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {startHere.map((course) => {
                const study = studyById.get(course.id)
                const info = infoById.get(course.id)!
                const days = study?.exam?.days_left
                return (
                  <li key={course.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <Link to={`/corsi/${course.id}`} className="font-medium break-words hover:underline">{course.fullname}</Link>
                      <p className="text-xs text-neutral-500 dark:text-neutral-400">
                        {days != null ? `Appello tra ${days} ${days === 1 ? "giorno" : "giorni"}` : "Nessun appello in calendario"}
                        {info.reliable ? ` · ${info.tried} domande provate` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <ReadinessBadge info={info} />
                      <Button size="sm" asChild><Link to={`/studio/${course.id}?duration=25`}>Allenati 25 min</Link></Button>
                    </div>
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      <OggiStudy />
      {loadingState}
      {errorState}
      {!loading && !hasError && !activeCourses.length && (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Nessun corso da seguire nel catalogo. <Link className="underline" to="/benvenuto">Configura i corsi</Link> o metti <code>stato: corrente</code> in corsi.yaml.
        </p>
      )}
      {!loading && !hasError && activeCourses.length > 0 && <>
      <AIAlerts problems={aiProblems} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Prontezza media</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-4">
              <div className="relative w-24 h-24">
                <svg className="w-full h-full -rotate-90">
                  <circle
                    cx="48"
                    cy="48"
                    r="40"
                    stroke="currentColor"
                    strokeWidth="8"
                    fill="none"
                    className="text-neutral-200 dark:text-neutral-700"
                  />
                  <circle
                    cx="48"
                    cy="48"
                    r="40"
                    stroke="currentColor"
                    strokeWidth="8"
                    strokeDasharray={`${((avgReadiness ?? 0) / 100) * 251.2} 251.2`}
                    strokeLinecap="round"
                    fill="none"
                    className="text-accent-500 transition-all duration-500"
                    style={{ transformOrigin: "center" }}
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className={cn("font-bold text-neutral-950 dark:text-neutral-50 text-center", avgReadiness === null ? "text-xs italic font-normal px-2" : "text-2xl")}>
                    {avgReadiness === null ? "dati insufficienti" : `${avgReadiness}%`}
                  </span>
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-neutral-500 dark:text-neutral-400">Corsi misurati</p>
                <p className="text-xl font-semibold">{reliable.length} di {activeCourses.length}</p>
                <p className="text-sm text-neutral-500 dark:text-neutral-400">Pronti per l'esame</p>
                <p className="text-xl font-semibold text-success-600">{readyForExam}</p>
              </div>
            </div>
            {insufficient > 0 && (
              <p className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">
                {insufficient} {insufficient === 1 ? "corso ha" : "corsi hanno"} meno di {MIN_TRIED_ITEMS} risposte: la loro prontezza non è ancora misurabile.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Flame className={cn("h-5 w-5", currentStreak > 0 ? "text-warning-500" : "text-neutral-400")} />
              Streak
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-4xl font-bold text-neutral-950 dark:text-neutral-50">{currentStreak}</p>
                <p className="text-sm text-neutral-500 dark:text-neutral-400">
                  {currentStreak === 1 ? "giorno consecutivo" : "giorni consecutivi"}
                </p>
              </div>
              <div className="flex items-center gap-1.5 text-warning-500">
                <Flame className={cn("h-6 w-6 transition-all", currentStreak >= 1 ? "text-warning-500" : "text-neutral-300 dark:text-neutral-700")} />
                <Flame className={cn("h-6 w-6 transition-all", currentStreak >= 3 ? "text-warning-500" : "text-neutral-300 dark:text-neutral-700")} />
                <Flame className={cn("h-6 w-6 transition-all", currentStreak >= 7 ? "text-warning-500 animate-pulse" : "text-neutral-300 dark:text-neutral-700")} />
              </div>
            </div>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-2 text-center">
              Miglior streak: {bestStreak} {bestStreak === 1 ? "giorno" : "giorni"} · Questa settimana: {weekProgress}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Award className="h-5 w-5 text-success-500" />
              Livello
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-medium">Livello {levelInfo.level}</span>
                <Badge variant="success">
                  {levelInfo.level === 1 && totalXP === 0 ? "Livello 1 - Matricola" : levelInfo.label}
                </Badge>
              </div>
              <Progress value={levelInfo.progress} className="h-2" />
              <p className="text-xs text-neutral-500 dark:text-neutral-400 text-center">
                {levelInfo.progress}% al Livello {levelInfo.level + 1} · {totalXP.toLocaleString("it-IT")} XP totali
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Coda AI & Turno di Notte Widget */}
      <AIPanelWidget
        data={aiPanel}
        isLoading={aiPanelLoading}
        isFetching={aiPanelFetching}
        onRefresh={() => refetchAIPanel()}
      />

      {/* Novità (reali da /api/notifications) */}
      {newItems.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <BookOpen className="h-5 w-5" />
                Novità
              </span>
              <span className="flex items-center gap-2">
                <Badge variant="outline">{unreadNews.length} da leggere</Badge>
                {unreadNews.length > 0 && (
                  <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" disabled={markRead.isPending} onClick={() => markRead.mutate()}>
                    <CheckCheck className="h-3.5 w-3.5" />
                    Segna come lette
                  </Button>
                )}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div>
              <div className="space-y-2">
                {newItems.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    disabled={!item.course_id}
                    onClick={() => item.course_id && navigate(`/corsi/${item.course_id}`)}
                    className={cn(
                      "w-full text-left flex items-start gap-3 p-3 rounded-lg transition-colors min-w-0",
                      "hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:hover:bg-transparent disabled:cursor-default"
                    )}
                  >
                    <div className="p-2 rounded-lg bg-accent-100 dark:bg-accent-900/30 shrink-0">
                      <BookOpen className="h-5 w-5 text-accent-600 dark:text-accent-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{item.title}{item.count > 1 ? ` (${item.count})` : ""}</p>
                      {item.body && (
                        <p className="text-sm text-neutral-500 dark:text-neutral-400 line-clamp-2">{item.body}</p>
                      )}
                      <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-0.5">
                        {item.course ? `${item.course} · ` : ""}
                        {safeFormatDistance(item.created_at)}
                      </p>
                    </div>
                    {item.course_id ? <ChevronRight className="h-4 w-4 text-neutral-400 shrink-0" /> : null}
                  </button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Corsi attivi */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <BookOpen className="h-5 w-5" />
              Corsi da seguire
            </span>
            <Badge variant="outline">{activeCourses.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {activeCourses.length === 0 ? (
            <p className="text-neutral-500 dark:text-neutral-400 text-center py-4">Nessun corso da seguire.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {activeCourses.map((course) => {
                const info = infoById.get(course.id)!
                const material = processedMaterial(course)
                const exam = courseExamByCourseId.get(course.id)
                const planCourse = planCourseByCourseId.get(course.id)
                return (
                  <button
                    type="button"
                    key={course.id}
                    className={cn(
                      "w-full min-w-0 text-left p-4 rounded-lg border transition-all",
                      "hover:border-accent-300 hover:shadow-md dark:hover:border-accent-700"
                    )}
                    onClick={() => navigate(`/corsi/${course.id}`)}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{course.fullname}</p>
                        <p className="text-sm text-neutral-500 dark:text-neutral-400 truncate">
                          {course.year_of_study ? `${course.year_of_study}° anno` : "Anno n.d."}
                          {planCourse?.days_left != null && ` · appello tra ${planCourse.days_left} giorni`}
                        </p>
                      </div>
                      <ReadinessBadge info={info} />
                    </div>
                    <Separator className="my-3" />
                    <div className="flex items-center justify-between">
                      <Progress value={info.reliable ? info.pct ?? 0 : 0} className="flex-1 h-1.5" />
                      {material.total > 0 && (
                        <span className="ml-3 text-xs text-neutral-500 dark:text-neutral-400 whitespace-nowrap" title="Lezioni con audio o trascrizione">
                          materiale {material.done}/{material.total}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-3 text-xs text-neutral-500 dark:text-neutral-400">
                      <TrendingUp className="h-3 w-3 shrink-0" />
                      <span className="truncate">
                        {exam ? `Appello ${safeFormatDistance(exam.date)}` : "Nessun appello in calendario"}
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
          {backlogCourses.length > 0 && (
            <div className="mt-5 border-t border-neutral-100 pt-4 dark:border-neutral-800">
              <h3 className="mb-2 text-sm font-medium text-neutral-500 dark:text-neutral-400">Arretrati (in secondo piano)</h3>
              <ul className="space-y-1 text-sm">
                {backlogCourses.map((course) => (
                  <li key={course.id} className="flex items-center justify-between gap-2">
                    <Link to={`/corsi/${course.id}`} className="min-w-0 truncate hover:underline">{course.fullname}</Link>
                    <ReadinessBadge info={infoById.get(course.id)!} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
      </>}
    </div>
  )
}
