import type { FeedShort } from "@/types"

/**
 * Varietà nel feed: niente due pillole sullo stesso argomento, e quando possibile
 * corso e tipo di contenuto (audio / slide / solo testo) cambiano da una pillola alla successiva.
 * Ordine stabile (niente casualità nel client): dentro ogni gruppo resta l'ordine del backend.
 */
export function diversifyFeed(shorts: FeedShort[]): FeedShort[] {
  const seen = new Set<number>()
  const pool = shorts.filter((s) => (seen.has(s.topic_id) ? false : (seen.add(s.topic_id), true)))
  const kind = (s: FeedShort) => (s.audio ? "audio" : s.slide ? "slide" : "testo")
  const out: FeedShort[] = []
  while (pool.length) {
    const prev = out[out.length - 1]
    let idx = prev ? pool.findIndex((s) => s.course_id !== prev.course_id && kind(s) !== kind(prev)) : 0
    if (idx < 0 && prev) idx = pool.findIndex((s) => s.course_id !== prev.course_id || kind(s) !== kind(prev))
    if (idx < 0) idx = 0
    out.push(pool.splice(idx, 1)[0])
  }
  return out
}
