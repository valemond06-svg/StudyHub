/**
 * Adapter del player: trasforma il JSON reale di GET /api/lectures/{id} (backend/src/studyhub/api/app.py)
 * nel formato interno del VideoPlayer.
 *
 * Formato del backend:
 *  - transcript: {segments: [{start, end, text}]}           (media/transcribe.py)
 *  - slides: [{file, start, end, shot_at}]                   (media/slides.py) → /media/{id}/slides/{file}
 *  - silences: [[inizio, fine], …]                           (media/audio.py)
 *  - has_local_audio, has_local_slides, video_modes, default_mode, videos, media_url, panopto_embed_url, viewer_url
 */

export type PlayerMode = "panopto" | "video" | "slides"

export interface TranscriptSegment {
  t_start: number
  t_end: number
  text: string
}

export interface SlideInfo {
  index: number
  timestamp: number
  end: number | null
  url: string
  thumbnailUrl: string
}

export interface SilenceInterval {
  start: number
  end: number
}

export interface LectureMediaData {
  title: string
  courseId: number | null
  audioUrl: string | null
  /** URL riproducibile nel tag <video>: MP4 di Moodle o video archiviato (/video/{id}/{kind}) */
  videoUrl: string | null
  /** Il video è su un server esterno (Moodle): può richiedere il login nel browser */
  videoIsRemote: boolean
  panoptoEmbedUrl: string | null
  viewerUrl: string | null
  transcript: TranscriptSegment[]
  silences: SilenceInterval[]
  slides: SlideInfo[]
  modes: PlayerMode[]
  defaultMode: PlayerMode | null
}

function finite(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null
}

function nonEmpty(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null
}

export function toTranscript(raw: unknown): TranscriptSegment[] {
  const segs = raw && typeof raw === "object" && Array.isArray((raw as { segments?: unknown }).segments)
    ? (raw as { segments: unknown[] }).segments
    : []
  const out: TranscriptSegment[] = []
  for (const s of segs) {
    if (!s || typeof s !== "object") continue
    const start = finite((s as Record<string, unknown>).start)
    const end = finite((s as Record<string, unknown>).end)
    const text = (s as Record<string, unknown>).text
    if (start === null || typeof text !== "string") continue
    out.push({ t_start: start, t_end: end ?? start, text: text.trim() })
  }
  return out.sort((a, b) => a.t_start - b.t_start)
}

export function toSlides(raw: unknown, lectureId: number): SlideInfo[] {
  if (!Array.isArray(raw)) return []
  const out: SlideInfo[] = []
  for (const s of raw) {
    if (!s || typeof s !== "object") continue
    const file = nonEmpty((s as Record<string, unknown>).file)
    const start = finite((s as Record<string, unknown>).start)
    if (!file || start === null || file.includes("..")) continue
    const url = `/media/${lectureId}/slides/${encodeURIComponent(file)}`
    out.push({ index: 0, timestamp: start, end: finite((s as Record<string, unknown>).end), url, thumbnailUrl: url })
  }
  out.sort((a, b) => a.timestamp - b.timestamp)
  return out.map((s, i) => ({ ...s, index: i }))
}

export function toSilences(raw: unknown): SilenceInterval[] {
  if (!Array.isArray(raw)) return []
  const out: SilenceInterval[] = []
  for (const s of raw) {
    if (!Array.isArray(s) || s.length < 2) continue
    const start = finite(s[0])
    const end = finite(s[1])
    if (start === null || end === null || end <= start) continue
    out.push({ start, end })
  }
  return out.sort((a, b) => a.start - b.start)
}

function pickVideoKind(videos: string[]): string | null {
  if (!videos.length) return null
  if (videos.includes("screen")) return "screen"
  if (videos.includes("video")) return "video"
  return videos[0]
}

export function toLectureMedia(raw: unknown, lectureId: number): LectureMediaData {
  const d = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  const videos = Array.isArray(d.videos) ? (d.videos as unknown[]).filter((v): v is string => typeof v === "string") : []

  const panoptoEmbedUrl = nonEmpty(d.panopto_embed_url)
  const viewerUrl = nonEmpty(d.viewer_url)
  const mediaUrl = nonEmpty(d.media_url)
  const driveKind = pickVideoKind(videos)
  // Il video archiviato su Drive passa dal backend (stesso origin); quello di Moodle è remoto.
  const videoUrl = driveKind ? `/video/${lectureId}/${encodeURIComponent(driveKind)}` : mediaUrl
  const videoIsRemote = !driveKind && Boolean(mediaUrl) && /^https?:\/\//i.test(mediaUrl ?? "")

  const hasLocalAudio = d.has_local_audio === true
  const slides = d.has_local_slides === false ? [] : toSlides(d.slides, lectureId)
  const audioUrl = hasLocalAudio ? `/media/${lectureId}/audio.opus` : null

  const modes: PlayerMode[] = []
  if (panoptoEmbedUrl) modes.push("panopto")
  if (videoUrl) modes.push("video")
  if (audioUrl || slides.length) modes.push("slides")

  const order: Record<string, PlayerMode> = { panopto: "panopto", moodle: "video", drive: "video", slides: "slides" }
  const fromBackend = order[String(d.default_mode)]
  const defaultMode = fromBackend && modes.includes(fromBackend)
    ? fromBackend
    : (modes[0] ?? null)

  return {
    title: nonEmpty(d.title) ?? "Lezione",
    courseId: finite(d.course_id),
    audioUrl,
    videoUrl,
    videoIsRemote,
    panoptoEmbedUrl,
    viewerUrl,
    transcript: toTranscript(d.transcript),
    silences: toSilences(d.silences),
    slides,
    modes,
    defaultMode,
  }
}

/**
 * Dall'elenco lezioni (GET /api/courses/{id}/lectures, righe della tabella `lectures`):
 * la lezione si può aprire se c'è almeno una sorgente (audio locale, slide, Panopto o video Moodle).
 */
export function canOpenLecture(row: {
  has_audio?: unknown
  n_slides?: unknown
  panopto_id?: unknown
  viewer_url?: unknown
  media_url?: unknown
  video_type?: unknown
}): boolean {
  return Boolean(
    row.has_audio ||
    (typeof row.n_slides === "number" && row.n_slides > 0) ||
    nonEmpty(row.panopto_id) ||
    nonEmpty(row.media_url) ||
    (typeof row.viewer_url === "string" && row.viewer_url.toLowerCase().includes("panopto")) ||
    row.video_type === "panopto" || row.video_type === "moodle"
  )
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00"
  const totalSecs = Math.floor(seconds)
  const hours = Math.floor(totalSecs / 3600)
  const mins = Math.floor((totalSecs % 3600) / 60)
  const secs = totalSecs % 60
  if (hours > 0) return `${hours}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`
  return `${mins}:${secs.toString().padStart(2, "0")}`
}

/** Indice della slide mostrata al tempo t (l'ultima iniziata), -1 prima della prima. */
export function slideIndexAt(slides: SlideInfo[], t: number): number {
  let idx = -1
  for (let i = 0; i < slides.length; i++) {
    if (slides[i].timestamp <= t) idx = i
    else break
  }
  return idx
}

/** Se t cade in un silenzio restituisce la fine del silenzio, altrimenti null. */
export function silenceEndAt(silences: SilenceInterval[], t: number): number | null {
  const s = silences.find((x) => x.start <= t && x.end > t)
  return s ? s.end : null
}
