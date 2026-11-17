export interface Course {
  id: number
  fullname: string
  year_of_study: number
  passed: boolean
  active: number
  priority: number
  folder: string | null
  /** numero di lezioni del corso (da /api/courses) */
  lectures: number
  /** numero di lezioni pronte (media_ok/trascritta) (da /api/courses) */
  ready: number
  // Campi frontend-only (non esposti dal backend, usati dalle pagine UI)
  shortname?: string
  semester?: number
  readiness?: number
  next_exam_date?: string | null
}

export interface Lecture {
  id: number
  course_id: number
  title: string
  status: "nuova" | "media_ok" | "trascritta" | "pronta" | "errore"
  source: "moodle" | "panopto" | "manual"
  date: string
  duration: number
  has_audio: boolean
  has_slides: boolean
  has_transcript: boolean
  has_notes: boolean
  folder: string
  // Additional fields from lecture detail endpoint
  panopto_id?: string | null
  viewer_url?: string | null
  panopto_embed_url?: string | null
  media_url?: string | null
  has_local_audio?: boolean
  has_local_slides?: boolean
  video_modes?: string[]
  default_mode?: string
  videos?: string[]
  slides?: any[]
  transcript?: { segments: any[] }
  silences?: any[]
}

export interface Flashcard {
  id: number
  lecture_id: number
  fronte: string
  retro: string
  due_date: string
  interval: number
  ease_factor: number
  reps: number
}

export interface Quiz {
  id: number
  lecture_id: number
  type: "richiamo" | "multipla" | "vero_falso" | "aperta" | "esercizio"
  prompt: string
  options?: string[]
  answer: string
  solution: string
  difficulty: number
}

export interface Exam {
  id: number
  course_id: number
  course: string
  date: string
  kind: string
  done: boolean
  days_left: number | null
  note?: string | null
  created_at?: string
}

export interface ExamProfile {
  id: number
  course_id: number
  parts: ExamPart[]
  topics: ExamTopic[]
  exercises: ExamExercise[]
  theory: string[]
  advice: string[]
  generated_at: string
}

export interface ExamPart {
  name: string
  points: number
  minimum: number
  weight: number
}

export interface ExamTopic {
  name: string
  frequency: string
  weight: number
}

export interface ExamExercise {
  type: string
  method: string
  common_errors: string[]
}

export interface Simulation {
  id: string
  course_id: number
  exam_profile_id: number
  questions: SimulationQuestion[]
  started_at: string
  completed_at?: string
  score?: number
  passed?: boolean
}

export interface SimulationQuestion {
  id: string
  type: string
  prompt: string
  options?: string[]
  answer: string
  solution: string
  points: number
}

export interface TutorThread {
  id: string
  course_id: number
  title: string
  messages: TutorMessage[]
  created_at: string
  updated_at: string
}

export interface TutorMessage {
  id: string
  role: "user" | "assistant"
  content: string
  citations?: Citation[]
  created_at: string
}

export interface Citation {
  lecture_id: number
  lecture_title: string
  t_start: number
  t_end: number
  text: string
}

export interface StudyTopic {
  id: number
  course_id: number
  name: string
  chapter: number
  position: number
  weight: number
  mastery: number
  hidden: 0 | 1 | 2
  questions_total: number
  questions_practiced: number
}

export interface AIJob {
  id: number
  kind: "lecture_notes" | "ocr" | "flashcards" | "quiz" | "exam_profile" | "simulation" | "tutor"
  course_id: number
  lecture_id?: number
  priority: number
  status: "pending" | "running" | "done" | "error"
  attempts: number
  error?: string
  created_at: string
  started_at?: string
  completed_at?: string
}

export interface NightTurn {
  date: string
  transcriptions: number
  units_35b: number
  sonnet_notes: number
  ocr_jobs: number
  embedding_batches: number
  duration_minutes: number
}

export interface AIPanelData {
  queue: AIJob[]
  backlog: AIJob[]
  pro_window: {
    utilization: number
    resets_at: string
    threshold: number
  }
  last_night: NightTurn | null
}

// --- Piano di oggi (/api/plan) ---------------------------------------------------

export interface PlanFlashcards {
  totale: number
  da_ripassare: number
  ripassate_oggi: number
}

export interface PlanTask {
  kind: string
  priority: number
  title: string
  detail: string
  ai?: boolean
  course_id?: number
  lecture_id?: number
}

export interface PlanCourse {
  course_id: number
  course: string
  exam: Exam | null
  days_left: number | null
  lectures: number
  with_notes: number
  profile: boolean
  sims: number
  best_grade: number | null
  urgency: number
}

export interface PlanData {
  today: string
  exams: Exam[]
  tasks: PlanTask[]
  courses: PlanCourse[]
  flashcards: PlanFlashcards
}

// --- Novità / notifiche (/api/notifications) ---------------------------------------

export interface NotificationItem {
  id: number
  kind: string
  course_id: number | null
  title: string
  body: string
  ref: string | null
  read: number
  course: string | null
  created_at: string
}

// --- Flashcard in scadenza (/api/flashcards/due) -----------------------------------

export interface DueFlashcardsResponse {
  cards: Flashcard[]
  stats: { totale: number; da_ripassare: number; ripassate_oggi: number }
}

// --- AI Status (/api/ai/status) ----------------------------------------------------

export interface AIJobStatus {
  jobs: any[]
  paused_reason: string | null
  usage: any
  backlog: any
}

export interface AIProvidersStatus {
  local: { available: boolean; healthy: boolean; url: string | null }
  gemini: { available: boolean; healthy: boolean; url: string | null }
  freellm: { available: boolean; healthy: boolean; url: string | null }
  claude: { available: boolean; healthy: boolean; url: string | null; utilization?: number; resets_at?: number }
}

// --- StudyTok Feed (/api/feed) -----------------------------------------------------

export interface FeedShort {
  id: string
  topic_id: number
  course_id: number
  course_name: string
  title: string
  hook_md: string
  widget: any | null
  slide: { doc_id: number; page: number } | null
  audio: { lecture_id: number; start_s: number; lecture_title: string } | null
  exam_trick: string | null
  archetipo_nome: string | null
  has_pcp: boolean
  has_sniper: boolean
}

export interface FeedResponse {
  shorts: FeedShort[]
}

// --- Study Course Stats (/api/study/{id}) ------------------------------------------

export interface StudyCourseStats {
  streak: number
  xp_total: number
  xp_today: number
  ready_exam: boolean
}

// --- AI Status (/api/ai/status) ----------------------------------------------------

export interface AIStatusResponse {
  local: boolean
  gemini: boolean
  freellm: boolean
  claude: boolean
}

// --- Storage (/api/storage) --------------------------------------------------------

export interface StorageStatus {
  media_root: string | null
  free_gb: number
  // Frontend-computed/derived fields (not from backend)
  db_size_mb?: number
  media_size_gb?: number
  cache_size_mb?: number
  total_gb?: number
  disk_total_gb?: number
}

// --- Fullrun (/api/fullrun) --------------------------------------------------------

export interface FullrunStatus {
  running: boolean
  progress?: number
  phase?: string
  message?: string
}