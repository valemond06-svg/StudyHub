/** Documenti del corso: visore PDF interno all'app (/documento/:id?pagina=N) e file servito dal backend. */

export function documentHref(docId: number, page?: number | null): string {
  return `/documento/${docId}${page ? `?pagina=${page}` : ""}`
}

/** URL del file per il visore nativo del browser (#page=N funziona in Chrome/Edge/Firefox). */
export function documentFileUrl(docId: number, page?: number | null): string {
  return `/api/docs/${docId}/file${page ? `#page=${page}` : ""}`
}

export const DOC_CATEGORY_LABELS: Record<string, string> = {
  appello: "Esami passati",
  soluzione: "Soluzioni",
  formulario: "Formulari",
  esercizi: "Esercizi",
  esiti: "Esiti",
  regole_esame: "Regole d'esame",
  programma: "Programma",
  calendario: "Calendario",
  slide: "Slide",
  appunti: "Appunti",
  materiale: "Altro materiale",
  avvisi: "Avvisi",
  forum: "Forum",
  sezione: "Pagine del corso",
  trascrizione: "Trascrizioni",
}

/** Prima quello che conta per l'esame: appelli passati, soluzioni, formulari, esercizi. */
export const DOC_CATEGORY_ORDER = [
  "appello", "soluzione", "formulario", "esercizi", "regole_esame", "esiti", "programma", "calendario",
  "slide", "appunti", "materiale", "sezione", "trascrizione", "avvisi", "forum",
]

export function sortCategories<T extends { category: string }>(rows: T[]): T[] {
  const rank = (c: string) => {
    const i = DOC_CATEGORY_ORDER.indexOf(c)
    return i < 0 ? DOC_CATEGORY_ORDER.length : i
  }
  return [...rows].sort((a, b) => rank(a.category) - rank(b.category) || a.category.localeCompare(b.category))
}

export function categoryLabel(category: string): string {
  return DOC_CATEGORY_LABELS[category] ?? category.replace(/_/g, " ")
}

export interface CourseDocument {
  id: number
  title: string | null
  name: string
  kind: string
  n_pages: number | null
  category: string
  exam_date: string | null
}

export interface CourseDocuments {
  categories: { category: string; count: number }[]
  documents: CourseDocument[]
}
