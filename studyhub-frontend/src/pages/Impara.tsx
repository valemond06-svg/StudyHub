import { useState } from "react"
import { Link, useParams, useSearchParams } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { studyApi, type InteractiveLesson, type LessonStep } from "@/lib/api-study"
import { InteractiveEngine } from "@/components/engines/InteractiveEngine"
import type { EngineType } from "@/components/engines/types"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { MathInline, MathMarkdown } from "@/components/ui/math-markdown"
import { SourceLink, StudyError, studyMuted } from "@/components/study/StudyFields"

const ENGINES = new Set<string>(["linear_2d", "pole_zero", "vector_field", "circuit_sim"])
const VECTOR_MODES = new Set(["vortex", "source", "sink", "saddle", "sine", "potential"])
type LessonData = NonNullable<InteractiveLesson["lesson"]>

function LessonWidget({ widget }: { widget: NonNullable<LessonData["widget"]> }) {
  if (!ENGINES.has(widget.tipo)) return null
  let config: unknown = widget.config_json
  if (typeof config === "string") {
    try { config = JSON.parse(config) } catch { config = {} }
  }
  const initialConfig = Object.fromEntries(Object.entries(config && typeof config === "object" ? config : {}).filter(([key, value]) =>
    (typeof value === "number" && Number.isFinite(value)) ||
    (key === "mode" && typeof value === "string" && (widget.tipo === "vector_field" ? VECTOR_MODES.has(value) : ["dc", "ac"].includes(value))),
  ))
  return <InteractiveEngine type={widget.tipo as EngineType} title={widget.titolo} description={widget.istruzioni} initialConfig={initialConfig} />
}

function StepQuestion({ check, answer, choose }: {
  check: NonNullable<LessonStep["verifica"]>; answer?: number; choose: (index: number) => void
}) {
  return (
    <div className="space-y-3 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
      <h3 className="font-medium">Verifica</h3>
      <MathMarkdown content={check.testo_md} />
      <div className="grid gap-2">
        {check.opzioni.map((option, index) => (
          <Button key={index} variant={answer === index ? "secondary" : "outline"} aria-pressed={answer === index} disabled={answer !== undefined}
            className="h-auto min-h-9 justify-start whitespace-normal py-2 text-left" onClick={() => choose(index)}><MathInline content={option} /></Button>
        ))}
      </div>
      {answer !== undefined && (
        <div role="status" className="space-y-1">
          <p className="font-medium">{answer === check.corretta ? "Risposta corretta" : "Risposta da rivedere"}</p>
          {answer !== check.corretta && check.opzioni[check.corretta] && <p className={studyMuted}>Risposta attesa · <MathInline content={check.opzioni[check.corretta]} /></p>}
          <MathMarkdown content={check.spiegazione_md} />
        </div>
      )}
    </div>
  )
}

function LessonPractice({ lesson }: { lesson: LessonData }) {
  const lab = lesson.laboratorio_pratico
  const exam = lesson.archetipo_esame
  const paper = lesson.ponte_carta_penna
  const trap = lesson.sniper_sbarramento
  const [answer, setAnswer] = useState<number>()
  return (
    <div className="space-y-4">
      {lesson.riassunto_md && <MathMarkdown content={lesson.riassunto_md} />}
      {exam && <section className="space-y-2"><h3 className="font-medium">{exam.nome_archetipo}</h3><MathMarkdown content={exam.come_appare_all_esame_md} /><MathMarkdown content={exam.trucco_del_docente_md} /></section>}
      {lab && <details className="space-y-3 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
        <summary className="cursor-pointer font-medium">{lab.titolo}</summary>
        <p className={studyMuted}>{lab.software}{lab.dataset && ` · ${lab.dataset}`}</p>
        <MathMarkdown content={lab.consegna_md} />
        <pre className="overflow-x-auto rounded-md bg-neutral-100 p-3 text-sm dark:bg-neutral-800">{lab.codice}</pre>
        <MathMarkdown content={lab.spiegazione_md} />
        {lab.output_atteso && <pre className="overflow-x-auto text-sm">{lab.output_atteso}</pre>}
        {lab.sfida && <section className="space-y-2"><MathMarkdown content={lab.sfida.consegna_md} /><details><summary className="cursor-pointer">Suggerimento</summary><MathMarkdown content={lab.sfida.suggerimento_md} /></details><details><summary className="cursor-pointer">Soluzione</summary><pre className="overflow-x-auto text-sm">{lab.sfida.soluzione_codice}</pre></details></section>}
      </details>}
      {paper && <details className="space-y-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
        <summary className="cursor-pointer font-medium">Carta e penna · {paper.tempo_stimato_min} min</summary>
        <MathMarkdown content={paper.sfida_testo_md} />
        <details><summary className="cursor-pointer">Mostra lo svolgimento</summary><MathMarkdown content={paper.soluzione_passo_passo_md} /><MathMarkdown content={paper.risultato_finale_md} /></details>
      </details>}
      {trap?.opzioni.length ? <StepQuestion check={{ ...trap, spiegazione_md: trap.perche_trabocchetto_md }} answer={answer} choose={setAnswer} /> : null}
      {lesson.errori_tipici?.length ? <section className="space-y-2"><h3 className="font-medium">Errori tipici</h3><ul className="space-y-2">{lesson.errori_tipici.map((item, index) => <li key={index}><MathMarkdown content={item.errore} /><MathMarkdown content={item.correzione} /></li>)}</ul></section> : null}
    </div>
  )
}

function LessonReader({ data, lesson }: { data: InteractiveLesson; lesson: LessonData }) {
  const client = useQueryClient()
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<number, number>>({})
  const step = lesson.passi?.[index]
  const check = step?.verifica?.opzioni.length ? step.verifica : undefined
  const answer = answers[index]
  const total = lesson.passi?.length ?? 0
  const done = useMutation({
    mutationFn: () => studyApi.completeLesson(data.topic.id),
    onSuccess: () => Promise.all([
      client.invalidateQueries({ queryKey: ["study-lesson", data.topic.id] }),
      client.invalidateQueries({ queryKey: ["lecture-topics"] }),
      client.invalidateQueries({ queryKey: ["study", data.topic.course_id] }),
    ]),
  })
  return (
    <div className="space-y-4">
      {lesson.hook_robotica_md && <MathMarkdown content={lesson.hook_robotica_md} />}
      {lesson.widget && <LessonWidget widget={lesson.widget} />}
      <Card>
        <CardHeader>
          {step && <p className={studyMuted}>Passo {index + 1} di {total}</p>}
          <CardTitle>{step ? <MathInline content={step.titolo} /> : "Riepilogo della lezione"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {step ? <>
            <MathMarkdown content={step.spiegazione_md} />
            {step.intuizione_md && <MathMarkdown className="rounded-lg bg-neutral-100 p-3 dark:bg-neutral-800" content={step.intuizione_md} />}
            {step.inizio_s != null && <SourceLink courseId={data.topic.course_id} source={data.topic} seconds={step.inizio_s} />}
            {check && <StepQuestion check={check} answer={answer} choose={(value) => setAnswers({ ...answers, [index]: value })} />}
          </> : <LessonPractice lesson={lesson} />}
          <StudyError error={done.error} />
          <div className="flex flex-wrap items-center gap-2">
            {index > 0 && <Button variant="outline" onClick={() => setIndex(index - 1)}>Indietro</Button>}
            {step ? <Button disabled={!!check && answer === undefined} onClick={() => setIndex(index + 1)}>{index + 1 === total ? "Vai al riepilogo" : "Passo successivo"}</Button> : (
              data.completed_at || done.isSuccess
                ? <><p role="status" className={studyMuted}>Lezione completata.</p><Button asChild><Link to={`/studio/${data.topic.course_id}?topic=${data.topic.id}&duration=25`}>Allenati sull’argomento</Link></Button></>
                : <Button disabled={done.isPending} onClick={() => done.mutate()}>Completa lezione</Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export function Impara() {
  const { topicId } = useParams()
  const [params] = useSearchParams()
  const client = useQueryClient()
  const id = Number(topicId)
  const valid = Number.isSafeInteger(id) && id > 0
  const reading = params.get("lettura") === "appunti"
  const key = ["study-lesson", id]
  const topic = useQuery({ queryKey: key, queryFn: () => studyApi.lesson(id), enabled: valid,
    refetchInterval: ({ state }) => state.data?.status === "in_coda" || state.data?.status === "in_corso" ? 6000 : false,
  })
  const prepare = useMutation({ mutationFn: () => studyApi.prepareLesson(id), onSuccess: (data) => client.setQueryData(key, data) })
  const data = topic.data
  const waiting = data?.status === "in_coda" || data?.status === "in_corso"
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      {data && <Button asChild variant="ghost" size="sm"><Link to={`/corsi/${data.topic.course_id}`}>Torna al corso</Link></Button>}
      <h1 className="text-3xl font-semibold tracking-tight"><MathInline content={data?.lesson?.titolo || data?.topic.name || "Impara"} /></h1>
      {!valid && <p role="alert">Argomento non valido.</p>}
      <StudyError error={topic.error || prepare.error} />
      {valid && topic.isPending && <p className={studyMuted}>Caricamento lezione…</p>}
      {data && (reading || !data.lesson) && <Card>
        <CardHeader><CardTitle>Appunti dell’argomento</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {data.topic.summary_md ? <MathMarkdown content={data.topic.summary_md} /> : <p className={studyMuted}>Nessun appunto per questo argomento.</p>}
          <div className="flex flex-wrap items-center gap-3">
            <SourceLink courseId={data.topic.course_id} source={data.topic} seconds={data.topic.t_start} />
            {data.topic.lecture_id && <Link className="text-sm text-accent-600 hover:underline dark:text-accent-400" to={`/corsi/${data.topic.course_id}?tab=lezioni&materiale=${data.topic.lecture_id}`}>Appunti AI della lezione</Link>}
          </div>
        </CardContent>
      </Card>}
      {data?.lesson && <LessonReader key={id} data={data} lesson={data.lesson} />}
      {data && !data.lesson && <Card>
        <CardHeader><CardTitle>Lezione interattiva</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p role="status" className={studyMuted}>{waiting ? "Preparazione in corso…" : data.status === "errore" ? (data.message || "Preparazione non riuscita.") : "La lezione interattiva è ancora da preparare."}</p>
          {!waiting && <Button disabled={prepare.isPending} onClick={() => prepare.mutate()}>{data.status === "errore" ? "Riprova preparazione" : "Prepara lezione con AI"}</Button>}
        </CardContent>
      </Card>}
    </div>
  )
}
