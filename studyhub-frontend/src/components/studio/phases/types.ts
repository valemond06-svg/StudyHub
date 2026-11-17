import type { ReactNode } from "react"

export interface QuestionData {
  id: string
  kind: "richiamo" | "multipla" | "vero_falso" | "aperta" | "esercizio"
  prompt_md: string
  options?: string[]
  answer_md: string
  correct?: number
  difficulty: number
  topic_id: number
  lecture_id?: number
  t_start?: number
  doc_id?: number
  page?: number
  n_criteria: number
}

export type SessionEntry = QuestionEntry | SchedaEntry

export interface QuestionEntry {
  id: number
  t: "domanda"
  question: QuestionData
  revealed?: boolean
  done?: boolean
  score?: number
  boss?: boolean
  retry?: boolean
}

export interface SchedaEntry {
  id: number
  t: "scheda"
  topic: number
  question?: never
  revealed?: boolean
  done?: boolean
  score?: never
  boss?: never
  retry?: never
}

export interface PhaseConfig {
  label: string
  icon: React.ComponentType<{ className?: string }>
  color: string
  bg: string
  duration: number
}

export interface AnswerData {
  choice?: number
  text?: string
}

export interface OnAnswerCallback {
  (isCorrect: boolean, confidence: number, answerData?: AnswerData): void
}

export interface OnAnswerSimpleCallback {
  (isCorrect: boolean): void
}

export interface PhasePropsBase {
  entries: SessionEntry[]
  currentIndex: number
  showAnswer: boolean
  confidence: number
  onAnswer: OnAnswerCallback
  onNext: () => void
  onSetShowAnswer: (v: boolean) => void
  onSetConfidence: (v: number) => void
  onReveal?: () => void
  isLoading?: boolean
}