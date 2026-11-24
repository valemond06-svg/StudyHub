import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Brain, HardDrive, Cloud, Key, Shield, Palette, Monitor, Save, TestTube, Trash2, Download, RotateCcw, Link, Server, Cpu, Database, Wifi, Eye, FlaskConical, BookOpen, HelpCircle, Target, Zap, Settings } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { api } from "@/lib/api"
import { useUIStore } from "@/store/ui"
import { cn } from "@/lib/utils"

export function Impostazioni() {
  const { theme, setTheme } = useUIStore()
  const [localLLMKey, setLocalLLMKey] = useState("")
  const [freellmKey, setFreellmKey] = useState("")
  const [freellmUrl, setFreellmUrl] = useState("http://100.119.96.109:3011")

  const { data: storage } = useQuery({ queryKey: ["storage"], queryFn: api.getStorage })
  const { data: aiProviders } = useQuery({ queryKey: ["aiProviders"], queryFn: api.getAIProviders })
  const { data: aiStatus } = useQuery({ queryKey: ["aiStatus"], queryFn: api.getAIStatus })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-neutral-950 dark:text-neutral-50">
          Impostazioni
        </h1>
        <p className="text-neutral-500 dark:text-neutral-400 mt-1">
          Configura StudyHub: AI, sincronizzazione, aspetto, dati
        </p>
      </div>

      <Tabs defaultValue="ai" className="space-y-6">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="ai">
            <Brain className="h-4 w-4 mr-2" />
            AI & Modelli
          </TabsTrigger>
          <TabsTrigger value="sync">
            <Cloud className="h-4 w-4 mr-2" />
            Sync & Cloud
          </TabsTrigger>
          <TabsTrigger value="appearance">
            <Palette className="h-4 w-4 mr-2" />
            Aspetto
          </TabsTrigger>
          <TabsTrigger value="data">
            <Database className="h-4 w-4 mr-2" />
            Dati
          </TabsTrigger>
          <TabsTrigger value="advanced">
            <Settings className="h-4 w-4 mr-2" />
            Avanzate
          </TabsTrigger>
        </TabsList>

        {/* AI & MODELLI */}
        <TabsContent value="ai" className="space-y-6">
          {/* AI Provider Chain */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Brain className="h-5 w-5" />
                Catena provider AI
              </CardTitle>
              <CardDescription>
                Ordine di fallback: il primo disponibile viene usato. Trascina per riordinare (prossimamente).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                {[
                  { id: "local", name: "LLM Locale (35B)", icon: Cpu, status: aiProviders?.local?.available ? "online" : "offline", desc: "Qwen 35B su PC fisso, 1 slot, timeout 20min" },
                  { id: "gemini", name: "Gemini (Antigravity)", icon: TestTube, status: aiProviders?.gemini?.available ? "online" : "offline", desc: "Google AI Pro via agy, sandbox isolato" },
                  { id: "freellm", name: "FreeLLMAPI (Brain)", icon: Server, status: aiProviders?.freellm?.available ? "online" : "offline", desc: "Catena curata: Qwen 3.8, Nemotron, Flash..." },
                  { id: "claude", name: "Claude Pro (Sonnet/Haiku)", icon: Brain, status: aiProviders?.claude?.available ? "online" : "offline", desc: "Abbonamento Pro, finestra 5h, solo on-demand" },
                ].map((p) => (
                  <div key={p.id} className="flex items-center justify-between p-4 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50/50 dark:bg-neutral-900/50">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-accent-100 dark:bg-accent-900/30">
                        <p.icon className="h-5 w-5 text-accent-600 dark:text-accent-400" />
                      </div>
                      <div>
                        <p className="font-medium">{p.name}</p>
                        <p className="text-sm text-neutral-500 dark:text-neutral-400">{p.desc}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant={p.status === "online" ? "success" : "default"} className="gap-1">
                        <span className={cn("h-2 w-2 rounded-full", p.status === "online" ? "bg-success-500" : "bg-neutral-400")} />
                        {p.status === "online" ? "Online" : "Offline"}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* LLM Locale Config */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Cpu className="h-5 w-5" />
                LLM Locale (PC Fisso)
              </CardTitle>
              <CardDescription>
                Configurazione del llama.cpp server sul PC fisso (100.83.194.37:8080/8081)
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="local-url">URL Server</Label>
                  <Input
                    id="local-url"
                    defaultValue="http://100.83.194.37:8080"
                    placeholder="http://host:port"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="local-key">API Key</Label>
                  <Input
                    id="local-key"
                    type="password"
                    value={localLLMKey}
                    onChange={(e) => setLocalLLMKey(e.target.value)}
                    placeholder="Incolla la chiave da ~/.config/brain-llm/api-key"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="local-timeout">Timeout (secondi)</Label>
                <Input id="local-timeout" type="number" defaultValue="1200" min="60" max="3600" className="w-32" />
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={() => {}}>Testa connessione</Button>
                <Button onClick={() => {}}>Salva</Button>
              </div>
            </CardContent>
          </Card>

          {/* FreeLLMAPI Config */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Server className="h-5 w-5" />
                FreeLLMAPI (Brain Gateway)
              </CardTitle>
              <CardDescription>
                Gateway gratuito con catena curata dal Brain (Qwen 3.8, Nemotron 550B, Flash...). Chiave in C:\Brain\secrets\.env
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="freellm-url">URL Server</Label>
                  <Input
                    id="freellm-url"
                    value={freellmUrl}
                    onChange={(e) => setFreellmUrl(e.target.value)}
                    placeholder="http://host:port (più URL separati da virgola)"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="freellm-key">API Key</Label>
                  <Input
                    id="freellm-key"
                    type="password"
                    value={freellmKey}
                    onChange={(e) => setFreellmKey(e.target.value)}
                    placeholder="freellmapi-... (da Brain secrets/.env)"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="freellm-timeout">Timeout (secondi)</Label>
                <Input id="freellm-timeout" type="number" defaultValue="180" min="30" max="600" className="w-32" />
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={() => {}}>Testa connessione</Button>
                <Button onClick={() => {}}>Salva</Button>
              </div>
            </CardContent>
          </Card>

          {/* Claude Pro */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Brain className="h-5 w-5" />
                Claude Pro (Sonnet / Haiku)
              </CardTitle>
              <CardDescription>
                Usa `claude.exe` nativo. Finestra 5 ore condivisa con Claude Code. Limite: Sonnet per appunti, Haiku per pulizia.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <Label>Utilizzo finestra corrente</Label>
                  <div className="flex items-center gap-2 mt-1">
                    <Progress value={aiProviders?.claude?.utilization ? Math.round(aiProviders.claude.utilization * 100) : 0} className="flex-1 h-3" />
                    <span className="text-sm font-mono text-neutral-500 w-16 text-right">
                      {aiProviders?.claude?.utilization ? Math.round(aiProviders.claude.utilization * 100) : 0}%
                    </span>
                  </div>
                </div>
                <Badge variant={aiProviders?.claude?.utilization && aiProviders.claude.utilization > 0.7 ? "warning" : "success"}>
                  {aiProviders?.claude?.utilization && aiProviders.claude.utilization > 0.7 ? "⚠ Vicino al limite" : "OK"}
                </Badge>
              </div>
              <p className="text-sm text-neutral-500 dark:text-neutral-400">
                Reset alle {aiProviders?.claude?.resets_at ? new Date(aiProviders.claude.resets_at * 1000).toLocaleTimeString('it-IT') : "—"}
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* SYNC & CLOUD */}
        <TabsContent value="sync" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Cloud className="h-5 w-5" />
                Google Drive (Media)
              </CardTitle>
              <CardDescription>
                Archivia video e audio pesanti su Drive. Il player li streamma da lì.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Cartella Drive</p>
                  <p className="text-sm text-neutral-500 dark:text-neutral-400">G:\Il mio Drive\StudyHub</p>
                </div>
                <Badge variant="success">Connesso</Badge>
              </div>
              <div className="flex gap-2">
                <Button variant="outline"><RotateCcw className="h-4 w-4 mr-1" /> Riscansiona</Button>
                <Button variant="outline"><Link className="h-4 w-4 mr-1" /> Cambia cartella</Button>
                <Button variant="outline" onClick={() => api.exportAnki()}><Download className="h-4 w-4 mr-1" /> Migra media</Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <RotateCcw className="h-5 w-5" />
                Sync automatico (Moodle + Panopto)
              </CardTitle>
              <CardDescription>
                Esegue ogni giorno alle 06:15. Scarica nuovi file, video, trascrive con Whisper, indicizza.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label>Orario</Label>
                  <Input type="time" defaultValue="06:15" className="w-32" />
                </div>
                <div className="space-y-2">
                  <Label>Massimo video/notte</Label>
                  <Input type="number" defaultValue="4" min="1" max="20" className="w-24" />
                </div>
                <div className="space-y-2">
                  <Label>Fine fase GPU</Label>
                  <Input type="time" defaultValue="00:30" className="w-32" />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline"><RotateCcw className="h-4 w-4 mr-1" /> Esegui ora</Button>
                <Button variant="outline"><TestTube className="h-4 w-4 mr-1" /> Solo locale (notte)</Button>
                <Button onClick={() => {}}><Save className="h-4 w-4 mr-1" /> Salva pianificazione</Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Key className="h-5 w-5" />
                Login Moodle / Panopto
              </CardTitle>
              <CardDescription>
                Sessione SSO UniVR. Panopto usa lo stesso profilo Chromium persistente.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Moodle</p>
                  <p className="text-sm text-neutral-500 dark:text-neutral-400">Token valido · Sessione attiva</p>
                </div>
                <Badge variant="success">OK</Badge>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Panopto</p>
                  <p className="text-sm text-neutral-500 dark:text-neutral-400">Cookie salvati in secrets/panopto.json</p>
                </div>
                <Badge variant="success">OK</Badge>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => {}}><Key className="h-4 w-4 mr-1" /> Rifai login</Button>
                <Button variant="outline" onClick={() => {}}><Trash2 className="h-4 w-4 mr-1" /> Cancella sessione</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* APPEARANCE */}
        <TabsContent value="appearance" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Palette className="h-5 w-5" />
                Tema
              </CardTitle>
              <CardDescription>
                Scegli l'aspetto dell'app. "Sistema" segue le preferenze del SO.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-4">
                {[
                  { id: "system", name: "Sistema", icon: Monitor, desc: "Segue OS" },
                  { id: "light", name: "Chiaro", icon: Monitor, desc: "Sempre chiaro" },
                  { id: "dark", name: "Scuro", icon: Monitor, desc: "Sempre scuro" },
                  { id: "oled", name: "OLED", icon: Monitor, desc: "Nero puro (#000)" },
                ].map((t) => (
                  <Button
                    key={t.id}
                    variant={theme === t.id ? "default" : "outline"}
                    className="flex flex-col items-center gap-2 p-6 h-full"
                    onClick={() => setTheme(t.id as any)}
                  >
                    <div className={cn("p-3 rounded-xl", theme === t.id ? "bg-accent-100 dark:bg-accent-900/30" : "bg-neutral-100 dark:bg-neutral-800")}>
                      <t.icon className="h-6 w-6" />
                    </div>
                    <span className="font-medium">{t.name}</span>
                    <span className="text-xs text-neutral-500">{t.desc}</span>
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Eye className="h-5 w-5" />
                Accessibilità
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Riduci animazioni</p>
                  <p className="text-sm text-neutral-500">Rispetta prefers-reduced-motion del sistema</p>
                </div>
                <Switch defaultChecked />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Alto contrasto</p>
                  <p className="text-sm text-neutral-500">Aumenta contrasto per visibilità</p>
                </div>
                <Switch />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Dimensione testo</p>
                  <p className="text-sm text-neutral-500">Scala base dell'interfaccia</p>
                </div>
                <Select defaultValue="base">
                  <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sm">Piccolo (14px)</SelectItem>
                    <SelectItem value="base">Normale (16px)</SelectItem>
                    <SelectItem value="lg">Grande (18px)</SelectItem>
                    <SelectItem value="xl">Molto grande (20px)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* DATA */}
        <TabsContent value="data" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <HardDrive className="h-5 w-5" />
                Spazio su disco
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <StatCard label="Database" value={storage?.db_size_mb || 317} unit="MB" icon={<Database className="h-5 w-5" />} />
                <StatCard label="Media (audio/slide)" value={storage?.media_size_gb || 12} unit="GB" icon={<HardDrive className="h-5 w-5" />} />
                <StatCard label="Cache (PNG, embeddings)" value={storage?.cache_size_mb || 850} unit="MB" icon={<Download className="h-5 w-5" />} />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Totale utilizzato</p>
                  <p className="text-sm text-neutral-500">{storage?.total_gb || 15.2} GB su {storage?.disk_total_gb || 512} GB</p>
                </div>
                <Progress value={((storage?.total_gb || 15.2) / (storage?.disk_total_gb || 512)) * 100} className="w-48 h-2" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Download className="h-5 w-5" />
                Export / Backup
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <ExportBtn title="Flashcard → Anki (.apkg)" desc="LaTeX→MathJax, GUID stabili" icon={<FlaskConical />} onClick={() => api.exportAnki()} />
                <ExportBtn title="Appunti corso → PDF" desc="Copertina, indice, profilo, lezioni" icon={<BookOpen />} onClick={() => {}} />
                <ExportBtn title="Quiz → TSV" desc="Per analisi offline" icon={<HelpCircle />} onClick={() => {}} />
                <ExportBtn title="Profilo esame → PDF" desc="Parti, argomenti, esercizi, teoria" icon={<Target />} onClick={() => {}} />
                <ExportBtn title="Simulazione → PDF" desc="Domande, soluzioni, criteri" icon={<Zap />} onClick={() => {}} />
                <ExportBtn title="Backup completo (ZIP)" desc="DB + file + vettori + FSRS" icon={<Database />} onClick={() => {}} variant="outline" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-error-200 bg-error-50/50 dark:border-error-900/30 dark:bg-error-950/20">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Trash2 className="h-5 w-5 text-error-500" />
                Zona pericolo
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-neutral-600 dark:text-neutral-300">
                Queste azioni sono irreversibili. Procedi con cautela.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="destructive" onClick={() => {}}><Trash2 className="h-4 w-4 mr-1" /> Cancella cache PNG/embeddings</Button>
                <Button variant="destructive" onClick={() => {}}><Trash2 className="h-4 w-4 mr-1" /> Reset progressi FSRS (tutti i corsi)</Button>
                <Button variant="destructive" onClick={() => {}}><Trash2 className="h-4 w-4 mr-1" /> Cancella tutto (nuclear option)</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ADVANCED */}
        <TabsContent value="advanced" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TestTube className="h-5 w-5" />
                Funzionalità sperimentali
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                {[
                  { id: "voice-notes", label: "Note vocali (Whisper locale)", desc: "Registra audio durante lo studio, trascrive in background", enabled: false },
                  { id: "adaptive-difficulty", label: "Difficoltà adattiva quiz", desc: "Regola difficoltà basata su performance FSRS", enabled: true },
                  { id: "weakness-radar", label: "Weakness Radar", desc: "Heatmap argomenti fragili per corso", enabled: true },
                  { id: "exam-simulator", label: "Exam Simulator immersivo", desc: "Timer, correzione AI, report PDF", enabled: true },
                  { id: "proactive-tutor", label: "Tutor proattivo", desc: "Suggerisce mini-lezioni su argomenti deboli", enabled: false },
                  { id: "pwa", label: "PWA / Offline-first", desc: "Installa come app, funziona offline", enabled: false },
                ].map((f) => (
                  <div key={f.id} className="flex items-center justify-between p-3 rounded-lg border border-neutral-200 dark:border-neutral-700">
                    <div className="flex-1">
                      <p className="font-medium">{f.label}</p>
                      <p className="text-sm text-neutral-500">{f.desc}</p>
                    </div>
                    <Switch defaultChecked={f.enabled} onCheckedChange={() => {}} />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wifi className="h-5 w-5" />
                Rete & Proxy
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Proxy HTTP/HTTPS</Label>
                  <Input placeholder="http://proxy:port" />
                </div>
                <div className="space-y-2">
                  <Label>No-proxy hosts</Label>
                  <Input placeholder="localhost,127.0.0.1,10.10.10.1" />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Modalità offline</p>
                  <p className="text-sm text-neutral-500">Blocca tutte le chiamate di rete (usa solo locale)</p>
                </div>
                <Switch />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Privacy & Telemetria
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Invia diagnostica anonima</p>
                    <p className="text-sm text-neutral-500">Errori, performance, uso funzionalità (niente dati personali)</p>
                  </div>
                  <Switch defaultChecked />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Filtro privacy Brain</p>
                    <p className="text-sm text-neutral-500">Applica privacy.py prima di inviare a FreeLLMAPI/Claude</p>
                  </div>
                  <Switch defaultChecked />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <RotateCcw className="h-5 w-5" />
                Informazioni app
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-2 text-sm">
                <div><span className="text-neutral-500">Versione</span> <span className="font-mono">v3.0.0-beta</span></div>
                <div><span className="text-neutral-500">Build</span> <span className="font-mono">2026-11-16</span></div>
                <div><span className="text-neutral-500">React</span> <span className="font-mono">18.2.0</span></div>
                <div><span className="text-neutral-500">Vite</span> <span className="font-mono">8.3.8</span></div>
                <div><span className="text-neutral-500">Tailwind</span> <span className="font-mono">4.0</span></div>
                <div><span className="text-neutral-500">TypeScript</span> <span className="font-mono">5.5</span></div>
              </div>
              <Separator />
              <div className="flex gap-2">
                <Button variant="outline" size="sm"><RotateCcw className="h-3.5 w-3.5 mr-1" /> Controlla aggiornamenti</Button>
                <Button variant="outline" size="sm"><Link className="h-3.5 w-3.5 mr-1" /> Repository GitHub</Button>
                <Button variant="outline" size="sm"><BookOpen className="h-3.5 w-3.5 mr-1" /> Documentazione</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

// Helper components
function StatCard({ label, value, unit, icon }: { label: string; value: number; unit: string; icon: React.ReactNode }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-1">
        <div className="p-2 rounded-lg bg-accent-100 dark:bg-accent-900/30">{icon}</div>
        <span className="text-sm text-neutral-500">{label}</span>
      </div>
      <p className="text-2xl font-bold flex items-baseline gap-1">
        {value} <span className="text-sm font-normal text-neutral-500">{unit}</span>
      </p>
    </Card>
  )
}

function ExportBtn({ title, desc, icon, onClick, variant = "default" }: { title: string; desc: string; icon: React.ReactNode; onClick: () => void; variant?: "default" | "outline" }) {
  return (
    <Button variant={variant} className="h-auto p-4 text-left gap-3" onClick={onClick}>
      <div className="p-2 rounded-lg bg-accent-100 dark:bg-accent-900/30">{icon}</div>
      <div>
        <p className="font-medium">{title}</p>
        <p className="text-xs text-neutral-500">{desc}</p>
      </div>
    </Button>
  )
}