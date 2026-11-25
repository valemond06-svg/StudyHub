import type { InteractiveLesson, PlanBlock } from "@/lib/api-study"

export const day = "2026-11-25"
export const course = { id: 7, fullname: "Algebra lineare", active: 1, passed: 0, priority: 0 }
export const lecture = { id: 9, title: "Trasformazioni lineari", course_id: 7, has_audio: 1, n_slides: 2, transcript_source: "whisper" }
export const exam = {
  id: 3, course_id: 7, course: course.fullname, date: "2026-12-01", kind: "orale",
  note: null, created_at: "2026-11-20T10:00:00", done: 0, days_left: 6,
}
export const availability = { hours_by_weekday: [2, 2, 2, 2, 2, 1, 0], days_off: ["2026-11-29"] }
export const block: PlanBlock = {
  id: "3:exercises:17", kind: "exercises", minutes: 25, exam_id: 3, exam_date: exam.date,
  course_id: 7, course: course.fullname, topic_id: 17, topic: "Cambio di base", mastery: 0.2, day,
}
export const week = {
  start: day,
  days: Array.from({ length: 7 }, (_, index) => ({
    day: new Date(Date.UTC(2026, 10, 25 + index)).toISOString().slice(0, 10),
    available_minutes: index === 4 ? 0 : 120, planned_minutes: index === 0 ? 25 : 0, blocks: index === 0 ? [block] : [],
  })),
  exams: [exam], unscheduled: [], changes: [],
}
export const recomputed = {
  ...week,
  days: week.days.map((entry, index) => index === 0
    ? { ...entry, available_minutes: 0, planned_minutes: 0, blocks: [] }
    : index === 1 ? { ...entry, planned_minutes: 25, blocks: [{ ...block, day: entry.day }] } : entry),
  changes: [{ block_id: block.id, kind: block.kind, exam_id: 3, course_id: 7, topic_id: 17, from_day: day, to_day: "2026-11-26", minutes: 25, reason: "missed_day" }],
}
export const note = {
  id: 4, course_id: 7, lecture_id: 9, doc_id: null, page: null, topic_id: null, timestamp_s: 92.5,
  body: "La matrice è invertibile se $\\det A \\ne 0$.", tags: ["esame"],
  created_at: "2026-11-23T10:00:00+00:00", updated_at: "2026-11-24T10:00:00+00:00",
}
export const card = {
  id: 10, course_id: 7, lecture_id: null, doc_id: 40, t_start: null, page: 12,
  front: "Quando è invertibile?", back: "Quando il determinante è diverso da zero.",
  origin: "manuale" as const, origin_key: null, suspended: false, due: "2026-11-22T12:00:00+00:00",
  created_at: "2026-11-22T12:00:00+00:00", attempt_id: null, url_hint: "/api/docs/40/file#page=12",
}
export const review = {
  day, course_id: null, cards: [{ ...card, review_bucket: "new" as const }],
  due_count: 7, new_count: 2, overdue_count: 4, overdue_review_count: 3, estimated_minutes: 3,
  proposal: { scheduled_today: 2, backlog_today: 3, new_today: 2, estimated_minutes: 3, remaining_backlog: 0, remaining_new: 0, remaining_days: 0 },
}
export const focus = {
  id: 6, course_id: 7, task: "Cambio di base", kind: "focus" as const, status: "running" as const,
  started_at: "2026-11-25T10:00:00+00:00", ends_at: "2026-11-25T10:25:00+00:00",
  stopped_at: null, planned_seconds: 1500, actual_seconds: 120,
}
export const summary = { day, course_id: 7, focus_seconds: 420, break_seconds: 180, focus_count: 2, break_count: 1 }
export const lessonMissing: InteractiveLesson = {
  topic: { id: 17, course_id: 7, name: "Cambio di base", summary_md: "Appunti sulle basi.", lecture_id: 9, t_start: 92, lecture: lecture.title },
  status: "da preparare", message: null, completed_at: null,
}
export const lessonReady: InteractiveLesson = {
  ...lessonMissing, status: "pronta",
  lesson: {
    titolo: "Cambio di base", hook_robotica_md: "Un esempio in robotica.",
    widget: { tipo: "linear_2d", titolo: "Griglia delle basi", istruzioni: "Muovi i vettori.", config_json: '{"a":2,"d":1}' },
    passi: [{
      titolo: "Vettori colonna", spiegazione_md: "Leggi le immagini dei vettori.", intuizione_md: "Ruota la griglia.", inizio_s: 92,
      verifica: { testo_md: "Qual è la dimensione?", opzioni: ["Uno", "Due"], corretta: 1, spiegazione_md: "Si lavora in due dimensioni." },
    }],
    errori_tipici: [{ errore: "Invertire l’ordine.", correzione: "Usa l’ordine dei vettori della base." }],
    riassunto_md: "Le colonne sono immagini dei vettori di base.",
  },
}
export const lectureNotes = {
  exists: true, md: "# Trasformazioni\nUn sottospazio è chiuso per somma.", model: "sonnet",
  created_at: "2026-11-25T10:00:00", input_tokens: 100, output_tokens: 30, flashcard: [], sources: [],
}
export const lectureTopics = [{ id: 17, name: "Cambio di base", learned: null, pos: 1 }]
export const quizList = [{ id: 11, title: "Quiz sulle basi", created_at: "2026-11-25T10:00:00", best: 0.5 }]
export const quiz = {
  id: 11, course_id: 7, lecture_id: 9, title: "Quiz sulle basi", created_at: "2026-11-25T10:00:00",
  questions: [
    { tipo: "vero_falso", testo_md: "I vettori sono indipendenti?", opzioni: [], inizio_s: 92 },
    { tipo: "aperta", testo_md: "Definisci uno span.", opzioni: [] },
  ],
  attempts: [{ id: 42, score: 1, max_score: 2, created_at: "2026-11-25T11:00:00" }],
}
export const correction = {
  attempt_id: 43, score: 1.5, max_score: 2, utilization: 0.1,
  results: [
    { indice: 0, risposta: 0, corretta: 0, punteggio: 1, soluzione_md: "Sono linearmente dipendenti." },
    { indice: 1, risposta: "Combinazioni lineari", corretta: -1, punteggio: 0.5, soluzione_md: "Tutte le combinazioni lineari dei vettori.", feedback_md: "Specifica l’insieme dei vettori." },
  ],
}
export const system = {
  checked_at: "2026-11-25T10:00:00+00:00",
  providers: {
    local: { available: true, status: "available", error: null, checked_at: "2026-11-25T10:00:00+00:00", retry_at: null },
    gemini: { available: null, status: "unverified", error: null, checked_at: null, retry_at: null },
    claude: { available: false, status: "subscription_rejected", error: "Verifica l’abbonamento Claude.", checked_at: "2026-11-25T09:40:00", retry_at: null },
  },
  login: { moodle: { status: "authenticated" }, panopto: { status: "expired" } },
  last_sync: { finished_at: "2026-11-24T20:00:00", course_id: 7, new_files: 2, updated_files: 1, error_count: 0 },
  restic: { status: "available", repository_bytes: 1073741824, free_bytes: 2147483648, capacity_bytes: 4294967296 },
}
