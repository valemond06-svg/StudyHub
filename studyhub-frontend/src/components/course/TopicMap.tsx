import { useState } from "react"
import { Link } from "react-router-dom"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Check, EyeOff, Eye } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { MathInline } from "@/components/ui/math-markdown"
import { api, describeError } from "@/lib/api"
import type { StudyTopic } from "@/types"
import { cn } from "@/lib/utils"

type MapTopic = StudyTopic & { learned?: string | null }

const LEVEL_STYLE: Record<number, string> = {
  4: "border-success-400 bg-success-50 dark:border-success-700 dark:bg-success-900/20",
  3: "border-success-300 bg-success-50/60 dark:border-success-800 dark:bg-success-900/10",
  2: "border-warning-300 bg-warning-50 dark:border-warning-800 dark:bg-warning-900/20",
  1: "border-error-300 bg-error-50 dark:border-error-800 dark:bg-error-900/20",
  0: "border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900",
}

/** Le tessere per argomento, raggruppate per capitolo: colore = livello misurato, ●●● = peso all'esame. */
export function TopicMap({ courseId, topics, chapters, excluded }: {
  courseId: number
  topics: MapTopic[]
  chapters: { name: string; topics: number; weight: number; mastery: number; mastery_exam: number }[]
  excluded: string[]
}) {
  const client = useQueryClient()
  const [selected, setSelected] = useState<number | null>(null)
  const toggle = useMutation({
    mutationFn: ({ chapter, exclude }: { chapter: string; exclude: boolean }) => api.setChapterExcluded(courseId, chapter, exclude),
    onSuccess: () => Promise.all([
      client.invalidateQueries({ queryKey: ["study", courseId] }),
      client.invalidateQueries({ queryKey: ["studyChapters", courseId] }),
      client.invalidateQueries({ queryKey: ["excludedChapters", courseId] }),
    ]),
  })

  const byChapter = new Map<string, MapTopic[]>()
  for (const t of topics) {
    const key = t.chapter || "Senza capitolo"
    byChapter.set(key, [...(byChapter.get(key) ?? []), t])
  }
  const chapterStats = new Map(chapters.map((c) => [c.name, c]))
  const counts = [4, 3, 2, 1].map((lv) => ({ lv, n: topics.filter((t) => t.tried && t.level === lv).length }))
  const never = topics.filter((t) => !t.tried).length

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2">
          Mappa del corso
          <Badge variant="outline">{byChapter.size} capitoli · {topics.length} argomenti</Badge>
        </CardTitle>
        {topics.length > 0 && (
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            Pronto {counts[0].n} · Solido {counts[1].n} · In crescita {counts[2].n} · Fragile {counts[3].n} · Mai provato {never}.
            Il colore viene dalle tue risposte, non dal materiale letto.
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-5">
        {topics.length === 0 && <p className="py-6 text-center text-neutral-500 dark:text-neutral-400">Nessun argomento: prepara prima il materiale del corso.</p>}
        {[...byChapter.entries()].map(([chapter, list]) => {
          const stats = chapterStats.get(chapter)
          return (
            <section key={chapter} className="space-y-2" aria-label={`Capitolo ${chapter}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="min-w-0 break-words font-medium"><MathInline content={chapter} /></h3>
                <div className="flex items-center gap-2 text-xs text-neutral-500">
                  {stats && <span title="Padronanza stimata al giorno dell'esame">all'esame {Math.round(stats.mastery_exam * 100)}%</span>}
                  {chapter !== "Senza capitolo" && (
                    <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" disabled={toggle.isPending}
                      onClick={() => toggle.mutate({ chapter, exclude: true })} title="Escludi il capitolo (es. parte già superata)">
                      <EyeOff className="h-3.5 w-3.5" /> Escludi
                    </Button>
                  )}
                </div>
              </div>
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {list.map((t) => {
                  const lv = t.tried ? t.level ?? 0 : 0
                  const open = selected === t.id
                  return (
                    <li key={t.id} className={cn("rounded-lg border p-3 text-sm", LEVEL_STYLE[lv] ?? LEVEL_STYLE[0])}>
                      <button type="button" className="w-full text-left" aria-expanded={open} onClick={() => setSelected(open ? null : t.id)}>
                        <span className="flex items-start justify-between gap-2">
                          <span className="min-w-0 break-words font-medium"><MathInline content={t.name} /></span>
                          <span className="shrink-0 tracking-tighter text-neutral-500" aria-label={`Peso ${t.weight} su 3`}>{"●".repeat(t.weight || 1)}</span>
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-neutral-600 dark:text-neutral-400">
                          <span>{t.tried ? t.level_name : "Mai provato"}</span>
                          {t.tried ? <span>{Math.round((t.m ?? 0) * 100)}% oggi · {Math.round((t.m_exam ?? 0) * 100)}% all'esame</span> : null}
                          <span>{t.n_items ?? 0} domande</span>
                          {t.learned && <span className="inline-flex items-center gap-0.5"><Check className="h-3 w-3" />lezione fatta</span>}
                        </span>
                      </button>
                      {open && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Button size="sm" variant="outline" asChild><Link to={`/impara/${t.id}`}>Impara</Link></Button>
                          {(t.n_items ?? 0) > 0 && <Button size="sm" asChild><Link to={`/studio/${courseId}?topic=${t.id}&duration=25`}>Allenati 25 min</Link></Button>}
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>
          )
        })}
        {excluded.length > 0 && (
          <div className="rounded-lg border border-dashed border-neutral-300 p-3 text-sm dark:border-neutral-700">
            <p className="mb-2 text-neutral-500">Capitoli esclusi (non contano nella prontezza):</p>
            <ul className="flex flex-wrap gap-2">
              {excluded.map((c) => (
                <li key={c}>
                  <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" disabled={toggle.isPending} onClick={() => toggle.mutate({ chapter: c, exclude: false })}>
                    <Eye className="h-3.5 w-3.5" /> Rimetti «{c}»
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {toggle.error && <p role="alert" className="text-sm text-error-600">{describeError(toggle.error)}</p>}
      </CardContent>
    </Card>
  )
}
