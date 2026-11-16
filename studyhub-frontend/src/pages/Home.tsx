import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"
import { Plus, Clock, Flame, Target, BookOpen, Award, TrendingUp, AlertCircle, ChevronRight, Zap } from "lucide-react"
import { formatDistanceToNow, parseISO } from "date-fns"
import { it } from "date-fns/locale"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { ScrollArea } from "@/components/ui/scroll-area"
import { api } from "@/lib/api"
import type { Course, Exam, FeedData, PlanData } from "@/types"
import { cn } from "@/lib/utils"

export function Home() {
  const navigate = useNavigate()
  const { data: courses = [] } = useQuery<Course[]>({ queryKey: ["courses"], queryFn: api.getCourses })
  const { data: exams = [] } = useQuery<Exam[]>({ queryKey: ["exams"], queryFn: api.getExams })
  const { data: feed } = useQuery<FeedData>({ queryKey: ["feed"], queryFn: api.getFeed })
  const { data: plan } = useQuery<PlanData>({ queryKey: ["plan"], queryFn: api.getPlan })

  const activeCourses = courses.filter((c: Course) => !c.passed && c.priority > 0).sort((a: Course, b: Course) => b.priority - a.priority)
  const upcomingExams = exams
    .filter((e: Exam) => e.date && new Date(e.date) > new Date())
    .sort((a: Exam, b: Exam) => new Date(a.date!).getTime() - new Date(b.date!).getTime())
    .slice(0, 3)

  const totalReadiness = activeCourses.reduce((sum: number, c: Course) => sum + (c.readiness || 0), 0)
  const avgReadiness = activeCourses.length ? Math.round(totalReadiness / activeCourses.length) : 0

  return (
    <div className="space-y-6">
      {/* Header with stats */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-neutral-950 dark:text-neutral-50">
            Oggi
          </h1>
          <p className="text-neutral-500 dark:text-neutral-400 mt-1">
            {activeCourses.length} corsi attivi · Prontezza media {avgReadiness}%
          </p>
        </div>
        <Button onClick={() => navigate("/corsi")} className="gap-2">
          <Plus className="h-4 w-4" />
          Nuovo corso
        </Button>
      </div>

      {/* Readiness + Next Exam */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
                    strokeDasharray={`${(avgReadiness / 100) * 251.2} 251.2`}
                    strokeLinecap="round"
                    fill="none"
                    className="text-accent-500 transition-all duration-500"
                    style={{ transformOrigin: "center" }}
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-3xl font-bold text-neutral-950 dark:text-neutral-50">{avgReadiness}%</span>
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-neutral-500 dark:text-neutral-400">Corsi attivi</p>
                <p className="text-xl font-semibold">{activeCourses.length}</p>
                <p className="text-sm text-neutral-500 dark:text-neutral-400">Pronti per l'esame</p>
                <p className="text-xl font-semibold text-success-600">
                  {activeCourses.filter((c) => (c.readiness || 0) >= 80).length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Clock className="h-5 w-5 text-accent-500" />
              Prossimo appello
            </CardTitle>
          </CardHeader>
          <CardContent>
            {upcomingExams[0] ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">{upcomingExams[0].course}</p>
                    <p className="text-sm text-neutral-500 dark:text-neutral-400">
                      {formatDistanceToNow(parseISO(upcomingExams[0].date!), { addSuffix: true, locale: it })}
                    </p>
                  </div>
                  <Badge variant="accent">
                    {Math.ceil((new Date(upcomingExams[0].date!).getTime() - Date.now()) / (1000 * 60 * 60 * 24))} giorni
                  </Badge>
                </div>
                <Button
                  variant="outline"
                  className="w-full justify-start gap-2"
                  onClick={() => navigate(`/corsi/${upcomingExams[0].course_id}`)}
                >
                  <Target className="h-4 w-4" />
                  Vai al corso
                </Button>
              </div>
            ) : (
              <p className="text-neutral-500 dark:text-neutral-400 text-center py-4">Nessun appello programmato</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Flame className="h-5 w-5 text-warning-500" />
              Streak
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="text-center">
                <p className="text-4xl font-bold text-neutral-950 dark:text-neutral-50">12</p>
                <p className="text-sm text-neutral-500 dark:text-neutral-400">giorni consecutivi</p>
              </div>
              <div className="flex items-center gap-2 text-warning-500">
                <Flame className="h-6 w-6" />
                <Flame className="h-6 w-6" />
                <Flame className="h-6 w-6" />
              </div>
            </div>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-2 text-center">
              Miglior streak: 28 giorni · Questa settimana: 5/7
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
                <span className="font-medium">Livello 3</span>
                <Badge variant="success">Studente Costante</Badge>
              </div>
              <Progress value={65} className="h-2" />
              <p className="text-xs text-neutral-500 dark:text-neutral-400 text-center">
                65% al Livello 4 · 1.240 XP totali
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Sessione consigliata */}
      {plan?.recommended_session && (
        <Card className="border-accent-200 bg-accent-50/50 dark:border-accent-900/30 dark:bg-accent-950/20">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-accent-500" />
                Sessione consigliata
              </CardTitle>
              <Badge variant="accent">{plan.recommended_session.duration} min</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-neutral-600 dark:text-neutral-300">
              {plan.recommended_session.reason}
            </p>
            <div className="flex flex-wrap gap-2">
              {plan.recommended_session.activities.map((act: any) => (
                <Badge key={act.type} variant="outline" className="gap-1">
                  {act.icon} {act.label}
                </Badge>
              ))}
            </div>
            <Button
              className="w-full"
              onClick={() => plan.recommended_session && navigate(`/studio/${plan.recommended_session.course_id}`)}
              size="lg"
            >
              Inizia sessione {plan.recommended_session.duration} min
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Ripassi scaduti */}
      {(feed?.due_flashcards && feed.due_flashcards > 0) && (
        <Card className="border-warning-200 bg-warning-50/50 dark:border-warning-900/30 dark:bg-warning-950/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-warning-500" />
              Ripassi in scadenza
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between">
            <div>
              <p className="text-2xl font-bold text-warning-600 dark:text-warning-400">{feed.due_flashcards}</p>
              <p className="text-sm text-neutral-500 dark:text-neutral-400">flashcard stanno per sfuggirti</p>
            </div>
            <Button onClick={() => navigate("/lab?tab=flashcard")}>
              Ripassa ora
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Novità Moodle */}
      {(feed?.new_items && feed.new_items.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <BookOpen className="h-5 w-5" />
                Novità da Moodle
              </span>
              <Badge variant="outline">{feed.new_items.length} elementi</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="max-h-64">
              <div className="space-y-3">
                {feed.new_items.slice(0, 5).map((item: any) => (
                  <div
                    key={item.id}
                    className={cn(
                      "flex items-center gap-3 p-3 rounded-lg transition-colors",
                      "hover:bg-neutral-100 dark:hover:bg-neutral-800"
                    )}
                  >
                    <div className="p-2 rounded-lg bg-accent-100 dark:bg-accent-900/30">
                      <item.icon className="h-5 w-5 text-accent-600 dark:text-accent-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{item.title}</p>
                      <p className="text-sm text-neutral-500 dark:text-neutral-400 truncate">
                        {item.course} · {formatDistanceToNow(parseISO(item.date), { addSuffix: true, locale: it })}
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-neutral-400" />
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* Corsi attivi */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <BookOpen className="h-5 w-5" />
              Corsi attivi
            </span>
            <Badge variant="outline">{activeCourses.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {activeCourses.map((course) => (
              <div
                key={course.id}
                className={cn(
                  "p-4 rounded-lg border transition-all",
                  "hover:border-accent-300 hover:shadow-md dark:hover:border-accent-700"
                )}
                onClick={() => navigate(`/corsi/${course.id}`)}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{course.fullname}</p>
                    <p className="text-sm text-neutral-500 dark:text-neutral-400 truncate">
                      {course.shortname} · {course.semester}° semestre
                    </p>
                  </div>
                  <Badge variant={(course.readiness || 0) >= 80 ? "success" : (course.readiness || 0) >= 50 ? "warning" : "default"}>
                    {(course.readiness || 0)}%
                  </Badge>
                </div>
                <Separator className="my-3" />
                <div className="flex items-center justify-between">
                  <Progress value={course.readiness || 0} className="flex-1 h-1.5" />
                  {course.next_exam_date && (
                    <span className="ml-3 text-xs text-neutral-500 dark:text-neutral-400">
                      Esame: {formatDistanceToNow(parseISO(course.next_exam_date), { addSuffix: true, locale: it })}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-3 text-xs text-neutral-500 dark:text-neutral-400">
                  <TrendingUp className="h-3 w-3" />
                  <span>Prossimo: {plan?.next_topic?.[course.id]?.name || "—"}</span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}