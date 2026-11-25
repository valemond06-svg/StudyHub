import { useEffect, useState, type FormEvent } from "react"
import { Link } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api, describeError } from "@/lib/api"
import { studyApi, type LectureQuiz, type QuizAnswer } from "@/lib/api-study"
import { Button } from "@/components/ui/button"
import { MathInline, MathMarkdown } from "@/components/ui/math-markdown"
import { Field, SourceLink, StudyError, studyMuted, studyTextarea } from "@/components/study/StudyFields"

function isPendingJob(status?: string) {
  return status === "in_coda" || status === "in_corso"
}

const formatScore = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 })

function LectureNotesPanel({ lectureId }: { lectureId: number }) {
  const client = useQueryClient()
  const [jobId, setJobId] = useState<number | null>()
  const [downloadError, setDownloadError] = useState("")
  const notesKey = ["lecture-notes", lectureId]
  const notes = useQuery({ queryKey: notesKey, queryFn: () => studyApi.lectureNotes(lectureId) })
  const jobsKey = ["lecture-note-jobs", lectureId, jobId]
  const jobs = useQuery({
    queryKey: jobsKey,
    queryFn: async () => {
      const data = await studyApi.lectureNoteJobs()
      return { paused: data.paused_reason, job: data.jobs.find((row) => jobId == null ? row.kind === "lecture_notes" && row.target_id === lectureId : row.id === jobId) ?? null }
    },
    enabled: jobId !== undefined,
    refetchInterval: ({ state }) => !state.data || isPendingJob(state.data.job?.status) ? 5000 : false,
  })
  const job = jobs.data?.job
  const queue = useMutation({
    mutationFn: () => studyApi.queueLectureNotes(lectureId),
    onSuccess: async ({ queued }) => {
      setJobId(queued[0] ?? null)
      if (!queued.length) await client.invalidateQueries({ queryKey: ["lecture-note-jobs", lectureId] })
    },
  })
  useEffect(() => {
    if (job?.status === "fatto") {
      void client.invalidateQueries({ queryKey: ["lecture-notes", lectureId] })
      void client.invalidateQueries({ queryKey: ["notesIndex"] })
      void client.invalidateQueries({ queryKey: ["flashcardStats"] })
      void client.invalidateQueries({ queryKey: ["review-today"] })
    }
  }, [client, job?.status, jobId, lectureId])
  const pending = jobId !== undefined && (jobs.isPending || isPendingJob(job?.status))
  return (
    <section className="space-y-3">
      <h3 className="font-semibold">Appunti AI</h3>
      <StudyError error={notes.error || queue.error || jobs.error} />
      {notes.isPending && <p className={studyMuted}>Caricamento appunti…</p>}
      {notes.data && (notes.data.exists ? (
        <div className="min-w-0 space-y-2 break-words">
          <p className={studyMuted}>{notes.data.model} · {new Date(notes.data.created_at).toLocaleDateString("it-IT")}</p>
          <MathMarkdown content={notes.data.md} />
        </div>
      ) : <p className={studyMuted}>Appunti ancora da generare.</p>)}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" disabled={!notes.data || queue.isPending || pending} onClick={() => queue.mutate()}>
          {notes.data?.exists ? "Richiedi rielaborazione" : "Genera appunti AI"}
        </Button>
        {notes.data?.exists && <Button variant="ghost" size="sm" onClick={() => {
          setDownloadError("")
          void api.downloadLecturePdf(lectureId).catch((error) => setDownloadError(describeError(error)))
        }}>Scarica PDF</Button>}
      </div>
      {notes.data?.exists && <p className={studyMuted}>A parità di materiale, il server può riutilizzare gli appunti esistenti.</p>}
      {pending && <p role="status" className={studyMuted}>{job?.status === "in_corso" ? "Elaborazione in corso…" : "Richiesta in coda."}{jobs.data?.paused && ` ${jobs.data.paused}`}</p>}
      {jobs.isSuccess && !job && <p role="status" className={studyMuted}>Stato della richiesta non disponibile.</p>}
      {job && !isPendingJob(job.status) && <p role="status" className={studyMuted}>
        {job.status === "fatto" ? "Elaborazione completata." : job.status === "errore" ? "Elaborazione non riuscita." : "Richiesta terminata."}{job.status === "errore" && job.message && ` ${job.message}`}
      </p>}
      {downloadError && <p role="alert" className="text-sm text-error-600">{downloadError}</p>}
    </section>
  )
}

function questionOptions(question: LectureQuiz["questions"][number]) {
  if (question.tipo === "vero_falso") return [{ value: 1, text: "Vero" }, { value: 0, text: "Falso" }]
  if (question.tipo === "multipla") return question.opzioni.map((text, value) => ({ value, text }))
  return []
}

function QuizAttempt({ quiz }: { quiz: LectureQuiz }) {
  const [answers, setAnswers] = useState<Record<number, QuizAnswer>>({})
  const client = useQueryClient()
  const grade = useMutation({
    mutationFn: (payload: QuizAnswer[]) => studyApi.submitQuiz(quiz.id, payload),
    onSuccess: () => Promise.all([
      client.invalidateQueries({ queryKey: ["lecture-quiz", quiz.id] }),
      client.invalidateQueries({ queryKey: ["lecture-quizzes", quiz.lecture_id] }),
      client.invalidateQueries({ queryKey: ["quizHistory"] }),
    ]),
  })
  function submit(event: FormEvent) {
    event.preventDefault()
    grade.mutate(quiz.questions.map((_, index) => answers[index] ?? null))
  }
  return (
    <div className="space-y-4 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
      <h4 className="font-medium">{quiz.title}</h4>
      <form className="space-y-4" onSubmit={submit}>
        {quiz.questions.map((question, index) => {
          const options = questionOptions(question)
          const correction = grade.data?.results.find((result) => result.indice === index)
          const expected = options.find(({ value }) => value === correction?.corretta)?.text
          return (
            <fieldset key={index} className="space-y-2 border-b border-neutral-200 pb-4 dark:border-neutral-800" disabled={grade.isPending || grade.isSuccess}>
              <legend className="mb-2 font-medium">{index + 1}. <MathInline content={question.testo_md} /></legend>
              {options.length ? options.map(({ text, value }) => (
                <label key={value} className="flex items-start gap-2 rounded-md border border-neutral-200 p-2 text-sm dark:border-neutral-800">
                  <input className="mt-0.5" type="radio" name={`quiz-${quiz.id}-${index}`} checked={answers[index] === value}
                    onChange={() => setAnswers({ ...answers, [index]: value })} /><MathInline content={text} />
                </label>
              )) : <Field name="Risposta"><textarea className={studyTextarea} rows={3} value={String(answers[index] ?? "")} onChange={(e) => setAnswers({ ...answers, [index]: e.target.value })} /></Field>}
              {correction && <div className="space-y-2 rounded-md bg-neutral-100 p-3 dark:bg-neutral-800">
                <p className="font-medium">{formatScore.format(correction.punteggio)} / 1</p>
                {expected && <p className={studyMuted}>Risposta attesa · <MathInline content={expected} /></p>}
                {correction.feedback_md && <MathMarkdown content={correction.feedback_md} />}
                <MathMarkdown content={correction.soluzione_md} />
                {question.inizio_s != null && <SourceLink courseId={quiz.course_id} source={{ lecture_id: quiz.lecture_id }} seconds={question.inizio_s} />}
              </div>}
            </fieldset>
          )
        })}
        <StudyError error={grade.error} />
        {grade.data ? (
          <div className="flex flex-wrap items-center gap-3">
            <p role="status" className="font-medium">Punteggio {formatScore.format(grade.data.score)} / {grade.data.max_score}</p>
            <Button type="button" variant="outline" onClick={() => { setAnswers({}); grade.reset() }}>Nuovo tentativo</Button>
          </div>
        ) : <Button disabled={grade.isPending || !quiz.questions.length}>{grade.isPending ? "Correzione in corso…" : "Consegna quiz"}</Button>}
      </form>
      <h5 className="font-medium">Storico dei tentativi</h5>
      {quiz.attempts.length ? <ul className="space-y-1 text-sm">{[...quiz.attempts].reverse().map((attempt) => (
        <li key={attempt.id}>{new Date(attempt.created_at).toLocaleString("it-IT")} · {formatScore.format(attempt.score)} / {attempt.max_score}</li>
      ))}</ul> : <p className={studyMuted}>Nessun tentativo registrato.</p>}
    </div>
  )
}

function LectureQuizPanel({ lectureId }: { lectureId: number }) {
  const client = useQueryClient()
  const [selected, setSelected] = useState<number>()
  const list = useQuery({ queryKey: ["lecture-quizzes", lectureId], queryFn: () => studyApi.lectureQuizzes(lectureId) })
  const quiz = useQuery({ queryKey: ["lecture-quiz", selected], queryFn: () => studyApi.quiz(selected!), enabled: !!selected })
  const generate = useMutation({
    mutationFn: () => studyApi.generateQuiz(lectureId),
    onSuccess: ({ id }) => {
      setSelected(id)
      return client.invalidateQueries({ queryKey: ["lecture-quizzes", lectureId] })
    },
  })
  return (
    <section className="space-y-3 border-t border-neutral-200 pt-4 dark:border-neutral-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Quiz della lezione</h3>
        <Button variant="outline" size="sm" disabled={generate.isPending} onClick={() => generate.mutate()}>{generate.isPending ? "Generazione in corso…" : "Genera quiz con AI"}</Button>
      </div>
      <StudyError error={list.error || quiz.error || generate.error} />
      {list.isPending && <p className={studyMuted}>Caricamento quiz…</p>}
      {list.data?.length === 0 && <p className={studyMuted}>Nessun quiz disponibile. Per generarne uno servono gli appunti AI.</p>}
      {list.data?.length ? <ul className="space-y-2">{list.data.map((row) => <li key={row.id}>
        <Button variant={selected === row.id ? "secondary" : "ghost"} size="sm" className="h-auto min-h-9 max-w-full whitespace-normal py-2 text-left" aria-pressed={selected === row.id} onClick={() => setSelected(selected === row.id ? undefined : row.id)}>
          {row.title}{row.best !== null && ` · Migliore ${Math.round(row.best * 100)}%`}
        </Button>
      </li>)}</ul> : null}
      {selected && quiz.isPending && <p className={studyMuted}>Caricamento domande…</p>}
      {quiz.data && <QuizAttempt key={quiz.data.id} quiz={quiz.data} />}
    </section>
  )
}

export function LecturePanel({ lectureId }: { lectureId: number }) {
  const topics = useQuery({ queryKey: ["lecture-topics", lectureId], queryFn: () => studyApi.lectureTopics(lectureId) })
  return (
    <div className="mt-4 space-y-5 border-t border-neutral-200 pt-4 dark:border-neutral-800">
      <StudyError error={topics.error} />
      {topics.data?.length ? <div className="flex flex-wrap gap-2">
        {topics.data.map((topic) => <Button key={topic.id} variant="secondary" size="sm" className="h-auto min-h-9 max-w-full whitespace-normal py-2 text-left" asChild><Link to={`/impara/${topic.id}`}>Impara · <MathInline content={topic.name} /></Link></Button>)}
      </div> : null}
      <LectureNotesPanel lectureId={lectureId} />
      <LectureQuizPanel lectureId={lectureId} />
    </div>
  )
}
