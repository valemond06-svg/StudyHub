import { lazy, Suspense } from "react"
import { QueryClientProvider } from "@tanstack/react-query"
import { BrowserRouter, Routes, Route } from "react-router-dom"
import { Toaster } from "@/components/ui/toaster"
import { MainLayout } from "@/components/layout/MainLayout"
import { Home } from "@/pages/Home"
import { Loader2 } from "lucide-react"
import { queryClient } from "@/lib/api"

const Corsi = lazy(() => import("@/pages/Corsi").then((m) => ({ default: m.Corsi })))
const CorsoDetail = lazy(() => import("@/pages/CorsoDetail").then((m) => ({ default: m.CorsoDetail })))
const Studio = lazy(() => import("@/pages/Studio").then((m) => ({ default: m.Studio })))
const Lab = lazy(() => import("@/pages/Lab").then((m) => ({ default: m.Lab })))
const Impostazioni = lazy(() => import("@/pages/Impostazioni").then((m) => ({ default: m.Impostazioni })))

function Loading() {
  return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="h-8 w-8 animate-spin text-accent-500" />
    </div>
  )
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<MainLayout />}>
            <Route path="/" element={<Home />} />
            <Route path="/corsi" element={
              <Suspense fallback={<Loading />}><Corsi /></Suspense>
            } />
            <Route path="/corsi/:id" element={
              <Suspense fallback={<Loading />}><CorsoDetail /></Suspense>
            } />
            <Route path="/lab" element={
              <Suspense fallback={<Loading />}><Lab /></Suspense>
            } />
            <Route path="/studio/:courseId" element={
              <Suspense fallback={<Loading />}><Studio /></Suspense>
            } />
            <Route path="/impostazioni" element={
              <Suspense fallback={<Loading />}><Impostazioni /></Suspense>
            } />
          </Route>
        </Routes>
        <Toaster />
      </BrowserRouter>
    </QueryClientProvider>
  )
}

export default App