import { useEffect, useState, type FormEvent } from "react"
import { useLocation } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { api } from "@/lib/api"
import { studyApi, type Appello, type Availability, type ExamInput } from "@/lib/api-study"
import { blockLabels, formatStudyDate, shiftStudyDate, useStudyPlan } from "@/lib/study-navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card"
import { PlanBlockRow } from "@/components/study/PlanBlockRow"
import { CoursePicker, Field, StudyError, studyMuted } from "@/components/study/StudyFields"
import type { Course } from "@/types"

const WEEKDAYS = ["Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato", "Domenica"]

function AvailabilityForm({ initial }: { initial: Availability }) {
  const client = useQueryClient()
  const [draft, setDraft] = useState(initial)
  const [dayOff, setDayOff] = useState("")
  const save = useMutation({
    mutationFn: studyApi.saveAvailability,
    onSuccess: (saved) => {
      client.setQueryData(["study-availability"], saved)
      return client.invalidateQueries({ queryKey: ["study-week"] })
    },
  })
  return (
    <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); save.mutate(draft) }}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
        {WEEKDAYS.map((day, index) => (
          <Field key={day} name={day}>
            <Input type="number" min={0} max={24} step="any" value={draft.hours_by_weekday[index] ?? ""} onChange={(e) => {
              const hours = e.target.valueAsNumber
              save.reset()
              setDraft({ ...draft, hours_by_weekday: draft.hours_by_weekday.map((value, i) => i === index ? (Number.isNaN(hours) ? 0 : hours) : value) })
            }} />
          </Field>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <Field name="Giorno libero"><Input type="date" value={dayOff} onChange={(e) => setDayOff(e.target.value)} /></Field>
        <Button type="button" variant="outline" disabled={!dayOff || draft.days_off.includes(dayOff)} onClick={() => {
          save.reset()
          setDraft({ ...draft, days_off: [...draft.days_off, dayOff].sort() })
          setDayOff("")
        }}>Aggiungi giorno libero</Button>
      </div>
      {draft.days_off.length > 0 && <ul className="flex flex-wrap gap-2">{draft.days_off.map((day) => (
        <li key={day}><Button type="button" size="sm" variant="outline" aria-label={`Rimuovi giorno libero ${formatStudyDate(day)}`} onClick={() => {
          save.reset()
          setDraft({ ...draft, days_off: draft.days_off.filter((value) => value !== day) })
        }}>{formatStudyDate(day)} ×</Button></li>
      ))}</ul>}
      <StudyError error={save.error} />
      <div className="flex items-center gap-3">
        <Button disabled={save.isPending}>Salva disponibilità</Button>
        {save.isSuccess && <p role="status" className={studyMuted}>Disponibilità salvata.</p>}
      </div>
    </form>
  )
}

function ExamForm({ exam, courses, today, close, refresh }: {
  exam?: Appello; courses: Course[]; today?: string; close: () => void; refresh: () => Promise<unknown>
}) {
  const [courseId, setCourseId] = useState<number | undefined>(exam?.course_id)
  const [date, setDate] = useState(exam?.date ?? "")
  const [kind, setKind] = useState(exam?.kind ?? "scritto")
  const [note, setNote] = useState(exam?.note ?? "")
  const [replacementCreated, setReplacementCreated] = useState(false)
  const save = useMutation({
    mutationFn: async (body: ExamInput) => {
      if (!replacementCreated) {
        await studyApi.createExam(body)
        if (exam) setReplacementCreated(true)
      }
      if (exam) await studyApi.deleteExam(exam.id)
    },
    onSuccess: async () => { await refresh(); close() },
    onError: () => refresh(),
  })
  function submit(event: FormEvent) {
    event.preventDefault()
    if (courseId) save.mutate({ course_id: courseId, date, kind: kind.trim(), note: note.trim() || null })
  }
  return (
    <form className="space-y-3 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800" onSubmit={submit}>
      <h3 className="font-medium">{exam ? "Modifica appello" : "Nuovo appello"}</h3>
      <fieldset disabled={save.isPending || replacementCreated} className="grid gap-3 sm:grid-cols-2">
        <Field name="Corso dell’appello"><CoursePicker required courses={courses} value={courseId} onChange={setCourseId} /></Field>
        <Field name="Data dell’appello"><Input type="date" required min={today} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field name="Tipo di appello"><Input required list="tipi-appello" value={kind} onChange={(e) => setKind(e.target.value)} /><datalist id="tipi-appello"><option value="scritto" /><option value="orale" /><option value="scritto e orale" /></datalist></Field>
        <Field name="Nota sull’appello"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </fieldset>
      <StudyError error={save.error} />
      {replacementCreated && save.isError && <p className={studyMuted}>Il nuovo appello è stato salvato. Riprova a rimuovere quello precedente.</p>}
      <div className="flex flex-wrap gap-2">
        <Button disabled={save.isPending || !courseId || !date || !kind.trim()}>{replacementCreated ? "Riprova rimozione" : "Salva appello"}</Button>
        <Button type="button" variant="ghost" disabled={save.isPending} onClick={close}>{replacementCreated ? "Chiudi" : "Annulla"}</Button>
      </div>
    </form>
  )
}

export function Piano() {
  const client = useQueryClient()
  const { hash } = useLocation()
  const { missedDay, setMissedDay } = useStudyPlan()
  const [start, setStart] = useState<string>()
  const [editing, setEditing] = useState<Appello | "new" | null>(null)
  const [deleting, setDeleting] = useState<number | null>(null)
  const courses = useQuery({ queryKey: ["courses"], queryFn: api.getCourses })
  const todayPlan = useQuery({ queryKey: ["study-week", undefined, missedDay], queryFn: () => studyApi.week(undefined, missedDay) })
  const week = useQuery({ queryKey: ["study-week", start, missedDay], queryFn: () => studyApi.week(start, missedDay) })
  const availability = useQuery({ queryKey: ["study-availability"], queryFn: studyApi.availability })
  const today = todayPlan.data?.start
  const data = week.data
  useEffect(() => {
    if (hash === "#appelli" && today) document.getElementById("appelli")?.scrollIntoView?.({ block: "start" })
  }, [hash, today])

  function refreshExams() {
    return Promise.all([
      client.invalidateQueries({ queryKey: ["study-week"] }),
      client.invalidateQueries({ queryKey: ["plan"] }),
      client.invalidateQueries({ queryKey: ["study"] }),
      client.invalidateQueries({ queryKey: ["studyCourses"] }),
    ])
  }
  const remove = useMutation({
    mutationFn: studyApi.deleteExam,
    onSuccess: async () => { await refreshExams(); setDeleting(null) },
  })
  const recompute = useMutation({
    mutationFn: (day: string) => studyApi.recompute(day, day),
    onSuccess: (result, day) => {
      client.setQueryData(["study-week", undefined, day], result)
      setMissedDay(day)
      setStart(undefined)
    },
  })

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">Piano</h1>
      <Card>
        <CardHeader className="gap-3">
          <CardTitle>Settimana di studio</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="icon" aria-label="Settimana precedente" disabled={!data || recompute.isPending} onClick={() => data && setStart(shiftStudyDate(data.start, -7))}><ChevronLeft className="size-4" /></Button>
            <Button variant="outline" size="icon" aria-label="Settimana successiva" disabled={!data || recompute.isPending} onClick={() => data && setStart(shiftStudyDate(data.start, 7))}><ChevronRight className="size-4" /></Button>
            {start && <Button variant="ghost" onClick={() => setStart(undefined)}>Torna a oggi</Button>}
            <Button variant="outline" className="sm:ml-auto" disabled={!today || recompute.isPending || missedDay === today} onClick={() => today && recompute.mutate(today)}>Ho saltato oggi</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <StudyError error={week.error || recompute.error} />
          {week.isPending && <p className={studyMuted}>Caricamento settimana…</p>}
          {data?.changes.length ? (
            <div className="rounded-lg bg-neutral-100 p-3 text-sm dark:bg-neutral-800">
              <h3 className="font-medium">Attività spostate</h3>
              <ul className="mt-2 space-y-1">
                {data.changes.map((change) => {
                  const block = data.days.flatMap((day) => day.blocks).concat(data.unscheduled).find((item) => item.id === change.block_id)
                  const course = block?.course ?? data.exams.find((exam) => exam.id === change.exam_id)?.course
                  return <li key={change.block_id}>{blockLabels[change.kind]}{block?.topic && ` · ${block.topic}`}{course && ` · ${course}`} ({change.minutes} min) · {change.to_day ? `Nuova data: ${formatStudyDate(change.to_day)}` : "Nessuno spazio prima dell’appello"}</li>
                })}
              </ul>
            </div>
          ) : missedDay === today && today && <p role="status" className={studyMuted}>Nessuna attività da spostare.</p>}
          {data?.days.map((day) => (
            <section key={day.day} className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-medium capitalize">{formatStudyDate(day.day)}{day.day === today && " · Oggi"}</h3>
                <p className={studyMuted}>{day.planned_minutes} / {day.available_minutes} min</p>
              </div>
              {day.blocks.length ? <ul className="mt-2">{day.blocks.map((block) => <PlanBlockRow key={block.id} block={block} />)}</ul> : <p className={studyMuted}>Nessuna attività in programma.</p>}
            </section>
          ))}
          {data?.unscheduled.length ? (
            <details className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
              <summary className="cursor-pointer text-sm font-medium">Senza spazio prima dell’appello ({data.unscheduled.length})</summary>
              <ul className="mt-2">{data.unscheduled.map((block) => <PlanBlockRow key={block.id} block={block} />)}</ul>
            </details>
          ) : null}
        </CardContent>
      </Card>

      <Card id="appelli" className="scroll-mt-20">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <CardTitle>Appelli</CardTitle>
          <Button size="sm" disabled={!!editing} onClick={() => setEditing("new")}>Aggiungi appello</Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <StudyError error={todayPlan.error || courses.error || remove.error} />
          {editing && <ExamForm key={editing === "new" ? "new" : editing.id} exam={editing === "new" ? undefined : editing} courses={courses.data ?? []} today={today} close={() => setEditing(null)} refresh={refreshExams} />}
          {todayPlan.data?.exams.length === 0 && <p className={studyMuted}>Nessun appello in calendario.</p>}
          {todayPlan.data?.exams.map((exam) => (
            <div key={exam.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
              <div className="min-w-0 break-words">
                <p className="font-medium">{exam.course}</p>
                <p className={studyMuted}>{formatStudyDate(exam.date)} · {exam.kind}{exam.note && ` · ${exam.note}`}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {deleting === exam.id ? <>
                  <Button size="sm" variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate(exam.id)}>Conferma eliminazione</Button>
                  <Button size="sm" variant="ghost" disabled={remove.isPending} onClick={() => { remove.reset(); setDeleting(null) }}>Annulla</Button>
                </> : <>
                  <Button size="sm" variant="outline" disabled={!!editing || deleting !== null} onClick={() => setEditing(exam)}>Modifica</Button>
                  <Button size="sm" variant="ghost" disabled={!!editing || deleting !== null} onClick={() => setDeleting(exam.id)}>Elimina</Button>
                </>}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Disponibilità settimanale</CardTitle><p className={studyMuted}>Ore di studio per giorno</p></CardHeader>
        <CardContent>
          <StudyError error={availability.error} />
          {availability.isPending && <p className={studyMuted}>Caricamento disponibilità…</p>}
          {availability.data && <AvailabilityForm initial={availability.data} />}
        </CardContent>
      </Card>
    </div>
  )
}
