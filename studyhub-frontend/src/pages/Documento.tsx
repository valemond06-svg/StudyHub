import { useEffect, useState } from "react"
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { ArrowLeft, ChevronLeft, ChevronRight, ExternalLink, FileText, Image as ImageIcon, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { api, describeError } from "@/lib/api"
import { documentFileUrl } from "@/lib/documents"
import { MathMarkdown } from "@/components/ui/math-markdown"

interface DocInfo {
  id: number
  course_id: number | null
  path: string
  kind: string
  title: string | null
  n_pages: number | null
}

type ViewMode = "pdf" | "immagine"

const TEXT_KINDS = new Set(["md", "text", "code", "transcript"])
const MAX_TEXT = 400_000

/** Markdown (con formule) e testo semplice si leggono direttamente nell'app, senza scaricarli. */
function TextDocument({ docId, markdown }: { docId: number; markdown: boolean }) {
  const text = useQuery({
    queryKey: ["doc-text", docId],
    queryFn: async () => {
      const res = await fetch(documentFileUrl(docId), { credentials: "include" })
      if (!res.ok) throw new Error(`File non disponibile (HTTP ${res.status}).`)
      const body = await res.text()
      return body.length > MAX_TEXT ? `${body.slice(0, MAX_TEXT)}\n\n[...troncato: apri il file per leggerlo tutto]` : body
    },
  })
  if (text.isPending) return <p className="text-sm text-neutral-500">Caricamento del file...</p>
  if (text.isError) return <p role="alert" className="text-sm text-error-600">{describeError(text.error)}</p>
  return (
    <article className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900 sm:p-6">
      {markdown ? <MathMarkdown content={text.data} /> : <pre className="whitespace-pre-wrap break-words text-sm">{text.data}</pre>}
    </article>
  )
}

function PageJump({ page, pages, onGo }: { page: number; pages: number; onGo: (p: number) => void }) {
  const [draft, setDraft] = useState(String(page))
  return (
    <form className="flex items-center gap-1 text-sm" onSubmit={(e) => { e.preventDefault(); onGo(Number(draft) || 1) }}>
      <label htmlFor="doc-pagina">Pagina</label>
      <Input id="doc-pagina" inputMode="numeric" className="h-9 w-16 text-center" value={draft} onChange={(e) => setDraft(e.target.value.replace(/\D/g, ""))} />
      {pages ? <span className="text-neutral-500">di {pages}</span> : null}
      <Button type="submit" size="sm" variant="secondary">Vai</Button>
    </form>
  )
}

function initialMode(): ViewMode {
  // I browser mobili non mostrano i PDF dentro un riquadro: lì si parte dalle pagine come immagini.
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "pdf"
  return window.matchMedia("(max-width: 767px)").matches ? "immagine" : "pdf"
}

/** Visore dei documenti del corso dentro l'app: PDF nativo del browser con salto a pagina, o pagina come immagine. */
export function Documento() {
  const { docId } = useParams()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const id = Number(docId)
  const valid = Number.isSafeInteger(id) && id > 0
  const [mode, setMode] = useState<ViewMode>(initialMode)

  const info = useQuery<DocInfo>({ queryKey: ["doc", id], queryFn: () => api.getDocument(id), enabled: valid, retry: false })
  const doc = info.data
  const pages = doc?.n_pages ?? 0
  const requested = Math.max(1, Math.floor(Number(params.get("pagina")) || 1))
  const page = pages ? Math.min(requested, pages) : requested
  const goTo = (p: number) => {
    const next = new URLSearchParams(params)
    const target = pages ? Math.min(Math.max(1, p), pages) : Math.max(1, p)
    if (target === 1) next.delete("pagina")
    else next.set("pagina", String(target))
    setParams(next, { replace: true })
  }

  useEffect(() => {
    if (!doc || doc.kind !== "pdf") return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return
      if (e.key === "PageDown" || (mode === "immagine" && e.key === "ArrowRight")) { e.preventDefault(); goTo(page + 1) }
      if (e.key === "PageUp" || (mode === "immagine" && e.key === "ArrowLeft")) { e.preventDefault(); goTo(page - 1) }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  const title = doc?.title || doc?.path.split(/[\\/]/).pop() || "Documento"
  const back = () => (window.history.length > 1 ? navigate(-1) : navigate(doc?.course_id ? `/corsi/${doc.course_id}?tab=materiali` : "/corsi"))

  if (!valid) return <p role="alert" className="py-12 text-center">Indirizzo del documento non valido.</p>
  if (info.isPending) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-accent-500" aria-label="Caricamento documento" /></div>
  }
  if (info.isError || !doc) {
    return (
      <div role="alert" className="mx-auto max-w-md space-y-4 py-12 text-center">
        <p>{describeError(info.error, "Documento non disponibile.")}</p>
        <Button variant="outline" onClick={() => navigate("/corsi")}>Torna ai corsi</Button>
      </div>
    )
  }

  const isPdf = doc.kind === "pdf"
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="icon" onClick={back} aria-label="Indietro"><ArrowLeft className="h-5 w-5" /></Button>
        <div className="min-w-0 flex-1">
          <h1 className="break-all text-lg font-semibold sm:break-words sm:text-xl">{title}</h1>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            {isPdf ? (pages ? `${pages} pagine` : "PDF") : doc.kind.toUpperCase()}
            {doc.course_id ? <> · <Link className="underline underline-offset-2" to={`/corsi/${doc.course_id}?tab=materiali`}>materiali del corso</Link></> : null}
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <a href={documentFileUrl(doc.id, isPdf ? page : null)} target="_blank" rel="noreferrer" className="gap-1">
            <ExternalLink className="h-4 w-4" /> <span className="hidden sm:inline">Apri in una nuova scheda</span><span className="sm:hidden">Apri</span>
          </a>
        </Button>
      </div>

      {isPdf ? (
        <>
          <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Pagine">
            <Button variant="outline" size="icon" onClick={() => goTo(page - 1)} disabled={page <= 1} aria-label="Pagina precedente"><ChevronLeft className="h-4 w-4" /></Button>
            <PageJump key={page} page={page} pages={pages} onGo={goTo} />
            <Button variant="outline" size="icon" onClick={() => goTo(page + 1)} disabled={pages > 0 && page >= pages} aria-label="Pagina successiva"><ChevronRight className="h-4 w-4" /></Button>
            <div className="ml-auto flex gap-1" role="group" aria-label="Modalità di visualizzazione">
              <Button size="sm" variant={mode === "pdf" ? "default" : "outline"} aria-pressed={mode === "pdf"} onClick={() => setMode("pdf")} className="gap-1"><FileText className="h-4 w-4" />PDF</Button>
              <Button size="sm" variant={mode === "immagine" ? "default" : "outline"} aria-pressed={mode === "immagine"} onClick={() => setMode("immagine")} className="gap-1"><ImageIcon className="h-4 w-4" />Pagina</Button>
            </div>
          </div>
          {mode === "pdf" ? (
            <iframe
              key={page}
              title={`${title}, pagina ${page}`}
              src={documentFileUrl(doc.id, page)}
              className="h-[calc(100vh-13rem)] min-h-[420px] w-full rounded-xl border border-neutral-200 bg-white dark:border-neutral-800"
            />
          ) : (
            <div className="overflow-auto rounded-xl border border-neutral-200 bg-white p-2 dark:border-neutral-800">
              <img
                key={page}
                src={api.documentPageUrl(doc.id, page, 130)}
                alt={`${title}, pagina ${page}`}
                className="mx-auto h-auto max-w-full"
              />
            </div>
          )}
        </>
      ) : TEXT_KINDS.has(doc.kind) ? (
        <TextDocument docId={doc.id} markdown={doc.kind === "md"} />
      ) : (
        <div className="rounded-xl border border-neutral-200 p-6 text-sm dark:border-neutral-800">
          <p>Questo file ({doc.kind}) non si apre nel visore: aprilo nella nuova scheda o scaricalo.</p>
          <Button className="mt-3" asChild><a href={documentFileUrl(doc.id)} download>Scarica il file</a></Button>
        </div>
      )}
    </div>
  )
}
