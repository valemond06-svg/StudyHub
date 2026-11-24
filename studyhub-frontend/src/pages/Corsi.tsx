import { useQuery } from "@tanstack/react-query"
import { Link, useNavigate } from "react-router-dom"
import { Plus, Filter, ChevronRight, BookOpen, Award, TrendingUp, Archive } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { Input } from "@/components/ui/input"
import { api } from "@/lib/api"
import type { Course } from "@/types"
import { cn } from "@/lib/utils"

export function Corsi() {
  const navigate = useNavigate()
  const { data: courses = [] } = useQuery<Course[]>({ queryKey: ["courses"], queryFn: api.getCourses })

  const activeCourses = courses.filter((c) => !c.passed).sort((a, b) => b.priority - a.priority)
  const passedCourses = courses.filter((c) => c.passed).sort((a, b) => a.fullname.localeCompare(b.fullname))

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-neutral-950 dark:text-neutral-50">
            Corsi
          </h1>
          <p className="text-neutral-500 dark:text-neutral-400 mt-1">
            {activeCourses.length} attivi · {passedCourses.length} superati
          </p>
        </div>
        <Button onClick={() => navigate("/corsi/nuevo")} className="gap-2">
          <Plus className="h-4 w-4" />
          Aggiungi corso
        </Button>
      </div>

      {/* Filtri */}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" className="gap-1">
          <Filter className="h-3 w-3" />
          Tutti
        </Button>
        <Button variant="default" size="sm" className="gap-1">
          <BookOpen className="h-3 w-3" />
          Attivi ({activeCourses.length})
        </Button>
        <Button variant="outline" size="sm" className="gap-1">
          <Award className="h-3 w-3" />
          Superati ({passedCourses.length})
        </Button>
        <Button variant="outline" size="sm" className="gap-1">
          <Archive className="h-3 w-3" />
          Archiviati
        </Button>
      </div>

      {/* Corsi attivi */}
      {activeCourses.length > 0 && (
        <section>
          <h2 className="text-lg font-medium text-neutral-950 dark:text-neutral-50 mb-4">
            Corsi attivi
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {activeCourses.map((course) => (
              <Link key={course.id} to={`/corsi/${course.id}`}>
                <Card className={cn(
                  "overflow-hidden transition-all cursor-pointer",
                  "hover:border-accent-300 hover:shadow-lg dark:hover:border-accent-700"
                )}>
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-accent-100 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300">
                            {course.year_of_study}° anno
                          </span>
                          <span className="text-xs text-neutral-500 dark:text-neutral-400">
                            {course.semester}° semestre
                          </span>
                        </div>
                        <h3 className="font-semibold text-lg truncate">{course.fullname}</h3>
                        <p className="text-sm text-neutral-500 dark:text-neutral-400 truncate mt-1">
                          {course.shortname}
                        </p>
                      </div>
                      <Badge
                        variant={
                          (course.readiness || 0) >= 80 ? "success" :
                          (course.readiness || 0) >= 50 ? "warning" : "default"
                        }
                        className="whitespace-nowrap"
                      >
                        {(course.readiness || 0)}%
                      </Badge>
                    </div>
                  </CardHeader>
                  <Separator />
                  <CardContent className="pt-4 space-y-3">
                    <Progress value={course.readiness || 0} className="h-1.5" />
                    <div className="flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400">
                      <span>{course.next_exam_date ? `Esame tra ${Math.ceil((new Date(course.next_exam_date).getTime() - Date.now()) / (1000*60*60*24))} giorni` : "Nessun appello"}</span>
                      <span className="flex items-center gap-1">
                        <TrendingUp className="h-3 w-3" />
                        {course.priority > 0 ? "Prioritario" : "Standard"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between pt-2 border-t border-neutral-100 dark:border-neutral-800">
                      <span className="text-sm font-medium text-accent-600 dark:text-accent-400">
                        Apri corso
                      </span>
                      <ChevronRight className="h-4 w-4 text-neutral-400" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Corsi superati */}
      {passedCourses.length > 0 && (
        <section>
          <h2 className="text-lg font-medium text-neutral-950 dark:text-neutral-50 mb-4">
            Corsi superati (Archivio)
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {passedCourses.map((course) => (
              <Card key={course.id} className="border-neutral-200/50 dark:border-neutral-700/50 bg-neutral-50/50 dark:bg-neutral-900/50">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{course.fullname}</p>
                      <p className="text-sm text-neutral-500 dark:text-neutral-400 truncate">
                        {course.shortname} · {course.year_of_study}° anno · Superato
                      </p>
                    </div>
                    <Badge variant="success" className="whitespace-nowrap">
                      <Award className="h-3 w-3 mr-1" />
                      Superato
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {activeCourses.length === 0 && passedCourses.length === 0 && (
        <Card className="text-center py-12">
          <CardContent>
            <BookOpen className="h-12 w-12 mx-auto text-neutral-300 dark:text-neutral-600 mb-4" />
            <h3 className="text-lg font-medium text-neutral-950 dark:text-neutral-50 mb-2">
              Nessun corso configurato
            </h3>
            <p className="text-neutral-500 dark:text-neutral-400 mb-6">
              Aggiungi il tuo primo corso per iniziare a studiare
            </p>
            <Button onClick={() => navigate("/corsi/nuevo")} className="gap-2">
              <Plus className="h-4 w-4" />
              Aggiungi corso
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}