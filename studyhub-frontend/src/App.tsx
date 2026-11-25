import { Component, type ReactNode, lazy, Suspense, useEffect } from "react"
import { QueryClientProvider } from "@tanstack/react-query"
import { BrowserRouter, Routes, Route, Navigate, Link } from "react-router-dom"
import { Toaster } from "@/components/ui/toaster"
import { MainLayout } from "@/components/layout/MainLayout"
import { CommandPalette } from "@/components/command-palette"
import { AlertCircle, Loader2, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { queryClient, ensureCsrfToken } from "@/lib/api"
import { useUIStore } from "@/store/ui"

const Home = lazy(() => import("@/pages/Home").then((m) => ({ default: m.Home })))
const Corsi = lazy(() => import("@/pages/Corsi").then((m) => ({ default: m.Corsi })))
const CorsoDetail = lazy(() => import("@/pages/CorsoDetail").then((m) => ({ default: m.CorsoDetail })))
const Studio = lazy(() => import("@/pages/Studio").then((m) => ({ default: m.Studio })))
const StudyTok = lazy(() => import("@/pages/StudyTok").then((m) => ({ default: m.StudyTok })))
const SimulazioneRunner = lazy(() => import("@/pages/SimulazioneRunner").then((m) => ({ default: m.SimulazioneRunner })))
const Lab = lazy(() => import("@/pages/Lab").then((m) => ({ default: m.Lab })))
const Impostazioni = lazy(() => import("@/pages/Impostazioni").then((m) => ({ default: m.Impostazioni })))
const Piano = lazy(() => import("@/pages/Piano").then((m) => ({ default: m.Piano })))
const Quaderno = lazy(() => import("@/pages/Quaderno").then((m) => ({ default: m.Quaderno })))
const FlashcardPage = lazy(() => import("@/pages/Flashcard").then((m) => ({ default: m.FlashcardPage })))
const Impara = lazy(() => import("@/pages/Impara").then((m) => ({ default: m.Impara })))
const Documento = lazy(() => import("@/pages/Documento").then((m) => ({ default: m.Documento })))
const Benvenuto = lazy(() => import("@/pages/Benvenuto").then((m) => ({ default: m.Benvenuto })))

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("StudyHub ErrorBoundary caught:", error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[50vh] p-6 text-center space-y-4">
          <div className="p-3 rounded-full bg-danger-100 text-danger-600 dark:bg-danger-950/40 dark:text-danger-400">
            <AlertCircle className="h-8 w-8" />
          </div>
          <h2 className="text-xl font-bold text-neutral-900 dark:text-neutral-50">
            Qualcosa è andato storto
          </h2>
          <p className="text-sm text-neutral-500 dark:text-neutral-400 max-w-md">
            {this.state.error?.message || "Si è verificato un errore imprevisto durante il rendering della pagina."}
          </p>
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={() => {
                this.setState({ hasError: false, error: null })
                window.location.href = "/"
              }}
            >
              Torna alla Home
            </Button>
            <Button
              onClick={() => {
                this.setState({ hasError: false, error: null })
                window.location.reload()
              }}
              className="gap-2"
            >
              <RefreshCw className="h-4 w-4" />
              Ricarica
            </Button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

function Loading() {
  return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="h-8 w-8 animate-spin text-accent-500" />
    </div>
  )
}

function useCsrfToken() {
  useEffect(() => {
    // Una sola chiamata a /api/csrf (anche con StrictMode): token CSRF e cookie api_token per audio/slide
    void ensureCsrfToken()
    // La ripresa delle sessioni ora sta sul server (GET /api/study/{id}/sessions/open): via la vecchia copia locale.
    try { window.localStorage.removeItem("studyhub-session") } catch { /* storage non disponibile */ }
  }, [])
}

function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4 text-center">
      <h1 className="text-2xl font-semibold text-neutral-950 dark:text-neutral-50">Pagina non trovata</h1>
      <p className="text-neutral-500 dark:text-neutral-400">L'indirizzo non corrisponde a nessuna pagina di StudyHub.</p>
      <Button asChild><Link to="/">Torna alla Home</Link></Button>
    </div>
  )
}

function useThemeSync() {
  const theme = useUIStore((s) => s.theme)

  useEffect(() => {
    const root = document.documentElement
    const applyTheme = (isDark: boolean, isOled: boolean) => {
      if (isDark) {
        root.classList.add("dark")
        root.classList.remove("light")
      } else {
        root.classList.remove("dark")
        root.classList.add("light")
      }

      if (isOled) {
        root.classList.add("oled")
      } else {
        root.classList.remove("oled")
      }
    }

    if (theme === "dark") {
      applyTheme(true, false)
    } else if (theme === "oled") {
      applyTheme(true, true)
    } else if (theme === "light") {
      applyTheme(false, false)
    } else {
      const mq = window.matchMedia("(prefers-color-scheme: dark)")
      applyTheme(mq.matches, false)
      const handler = (e: MediaQueryListEvent) => applyTheme(e.matches, false)
      mq.addEventListener("change", handler)
      return () => mq.removeEventListener("change", handler)
    }
  }, [theme])
}

function App() {
  useThemeSync()
  useCsrfToken()

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Routes>
            <Route element={<MainLayout />}>
              <Route path="/" element={
                <Suspense fallback={<Loading />}><Home /></Suspense>
              } />
              <Route path="/corsi" element={
                <Suspense fallback={<Loading />}><Corsi /></Suspense>
              } />
              <Route path="/corsi/:id" element={
                <Suspense fallback={<Loading />}><CorsoDetail /></Suspense>
              } />
              <Route path="/feed" element={
                <Suspense fallback={<Loading />}><StudyTok /></Suspense>
              } />
              <Route path="/lab/feed" element={
                <Suspense fallback={<Loading />}><StudyTok /></Suspense>
              } />
              <Route path="/piano" element={
                <Suspense fallback={<Loading />}><Piano /></Suspense>
              } />
              <Route path="/quaderno" element={
                <Suspense fallback={<Loading />}><Quaderno /></Suspense>
              } />
              <Route path="/flashcard" element={
                <Suspense fallback={<Loading />}><FlashcardPage /></Suspense>
              } />
              <Route path="/impara/:topicId" element={
                <Suspense fallback={<Loading />}><Impara /></Suspense>
              } />
              <Route path="/documento/:docId" element={
                <Suspense fallback={<Loading />}><Documento /></Suspense>
              } />
              <Route path="/benvenuto" element={
                <Suspense fallback={<Loading />}><Benvenuto /></Suspense>
              } />
              <Route path="/simulazione/:id" element={
                <Suspense fallback={<Loading />}><SimulazioneRunner /></Suspense>
              } />
              <Route path="/lab" element={
                <Suspense fallback={<Loading />}><Lab /></Suspense>
              } />
              <Route path="/studio" element={<Navigate to="/corsi" replace />} />
              <Route path="/studio/:courseId" element={
                <Suspense fallback={<Loading />}><Studio /></Suspense>
              } />
              <Route path="/impostazioni" element={
                <Suspense fallback={<Loading />}><Impostazioni /></Suspense>
              } />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
          <Toaster />
          <CommandPalette />
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  )
}

export default App
