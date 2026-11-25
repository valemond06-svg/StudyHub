/**
 * Problemi reali dell'AI da mostrare in Home e Impostazioni, ricavati da
 *  - GET /api/ai/status → usage {utilization, resets_at, status} (file di uso di Claude Code, ai/claude_runner.py)
 *  - GET /api/ai/pannello → coda.ultimi_errori [{id, kind, titolo, messaggio, data}], finestra.coda_in_pausa
 * Niente valori inventati: se un dato manca, non si mostra.
 */
import type { AIPanelData, AIStatusResponse } from "@/types"

export interface AIProblem {
  id: string
  level: "error" | "warning"
  title: string
  detail: string
  hint?: string
}

const OK_STATUSES = new Set(["allowed", "allowed_warning"])

const KIND_LABEL: Record<string, string> = {
  lecture_notes: "Appunti della lezione",
  ocr: "OCR del documento",
}

function looksLikeSubscriptionIssue(msg: string): boolean {
  return /subscription|abbonamento|payment|past due|billing|pagamento/i.test(msg)
}

export function summarizeAIProblems(status?: AIStatusResponse | null, panel?: AIPanelData | null, now = Date.now() / 1000): AIProblem[] {
  const out: AIProblem[] = []
  const usage = status?.usage
  const errors = panel?.coda?.ultimi_errori ?? []
  const subscriptionError = errors.find((e) => looksLikeSubscriptionIssue(e.messaggio ?? ""))

  if (usage?.status && !OK_STATUSES.has(usage.status)) {
    const resetsAt = typeof usage.resets_at === "number" && usage.resets_at > now ? usage.resets_at : null
    out.push({
      id: "claude-status",
      level: "error",
      title: subscriptionError ? "Claude rifiuta le richieste: abbonamento da verificare" : "Claude non accetta richieste",
      detail: subscriptionError
        ? (subscriptionError.messaggio ?? "")
        : `Ultimo stato riportato da Claude Code: «${usage.status}».`,
      hint: resetsAt
        ? `Finestra chiusa fino alle ${new Date(resetsAt * 1000).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}.`
        : "Controlla l'abbonamento Claude Pro; appunti e correzioni AI restano in coda finché non torna disponibile.",
    })
  } else if (subscriptionError) {
    out.push({
      id: "claude-subscription",
      level: "error",
      title: "Claude ha segnalato un problema di abbonamento",
      detail: subscriptionError.messaggio ?? "",
      hint: "Controlla l'abbonamento Claude Pro.",
    })
  }

  if (panel?.finestra?.coda_in_pausa) {
    out.push({
      id: "queue-paused",
      level: "warning",
      title: "Coda AI in pausa",
      detail: panel.finestra.coda_in_pausa,
    })
  }

  // Errori dei job (raggruppati per messaggio uguale: niente righe ripetute)
  const seen = new Map<string, { count: number; first: (typeof errors)[number] }>()
  for (const e of errors) {
    if (subscriptionError && e === subscriptionError) continue
    if (looksLikeSubscriptionIssue(e.messaggio ?? "") && out.some((p) => p.id.startsWith("claude"))) continue
    const key = (e.messaggio ?? "").trim() || `#${e.id}`
    const prev = seen.get(key)
    if (prev) prev.count++
    else seen.set(key, { count: 1, first: e })
  }
  for (const [key, { count, first }] of seen) {
    const what = KIND_LABEL[first.kind] ?? first.kind
    out.push({
      id: `job-${first.id}`,
      level: "warning",
      title: `${what} non riuscito${count > 1 ? ` (${count} volte)` : ""}`,
      detail: `${first.titolo ? `${first.titolo}: ` : ""}${key}`,
    })
  }
  return out
}

/** Uso della finestra Claude in % (null se sconosciuto). */
export function claudeUsagePct(status?: AIStatusResponse | null): number | null {
  const u = status?.usage?.utilization
  return typeof u === "number" && Number.isFinite(u) ? Math.round(u * 100) : null
}
