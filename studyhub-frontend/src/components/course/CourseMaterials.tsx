import { Link, useSearchParams } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { FileText, Megaphone } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { MathMarkdown } from "@/components/ui/math-markdown"
import { api, describeError } from "@/lib/api"
import { categoryLabel, documentHref, sortCategories, type CourseDocuments } from "@/lib/documents"

/** Materiale del corso per categoria (prima esami passati, soluzioni, formulari) e avvisi del docente. */
export function CourseMaterials({ courseId }: { courseId: number }) {
  const [params, setParams] = useSearchParams()
  const docs = useQuery<CourseDocuments>({ queryKey: ["courseDocs", courseId], queryFn: () => api.getCourseDocuments(courseId) })
  const news = useQuery({ queryKey: ["courseNews", courseId], queryFn: () => api.getCourseAnnouncements(courseId, 10) })

  const categories = sortCategories(docs.data?.categories ?? [])
  const requested = params.get("categoria")
  const active = requested && categories.some((c) => c.category === requested) ? requested : categories[0]?.category ?? null
  const list = (docs.data?.documents ?? []).filter((d) => d.category === active)
  const choose = (category: string) => {
    const next = new URLSearchParams(params)
    next.set("tab", "materiali")
    next.set("categoria", category)
    setParams(next, { replace: true })
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" />Materiale per categoria</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {docs.isPending && <p className="text-sm text-neutral-500">Caricamento materiale...</p>}
          {docs.error && <p role="alert" className="text-sm text-error-600">{describeError(docs.error)}</p>}
          {docs.data && categories.length === 0 && (
            <p className="text-sm text-neutral-500 dark:text-neutral-400">Nessun documento classificato per questo corso (serve un sync del materiale Moodle).</p>
          )}
          {categories.length > 0 && (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Categorie di materiale">
              {categories.map((c) => (
                <Button key={c.category} size="sm" variant={c.category === active ? "default" : "outline"} aria-pressed={c.category === active} onClick={() => choose(c.category)}>
                  {categoryLabel(c.category)} ({c.count})
                </Button>
              ))}
            </div>
          )}
          {list.length > 0 && (
            <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {list.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <Link to={documentHref(d.id)} className="break-words font-medium text-accent-700 hover:underline dark:text-accent-400">
                      {d.title || d.name}
                    </Link>
                    <p className="text-xs text-neutral-500">
                      {d.kind.toUpperCase()}{d.n_pages ? ` · ${d.n_pages} pagine` : ""}{d.exam_date ? ` · appello del ${new Date(`${d.exam_date}T12:00:00`).toLocaleDateString("it-IT")}` : ""}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" asChild className="shrink-0"><Link to={documentHref(d.id)}>Apri</Link></Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Megaphone className="h-5 w-5" />Avvisi del docente</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {news.isPending && <p className="text-sm text-neutral-500">Caricamento avvisi...</p>}
          {news.error && <p role="alert" className="text-sm text-error-600">{describeError(news.error)}</p>}
          {news.data && news.data.items.length === 0 && <p className="text-sm text-neutral-500 dark:text-neutral-400">Nessun avviso Moodle salvato per questo corso.</p>}
          {news.data?.items.map((md, i) => (
            <article key={i} className="rounded-lg border border-neutral-200 p-3 text-sm dark:border-neutral-800">
              <MathMarkdown content={md} />
            </article>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
