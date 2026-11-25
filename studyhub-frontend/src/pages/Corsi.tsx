import { useQuery } from "@tanstack/react-query"
import { Link, useSearchParams } from "react-router-dom"
import { ChevronRight, BookOpen, Award, TrendingUp, Archive, Layers, Loader2, History } from "lucide-react"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { ReadinessBadge } from "@/components/study/ReadinessBadge"
import { api } from "@/lib/api"
import { processedMaterial, readinessInfo } from "@/lib/readiness"
import { courseStage, filterCourses, parseCourseFilter, STAGE_LABEL, type CourseFilter as Filter } from "@/lib/courses"
import type { Course, StudyCourseOverview } from "@/types"
import { cn } from "@/lib/utils"

const FILTERS: Array<{ id: Filter; label: string; icon: typeof BookOpen }> = [
  { id: "seguo", label: "Da seguire", icon: BookOpen },
  { id: "arretrati", label: "Arretrati", icon: History },
  { id: "altri", label: "Futuri e archivio", icon: Archive },
  { id: "superati", label: "Superati", icon: Award },
  { id: "tutti", label: "Tutti", icon: Layers },
]

export function Corsi() {
  const [searchParams, setSearchParams] = useSearchParams()
  const filter: Filter = parseCourseFilter(searchParams.get("filtro"))

  const { data: courses = [], isLoading } = useQuery<Course[]>({ queryKey: ["courses"], queryFn: api.getCourses })
  const { data: studyCourses = [] } = useQuery<StudyCourseOverview[]>({ queryKey: ["studyCourses"], queryFn: api.getStudyCourses })
  const studyById = new Map(studyCourses.map((s) => [s.id, s]))
  const daysToExam = new Map(studyCourses.map((s) => [s.id, s.exam?.days_left ?? null]))

  const counts = Object.fromEntries(FILTERS.map((f) => [f.id, filterCourses(courses, f.id).length])) as Record<Filter, number>
  const visible = filterCourses(courses, filter, daysToExam)

  const setFilter = (f: Filter) => {
    const next = new URLSearchParams(searchParams)
    if (f === "seguo") next.delete("filtro")
    else next.set("filtro", f)
    setSearchParams(next, { replace: true })
  }

  return (
    <div className="space-y-6 min-w-0">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-neutral-950 dark:text-neutral-50">Corsi</h1>
        <p className="text-neutral-500 dark:text-neutral-400 mt-1">
          {counts.seguo} da seguire · {counts.arretrati} arretrati · lo stato viene da corsi.yaml
        </p>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filtra i corsi">
        {FILTERS.map((f) => (
          <Button
            key={f.id}
            variant={filter === f.id ? "default" : "outline"}
            size="sm"
            className="gap-1"
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}
          >
            <f.icon className="h-3 w-3" />
            {f.label} ({counts[f.id]})
          </Button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-accent-500" /></div>
      ) : visible.length === 0 ? (
        <Card className="text-center py-12">
          <CardContent>
            <BookOpen className="h-12 w-12 mx-auto text-neutral-300 dark:text-neutral-600 mb-4" />
            <p className="text-neutral-500 dark:text-neutral-400">Nessun corso in questo elenco.</p>
            {courses.length === 0 && <Button asChild className="mt-4"><Link to="/benvenuto">Configura i corsi</Link></Button>}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visible.map((course) => {
            const study = studyById.get(course.id)
            const info = readinessInfo(study)
            const material = processedMaterial(course)
            const exam = study?.exam
            const stage = courseStage(course)
            return (
              <Link key={course.id} to={`/corsi/${course.id}`} className="block min-w-0">
                <Card className={cn(
                  "h-full overflow-hidden transition-all cursor-pointer",
                  "hover:border-accent-300 hover:shadow-lg dark:hover:border-accent-700",
                  (course.passed || stage === "archivio" || stage === "futuro") && "bg-neutral-50/50 dark:bg-neutral-900/50"
                )}>
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-accent-100 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300">
                            {course.year_of_study ? `${course.year_of_study}° anno` : "Anno n.d."}
                          </span>
                          {course.passed
                            ? <Badge variant="success" className="gap-1"><Award className="h-3 w-3" />Superato</Badge>
                            : <Badge variant={stage === "corrente" ? "accent" : "outline"}>{STAGE_LABEL[stage]}</Badge>}
                        </div>
                        <h3 className="font-semibold text-lg break-words line-clamp-2">{course.fullname}</h3>
                      </div>
                      {!course.passed && study && <ReadinessBadge info={info} className="shrink-0" />}
                    </div>
                  </CardHeader>
                  <Separator />
                  <CardContent className="pt-4 space-y-3">
                    {!course.passed && study && (
                      <>
                        <Progress value={info.reliable ? info.pct ?? 0 : 0} className="h-1.5" aria-label="Prontezza" />
                        <p className="text-xs text-neutral-500 dark:text-neutral-400 line-clamp-2">{info.hint}</p>
                      </>
                    )}
                    <div className="flex items-center justify-between gap-2 text-xs text-neutral-500 dark:text-neutral-400">
                      <span className="truncate">
                        {exam?.days_left != null ? `Appello tra ${exam.days_left} giorni` : "Nessun appello in calendario"}
                      </span>
                      {course.priority > 0 && (
                        <span className="flex items-center gap-1 shrink-0"><TrendingUp className="h-3 w-3" />Prioritario</span>
                      )}
                    </div>
                    <div className="flex items-center justify-between pt-2 border-t border-neutral-100 dark:border-neutral-800 text-xs">
                      <span className="text-neutral-500 dark:text-neutral-400" title="Lezioni con audio o trascrizione">
                        Materiale {material.done}/{material.total}
                      </span>
                      <span className="flex items-center gap-1 text-sm font-medium text-accent-600 dark:text-accent-400">
                        Apri <ChevronRight className="h-4 w-4" />
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
