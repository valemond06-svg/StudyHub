import { useEffect, useState, type FormEvent } from "react"
import * as Popover from "@radix-ui/react-popover"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Timer, X } from "lucide-react"
import { api } from "@/lib/api"
import { studyApi, type FocusSession, type FocusStart } from "@/lib/api-study"
import { useFocusDraft } from "@/lib/study-navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { CoursePicker, Field, StudyError, studyMuted, studySelect } from "@/components/study/StudyFields"

async function readFocus() {
  const { sessions } = await studyApi.focus()
  return { session: sessions[0] ?? null, receivedAt: performance.now() }
}

function secondsLeft(session: FocusSession, receivedAt: number) {
  const serverAtReceipt = Date.parse(session.started_at) + session.actual_seconds * 1000
  const serverNow = serverAtReceipt + Math.max(0, performance.now() - receivedAt)
  return Math.max(0, Math.ceil((Date.parse(session.ends_at) - serverNow) / 1000))
}

function clockLabel(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`
}

const minuteFormat = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1 })

export function FocusWidget() {
  const client = useQueryClient()
  const [open, setOpen] = useState(false)
  const [courseId, setCourseId] = useState<number>()
  const [task, setTask] = useState("")
  const [minutes, setMinutes] = useState("25")
  const [kind, setKind] = useState<FocusStart["kind"]>("focus")
  const [summaryCourse, setSummaryCourse] = useState<number>()
  const [day, setDay] = useState<string>()
  const [, setTick] = useState(0)
  const focus = useQuery({ queryKey: ["study-focus"], queryFn: readFocus, refetchInterval: 15_000, refetchOnWindowFocus: "always" })
  const courses = useQuery({ queryKey: ["courses"], queryFn: api.getCourses, enabled: open })
  const summary = useQuery({ queryKey: ["study-focus-summary", summaryCourse, day], queryFn: () => studyApi.focusSummary(summaryCourse, day), enabled: open, refetchInterval: 15_000 })
  const session = focus.data?.session
  const active = session?.status === "running" ? session : null
  const remaining = active ? secondsLeft(active, focus.data!.receivedAt) : 0
  const expired = !!active && remaining === 0

  useEffect(() => useFocusDraft.subscribe(({ draft }, previous) => {
    if (draft && draft !== previous.draft) {
      setCourseId(draft.courseId)
      setTask(draft.task ?? "")
      setMinutes(String(draft.minutes ?? 25))
      setKind("focus")
      setSummaryCourse(draft.courseId)
      setOpen(true)
    }
  }), [])

  useEffect(() => {
    if (!active || expired) return
    const timer = window.setInterval(() => setTick((value) => value + 1), 250)
    return () => window.clearInterval(timer)
  }, [active, expired])

  useEffect(() => {
    if (expired) {
      void client.invalidateQueries({ queryKey: ["study-focus"] })
      void client.invalidateQueries({ queryKey: ["study-focus-summary"] })
    }
  }, [client, expired])

  async function refresh(session?: FocusSession) {
    if (session) client.setQueryData(["study-focus"], { session, receivedAt: performance.now() })
    await Promise.all([
      client.invalidateQueries({ queryKey: ["study-focus"] }),
      client.invalidateQueries({ queryKey: ["study-focus-summary"] }),
    ])
  }
  const start = useMutation({ mutationFn: studyApi.startFocus, onSuccess: refresh, onError: () => refresh() })
  const stop = useMutation({ mutationFn: studyApi.stopFocus, onSuccess: refresh, onError: () => refresh() })
  const busy = start.isPending || stop.isPending
  function submit(event: FormEvent) {
    event.preventDefault()
    if (courseId) {
      stop.reset()
      start.mutate({ course_id: courseId, task: task.trim() || null, planned_seconds: Number(minutes) * 60, kind })
    }
  }
  return (
    <div className="fixed bottom-4 right-4 z-40 sm:bottom-6 sm:right-6">
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <Button variant={active ? "default" : "outline"} className="rounded-full shadow-md" aria-label="Apri Pomodoro">
            <Timer className="size-4" /> <span className="tabular-nums">{active ? clockLabel(remaining) : "Focus"}</span>
          </Button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content aria-label="Pomodoro" side="top" align="end" sideOffset={8} collisionPadding={12}
            className="z-50 max-h-[min(75dvh,var(--radix-popover-content-available-height))] w-[min(23rem,calc(100vw-1.5rem))] space-y-4 overflow-auto rounded-2xl border border-neutral-200 bg-white p-4 shadow-xl dark:border-neutral-800 dark:bg-neutral-900">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Pomodoro</h2>
              <Popover.Close asChild><Button variant="ghost" size="icon" aria-label="Chiudi Pomodoro"><X className="size-4" /></Button></Popover.Close>
            </div>
            <StudyError error={focus.error || courses.error || start.error || stop.error} />
            {focus.isPending && <p className={studyMuted}>Caricamento timer…</p>}
            {active ? (
              <div className="space-y-2">
                <p className="break-words font-medium">{active.task || courses.data?.find((course) => course.id === active.course_id)?.fullname || (active.kind === "pausa" ? "Pausa" : "Sessione focus")}</p>
                <p className="text-4xl font-semibold tabular-nums" role="timer">{clockLabel(remaining)}</p>
                <Button variant="outline" disabled={busy} onClick={() => { start.reset(); stop.mutate(active.id) }}>Termina sessione</Button>
              </div>
            ) : (
              <form className="space-y-3" onSubmit={submit}>
                <Field name="Corso del timer"><CoursePicker required courses={courses.data ?? []} value={courseId} onChange={(id) => { setCourseId(id); setSummaryCourse(id) }} /></Field>
                <Field name="Compito"><Input value={task} maxLength={500} onChange={(e) => setTask(e.target.value)} /></Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field name="Minuti"><Input type="number" required min={1} max={1440} value={minutes} onChange={(e) => setMinutes(e.target.value)} /></Field>
                  <Field name="Modalità">
                    <select className={studySelect} value={kind} onChange={(e) => { const mode = e.target.value === "pausa" ? "pausa" : "focus"; setKind(mode); setMinutes(mode === "pausa" ? "5" : "25") }}>
                      <option value="focus">Focus</option><option value="pausa">Pausa</option>
                    </select>
                  </Field>
                </div>
                <Button disabled={busy || !focus.isSuccess || !courseId || !minutes}>Avvia timer</Button>
              </form>
            )}
            <div className="space-y-3 border-t border-neutral-200 pt-3 dark:border-neutral-800">
              <h3 className="text-sm font-semibold">Riepilogo</h3>
              <Field name="Corso del riepilogo"><CoursePicker courses={courses.data ?? []} value={summaryCourse} onChange={setSummaryCourse} empty="Tutti i corsi" /></Field>
              <Field name="Giorno del riepilogo"><Input type="date" value={day ?? summary.data?.day ?? ""} onChange={(e) => setDay(e.target.value || undefined)} /></Field>
              {day && <Button size="sm" variant="ghost" onClick={() => setDay(undefined)}>Oggi</Button>}
              <StudyError error={summary.error} />
              {summary.isPending && <p className={studyMuted}>Caricamento riepilogo…</p>}
              {summary.data && <p className={studyMuted}>{minuteFormat.format(summary.data.focus_seconds / 60)} min di focus · {minuteFormat.format(summary.data.break_seconds / 60)} min di pausa</p>}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  )
}
