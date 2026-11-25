import { useQuery } from "@tanstack/react-query"
import { RefreshCw } from "lucide-react"
import { studyApi } from "@/lib/api-study"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { StudyError, studyMuted } from "@/components/study/StudyFields"

const STATUS: Record<string, string> = {
  available: "Disponibile",
  unverified: "Da verificare",
  not_configured: "Non configurato",
  subscription_rejected: "Abbonamento rifiutato",
  quota_exceeded: "Quota esaurita",
  login_required: "Accesso richiesto",
  unreachable: "Non raggiungibile",
  unavailable: "Non disponibile",
  error: "Errore",
  authenticated: "Accesso valido",
  missing: "Accesso mancante",
  expired: "Accesso scaduto",
  token_only: "Accesso tramite token",
}
const PROVIDERS: Record<string, string> = { local: "LLM locale", gemini: "Gemini", claude: "Claude" }
const LOGINS: Record<string, string> = { moodle: "Moodle", panopto: "Panopto" }
const decimal = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1 })
const dateTime = new Intl.DateTimeFormat("it-IT", { dateStyle: "medium", timeStyle: "short" })

function displayTime(value: string | number) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "Data sconosciuta" : dateTime.format(date)
}

function displaySize(bytes: number) {
  if (bytes >= 1024 ** 3) return `${decimal.format(bytes / 1024 ** 3)} GiB`
  if (bytes >= 1024 ** 2) return `${decimal.format(bytes / 1024 ** 2)} MiB`
  return bytes >= 1024 ? `${decimal.format(bytes / 1024)} KiB` : `${decimal.format(bytes)} B`
}

function Status({ value }: { value: string }) {
  const variant = ["available", "authenticated"].includes(value) ? "success" : ["unverified", "not_configured"].includes(value) ? "outline" : "secondary"
  return <Badge variant={variant}>{STATUS[value] ?? value}</Badge>
}

export function SystemStatusPanel() {
  const status = useQuery({ queryKey: ["study-system-status"], queryFn: studyApi.systemStatus, refetchInterval: 60_000 })
  const data = status.data
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle>Stato del sistema</CardTitle>
        <Button variant="outline" size="sm" onClick={() => void status.refetch()} disabled={status.isFetching}>
          <RefreshCw className="size-4" /> Aggiorna stato
        </Button>
      </CardHeader>
      <CardContent className="space-y-5">
        <StudyError error={status.error} />
        {status.isPending && <p className={studyMuted}>Controlli in corso…</p>}
        {data && <>
          <div className="grid gap-3 sm:grid-cols-3">
            {Object.entries(data.providers).map(([name, provider]) => (
              <section key={name} className="min-w-0 space-y-2 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
                <h3 className="font-medium">{PROVIDERS[name] ?? name}</h3>
                <Status value={provider.status} />
                {provider.error && <p className="break-words text-sm">{provider.error}</p>}
                {provider.retry_at != null && <p className={studyMuted}>Riprova dal {displayTime(provider.retry_at * 1000)}</p>}
              </section>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <section className="space-y-2">
              <h3 className="font-medium">Accessi</h3>
              <dl className="space-y-2">
                {Object.entries(data.login).map(([name, login]) => <div key={name} className="flex flex-wrap items-center gap-2 text-sm"><dt>{LOGINS[name] ?? name}</dt><dd><Status value={login.status} /></dd></div>)}
              </dl>
            </section>
            <section className="space-y-2">
              <h3 className="font-medium">Ultima sincronizzazione Moodle</h3>
              {data.last_sync ? <>
                <p className={studyMuted}>{displayTime(data.last_sync.finished_at)}</p>
                <p className={studyMuted}>{[
                  data.last_sync.new_files != null ? `${data.last_sync.new_files} file nuovi` : null,
                  data.last_sync.updated_files != null ? `${data.last_sync.updated_files} aggiornati` : null,
                  data.last_sync.error_count != null ? `${data.last_sync.error_count} errori` : null,
                ].filter(Boolean).join(" · ")}</p>
              </> : <p className={studyMuted}>Nessuna sincronizzazione registrata.</p>}
            </section>
          </div>
          <section className="space-y-2">
            <div className="flex flex-wrap items-center gap-2"><h3 className="font-medium">Backup locale Restic</h3><Status value={data.restic.status} /></div>
            <p className={studyMuted}>{[
              data.restic.repository_bytes == null ? null : `Repository ${displaySize(data.restic.repository_bytes)}`,
              data.restic.free_bytes == null ? null : `${displaySize(data.restic.free_bytes)} liberi`,
              data.restic.capacity_bytes == null ? null : `capacità ${displaySize(data.restic.capacity_bytes)}`,
            ].filter(Boolean).join(" · ") || "Misure di spazio non disponibili."}</p>
          </section>
          <p className={studyMuted}>Verificato il {displayTime(data.checked_at)}</p>
        </>}
      </CardContent>
    </Card>
  )
}
