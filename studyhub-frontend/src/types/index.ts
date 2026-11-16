export interface Course {
  id: number
  fullname: string
  shortname: string
  year_of_study: number
  semester: number
  passed: boolean
  priority: number
  folder: string
  moodle_id: number
  readiness?: number
  next_exam_date?: string
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
  type: string
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

export interface FeedItem {
  id: string
  type: "file" | "lecture" | "avviso"
  title: string
  course: string
  course_id: number
  date: string
  icon: React.ReactNode
}

export interface FeedData {
  due_flashcards: number
  new_items: FeedItem[]
}

export interface PlanActivity {
  type: string
  label: string
  icon: React.ReactNode
}

export interface RecommendedSession {
  course_id: number
  duration: number
  reason: string
  activities: PlanActivity[]
}

export interface PlanData {
  recommended_session?: RecommendedSession
  next_topic?: Record<number, { name: string }>
}