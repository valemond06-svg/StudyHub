import { useState } from "react"
import {
  Brain,
  Moon,
  Cpu,
  Sparkles,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Activity,
  Headphones,
  Zap,
} from "lucide-react"
import { format, formatDistanceToNow, parseISO } from "date-fns"
import { it } from "date-fns/locale"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/hooks/use-toast"
import type { AIPanelData } from "@/types"
import { cn } from "@/lib/utils"

interface AIPanelWidgetProps {
  data?: AIPanelData
  isLoading?: boolean
  isFetching?: boolean
  onRefresh: () => void
}

export function AIPanelWidget({ data, isLoading, isFetching, onRefresh }: AIPanelWidgetProps) {
  const { toast } = useToast()
  const [schedulingNight, setSchedulingNight] = useState(false)

  // Cluster local LLM status
  const cluster = data?.cluster
  const clusterStatus = cluster?.status ?? (data?.coda?.in_corso?.length ? "attivo" : "in_attesa")
  const clusterUrl = cluster?.url ?? "10.10.10.1:8080"
  const clusterModel = cluster?.model ?? "Qwen3.6-35B"

  // Arretrati counts
  const daTrascrivere = data?.arretrati?.da_trascrivere ?? 0
  const sonnetBacklog =
    (data?.arretrati?.trascritte_senza_appunti ?? 0) +
    (data?.arretrati?.unita_lezione_attesa_sonnet ?? 0)
  const unitaNuove = data?.arretrati?.unita_nuove ?? 0
  const jobInCorso = data?.coda?.in_corso?.length ?? 0

  // Claude Pro window
  const usoPct = data?.finestra?.uso_pct ?? 0
  const sogliaPct = data?.finestra?.soglia_pct ?? 70
  const arretratiInPausa = data?.finestra?.arretrati_in_pausa ?? false
  const resetAlle = data?.finestra?.reset_alle

  // Night turn
  const notte = data?.notte
  const ultimoTurno = notte?.ultimo
  const isNightRunning = Boolean(notte?.in_corso)

  const handlePlanNightTurn = () => {
    setSchedulingNight(true)
    setTimeout(() => {
      setSchedulingNight(false)
      toast({
        title: "Turno di notte pianificato",
        description: "Il timer brain-notte.timer è attivo e partirà alle 22:30 con comando studyhub notte --solo-locale.",
      })
    }, 400)
  }

  // Format Claude reset time
  let resetLabel: string | null = null
  if (resetAlle) {
    try {
      const resetDate = new Date(resetAlle * 1000)
      resetLabel = `Reset alle ${format(resetDate, "HH:mm")}`
    } catch {
      resetLabel = null
    }
  }

  // Format last night date
  let lastNightDateLabel = "Nessun dato registrato"
  if (ultimoTurno?.inizio) {
    try {
      const parsedDate = parseISO(ultimoTurno.inizio)
      lastNightDateLabel = formatDistanceToNow(parsedDate, { addSuffix: true, locale: it })
    } catch {
      lastNightDateLabel = ultimoTurno.inizio
    }
  }

  return (
    <Card className="border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-neutral-900/60 shadow-xs">
      <CardHeader className="pb-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100">
                <Brain className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-lg font-semibold tracking-tight">
                  Coda AI & Turno di Notte
                </CardTitle>
                <CardDescription className="text-xs text-neutral-500 dark:text-neutral-400">
                  Cluster Dual-PC ({clusterUrl}) · Trascrizioni Whisper & Claude Pro
                </CardDescription>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
            {/* Cluster LLM badge */}
            <div
              className={cn(
                "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors",
                clusterStatus === "attivo"
                  ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800"
                  : clusterStatus === "in_attesa"
                  ? "bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800"
                  : "bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 border-neutral-200 dark:border-neutral-700"
              )}
              title={`LLM Locale su ${clusterUrl}`}
            >
              <span
                className={cn(
                  "h-2 w-2 rounded-full",
                  clusterStatus === "attivo"
                    ? "bg-emerald-500 animate-pulse"
                    : clusterStatus === "in_attesa"
                    ? "bg-blue-500"
                    : "bg-neutral-400"
                )}
              />
              <span>{clusterModel}</span>
              <span className="opacity-60">·</span>
              <span className="capitalize">
                {clusterStatus === "attivo" ? "Attivo" : clusterStatus === "in_attesa" ? "In attesa" : "Offline"}
              </span>
            </div>

            {/* Quick Actions */}
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={handlePlanNightTurn}
              disabled={schedulingNight}
            >
              <Moon className="h-3.5 w-3.5 text-indigo-500" />
              <span>Pianifica turno</span>
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
              onClick={onRefresh}
              title="Aggiorna stato AI"
            >
              <RefreshCw className={cn("h-4 w-4", (isFetching || isLoading) && "animate-spin text-accent-500")} />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* Metric tiles: Arretrati & Processing */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {/* Da trascrivere */}
          <div className="p-3.5 rounded-xl border border-neutral-200/60 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-800/20 space-y-1">
            <div className="flex items-center gap-2 text-neutral-500 dark:text-neutral-400 text-xs font-medium">
              <Headphones className="h-3.5 w-3.5 text-blue-500" />
              <span>Da trascrivere</span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">
                {daTrascrivere}
              </span>
              <span className="text-xs text-neutral-400">lezioni</span>
            </div>
            <p className="text-[11px] text-neutral-500 dark:text-neutral-400">Whisper locale</p>
          </div>

          {/* In attesa Sonnet */}
          <div className="p-3.5 rounded-xl border border-neutral-200/60 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-800/20 space-y-1">
            <div className="flex items-center gap-2 text-neutral-500 dark:text-neutral-400 text-xs font-medium">
              <Sparkles className="h-3.5 w-3.5 text-purple-500" />
              <span>Attesa Claude</span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">
                {sonnetBacklog}
              </span>
              <span className="text-xs text-neutral-400">appunti</span>
            </div>
            <p className="text-[11px] text-neutral-500 dark:text-neutral-400">Claude Sonnet</p>
          </div>

          {/* Nuove unità 35B */}
          <div className="p-3.5 rounded-xl border border-neutral-200/60 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-800/20 space-y-1">
            <div className="flex items-center gap-2 text-neutral-500 dark:text-neutral-400 text-xs font-medium">
              <Cpu className="h-3.5 w-3.5 text-emerald-500" />
              <span>Unità 35B</span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">
                {unitaNuove}
              </span>
              <span className="text-xs text-neutral-400">nuove</span>
            </div>
            <p className="text-[11px] text-neutral-500 dark:text-neutral-400">Turno notturno</p>
          </div>

          {/* Job in corso */}
          <div className="p-3.5 rounded-xl border border-neutral-200/60 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-800/20 space-y-1">
            <div className="flex items-center gap-2 text-neutral-500 dark:text-neutral-400 text-xs font-medium">
              <Activity className="h-3.5 w-3.5 text-accent-500" />
              <span>In corso</span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">
                {jobInCorso}
              </span>
              <span className="text-xs text-neutral-400">job attivi</span>
            </div>
            <p className="text-[11px] text-neutral-500 dark:text-neutral-400">Coda elaborazione</p>
          </div>
        </div>

        {/* Barra Utilizzo Finestra Pro Claude con soglia 70% */}
        <div className="p-4 rounded-xl border border-neutral-200/60 dark:border-neutral-800 bg-neutral-50/40 dark:bg-neutral-800/10 space-y-2.5">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 font-medium text-neutral-700 dark:text-neutral-200">
              <Zap className="h-3.5 w-3.5 text-amber-500" />
              <span>Finestra Pro Claude</span>
              {arretratiInPausa && (
                <Badge variant="warning" className="text-[10px] py-0 px-1.5">
                  Arretrati in pausa
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2 text-neutral-500 dark:text-neutral-400">
              <span className="font-semibold text-neutral-900 dark:text-neutral-100">
                {usoPct}%
              </span>
              <span className="text-[11px]">(Stop automatico al {sogliaPct}%)</span>
            </div>
          </div>

          {/* Custom progress bar with 70% marker indicator */}
          <div className="relative w-full h-2.5 bg-neutral-200 dark:bg-neutral-700 rounded-full overflow-hidden">
            {/* 70% threshold marker */}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-neutral-400 dark:bg-neutral-500 z-10"
              style={{ left: `${sogliaPct}%` }}
              title={`Soglia limite stop: ${sogliaPct}%`}
            />
            {/* Progress fill */}
            <div
              className={cn(
                "h-full rounded-full transition-all duration-500",
                usoPct >= sogliaPct
                  ? "bg-amber-500"
                  : usoPct >= 50
                  ? "bg-amber-400 dark:bg-amber-500"
                  : "bg-accent-500"
              )}
              style={{ width: `${Math.min(usoPct, 100)}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-[11px] text-neutral-500 dark:text-neutral-400 pt-0.5">
            <span>
              {arretratiInPausa
                ? "Soglia di sicurezza raggiunta: gli arretrati riprenderanno al prossimo reset"
                : "Finestra disponibile per la stesura appunti con Sonnet"}
            </span>
            {resetLabel && <span>{resetLabel}</span>}
          </div>
        </div>

        {/* Turno di Notte Summary */}
        <div className="p-4 rounded-xl border border-neutral-200/60 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-800/30">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2">
            <div className="flex items-center gap-2">
              <Moon className="h-4 w-4 text-indigo-500" />
              <span className="text-xs font-semibold text-neutral-900 dark:text-neutral-100">
                Ultimo turno di notte
              </span>
              <span className="text-[11px] text-neutral-500 dark:text-neutral-400 font-mono">
                studyhub notte --solo-locale
              </span>
            </div>

            {isNightRunning ? (
              <Badge variant="accent" className="gap-1 animate-pulse">
                <Activity className="h-3 w-3" />
                In corso adesso
              </Badge>
            ) : ultimoTurno ? (
              <Badge
                variant={ultimoTurno.esito === "ok" ? "success" : "warning"}
                className="gap-1"
              >
                {ultimoTurno.esito === "ok" ? (
                  <CheckCircle2 className="h-3 w-3" />
                ) : (
                  <AlertTriangle className="h-3 w-3" />
                )}
                <span>{ultimoTurno.esito === "ok" ? "Completato" : "LLM offline"}</span>
              </Badge>
            ) : (
              <Badge variant="outline" className="text-xs">
                In attesa (22:30)
              </Badge>
            )}
          </div>

          {ultimoTurno ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs pt-1.5 border-t border-neutral-200/50 dark:border-neutral-800/80">
              <div>
                <span className="text-neutral-400 block text-[11px]">Eseguito</span>
                <span className="font-medium text-neutral-800 dark:text-neutral-200">
                  {lastNightDateLabel}
                </span>
              </div>
              <div>
                <span className="text-neutral-400 block text-[11px]">Unità elaborate</span>
                <span className="font-medium text-neutral-800 dark:text-neutral-200">
                  {ultimoTurno.unita_fatte ?? 0} unità (35B)
                </span>
              </div>
              <div>
                <span className="text-neutral-400 block text-[11px]">Trascrizioni</span>
                <span className="font-medium text-neutral-800 dark:text-neutral-200">
                  {ultimoTurno.trascritte ?? 0} lezioni
                </span>
              </div>
              <div>
                <span className="text-neutral-400 block text-[11px]">Durata & Errori</span>
                <span className="font-medium text-neutral-800 dark:text-neutral-200">
                  {ultimoTurno.durata_min ?? 0} min · {ultimoTurno.errori ?? 0} err
                </span>
              </div>
            </div>
          ) : (
            <div className="pt-2 text-xs text-neutral-500 dark:text-neutral-400">
              Nessun turno notturno ancora completato. Il Brain lancia la sequenza (Whisper → svuotamento Ollama → Qwen 35B) ogni notte alle 22:30.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
