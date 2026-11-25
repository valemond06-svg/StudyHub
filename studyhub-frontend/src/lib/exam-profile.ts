/**
 * Adapter del profilo d'esame: GET /api/courses/{id}/exam → {profile, profile_md, sims}.
 * `profile` segue PROFILE_SCHEMA di backend/src/studyhub/study/exam.py:
 *   sintesi_md, formato{durata_min, parti[{nome, descrizione, punti?, minimo?}], orale, materiale_consentito, regole_voto},
 *   argomenti[{nome, frequenza, peso: alto|medio|basso, note}],
 *   esercizi_tipo[{titolo, metodo_md, frequenza, errori_tipici?}], teoria_richiesta[], consigli_md
 * `profile_md` ripete gli stessi contenuti in markdown: la UI mostra solo la versione strutturata.
 */

export type ExamWeight = "alto" | "medio" | "basso"

export interface ExamProfileView {
  summaryMd: string
  /** null se il backend non la conosce (0 o assente) */
  durationMin: number | null
  oral: string | null
  allowedMaterial: string | null
  gradingRules: string | null
  parts: Array<{ name: string; description: string; points: number | null; minimum: number | null }>
  topics: Array<{ name: string; frequency: string; weight: ExamWeight | null; notes: string }>
  exercises: Array<{ title: string; methodMd: string; frequency: string; commonErrors: string | null }>
  theory: string[]
  adviceMd: string
}

export const EXAM_WEIGHT_LABEL: Record<ExamWeight, string> = {
  alto: "Peso alto",
  medio: "Peso medio",
  basso: "Peso basso",
}

export interface ExamSimulationSummary {
  id: number
  title: string
  durationMin: number | null
  bestGrade: number | null
  createdAt: string | null
}

function s(v: unknown): string {
  return typeof v === "string" ? v.trim() : ""
}

function nOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null
}

function textOrNull(v: unknown): string | null {
  const t = s(v)
  return t ? t : null
}

function arr(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object") : []
}

export function toExamProfile(raw: unknown): ExamProfileView | null {
  if (!raw || typeof raw !== "object") return null
  const p = raw as Record<string, unknown>
  const f = (p.formato && typeof p.formato === "object" ? p.formato : {}) as Record<string, unknown>
  const duration = nOrNull(f.durata_min)
  const weight = (w: unknown): ExamWeight | null => (w === "alto" || w === "medio" || w === "basso" ? w : null)

  return {
    summaryMd: s(p.sintesi_md),
    durationMin: duration && duration > 0 ? duration : null,
    oral: textOrNull(f.orale),
    allowedMaterial: textOrNull(f.materiale_consentito),
    gradingRules: textOrNull(f.regole_voto),
    parts: arr(f.parti).map((x) => ({
      name: s(x.nome) || "Parte",
      description: s(x.descrizione),
      points: nOrNull(x.punti) || null,
      minimum: nOrNull(x.minimo) || null,
    })),
    topics: arr(p.argomenti)
      .map((x) => ({ name: s(x.nome), frequency: s(x.frequenza), weight: weight(x.peso), notes: s(x.note) }))
      .filter((t) => t.name)
      .sort((a, b) => order(a.weight) - order(b.weight)),
    exercises: arr(p.esercizi_tipo)
      .map((x) => ({ title: s(x.titolo), methodMd: s(x.metodo_md), frequency: s(x.frequenza), commonErrors: textOrNull(x.errori_tipici) }))
      .filter((e) => e.title || e.methodMd),
    theory: Array.isArray(p.teoria_richiesta) ? p.teoria_richiesta.map(s).filter(Boolean) : [],
    adviceMd: s(p.consigli_md),
  }
}

function order(w: ExamWeight | null): number {
  return w === "alto" ? 0 : w === "medio" ? 1 : w === "basso" ? 2 : 3
}

/** Elenco simulazioni (exam.list_sims): {id, title, duration_min, created_at, best} */
export function toExamSims(raw: unknown): ExamSimulationSummary[] {
  return arr(raw).map((x) => ({
    id: Number(x.id),
    title: s(x.title) || s(x.titolo) || `Simulazione #${x.id}`,
    durationMin: nOrNull(x.duration_min) ?? nOrNull(x.durata_min),
    bestGrade: nOrNull(x.best),
    createdAt: textOrNull(x.created_at),
  })).filter((x) => Number.isFinite(x.id))
}
