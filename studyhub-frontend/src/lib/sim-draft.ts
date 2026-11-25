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
  submittedAt?: number
  submissionInDatabase?: boolean
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

/** Usa IndexedDB quando la consegna completa supera la quota di localStorage. */
function submissionStore<T>(mode: IDBTransactionMode, requestFor: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("studyhub-simulation-submissions", 1)
    open.onupgradeneeded = () => open.result.createObjectStore("submissions")
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const db = open.result
      const tx = db.transaction("submissions", mode)
      const request = requestFor(tx.objectStore("submissions"))
      tx.oncomplete = () => { db.close(); resolve(request.result) }
      tx.onabort = () => { db.close(); reject(tx.error) }
    }
  })
}

export function persistSubmission(simId: string, draft: SimDraft): Promise<SimDraft> {
  const persist = () => storeSubmission(simId, draft)
  return navigator.locks?.request(key(simId), persist) ?? persist()
}

async function storeSubmission(simId: string, draft: SimDraft): Promise<SimDraft> {
  const saved = loadDraft(simId)
  if (saved?.submissionId === draft.submissionId && saved.submittedAt !== undefined) {
    if (!saved.submissionInDatabase) return saved
    const snapshot = await submissionStore<SimDraft | undefined>("readonly", (store) => store.get(saved.submissionId))
    if (!snapshot) throw new Error("Le risposte salvate per questa consegna non sono disponibili.")
    return snapshot
  }
  try {
    window.localStorage.setItem(key(simId), JSON.stringify(draft))
    return draft
  } catch {
    try {
      await submissionStore("readwrite", (store) => store.put(draft, draft.submissionId))
      const savedMarker = saveDraft(simId, { ...draft, submissionInDatabase: true })
      if (savedMarker.ok) return draft
    } catch {
      // Senza una copia completa il server non deve ricevere la consegna.
    }
    throw new Error("Il browser non riesce a salvare tutte le risposte della consegna.")
  }
}

export function clearSubmission(simId: string, submissionId: string) {
  const draft = loadDraft(simId)
  if (draft?.submissionId !== submissionId) return
  clearDraft(simId)
  if (draft.submissionInDatabase) {
    void submissionStore("readwrite", (store) => store.delete(submissionId)).catch(() => {})
  }
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
export function elapsedMinutes(draft: Pick<SimDraft, "startedAt" | "deadline" | "submittedAt">, now = Date.now()): number {
  const end = Math.min(draft.submittedAt ?? now, draft.deadline)
  return Math.max(0, Math.round(((end - draft.startedAt) / 60000) * 100) / 100)
}
