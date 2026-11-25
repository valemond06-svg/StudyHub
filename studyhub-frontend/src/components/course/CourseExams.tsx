import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { CalendarDays, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { describeError } from "@/lib/api"
import { studyApi } from "@/lib/api-study"
import { formatStudyDate } from "@/lib/study-navigation"
import type { Exam } from "@/types"

/** Date d'appello del corso: senza, la prontezza viene proiettata a 14 giorni e il piano non sa dove andare. */
export function CourseExams({ courseId, exams }: { courseId: number; exams: Exam[] }) {
  const client = useQueryClient()
  const [date, setDate] = useState("")
  const [kind, setKind] = useState("scritto")
  const refresh = () => Promise.all(["plan", "study", "studyCourses", "study-week"].map((k) => client.invalidateQueries({ queryKey: [k] })))
  const add = useMutation({
    mutationFn: () => studyApi.createExam({ course_id: courseId, date, kind: kind.trim() || "scritto", note: null }),
    onSuccess: async () => { setDate(""); await refresh() },
  })
  const remove = useMutation({ mutationFn: (id: number) => studyApi.deleteExam(id), onSuccess: refresh })
  const [today] = useState(() => new Date().toISOString().slice(0, 10))
  const upcoming = exams.filter((e) => e.date >= today).sort((a, b) => a.date.localeCompare(b.date))

  return (
    <Card id="appelli" className="scroll-mt-20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><CalendarDays className="h-5 w-5" />Appelli</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {upcoming.length === 0 ? (
          <p className="text-neutral-500 dark:text-neutral-400">Nessun appello in calendario: la prontezza è proiettata a 14 giorni.</p>
        ) : (
          <ul className="space-y-2">
            {upcoming.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-2 rounded-lg border border-neutral-200 p-2 dark:border-neutral-800">
                <span>{formatStudyDate(e.date)} · {e.kind}{e.days_left != null ? ` · tra ${e.days_left} giorni` : ""}</span>
                <Button size="icon" variant="ghost" aria-label={`Rimuovi l'appello del ${e.date}`} disabled={remove.isPending} onClick={() => remove.mutate(e.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <form className="flex flex-wrap items-end gap-2" onSubmit={(ev) => { ev.preventDefault(); if (date) add.mutate() }}>
          <label className="grid gap-1">
            <span className="text-xs font-medium">Data</span>
            <Input type="date" required min={today} value={date} onChange={(e) => setDate(e.target.value)} className="h-9" />
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-medium">Tipo</span>
            <Input list="tipi-appello-corso" value={kind} onChange={(e) => setKind(e.target.value)} className="h-9 w-40" />
            <datalist id="tipi-appello-corso"><option value="scritto" /><option value="orale" /><option value="scritto e orale" /></datalist>
          </label>
          <Button type="submit" size="sm" disabled={!date || add.isPending}>Aggiungi appello</Button>
        </form>
        {(add.error || remove.error) && <p role="alert" className="text-error-600">{describeError(add.error || remove.error)}</p>}
      </CardContent>
    </Card>
  )
}
