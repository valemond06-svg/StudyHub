import { useParams, useSearchParams, useNavigate } from "react-router-dom"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useState, useEffect, useCallback } from "react"
import { ArrowLeft, Play, Pause, SkipForward, RotateCcw, Flag, Target, Zap, Heart, X, Check, Loader2, Volume2, VolumeX, Settings, ChevronDown, ChevronUp, HelpCircle, Brain } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { api } from "@/lib/api"
import { useSessionStore } from "@/store/session"
import { cn } from "@/lib/utils"
import { formatDistanceToNow, parseISO } from "date-fns"
import { it } from "date-fns/locale"

type SessionPhase = "warmup" | "learn" | "practice" | "boss" | "cooldown" | "complete"

interface Question {
  id: string
  type: "richiamo" | "multipla" | "vero_falso" | "aperta" | "esercizio"
  prompt: string
  options?: string[]
  answer: string
  solution: string
  difficulty: number
  topic: string
  lecture_id?: number
  t_start?: number
}

interface LearnStep {
  id: string
  title: string
  explanation: string
  quick_understand: string
  verification: { question: string; answer: string }
  exam_example: { prompt: string; next_step: string }
  common_errors: string[]
  summary: string
}

const PHASE_CONFIG = {
  warmup: { label: "Riscaldamento", icon: Zap, color: "text-warning-500", bg: "bg-warning-50 dark:bg-warning-900/20", duration: 2 },
  learn: { label: "Impara", icon: Brain, color: "text-accent-500", bg: "bg-accent-50 dark:bg-accent-900/20", duration: 60 },
  practice: { label: "Esercitati", icon: Target, color: "text-success-500", bg: "bg-success-50 dark:bg-success-900/20", duration: 30 },
  boss: { label: "Boss Finale", icon: Flag, color: "text-error-500", bg: "bg-error-50 dark:bg-error-900/20", duration: 8 },
  cooldown: { label: "Defaticamento", icon: Heart, color: "text-neutral-500", bg: "bg-neutral-50 dark:bg-neutral-900/20", duration: 2 },
  complete: { label: "Completato", icon: Check, color: "text-success-500", bg: "bg-success-50 dark:bg-success-900/20", duration: 0 },
}

const PHASE_ORDER: SessionPhase[] = ["warmup", "learn", "practice", "boss", "cooldown", "complete"]

// Mock data for demo
const warmupQuestions: Question[] = [
  { id: "w1", type: "richiamo", prompt: "Cos'è il limite di una funzione?", answer: "Il valore che la funzione si avvicina quando x tende a un punto", solution: "Definizione formale ε-δ...", difficulty: 1, topic: "Limiti" },
  { id: "w2", type: "multipla", prompt: "lim(x→0) sin(x)/x = ?", options: ["0", "1", "∞", "Non esiste"], answer: "1", solution: "Limite notevole", difficulty: 1, topic: "Limiti" },
  { id: "w3", type: "vero_falso", prompt: "Una funzione continua è sempre derivabile", answer: "Falso", solution: "Controesempio: |x| in x=0", difficulty: 2, topic: "Derivate" },
]

const learnSteps: LearnStep[] = [
  {
    id: "l1",
    title: "Perché ti serve",
    explanation: "Le derivate misurano la velocità di variazione: fondamentali per ottimizzazione, fisica, economia.",
    quick_understand: "Pensa alla velocità dell'auto: la derivata della posizione è la velocità.",
    verification: { question: "Se f(x) = x², qual è f'(3)?", answer: "6" },
    exam_example: { prompt: "Trova i punti critici di f(x) = x³ - 3x", next_step: "Deriva e poni = 0" },
    common_errors: ["Dimenticare la regola della catena", "Segno errato nelle derivate di funzioni trigonometriche"],
    summary: "Derivata = coefficiente angolare della tangente. f'(x) = lim(h→0) [f(x+h)-f(x)]/h",
  },
  {
    id: "l2",
    title: "Regole di derivazione",
    explanation: "Potenza, prodotto, quoziente, catena. La regola della catena è la più usata e la più sbagliata.",
    quick_understand: "Catena: 'derivata dell'esterno × derivata dell'interno'. Come sbucciare una cipolla.",
    verification: { question: "Deriva sin(x²)", answer: "2x·cos(x²)" },
    exam_example: { prompt: "Deriva f(x) = (3x²+1)⁵", next_step: "Catena: 5(3x²+1)⁴ · 6x" },
    common_errors: ["Moltiplicare per la derivata interna", "Confondere potenza costante vs variabile"],
    summary: "(uⁿ)' = n·uⁿ⁻¹·u' · (u·v)' = u'v + uv' · (u/v)' = (u'v - uv')/v² · f(g(x))' = f'(g(x))·g'(x)",
  },
]

const practiceQuestions: Question[] = [
  { id: "p1", type: "richiamo", prompt: "Deriva x⁵", answer: "5x⁴", solution: "Regola della potenza", difficulty: 1, topic: "Derivate" },
  { id: "p2", type: "multipla", prompt: "Derivata di eˣ è:", options: ["eˣ", "xeˣ⁻¹", "ln(x)", "1"], answer: "eˣ", solution: "Derivata di eˣ è eˣ", difficulty: 1, topic: "Derivate" },
  { id: "p3", type: "esercizio", prompt: "Trova i punti critici di f(x) = x³ - 6x² + 9x", answer: "x=1 (max), x=3 (min)", solution: "f'(x)=3x²-12x+9=3(x-1)(x-3)", difficulty: 2, topic: "Applicazioni derivate" },
  { id: "p4", type: "aperta", prompt: "Spiega perché |x| non è derivabile in 0", answer: "Derivata sinistra -1, destra +1", solution: "Limiti laterali diversi", difficulty: 2, topic: "Derivate" },
  { id: "p5", type: "vero_falso", prompt: "Se f'(c)=0 allora c è un estremo", answer: "Falso", solution: "Può essere punto di flesso (es. x³ in 0)", difficulty: 2, topic: "Applicazioni derivate" },
]

const bossQuestion: Question = {
  id: "b1", type: "esercizio",
  prompt: "Una lattina cilindrica deve contenere 330 ml. Trova raggio e altezza che minimizzano la superficie (costo materiale).",
  answer: "r = ∛(165/π) ≈ 3.74 cm, h = 2r ≈ 7.48 cm",
  solution: "V=πr²h=330 → h=330/(πr²). S=2πr²+2πrh=2πr²+660/r. S'=4πr-660/r²=0 → r³=165/π",
  difficulty: 3, topic: "Ottimizzazione",
}

export function Studio() {
  const { courseId } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  const duration = Number(searchParams.get("duration")) || 45
  const courseIdNum = Number(courseId)

  const { currentSession, startSession, endSession, cancelSession } = useSessionStore()

  const { data: course } = useQuery({
    queryKey: ["course", courseIdNum],
    queryFn: () => api.getCourse(courseIdNum),
    enabled: !!courseIdNum,
  })

  // Session state
  const [phase, setPhase] = useState<SessionPhase>("warmup")
  const [phaseProgress, setPhaseProgress] = useState(0)
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0)
  const [showAnswer, setShowAnswer] = useState(false)
  const [confidence, setConfidence] = useState(3)
  const [xpEarned, setXpEarned] = useState(0)
  const [streak, setStreak] = useState(0)
  const [combo, setCombo] = useState(0)
  const [questionsAnswered, setQuestionsAnswered] = useState(0)
  const [correctAnswers, setCorrectAnswers] = useState(0)

  const currentPhaseConfig = PHASE_CONFIG[phase]
  const totalPhases = PHASE_ORDER.length - 1
  const currentPhaseIndex = PHASE_ORDER.indexOf(phase)

  // Phase timer
  useEffect(() => {
    if (phase === "complete") return
    const config = PHASE_CONFIG[phase]
    if (config.duration === 0) return

    const timer = setInterval(() => {
      setPhaseProgress(prev => {
        const next = prev + (100 / (config.duration * 60))
        if (next >= 100) {
          clearInterval(timer)
          advancePhase()
          return 0
        }
        return next
      })
    }, 1000)

    return () => clearInterval(timer)
  }, [phase])

  const advancePhase = () => {
    const nextIndex = PHASE_ORDER.indexOf(phase) + 1
    if (nextIndex < PHASE_ORDER.length) {
      setPhase(PHASE_ORDER[nextIndex])
      setCurrentQuestionIndex(0)
      setShowAnswer(false)
      setConfidence(3)
    }
  }

  const handleAnswer = (isCorrect: boolean) => {
    setShowAnswer(true)
    setQuestionsAnswered(prev => prev + 1)
    if (isCorrect) {
      setCorrectAnswers(prev => prev + 1)
      setStreak(prev => prev + 1)
      setCombo(prev => prev + 1)
      const xpGain = 10 + Math.min(combo * 5, 50)
      setXpEarned(prev => prev + xpGain)
    } else {
      setStreak(0)
      setCombo(0)
    }
  }

  const nextQuestion = () => {
    const questions = getCurrentQuestions()
    if (currentQuestionIndex < questions.length - 1) {
      setCurrentQuestionIndex(prev => prev + 1)
      setShowAnswer(false)
      setConfidence(3)
    } else {
      advancePhase()
    }
  }

  const getCurrentQuestions = () => {
    switch (phase) {
      case "warmup": return warmupQuestions
      case "learn": return learnSteps
      case "practice": return practiceQuestions
      case "boss": return [bossQuestion]
      default: return []
    }
  }

  const getCurrentItem = () => {
    const questions = getCurrentQuestions()
    return questions[currentQuestionIndex]
  }

  if (!course) return <div className="flex items-center justify-center h-64">Caricamento...</div>

  return (
    <div className="h-[calc(100vh-140px)] flex flex-col">
      {/* Top Bar */}
      <div className="flex items-center justify-between p-4 border-b border-neutral-200 dark:border-neutral-700">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(`/corsi/${courseId}`)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="font-semibold text-lg">{course.fullname}</h1>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              Sessione {duration} min · Fase {currentPhaseIndex + 1}/{totalPhases}
            </p>
          </div>
        </div>

        {/* Phase indicator */}
        <div className="flex items-center gap-2">
          {PHASE_ORDER.slice(0, -1).map((p, i) => {
            const Icon = PHASE_CONFIG[p].icon
            return (
              <div key={p} className={cn(
                "flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium transition-all",
                i < currentPhaseIndex ? "bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-400" :
                i === currentPhaseIndex ? `${currentPhaseConfig.bg} ${currentPhaseConfig.color}` :
                "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
              )}>
                {Icon && <Icon className="h-3 w-3" />}
                {p !== "warmup" && <span>{PHASE_CONFIG[p].label}</span>}
              </div>
            )
          })}
        </div>

        {/* XP & Streak */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-neutral-100 dark:bg-neutral-800">
            <Zap className="h-4 w-4 text-warning-500" />
            <span className="font-mono font-semibold">{xpEarned} XP</span>
          </div>
          <div className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-neutral-100 dark:bg-neutral-800">
            <Heart className="h-4 w-4 text-error-500" />
            <span className="font-mono font-semibold">{streak}</span>
          </div>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="h-2 bg-neutral-200 dark:bg-neutral-700 relative overflow-hidden">
        <div
          className="h-full bg-accent-500 transition-all duration-500 ease-out"
          style={{ width: `${((currentPhaseIndex) / (totalPhases - 1) + (phaseProgress / 100) * (1 / (totalPhases - 1))) * 100}%` }}
        />
        {/* Phase markers */}
        {PHASE_ORDER.slice(0, -1).map((p, i) => (
          <div
            key={p}
            className="absolute top-0 bottom-0 w-0.5 bg-white/50"
            style={{ left: `${(i / (totalPhases - 1)) * 100}%` }}
          />
        ))}
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {phase === "warmup" && <WarmupPhase
          questions={warmupQuestions}
          currentQuestionIndex={currentQuestionIndex}
          showAnswer={showAnswer}
          confidence={confidence}
          currentPhaseConfig={currentPhaseConfig}
          handleAnswer={handleAnswer}
          nextQuestion={nextQuestion}
          setShowAnswer={setShowAnswer}
          setConfidence={setConfidence}
        />}
        {phase === "learn" && <LearnPhase
          steps={learnSteps}
          currentQuestionIndex={currentQuestionIndex}
          showAnswer={showAnswer}
          handleAnswer={handleAnswer}
          setShowAnswer={setShowAnswer}
        />}
        {phase === "practice" && <PracticePhase
          questions={practiceQuestions}
          currentQuestionIndex={currentQuestionIndex}
          showAnswer={showAnswer}
          confidence={confidence}
          handleAnswer={handleAnswer}
          nextQuestion={nextQuestion}
          setShowAnswer={setShowAnswer}
          setConfidence={setConfidence}
          xpEarned={xpEarned}
          streak={streak}
          combo={combo}
          questionsAnswered={questionsAnswered}
          correctAnswers={correctAnswers}
        />}
        {phase === "boss" && <BossPhase
          question={bossQuestion}
          showAnswer={showAnswer}
          handleAnswer={handleAnswer}
          setShowAnswer={setShowAnswer}
        />}
        {phase === "cooldown" && <CooldownPhase
          xpEarned={xpEarned}
          streak={streak}
          questionsAnswered={questionsAnswered}
          correctAnswers={correctAnswers}
        />}
        {phase === "complete" && <CompletePhase
          xpEarned={xpEarned}
          streak={streak}
          questionsAnswered={questionsAnswered}
          correctAnswers={correctAnswers}
          navigate={navigate}
          courseId={courseId || ""}
          duration={duration}
        />}
      </div>

      {/* Bottom Actions */}
      <div className="p-4 border-t border-neutral-200 dark:border-neutral-700 bg-white/50 dark:bg-neutral-950/50 backdrop-blur-sm">
        {phase !== "complete" && phase !== "cooldown" && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm text-neutral-500">Sicurezza:</span>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((c) => (
                  <button
                    key={c}
                    onClick={() => setConfidence(c)}
                    className={cn(
                      "w-8 h-8 rounded-full text-xs font-medium transition-all",
                      c <= confidence
                        ? "bg-accent-500 text-white"
                        : "bg-neutral-200 text-neutral-500 hover:bg-neutral-300 dark:bg-neutral-700 dark:text-neutral-400"
                    )}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
            <Button
              size="lg"
              className="flex-1 sm:flex-none min-w-[160px]"
              onClick={showAnswer ? nextQuestion : () => handleAnswer(true)}
              disabled={!showAnswer && phase !== "learn"}
            >
              {showAnswer ? (
                currentQuestionIndex < getCurrentQuestions().length - 1
                  ? "Avanti"
                  : "Fase successiva"
              ) : (
                "Conferma risposta"
              )}
            </Button>
          </div>
        )}

        {phase === "cooldown" && (
          <Button size="lg" className="w-full" onClick={() => setPhase("complete")}>
            Vedi risultati finali
          </Button>
        )}

        {phase === "complete" && (
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => navigate(`/corsi/${courseId}`)}>
              Torna al corso
            </Button>
            <Button className="flex-1" onClick={() => navigate(`/studio/${courseId}?duration=${duration}`)}>
              <RotateCcw className="h-4 w-4 mr-1" />
              Nuova sessione
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

// === PHASE COMPONENTS (inline, using props) ===

function WarmupPhase({
  questions, currentQuestionIndex, showAnswer, confidence, currentPhaseConfig,
  handleAnswer, nextQuestion, setShowAnswer, setConfidence
}: {
  questions: Question[]
  currentQuestionIndex: number
  showAnswer: boolean
  confidence: number
  currentPhaseConfig: typeof PHASE_CONFIG.warmup
  handleAnswer: (correct: boolean) => void
  nextQuestion: () => void
  setShowAnswer: (v: boolean) => void
  setConfidence: (v: number) => void
}) {
  const item = questions[currentQuestionIndex]

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="text-center mb-8">
        <div className={cn("inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium", currentPhaseConfig.bg, currentPhaseConfig.color)}>
          <currentPhaseConfig.icon className="h-4 w-4" />
          {currentPhaseConfig.label} - Domanda {currentQuestionIndex + 1}/{questions.length}
        </div>
      </div>

      <Card className={cn("border-2", showAnswer ? "border-success-300 dark:border-success-700" : "border-neutral-200 dark:border-neutral-700")}>
        <CardContent className="p-8 text-center">
          <p className="text-2xl font-medium text-neutral-950 dark:text-neutral-50 mb-6">{item.prompt}</p>

          {!showAnswer && (
            <div className="space-y-3">
              {item.options ? (
                item.options.map((opt, i) => (
                  <Button
                    key={i}
                    variant="outline"
                    className="w-full justify-start"
                    onClick={() => handleAnswer(opt === item.answer)}
                  >
                    {opt}
                  </Button>
                ))
              ) : (
                <Button variant="default" className="w-full" onClick={() => handleAnswer(true)}>
                  So la risposta
                </Button>
              )}
            </div>
          )}

          {showAnswer && (
            <div className="space-y-4 text-left">
              <div className={cn("p-4 rounded-lg", item.type === "vero_falso" ? "bg-success-50 dark:bg-success-900/20" : "bg-accent-50 dark:bg-accent-900/20")}>
                <p className="font-medium">Risposta corretta: {item.answer}</p>
              </div>
              <div className="p-4 rounded-lg bg-neutral-100 dark:bg-neutral-800">
                <p className="font-medium mb-2">Soluzione:</p>
                <p className="text-sm text-neutral-600 dark:text-neutral-300">{item.solution}</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Progress value={((currentQuestionIndex + (showAnswer ? 1 : 0)) / questions.length) * 100} className="h-2" />
    </div>
  )
}

function LearnPhase({
  steps, currentQuestionIndex, showAnswer, handleAnswer, setShowAnswer
}: {
  steps: LearnStep[]
  currentQuestionIndex: number
  showAnswer: boolean
  handleAnswer: (correct: boolean) => void
  setShowAnswer: (v: boolean) => void
}) {
  const step = steps[currentQuestionIndex]

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <Card>
        <CardContent className="p-6 space-y-6">
          {/* Step header */}
          <div className="flex items-center gap-3">
            <Badge variant="accent" className="text-sm">Passo {currentQuestionIndex + 1}/{steps.length}</Badge>
            <h2 className="text-xl font-semibold">{step.title}</h2>
          </div>

          {/* Why it matters */}
          <div className="p-4 rounded-lg bg-accent-50 dark:bg-accent-900/20 border border-accent-200 dark:border-accent-800">
            <p className="text-neutral-700 dark:text-neutral-300">{step.explanation}</p>
          </div>

          {/* Explanation */}
          <div className="prose prose-neutral dark:prose-invert max-w-none">
            <h3 className="font-medium mb-2">Spiegazione</h3>
            <p className="text-neutral-600 dark:text-neutral-300 whitespace-pre-wrap">{step.explanation}</p>
          </div>

          {/* Quick understand */}
          <div className="p-4 rounded-lg bg-success-50 dark:bg-success-900/20 border border-success-200 dark:border-success-800">
            <div className="flex items-center gap-2 mb-2">
              <Zap className="h-4 w-4 text-success-600" />
              <span className="font-medium text-success-700 dark:text-success-400">Per capirlo al volo</span>
            </div>
            <p className="text-neutral-700 dark:text-neutral-300">{step.quick_understand}</p>
          </div>

          {/* Verification */}
          {!showAnswer && (
            <div className="p-4 rounded-lg bg-warning-50 dark:bg-warning-900/20 border border-warning-200 dark:border-warning-800">
              <h4 className="font-medium mb-2">Verifica immediata</h4>
              <p className="mb-3">{step.verification.question}</p>
              <Button onClick={() => handleAnswer(true)} className="w-full">Ho capito</Button>
            </div>
          )}

          {showAnswer && (
            <div className="p-4 rounded-lg bg-success-50 dark:bg-success-900/20 border border-success-200 dark:border-success-800">
              <h4 className="font-medium mb-2">✓ Verificato</h4>
              <p>Risposta: {step.verification.answer}</p>
            </div>
          )}

          {/* Exam example */}
          <div className="p-4 rounded-lg bg-error-50 dark:bg-error-900/20 border border-error-200 dark:border-error-800">
            <div className="flex items-center gap-2 mb-2">
              <Flag className="h-4 w-4 text-error-600" />
              <span className="font-medium text-error-700 dark:text-error-400">Esempio d'esame: "Indovina il passo dopo"</span>
            </div>
            <p className="mb-2">{step.exam_example.prompt}</p>
            <p className="text-sm text-neutral-600 dark:text-neutral-400"><strong>Passo successivo:</strong> {step.exam_example.next_step}</p>
          </div>

          {/* Common errors */}
          <div>
            <h4 className="font-medium mb-2 flex items-center gap-2">
              <X className="h-4 w-4 text-error-500" />
              Errori tipici
            </h4>
            <ul className="space-y-1 text-sm text-neutral-600 dark:text-neutral-300">
              {step.common_errors.map((err, i) => (
                <li key={i} className="flex items-center gap-2">
                  <X className="h-3 w-3 text-error-500 flex-shrink-0" />
                  {err}
                </li>
              ))}
            </ul>
          </div>

          {/* Summary */}
          <div className="p-4 rounded-lg bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700">
            <h4 className="font-medium mb-2">🧠 Da sapere a memoria</h4>
            <p className="font-mono text-sm">{step.summary}</p>
          </div>

          <Button onClick={() => handleAnswer(true)} className="w-full" size="lg">
            Passo successivo
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

function PracticePhase({
  questions, currentQuestionIndex, showAnswer, confidence,
  handleAnswer, nextQuestion, setShowAnswer, setConfidence,
  xpEarned, streak, combo, questionsAnswered, correctAnswers
}: {
  questions: Question[]
  currentQuestionIndex: number
  showAnswer: boolean
  confidence: number
  handleAnswer: (correct: boolean) => void
  nextQuestion: () => void
  setShowAnswer: (v: boolean) => void
  setConfidence: (v: number) => void
  xpEarned: number
  streak: number
  combo: number
  questionsAnswered: number
  correctAnswers: number
}) {
  const item = questions[currentQuestionIndex]
  const isLast = currentQuestionIndex === questions.length - 1

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <Badge variant="success" className="text-sm">Esercitati {currentQuestionIndex + 1}/{questions.length}</Badge>
        <div className="flex items-center gap-2">
          <span className="text-sm text-neutral-500">Combo: </span>
          <span className="font-mono font-bold text-accent-600">{combo}</span>
        </div>
      </div>

      <Card className={cn("border-2", showAnswer ? "border-success-300 dark:border-success-700" : "border-neutral-200 dark:border-neutral-700")}>
        <CardContent className="p-8">
          <div className="flex items-center gap-2 mb-4">
            <Badge variant={item.type === "esercizio" ? "accent" : "outline"} className="text-xs capitalize">{item.type}</Badge>
            <Badge variant="outline" className="text-xs">{item.topic}</Badge>
            <Badge variant={item.difficulty >= 3 ? "destructive" : item.difficulty >= 2 ? "warning" : "success"} className="text-xs">
              Difficoltà {item.difficulty}
            </Badge>
          </div>

          <p className="text-xl font-medium text-neutral-950 dark:text-neutral-50 mb-6">{item.prompt}</p>

          {!showAnswer && (
            <div className="space-y-3">
              {item.options ? (
                item.options.map((opt, i) => (
                  <Button
                    key={i}
                    variant="outline"
                    className="w-full justify-start"
                    onClick={() => handleAnswer(opt === item.answer)}
                  >
                    {opt}
                  </Button>
                ))
              ) : item.type === "vero_falso" ? (
                <div className="flex gap-3">
                  <Button variant="outline" className="flex-1" onClick={() => handleAnswer(item.answer === "Vero")}>Vero</Button>
                  <Button variant="outline" className="flex-1" onClick={() => handleAnswer(item.answer === "Falso")}>Falso</Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <textarea
                    placeholder="Scrivi la tua risposta..."
                    className="w-full min-h-[100px] p-3 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900"
                    rows={4}
                  />
                  <Button onClick={() => handleAnswer(true)} className="w-full">Conferma</Button>
                </div>
              )}
            </div>
          )}

          {showAnswer && (
            <div className="space-y-4">
              <div className={cn("p-4 rounded-lg", item.answer === "Vero" || item.answer === "Falso" ? "bg-success-50 dark:bg-success-900/20" : "bg-accent-50 dark:bg-accent-900/20")}>
                <p className="font-medium">La tua risposta: {/* would track user answer */}</p>
                <p className="font-medium text-success-700 dark:text-success-400">Corretta: {item.answer}</p>
              </div>
              <div className="p-4 rounded-lg bg-neutral-100 dark:bg-neutral-800">
                <p className="font-medium mb-2">Soluzione:</p>
                <p className="text-sm text-neutral-600 dark:text-neutral-300">{item.solution}</p>
              </div>
              {item.lecture_id && item.t_start && (
                <Button variant="outline" className="w-full gap-2" size="sm">
                  <Play className="h-4 w-4" />
                  Vai al minuto {Math.floor(item.t_start / 60)}:{String(item.t_start % 60).padStart(2, '0')} della lezione
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Progress value={((currentQuestionIndex + (showAnswer ? 1 : 0)) / questions.length) * 100} className="h-2" />
    </div>
  )
}

function BossPhase({
  question, showAnswer, handleAnswer, setShowAnswer
}: {
  question: Question
  showAnswer: boolean
  handleAnswer: (correct: boolean) => void
  setShowAnswer: (v: boolean) => void
}) {
  return (
    <div className="space-y-6 max-w-3xl mx-auto text-center">
      <div className="p-6 rounded-2xl bg-error-50 dark:bg-error-900/20 border-2 border-error-200 dark:border-error-800">
        <Flag className="h-12 w-12 mx-auto text-error-500 mb-4" />
        <h2 className="text-2xl font-bold text-error-700 dark:text-error-400 mb-2">Boss Finale</h2>
        <p className="text-error-600 dark:text-error-300">Domanda stile esame con timer. Dimostra di aver imparato!</p>
      </div>

      <Card className={cn("border-2", showAnswer ? "border-success-300 dark:border-success-700" : "border-error-200 dark:border-error-700")}>
        <CardContent className="p-8">
          <div className="flex items-center justify-center gap-2 mb-6">
            <Badge variant="destructive" className="text-sm">ESAME</Badge>
            <Badge variant="accent" className="text-sm">{question.topic}</Badge>
            <Badge variant={question.difficulty >= 3 ? "destructive" : "warning"} className="text-sm">Difficoltà {question.difficulty}</Badge>
          </div>

          <p className="text-lg font-medium text-neutral-950 dark:text-neutral-50 mb-6">{question.prompt}</p>

          {!showAnswer && (
            <div className="space-y-4">
              <textarea
                placeholder="Scrivi la tua soluzione completa..."
                className="w-full min-h-[150px] p-4 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 font-mono text-sm"
                rows={6}
              />
              <Button onClick={() => handleAnswer(true)} className="w-full" size="lg">
                Consegna
              </Button>
            </div>
          )}

          {showAnswer && (
            <div className="space-y-4">
              <div className="p-4 rounded-lg bg-success-50 dark:bg-success-900/20 border border-success-200 dark:border-success-800">
                <p className="font-medium text-success-700 dark:text-success-400 mb-2">✓ Consegnato per correzione</p>
                <p className="text-sm text-neutral-600 dark:text-neutral-300">La correzione AI arriverà tra pochi secondi...</p>
              </div>
              <div className="p-4 rounded-lg bg-neutral-100 dark:bg-neutral-800">
                <p className="font-medium mb-2">Soluzione di riferimento:</p>
                <p className="text-sm text-neutral-600 dark:text-neutral-300 font-mono whitespace-pre-wrap">{question.solution}</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function CooldownPhase({
  xpEarned, streak, questionsAnswered, correctAnswers
}: {
  xpEarned: number
  streak: number
  questionsAnswered: number
  correctAnswers: number
}) {
  return (
    <div className="space-y-6 max-w-3xl mx-auto text-center">
      <div className="p-8 rounded-2xl bg-success-50 dark:bg-success-900/20 border-2 border-success-200 dark:border-success-800">
        <Heart className="h-12 w-12 mx-auto text-success-500 mb-4" />
        <h2 className="text-2xl font-bold text-success-700 dark:text-success-400 mb-2">Sessione completata!</h2>
        <p className="text-success-600 dark:text-success-300">Ottimo lavoro. Ecco il riepilogo.</p>
      </div>

      <Card>
        <CardContent className="p-6 space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <StatCard label="XP guadagnati" value={xpEarned} icon={<Zap className="h-5 w-5 text-warning-500" />} />
            <StatCard label="Domande" value={`${questionsAnswered} risposte`} icon={<HelpCircle className="h-5 w-5 text-accent-500" />} />
            <StatCard label="Corrette" value={`${correctAnswers} / ${questionsAnswered}`} icon={<Check className="h-5 w-5 text-success-500" />} />
          </div>

          <Separator />

          <div className="space-y-3 text-left">
            <h4 className="font-medium">Da rivedere:</h4>
            <ul className="space-y-1 text-sm text-neutral-600 dark:text-neutral-300">
              <li className="flex items-center gap-2"><X className="h-3 w-3 text-error-500" /> Derivata di funzioni composte (regola catena)</li>
              <li className="flex items-center gap-2"><X className="h-3 w-3 text-error-500" /> Punti critici e classificazione</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function CompletePhase({
  xpEarned, streak, questionsAnswered, correctAnswers,
  navigate, courseId, duration
}: {
  xpEarned: number
  streak: number
  questionsAnswered: number
  correctAnswers: number
  navigate: (path: string) => void
  courseId: string
  duration: number
}) {
  return (
    <div className="space-y-6 max-w-3xl mx-auto text-center">
      <div className="p-8 rounded-2xl bg-success-50 dark:bg-success-900/20 border-2 border-success-200 dark:border-success-800">
        <Check className="h-16 w-16 mx-auto text-success-500 mb-4" />
        <h2 className="text-3xl font-bold text-success-700 dark:text-success-400 mb-2">Complimenti! 🎉</h2>
        <p className="text-success-600 dark:text-success-300 text-lg">Hai completato la sessione. I risultati sono stati salvati.</p>
      </div>

      <Card>
        <CardContent className="p-6 space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <StatCard label="XP totali" value={xpEarned} icon={<Zap className="h-5 w-5 text-warning-500" />} />
            <StatCard label="Streak" value={`${streak} 🔥`} icon={<Heart className="h-5 w-5 text-error-500" />} />
            <StatCard label="Precisione" value={`${questionsAnswered ? Math.round(correctAnswers / questionsAnswered * 100) : 0}%`} icon={<Target className="h-5 w-5 text-accent-500" />} />
          </div>

          <Separator />

          <div className="space-y-3">
            <h4 className="font-medium">Prossimi passi consigliati:</h4>
            <ul className="space-y-2 text-left">
              <li className="p-3 rounded-lg bg-warning-50 dark:bg-warning-900/20 border border-warning-200 dark:border-warning-800">
                Rivedi: Regola della catena (2 errori)
              </li>
              <li className="p-3 rounded-lg bg-accent-50 dark:bg-accent-900/20 border border-accent-200 dark:border-accent-800">
                Prossima lezione: Applicazioni derivate - Ottimizzazione
              </li>
              <li className="p-3 rounded-lg bg-success-50 dark:bg-success-900/20 border border-success-200 dark:border-success-800">
                Flashcard in scadenza: 3 da ripassare oggi
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function StatCard({ label, value, icon }: { label: string; value: number | string; icon: React.ReactNode }) {
  return (
    <div className="p-4 rounded-lg bg-neutral-50 dark:bg-neutral-800/50 text-center">
      <div className="flex items-center justify-center gap-1 mb-1">{icon}</div>
      <p className="text-2xl font-bold text-neutral-950 dark:text-neutral-50">{value}</p>
      <p className="text-xs text-neutral-500 dark:text-neutral-400">{label}</p>
    </div>
  )
}