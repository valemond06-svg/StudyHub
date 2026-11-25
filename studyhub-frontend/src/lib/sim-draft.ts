/**
 * Bozza della simulazione d'esame nel browser: risposte e **scadenza assoluta** (epoch ms), così una ricarica
 * o una chiusura della scheda non fermano né azzerano il tempo. Allo zero la prova si consegna da sola.
 */

export interface SimAnswer {
  testo: string
  scelta: number | null
  immagini: string[]
}

export interface SimDraft {
  submissionId: string
  startedAt: number
  deadline: number
  answers: Record<number, SimAnswer>
  selected: number
  /** true se le foto non sono entrate nella memoria del browser (restano solo in questa scheda) */
  photosDropped?: boolean
}

const key = (simId: string) => `studyhub-sim-draft-${simId}`

export function loadDraft(simId: string): SimDraft | null {
  try {
    const raw = window.localStorage.getItem(key(simId))
    if (!raw) return null
    const d = JSON.parse(raw) as SimDraft
    if (typeof d?.deadline !== "number" || typeof d?.startedAt !== "number" || !d.answers) return null
    const submissionId = typeof d.submissionId === "string" && d.submissionId
      ? d.submissionId : `legacy-${d.startedAt}`
    return { ...d, submissionId, selected: typeof d.selected === "number" ? d.selected : 0 }
  } catch {
    return null
  }
}

/** Salva la bozza; se le foto non ci stanno (quota del browser) salva almeno testo e scelte. */
export function saveDraft(simId: string, draft: SimDraft): { ok: boolean; photosDropped: boolean } {
  try {
    window.localStorage.setItem(key(simId), JSON.stringify(draft))
    return { ok: true, photosDropped: false }
  } catch {
    try {
      const light: SimDraft = {
        ...draft,
        photosDropped: true,
        answers: Object.fromEntries(Object.entries(draft.answers).map(([k, a]) => [k, { ...a, immagini: [] }])),
      }
      window.localStorage.setItem(key(simId), JSON.stringify(light))
      return { ok: true, photosDropped: true }
    } catch {
      return { ok: false, photosDropped: true }
    }
  }
}

export function clearDraft(simId: string) {
  try { window.localStorage.removeItem(key(simId)) } catch { /* storage non disponibile */ }
}

export function newDraft(totalSeconds: number, now = Date.now()): SimDraft {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  const submissionId = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
  return { submissionId, startedAt: now, deadline: now + totalSeconds * 1000, answers: {}, selected: 0 }
}

export function remainingSeconds(deadline: number, now = Date.now()): number {
  return Math.max(0, Math.ceil((deadline - now) / 1000))
}

/** Minuti trascorsi da inviare con la consegna (mai oltre la durata della prova). */
export function elapsedMinutes(draft: Pick<SimDraft, "startedAt" | "deadline">, now = Date.now()): number {
  const end = Math.min(now, draft.deadline)
  return Math.max(0, Math.round(((end - draft.startedAt) / 60000) * 100) / 100)
}
