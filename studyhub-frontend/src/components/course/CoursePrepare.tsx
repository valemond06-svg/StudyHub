import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Loader2, Square, Wand2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { api, describeError } from "@/lib/api"

export interface PrepareStatus {
  status: "da preparare" | "in_corso" | "pronta"
  todo: number
  ready: number
  running: boolean
  current: string | null
  stopped: string | null
  order_pending: boolean
  lectures_without_notes: number
  errors: { title: string; message: string | null }[]
  units?: Record<string, number>
}

/**
 * Preparazione del corso (analisi del materiale in domande e ordine didattico): parte solo dal pulsante
 * (POST /api/study/{id}/prepare); mentre è in corso la pagina interroga GET /api/study/{id} ogni 5 s.
 */
export function CoursePrepare({ courseId, prepare }: { courseId: number; prepare: PrepareStatus | undefined }) {
  const client = useQueryClient()
  const update = (data: PrepareStatus) => {
    client.setQueryData(["study", courseId], (old: Record<string, unknown> | undefined) => (old ? { ...old, prepare: data } : old))
    void client.invalidateQueries({ queryKey: ["study", courseId] })
  }
  const start = useMutation({ mutationFn: () => api.prepareStudy(courseId) as Promise<PrepareStatus>, onSuccess: update })
  const stop = useMutation({ mutationFn: () => api.stopPrepare(courseId) as Promise<PrepareStatus>, onSuccess: update })
  if (!prepare) return null

  const running = prepare.status === "in_corso"
  const total = prepare.todo + prepare.ready
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2"><Wand2 className="h-5 w-5 text-accent-500" />Preparazione del materiale</CardTitle>
        <Badge variant={prepare.status === "pronta" ? "success" : running ? "accent" : "warning"}>
          {prepare.status === "pronta" ? "Pronta" : running ? "In corso" : "Da preparare"}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-neutral-600 dark:text-neutral-300">
          {total > 0
            ? `${prepare.ready} unità di materiale su ${total} trasformate in domande e schede.`
            : "Nessuna unità di materiale ancora individuata per questo corso."}
          {prepare.todo > 0 && ` Ne restano ${prepare.todo}.`}
          {prepare.order_pending && " L'ordine didattico degli argomenti va aggiornato."}
          {prepare.lectures_without_notes > 0 && ` ${prepare.lectures_without_notes} lezioni aspettano gli appunti AI.`}
        </p>
        {running && (
          <p role="status" className="flex items-center gap-2 text-neutral-600 dark:text-neutral-300">
            <Loader2 className="h-4 w-4 animate-spin" />
            {prepare.current ? `Sto analizzando: ${prepare.current}` : "Analisi in corso..."} (si aggiorna da sola)
          </p>
        )}
        {prepare.stopped && !running && <p className="text-neutral-500">Ultima preparazione interrotta: {prepare.stopped}.</p>}
        {prepare.errors?.length > 0 && (
          <details className="rounded-lg border border-error-200 p-2 dark:border-error-900">
            <summary className="cursor-pointer text-error-700 dark:text-error-400">{prepare.errors.length} unità in errore</summary>
            <ul className="mt-2 space-y-1">
              {prepare.errors.map((e, i) => <li key={i} className="break-words"><strong>{e.title}</strong>{e.message ? `: ${e.message}` : ""}</li>)}
            </ul>
          </details>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {running ? (
            <Button variant="outline" className="gap-2" disabled={stop.isPending} onClick={() => stop.mutate()}>
              <Square className="h-4 w-4" /> Ferma dopo l'unità corrente
            </Button>
          ) : prepare.status !== "pronta" ? (
            <Button className="gap-2" disabled={start.isPending} onClick={() => start.mutate()}>
              {start.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
              Prepara il materiale con l'AI
            </Button>
          ) : null}
          {!running && prepare.status !== "pronta" && <span className="text-xs text-neutral-500">Usa l'AI: parte solo con questo clic.</span>}
        </div>
        {(start.error || stop.error) && <p role="alert" className="text-error-600 dark:text-error-400">{describeError(start.error || stop.error)}</p>}
      </CardContent>
    </Card>
  )
}
