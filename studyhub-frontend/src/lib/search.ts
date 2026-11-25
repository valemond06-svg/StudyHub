/**
 * Adapter della ricerca: GET /api/search risponde
 *   {results: [{id, kind, page, t_start, t_end, heading, doc_id, path, title, lecture_id, course, course_id, snippet, score}],
 *    semantic: boolean}
 * (backend/src/studyhub/search.py). Lo snippet marca i termini trovati con [[ ]].
 */
import { documentHref } from "@/lib/documents"

export type SearchGroup = "lezioni" | "documenti" | "appunti" | "codice"

export interface SearchHit {
  /** id del chunk */
  id: number
  kind: string
  group: SearchGroup
  title: string
  snippet: string
  course: string | null
  courseId: number | null
  docId: number
  lectureId: number | null
  page: number | null
  tStart: number | null
  heading: string | null
  score: number
}

export interface SearchResponse {
  results: SearchHit[]
  semantic: boolean
}

export const SEARCH_GROUP_LABEL: Record<SearchGroup, string> = {
  lezioni: "Lezioni registrate",
  documenti: "Documenti e slide",
  appunti: "Appunti e testi",
  codice: "Codice",
}

export const SEARCH_GROUP_ORDER: SearchGroup[] = ["lezioni", "documenti", "appunti", "codice"]

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null
}

export function groupForKind(kind: string): SearchGroup {
  if (kind === "transcript") return "lezioni"
  if (kind === "pdf" || kind === "pptx" || kind === "docx") return "documenti"
  if (kind === "code") return "codice"
  return "appunti"
}

function basename(path: string | null): string | null {
  if (!path) return null
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] || null
}

export function toSearchHit(raw: unknown): SearchHit | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  const id = num(r.id)
  const docId = num(r.doc_id)
  if (id === null || docId === null) return null
  const kind = str(r.kind) ?? "text"
  return {
    id,
    kind,
    group: groupForKind(kind),
    title: str(r.title) ?? basename(str(r.path)) ?? `Documento ${docId}`,
    snippet: typeof r.snippet === "string" ? r.snippet : "",
    course: str(r.course),
    courseId: num(r.course_id),
    docId,
    lectureId: num(r.lecture_id),
    page: num(r.page),
    tStart: num(r.t_start),
    heading: str(r.heading),
    score: num(r.score) ?? 0,
  }
}

export function toSearchResponse(raw: unknown): SearchResponse {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  const list = Array.isArray(obj.results) ? obj.results : []
  return {
    results: list.map(toSearchHit).filter((h): h is SearchHit => h !== null),
    semantic: obj.semantic === true,
  }
}

/** Raggruppa mantenendo l'ordine di rilevanza dentro ciascun gruppo. */
export function groupSearchHits(hits: SearchHit[]): Array<{ group: SearchGroup; label: string; hits: SearchHit[] }> {
  return SEARCH_GROUP_ORDER
    .map((group) => ({ group, label: SEARCH_GROUP_LABEL[group], hits: hits.filter((h) => h.group === group) }))
    .filter((g) => g.hits.length > 0)
}

/** Divide lo snippet in parti normali e parti evidenziate ([[ ]]). */
export function splitSnippet(snippet: string): Array<{ text: string; mark: boolean }> {
  const out: Array<{ text: string; mark: boolean }> = []
  const re = /\[\[([\s\S]*?)\]\]/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(snippet)) !== null) {
    if (m.index > last) out.push({ text: snippet.slice(last, m.index), mark: false })
    out.push({ text: m[1], mark: true })
    last = re.lastIndex
  }
  if (last < snippet.length) out.push({ text: snippet.slice(last), mark: false })
  return out
}

export type SearchTarget =
  | { type: "lecture"; courseId: number | null; lectureId: number; t: number }
  | { type: "document"; url: string }

/**
 * Dove porta un risultato (come openSource della vecchia UI):
 * trascrizione → player della lezione al secondo esatto; PDF → file alla pagina; altro → file.
 */
export function searchTarget(hit: SearchHit): SearchTarget {
  if (hit.lectureId !== null && hit.tStart !== null) {
    return { type: "lecture", courseId: hit.courseId, lectureId: hit.lectureId, t: Math.max(0, Math.floor(hit.tStart)) }
  }
  return { type: "document", url: documentHref(hit.docId, hit.kind === "pdf" ? hit.page : null) }
}

/** "▶ 12:34", "p. 7" o il tipo: dove si trova il risultato. */
export function searchWhere(hit: SearchHit): string {
  if (hit.tStart !== null && hit.group === "lezioni") {
    const s = Math.floor(hit.tStart)
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = String(s % 60).padStart(2, "0")
    return `al minuto ${h ? `${h}:${String(m).padStart(2, "0")}` : m}:${sec}`
  }
  if (hit.page) return `p. ${hit.page}`
  return hit.kind.toUpperCase()
}
