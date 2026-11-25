import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useLocation } from "react-router-dom"
import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { api } from "@/lib/api"

/** Durante una sessione, una lezione o una simulazione la ricarica non si propone (come nella vecchia UI). */
const BUSY = [/^\/studio\/\d+/, /^\/simulazione\//, /^\/impara\//]

/**
 * Dopo un aggiornamento (nuova build in dist/) propone di ricaricare: la versione è il momento della build
 * servita dal backend (GET /api/version). Mai una ricarica forzata.
 */
export function UpdateBanner() {
  const { pathname } = useLocation()
  // La versione con cui è stata caricata questa pagina: quella scritta nel bundle al primo caricamento.
  const [loadedAt, setLoadedAt] = useState<string | null>(null)
  const { data } = useQuery({ queryKey: ["ui-version"], queryFn: () => api.getUIVersion(), refetchInterval: 60_000, retry: false, staleTime: 0 })
  const version = data?.ui || null
  if (version && loadedAt === null) setLoadedAt(version)
  const changed = Boolean(version && loadedAt && version !== loadedAt)
  if (!changed || BUSY.some((re) => re.test(pathname))) return null
  return (
    <div role="status" className="mx-4 mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-accent-300 bg-accent-50 p-3 text-sm dark:border-accent-800 dark:bg-accent-900/20 lg:mx-6">
      <span>È disponibile una nuova versione di StudyHub.</span>
      <Button size="sm" className="gap-1" onClick={() => window.location.reload()}><RefreshCw className="h-4 w-4" />Ricarica</Button>
    </div>
  )
}
