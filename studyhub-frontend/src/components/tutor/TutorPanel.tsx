import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"
import { ArrowLeft, Brain, Loader2, Plus, Send, Trash2, FileText, PlayCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { MathMarkdown } from "@/components/ui/math-markdown"
import { api, describeError } from "@/lib/api"
import { useToast } from "@/hooks/use-toast"
import { safeFormatDistance } from "@/lib/utils"

/** GET /api/tutor/threads → [{id, course_id, mode, title, created_at, course, n}] */
interface ThreadRow { id: number; course_id: number | null; mode: string; title: string | null; created_at: string | null; course: string | null; n: number }
interface Source { n: number; doc_id: number; title: string; kind: string; page: number | null; t_start: number | null; lecture_id: number | null; where?: string }
interface Message { id: number; role: "user" | "assistant"; content: string; citations: Source[]; created_at: string | null }

interface TutorPanelProps {
  courseId?: number
  threadId: number | null
  onOpenThread: (id: number | null) => void
}

export function TutorPanel({ courseId, threadId, onOpenThread }: TutorPanelProps) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [mode, setMode] = useState<"normale" | "socratico">("normale")

  const { data: threads = [], isLoading } = useQuery<ThreadRow[]>({
    queryKey: ["tutorThreads", courseId ?? "all"],
    queryFn: () => api.getTutorThreads(courseId),
  })

  const createMutation = useMutation({
    mutationFn: () => api.createTutorThread(courseId ?? null, mode),
    onSuccess: (t: { id: number }) => {
      void queryClient.invalidateQueries({ queryKey: ["tutorThreads"] })
      onOpenThread(t.id)
    },
    onError: (err) => toast({ variant: "destructive", title: "Conversazione non creata", description: describeError(err) }),
  })
  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.deleteTutorThread(id),
    onSuccess: (_r, id) => {
      void queryClient.invalidateQueries({ queryKey: ["tutorThreads"] })
      if (id === threadId) onOpenThread(null)
    },
    onError: (err) => toast({ variant: "destructive", title: "Conversazione non eliminata", description: describeError(err) }),
  })

  if (threadId !== null) {
    return <TutorThread threadId={threadId} onBack={() => onOpenThread(null)} onDelete={() => deleteMutation.mutate(threadId)} />
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2"><Brain className="h-5 w-5" />Tutor sul materiale del corso</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-neutral-200 dark:border-neutral-700 p-0.5 text-xs" role="group" aria-label="Modalità del tutor">
            {(["normale", "socratico"] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                onClick={() => setMode(m)}
                className={mode === m ? "px-2 py-1 rounded-md bg-accent-500 text-white" : "px-2 py-1 rounded-md text-neutral-500"}
              >
                {m === "normale" ? "Risposte" : "Socratico"}
              </button>
            ))}
          </div>
          <Button size="sm" className="gap-1" disabled={createMutation.isPending} onClick={() => createMutation.mutate()}>
            <Plus className="h-4 w-4" />Nuova conversazione
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Il tutor cerca nelle trascrizioni, nei PDF e negli appunti{courseId ? " del corso selezionato" : ""} e cita le fonti. Ogni domanda usa l'AI.
        </p>
        {isLoading ? (
          <Loader2 className="h-5 w-5 animate-spin text-accent-500" />
        ) : threads.length === 0 ? (
          <p className="text-center py-8 text-neutral-500 dark:text-neutral-400">Nessuna conversazione salvata.</p>
        ) : (
          threads.map((t) => (
            <div key={t.id} className="flex items-center justify-between gap-2 p-3 rounded-lg border border-neutral-200 dark:border-neutral-700">
              <button type="button" className="flex-1 min-w-0 text-left" onClick={() => onOpenThread(t.id)}>
                <p className="font-medium truncate">{t.title || "Conversazione senza domande"}</p>
                <p className="text-xs text-neutral-500 dark:text-neutral-400 truncate">
                  {t.course || "Tutti i corsi"} · {t.n} messaggi · {t.mode === "socratico" ? "socratico · " : ""}{safeFormatDistance(t.created_at, "data n.d.")}
                </p>
              </button>
              <Button variant="ghost" size="icon" aria-label="Elimina conversazione" onClick={() => deleteMutation.mutate(t.id)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}

function TutorThread({ threadId, onBack, onDelete }: { threadId: number; onBack: () => void; onDelete: () => void }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { toast } = useToast()
  const [question, setQuestion] = useState("")

  const { data: thread, isLoading, isError } = useQuery<{ id: number; title: string | null; course_id: number | null; mode: string; messages: Message[] }>({
    queryKey: ["tutorThread", threadId],
    queryFn: () => api.getTutorThread(threadId),
  })

  const ask = useMutation({
    mutationFn: (q: string) => api.askTutor(threadId, q),
    onSuccess: () => {
      setQuestion("")
      void queryClient.invalidateQueries({ queryKey: ["tutorThread", threadId] })
      void queryClient.invalidateQueries({ queryKey: ["tutorThreads"] })
    },
    onError: (err) => toast({ variant: "destructive", title: "Il tutor non ha risposto", description: describeError(err) }),
  })

  const openSource = async (s: Source) => {
    if (s.lecture_id !== null && s.t_start !== null) {
      try {
        const lec = await api.getLecture(s.lecture_id)
        if (typeof lec?.course_id === "number") navigate(`/corsi/${lec.course_id}?lezione=${s.lecture_id}&t=${Math.floor(s.t_start)}`)
      } catch (err) {
        toast({ variant: "destructive", title: "Fonte non apribile", description: describeError(err) })
      }
      return
    }
    window.open(`/api/docs/${s.doc_id}/file${s.kind === "pdf" && s.page ? `#page=${s.page}` : ""}`, "_blank", "noopener")
  }

  const submit = () => {
    const q = question.trim()
    if (q && !ask.isPending) ask.mutate(q)
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Button variant="ghost" size="icon" onClick={onBack} aria-label="Torna alle conversazioni"><ArrowLeft className="h-4 w-4" /></Button>
          <CardTitle className="truncate text-base">{thread?.title || "Nuova conversazione"}</CardTitle>
          {thread?.mode === "socratico" && <Badge variant="outline">Socratico</Badge>}
        </div>
        <Button variant="ghost" size="icon" onClick={onDelete} aria-label="Elimina conversazione"><Trash2 className="h-4 w-4" /></Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && <Loader2 className="h-5 w-5 animate-spin text-accent-500" />}
        {isError && <p role="alert" className="text-sm text-error-600">Conversazione non trovata.</p>}
        <div className="space-y-3">
          {thread?.messages.map((m) => (
            <div key={m.id} className={m.role === "user" ? "ml-auto max-w-[90%] rounded-xl bg-accent-50 dark:bg-accent-900/20 p-3" : "max-w-full rounded-xl bg-neutral-50 dark:bg-neutral-900/60 p-3"}>
              <div className="text-sm"><MathMarkdown content={m.content} /></div>
              {m.role === "assistant" && m.citations?.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {m.citations.map((s) => (
                    <button key={s.n} type="button" onClick={() => void openSource(s)} className="inline-flex items-center gap-1 rounded-md border border-neutral-200 dark:border-neutral-700 px-2 py-0.5 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800 max-w-full">
                      {s.lecture_id !== null && s.t_start !== null ? <PlayCircle className="h-3 w-3 shrink-0" /> : <FileText className="h-3 w-3 shrink-0" />}
                      <span className="truncate">[{s.n}] {s.title}{s.where ? ` · ${s.where}` : ""}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
          {thread && thread.messages.length === 0 && (
            <p className="text-sm text-neutral-500 text-center py-4">Scrivi la prima domanda sul materiale del corso.</p>
          )}
        </div>
        <form className="flex gap-2 items-end" onSubmit={(e) => { e.preventDefault(); submit() }}>
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit() } }}
            rows={2}
            maxLength={4000}
            placeholder="La tua domanda (Invio per inviare, Maiusc+Invio per andare a capo)"
            aria-label="Domanda al tutor"
            className="flex-1 min-w-0 rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          />
          <Button type="submit" disabled={!question.trim() || ask.isPending} className="gap-1">
            {ask.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Invia
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
