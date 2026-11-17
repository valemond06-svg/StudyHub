import { useCallback, useRef, useState } from "react"

const STORAGE_KEY = "studyhub-gamification"

interface GamificationState {
  xp: number
  level: number
  streak: number
  combo: number
  lastActiveDay: string | null
  unlockedMilestones: string[]
  totalSessions: number
  totalFlashcardsMature: number
  totalSimulationsPassed: number
}

export interface Milestone {
  id: string
  name: string
  description: string
  threshold: number
}

export interface Gamification {
  xp: number
  level: number
  streak: number
  combo: number
  addXp: (n: number) => void
  incrementStreak: () => void
  resetStreak: () => void
  awardMilestone: (id: string) => void
  /** Increment the session counter (feeds the "first-session" milestone). */
  recordSession: () => void
  /** Add to the mature-flashcards counter (feeds "100 flashcard mature"). */
  addMatureFlashcards: (n: number) => void
  /** Increment the passed-simulations counter (feeds "Prima simulazione superata"). */
  recordSimulationPassed: () => void
  onMilestone: (cb: (milestone: Milestone) => void) => () => void
}

/** XP needed to go from `level` to `level + 1`. Slows down as level rises. */
function xpToNext(level: number): number {
  return 100 * level
}

/** Total XP accumulated up to (but not including) `level`. */
function cumulativeXp(level: number): number {
  let total = 0
  for (let l = 1; l < level; l++) total += xpToNext(l)
  return total
}

function levelFromXp(xp: number): number {
  let level = 1
  while (xp >= cumulativeXp(level + 1)) level++
  return level
}

export const MILESTONES: Milestone[] = [
  { id: "first-session", name: "Prima sessione", description: "Hai completato la tua prima sessione di studio.", threshold: 1 },
  { id: "streak-3", name: "3 giorni di fila", description: "Hai studiato per 3 giorni consecutivi.", threshold: 3 },
  { id: "streak-7", name: "7 giorni di fila", description: "Una settimana intera senza interruzioni. Formidabile!", threshold: 7 },
  { id: "streak-10", name: "10 giorni di fila", description: "Doppia cifra di streak. La costanza paga.", threshold: 10 },
  { id: "streak-30", name: "30 giorni di fila", description: "Un mese di studio costante. Sei inarrestabile!", threshold: 30 },
  { id: "streak-60", name: "60 giorni di fila", description: "Due mesi di studio consecutivi. Leggenda!", threshold: 60 },
  { id: "flashcards-100", name: "100 flashcard mature", description: "Hai ripassato e maturato 100 flashcard.", threshold: 100 },
  { id: "simulation-passed", name: "Prima simulazione superata", description: "Hai superato la tua prima simulazione d'esame.", threshold: 1 },
]

function defaultState(): GamificationState {
  return {
    xp: 0,
    level: 1,
    streak: 0,
    combo: 0,
    lastActiveDay: null,
    unlockedMilestones: [],
    totalSessions: 0,
    totalFlashcardsMature: 0,
    totalSimulationsPassed: 0,
  }
}

function loadState(): GamificationState {
  if (typeof window === "undefined") return defaultState()
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultState()
    const parsed = JSON.parse(raw) as Partial<GamificationState>
    return { ...defaultState(), ...parsed }
  } catch {
    return defaultState()
  }
}

function isSameOrNextDay(prev: string | null, today: string): "same" | "next" | "gap" {
  if (!prev) return "same"
  if (prev === today) return "same"
  const prevDate = new Date(prev + "T00:00:00")
  const todayDate = new Date(today + "T00:00:00")
  const diffDays = Math.round((todayDate.getTime() - prevDate.getTime()) / 86_400_000)
  if (diffDays === 1) return "next"
  return "gap"
}

function isMilestoneHit(m: Milestone, s: GamificationState): boolean {
  switch (m.id) {
    case "first-session":
      return s.totalSessions >= m.threshold
    case "streak-3":
    case "streak-7":
    case "streak-10":
    case "streak-30":
    case "streak-60":
      return s.streak >= m.threshold
    case "flashcards-100":
      return s.totalFlashcardsMature >= m.threshold
    case "simulation-passed":
      return s.totalSimulationsPassed >= m.threshold
    default:
      return false
  }
}

export function useGamification(): Gamification {
  const [state, setState] = useState<GamificationState>(loadState)
  const milestoneListeners = useRef<Array<(m: Milestone) => void>>([])

  const persist = (next: GamificationState) => {
    setState(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      /* storage unavailable — keep state in memory */
    }
  }

  const checkMilestones = (next: GamificationState): GamificationState => {
    const newlyUnlocked = MILESTONES.filter(
      (m) => !next.unlockedMilestones.includes(m.id) && isMilestoneHit(m, next)
    )
    if (newlyUnlocked.length === 0) return next
    const result: GamificationState = {
      ...next,
      unlockedMilestones: [...next.unlockedMilestones, ...newlyUnlocked.map((m) => m.id)],
    }
    queueMicrotask(() => {
      for (const m of newlyUnlocked) {
        milestoneListeners.current.forEach((cb) => cb(m))
      }
    })
    return result
  }

  const addXp = (n: number) => {
    persist(checkMilestones({ ...state, xp: state.xp + Math.max(0, n) }))
  }

  const incrementStreak = () => {
    const today = new Date().toISOString().slice(0, 10)
    const relation = isSameOrNextDay(state.lastActiveDay, today)
    let streak = state.streak
    if (relation === "next") streak += 1
    else if (relation === "same") streak = Math.max(streak, 1)
    else streak = 1
    persist(checkMilestones({ ...state, streak, lastActiveDay: today }))
  }

  const resetStreak = () => {
    persist({ ...state, streak: 0 })
  }

  const awardMilestone = (id: string) => {
    const milestone = MILESTONES.find((m) => m.id === id)
    if (!milestone) return
    if (state.unlockedMilestones.includes(id)) return
    persist(checkMilestones({ ...state, unlockedMilestones: [...state.unlockedMilestones, id] }))
  }

  const onMilestone = useCallback((cb: (m: Milestone) => void) => {
    milestoneListeners.current.push(cb)
    return () => {
      milestoneListeners.current = milestoneListeners.current.filter((fn) => fn !== cb)
    }
  }, [])

  const recordSession = () => {
    persist(checkMilestones({ ...state, totalSessions: state.totalSessions + 1 }))
  }

  const addMatureFlashcards = (n: number) => {
    persist(
      checkMilestones({ ...state, totalFlashcardsMature: state.totalFlashcardsMature + Math.max(0, n) })
    )
  }

  const recordSimulationPassed = () => {
    persist(checkMilestones({ ...state, totalSimulationsPassed: state.totalSimulationsPassed + 1 }))
  }

  const level = levelFromXp(state.xp)

  return {
    xp: state.xp,
    level,
    streak: state.streak,
    combo: state.combo,
    addXp,
    incrementStreak,
    resetStreak,
    awardMilestone,
    recordSession,
    addMatureFlashcards,
    recordSimulationPassed,
    onMilestone,
  }
}

export { xpToNext, cumulativeXp, levelFromXp }