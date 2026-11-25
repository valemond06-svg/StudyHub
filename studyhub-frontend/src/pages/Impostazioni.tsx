import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Brain, HardDrive, Cloud, Key, Palette, Monitor, Sun, Moon, MoonStar, Cpu, Database, FlaskConical, BookOpen, CheckCircle2, XCircle, Loader2, RefreshCw, Ban, Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { AIAlerts } from "@/components/home/AIAlerts"
import { api, describeError } from "@/lib/api"
import { claudeUsagePct, summarizeAIProblems } from "@/lib/ai-health"
import { useToast } from "@/hooks/use-toast"
import { useUIStore } from "@/store/ui"
import type { AIPanelData, AIProvidersStatus, AIStatusResponse, Course, SetupStatus, StorageStatus } from "@/types"
import { cn } from "@/lib/utils"

type Theme = "system" | "light" | "dark" | "oled"

function StatusBadge({ ok, okLabel = "OK", koLabel = "Da sistemare" }: { ok: boolean | null | undefined; okLabel?: string; koLabel?: string }) {
  if (ok === null || ok === undefined) return <Badge variant="outline">Sconosciuto</Badge>
  return ok
    ? <Badge variant="success" className="gap-1"><CheckCircle2 className="h-3 w-3" />{okLabel}</Badge>
    : <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" />{koLabel}</Badge>
}

export function Impostazioni() {
  const { theme, setTheme } = useUIStore()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [pdfCourse, setPdfCourse] = useState<string>("")

  const { data: storage } = useQuery<StorageStatus>({ queryKey: ["storage"], queryFn: api.getStorage })
  const { data: providers } = useQuery<AIProvidersStatus>({ queryKey: ["aiProviders"], queryFn: api.getAIProviders })
  const { data: aiStatus } = useQuery<AIStatusResponse>({ queryKey: ["aiStatus"], queryFn: api.getAIStatus })
  const { data: aiPanel } = useQuery<AIPanelData>({ queryKey: ["aiPanel"], queryFn: api.getAIPanel })
  const { data: setup, isLoading: setupLoading, refetch: refetchSetup } = useQuery<SetupStatus>({
    queryKey: ["setup"],
    queryFn: api.getSetupStatus,
    refetchInterval: (q) => (q.state.data?.login_running ? 5_000 : false),
  })
  const { data: courses = [] } = useQuery<Course[]>({ queryKey: ["courses"], queryFn: api.getCourses })

  const problems = summarizeAIProblems(aiStatus, aiPanel)
  const usagePct = claudeUsagePct(aiStatus)
  const claudeStatus = aiStatus?.usage?.status ?? null
  const claudeOk = claudeStatus ? ["allowed", "allowed_warning"].includes(claudeStatus) : null
  const queued = aiPanel?.coda?.per_stato?.in_coda ?? 0

  const loginMutation = useMutation({
    mutationFn: api.setupLogin,
    onSuccess: () => {
      toast({ title: "Finestra di login aperta", description: "Accedi a Moodle UniVR nella finestra del browser che si è aperta." })
      void refetchSetup()
    },
    onError: (err) => toast({ variant: "destructive", title: "Login non avviato", description: describeError(err) }),
  })
  const cancelMutation = useMutation({
    mutationFn: api.cancelAIQueue,
    onSuccess: (res) => {
      setConfirmCancel(false)
      toast({ title: "Coda AI svuotata", description: `${res?.cancelled ?? 0} lavori annullati.` })
      void queryClient.invalidateQueries({ queryKey: ["aiPanel"] })
      void queryClient.invalidateQueries({ queryKey: ["aiStatus"] })
    },
    onError: (err) => toast({ variant: "destructive", title: "Coda non annullata", description: describeError(err) }),
  })
  const download = (fn: () => Promise<void>, what: string) =>
    fn().catch((err) => toast({ variant: "destructive", title: `${what} non riuscito`, description: describeError(err) }))

  const loginCheck = setup?.checks.find((c) => c.id === "login")
  const local = providers?.local

  return (
    <div className="space-y-6 min-w-0">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-neutral-950 dark:text-neutral-50">Impostazioni</h1>
        <p className="text-neutral-500 dark:text-neutral-400 mt-1">Stato reale di AI e installazione, aspetto, esportazioni</p>
      </div>

      <Tabs defaultValue="stato" className="space-y-6">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="stato"><Brain className="h-4 w-4 sm:mr-2" /><span className="sr-only sm:not-sr-only">Stato</span></TabsTrigger>
          <TabsTrigger value="aspetto"><Palette className="h-4 w-4 sm:mr-2" /><span className="sr-only sm:not-sr-only">Aspetto</span></TabsTrigger>
          <TabsTrigger value="dati"><Database className="h-4 w-4 sm:mr-2" /><span className="sr-only sm:not-sr-only">Dati</span></TabsTrigger>
        </TabsList>

        <TabsContent value="stato" className="space-y-6">
          <AIAlerts problems={problems} />

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Brain className="h-5 w-5" />Claude Pro</CardTitle>
              <CardDescription>Dal file d'uso di Claude Code (finestra di 5 ore).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm">Stato richieste</span>
                <StatusBadge ok={claudeOk} okLabel="Accettate" koLabel={claudeStatus === "rejected" ? "Rifiutate" : `Bloccate (${claudeStatus})`} />
              </div>
              <div className="flex items-center gap-2">
                <Progress value={usagePct ?? 0} className="flex-1 h-3" aria-label="Uso della finestra Claude" />
                <span className="text-sm font-mono text-neutral-500 w-16 text-right">{usagePct === null ? "n.d." : `${usagePct}%`}</span>
              </div>
              <p className="text-sm text-neutral-500 dark:text-neutral-400">
                {aiStatus?.usage?.resets_at ? `Reset finestra alle ${new Date(aiStatus.usage.resets_at * 1000).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}` : "Nessun dato sul reset."}
                {aiStatus?.backlog ? ` · Arretrati automatici ${aiStatus.backlog.enabled ? "attivi" : "spenti"}, stop al ${Math.round(aiStatus.backlog.stop_at * 100)}%` : ""}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Cpu className="h-5 w-5" />LLM locale</CardTitle>
              <CardDescription>Server llama.cpp configurato nel backend (config.yaml di StudyHub).</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-mono break-all">{local?.url ?? "non configurato"}</span>
              <StatusBadge ok={local ? local.healthy : null} okLabel="Raggiungibile" koLabel="Non raggiungibile" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><RefreshCw className="h-5 w-5" />Coda AI</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm">
                In coda: <strong>{queued}</strong> · In corso: <strong>{aiPanel?.coda?.in_corso?.length ?? 0}</strong> · Errori recenti: <strong>{aiPanel?.coda?.ultimi_errori?.length ?? 0}</strong>
              </p>
              {confirmCancel ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm">Annullare tutti i lavori in coda?</span>
                  <Button variant="destructive" size="sm" disabled={cancelMutation.isPending} onClick={() => cancelMutation.mutate()}>Sì, annulla</Button>
                  <Button variant="outline" size="sm" onClick={() => setConfirmCancel(false)}>No</Button>
                </div>
              ) : (
                <Button variant="outline" size="sm" className="gap-1" disabled={!queued} onClick={() => setConfirmCancel(true)}>
                  <Ban className="h-4 w-4" />Annulla la coda
                </Button>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Key className="h-5 w-5" />Installazione e login</CardTitle>
              <CardDescription>Controlli locali del backend (doctor).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {setupLoading ? (
                <Loader2 className="h-5 w-5 animate-spin text-accent-500" />
              ) : setup ? (
                <ul className="space-y-2">
                  {setup.checks.map((c) => (
                    <li key={c.id} className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-1 p-3 rounded-lg border border-neutral-200 dark:border-neutral-700">
                      <div className="min-w-0">
                        <p className="font-medium text-sm">{c.label}{c.required ? "" : " (facoltativo)"}</p>
                        {c.detail && <p className="text-xs text-neutral-500 break-words">{c.detail}</p>}
                        {!c.ok && c.fix && <p className="text-xs text-warning-700 dark:text-warning-400 mt-1">{c.fix}</p>}
                      </div>
                      <StatusBadge ok={c.ok} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-neutral-500">Controlli non disponibili.</p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" className="gap-1" disabled={loginMutation.isPending || setup?.login_running} onClick={() => loginMutation.mutate()}>
                  <Key className="h-4 w-4" />{setup?.login_running ? "Login in corso…" : loginCheck?.ok ? "Rifai login Moodle" : "Accedi a Moodle"}
                </Button>
                <span className="text-xs text-neutral-500">Apre una finestra del browser: le credenziali le scrivi lì.</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><HardDrive className="h-5 w-5" />Spazio e media</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-1"><Cloud className="h-4 w-4" />Archivio media (Drive)</span>
                {storage ? (storage.media_root ? <span className="font-mono text-xs break-all">{storage.media_root}</span> : <Badge variant="outline">Non configurato</Badge>) : <Badge variant="outline">…</Badge>}
              </div>
              <div className="flex items-center justify-between gap-2">
                <span>Spazio libero sul disco dei corsi</span>
                <span className="font-semibold">{storage ? `${storage.free_gb} GB` : "…"}</span>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="aspetto" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Palette className="h-5 w-5" />Tema</CardTitle>
              <CardDescription>"Sistema" segue le preferenze del sistema operativo.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
                {([
                  { id: "system", name: "Sistema", icon: Monitor },
                  { id: "light", name: "Chiaro", icon: Sun },
                  { id: "dark", name: "Scuro", icon: Moon },
                  { id: "oled", name: "OLED", icon: MoonStar },
                ] as Array<{ id: Theme; name: string; icon: typeof Monitor }>).map((t) => (
                  <Button
                    key={t.id}
                    variant={theme === t.id ? "default" : "outline"}
                    className="flex flex-col items-center gap-2 p-5 h-full"
                    aria-pressed={theme === t.id}
                    onClick={() => setTheme(t.id)}
                  >
                    <t.icon className="h-6 w-6" />
                    <span className="font-medium">{t.name}</span>
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="dati" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Download className="h-5 w-5" />Esporta</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" className="gap-2" onClick={() => download(() => api.exportAnkiApkg(), "Download Anki")}>
                  <FlaskConical className="h-4 w-4" />Flashcard per Anki (.apkg)
                </Button>
                <Button variant="outline" className="gap-2" onClick={() => download(() => api.exportAnki(), "Download TSV")}>
                  <FlaskConical className="h-4 w-4" />Flashcard in testo (.tsv)
                </Button>
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <Select value={pdfCourse} onValueChange={setPdfCourse}>
                  <SelectTrigger className="w-full sm:w-72" aria-label="Corso della dispensa"><SelectValue placeholder="Scegli un corso…" /></SelectTrigger>
                  <SelectContent>
                    {courses.filter((c) => !c.passed).map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>{c.fullname}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button className={cn("gap-2")} disabled={!pdfCourse} onClick={() => download(() => api.downloadCoursePdf(Number(pdfCourse)), "Dispensa PDF")}>
                  <BookOpen className="h-4 w-4" />Dispensa del corso (PDF)
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
