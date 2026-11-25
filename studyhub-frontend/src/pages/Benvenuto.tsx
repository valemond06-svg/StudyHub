import type { ReactNode } from "react"
import { Link } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CheckCircle2, Circle, Loader2, LogIn, ListChecks, PlayCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { api, describeError } from "@/lib/api"
import type { SetupCheck, SetupStatus } from "@/types"
import { cn, safeFormatDistance } from "@/lib/utils"

interface FullrunState {
  phase?: string
  login?: string | null
  started_at?: string
  finished_at?: string | null
  updated_at?: string
  alive?: boolean
}

function Step({ n, done, title, children }: { n: number; done: boolean; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className={cn("mt-0.5 shrink-0", done ? "text-success-600" : "text-neutral-400")} aria-hidden>
        {done ? <CheckCircle2 className="h-6 w-6" /> : <Circle className="h-6 w-6" />}
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <h2 className="font-semibold">{n}. {title} {done && <span className="sr-only">(fatto)</span>}</h2>
        {children}
      </div>
    </li>
  )
}

function CheckRow({ check }: { check: SetupCheck }) {
  return (
    <li className="flex flex-col gap-1 rounded-lg border border-neutral-200 p-3 text-sm dark:border-neutral-800 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <p className="font-medium">{check.label}{!check.required && <span className="ml-1 font-normal text-neutral-500">(facoltativo)</span>}</p>
        {check.detail && <p className="break-words text-neutral-500 dark:text-neutral-400">{check.detail}</p>}
        {!check.ok && check.fix && <p className="break-words text-warning-700 dark:text-warning-300">{check.fix}</p>}
      </div>
      <Badge variant={check.ok ? "success" : check.required ? "destructive" : "outline"} className="shrink-0 self-start">
        {check.ok ? "OK" : check.required ? "Da sistemare" : "Assente"}
      </Badge>
    </li>
  )
}

/**
 * Primo avvio senza terminale: login Moodle (la finestra di Chromium la apre il server: le credenziali le scrivi tu, lì),
 * catalogo dei corsi, elaborazione completa. Ogni passo parte solo da un clic.
 */
export function Benvenuto() {
  const client = useQueryClient()
  const setup = useQuery<SetupStatus>({
    queryKey: ["setup"],
    queryFn: api.getSetupStatus,
    refetchInterval: (q) => (q.state.data?.login_running ? 3000 : false),
  })
  const fullrun = useQuery<FullrunState>({
    queryKey: ["fullrun"],
    queryFn: api.getFullrunStatus,
    refetchInterval: (q) => (q.state.data?.alive || setup.data?.fullrun_running ? 15000 : false),
  })
  const refresh = () => Promise.all([
    client.invalidateQueries({ queryKey: ["setup"] }),
    client.invalidateQueries({ queryKey: ["fullrun"] }),
    client.invalidateQueries({ queryKey: ["courses"] }),
  ])
  const login = useMutation({ mutationFn: api.setupLogin, onSuccess: refresh })
  const courses = useMutation({ mutationFn: api.setupCourses, onSuccess: refresh })
  const run = useMutation({ mutationFn: api.setupFullrun, onSuccess: refresh })

  const checks = setup.data?.checks ?? []
  const ok = (id: string) => checks.find((c) => c.id === id)?.ok ?? false
  const loggedIn = ok("login")
  const hasCourses = ok("corsi")
  const fr = fullrun.data ?? {}
  const running = Boolean(fr.alive || setup.data?.fullrun_running)

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Primo avvio</h1>
        <p className="mt-1 text-neutral-500 dark:text-neutral-400">
          Tre passi, senza terminale. Ogni passo parte solo quando premi il pulsante.
        </p>
      </div>

      {setup.isPending && <p className="flex items-center gap-2 text-sm text-neutral-500"><Loader2 className="h-4 w-4 animate-spin" /> Controllo l'installazione...</p>}
      {setup.isError && <p role="alert" className="text-sm text-error-600">{describeError(setup.error)}</p>}

      {setup.data && (
        <Card>
          <CardContent className="pt-6">
            <ol className="space-y-6">
              <Step n={1} done={loggedIn} title="Accedi a Moodle UniVR">
                <p className="text-sm text-neutral-600 dark:text-neutral-300">
                  Si apre una finestra del browser con il login d'ateneo: le credenziali le scrivi tu, lì. StudyHub salva solo la sessione.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button className="gap-2" disabled={login.isPending || setup.data.login_running} onClick={() => login.mutate()}>
                    <LogIn className="h-4 w-4" /> {loggedIn ? "Rifai il login" : "Accedi a Moodle"}
                  </Button>
                  {setup.data.login_running && <span role="status" className="flex items-center gap-1 text-sm text-neutral-500"><Loader2 className="h-4 w-4 animate-spin" /> In attesa che completi il login nella finestra...</span>}
                </div>
                {login.error && <p role="alert" className="text-sm text-error-600">{describeError(login.error)}</p>}
              </Step>

              <Step n={2} done={hasCourses} title="Trova i tuoi corsi">
                <p className="text-sm text-neutral-600 dark:text-neutral-300">
                  Legge da Moodle i corsi a cui sei iscritto e li classifica in <code>corsi.yaml</code>: lì metti
                  <strong> corrente</strong> sui corsi che segui ora, <strong>arretrato</strong> sugli esami da recuperare,
                  <strong> futuro</strong> o <strong>archivio</strong> sugli altri (nascosti di default).
                </p>
                <Button variant={hasCourses ? "outline" : "default"} className="gap-2" disabled={!loggedIn || courses.isPending} onClick={() => courses.mutate()}>
                  {courses.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListChecks className="h-4 w-4" />}
                  {hasCourses ? "Aggiorna il catalogo" : "Trova i miei corsi"}
                </Button>
                {!loggedIn && <p className="text-xs text-neutral-500">Prima fai il login.</p>}
                {courses.data && <p role="status" className="text-sm">{courses.data.courses} corsi trovati, {courses.data.active} attivi.</p>}
                {courses.error && <p role="alert" className="text-sm text-error-600">{describeError(courses.error)}</p>}
              </Step>

              <Step n={3} done={Boolean(fr.finished_at) && !running} title="Elabora tutto">
                <p className="text-sm text-neutral-600 dark:text-neutral-300">
                  Scarica materiale e registrazioni, trascrive e prepara le domande. Gira in un processo a parte: puoi chiudere l'app.
                  Usa l'AI e può richiedere ore.
                </p>
                <Button variant="outline" className="gap-2" disabled={!hasCourses || running || run.isPending} onClick={() => run.mutate()}>
                  {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
                  {running ? "Elaborazione in corso" : fr.started_at && !fr.finished_at ? "Riprendi l'elaborazione" : "Avvia l'elaborazione completa"}
                </Button>
                {(fr.phase || fr.login) && (
                  <div role="status" className="rounded-lg bg-neutral-50 p-3 text-sm dark:bg-neutral-900">
                    {fr.phase && <p>Fase: {fr.phase}{fr.updated_at ? ` · aggiornato ${safeFormatDistance(fr.updated_at)}` : ""}</p>}
                    {fr.login && <p className="text-warning-700 dark:text-warning-300">{fr.login}</p>}
                    {fr.finished_at && <p>Ultima elaborazione finita {safeFormatDistance(fr.finished_at)}.</p>}
                  </div>
                )}
                {run.error && <p role="alert" className="text-sm text-error-600">{describeError(run.error)}</p>}
              </Step>
            </ol>
          </CardContent>
        </Card>
      )}

      {checks.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle>Controlli dell'installazione</CardTitle>
            <Badge variant={setup.data?.ready ? "success" : "warning"}>{setup.data?.ready ? "Pronto" : "Da completare"}</Badge>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">{checks.map((c) => <CheckRow key={c.id} check={c} />)}</ul>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap gap-2">
        <Button asChild><Link to="/">Vai a Oggi</Link></Button>
        <Button asChild variant="outline"><Link to="/corsi">Vai ai corsi</Link></Button>
      </div>
    </div>
  )
}
