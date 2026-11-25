import { useEffect } from "react"
import { NavLink, useLocation } from "react-router-dom"
import { BookOpen, Brain, CalendarDays, NotebookPen, Zap, Settings, X, ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { useUIStore } from "@/store/ui"

const navigation = [
  { name: "Oggi", href: "/", icon: BookOpen },
  { name: "Corsi", href: "/corsi", icon: Brain },
  { name: "Piano", href: "/piano", icon: CalendarDays },
  { name: "Quaderno", href: "/quaderno", icon: NotebookPen },
  { name: "Lab", href: "/lab", icon: Zap },
  { name: "Impostazioni", href: "/impostazioni", icon: Settings },
] as const

/**
 * Desktop (lg+): barra fissa, comprimibile.
 * Schermi piccoli: menu a scomparsa, chiuso di default; si apre dal pulsante Menu dell'header e si chiude
 * con il velo, con Esc, con il pulsante Chiudi o cambiando pagina.
 */
export function Sidebar() {
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed)
  const toggleSidebarCollapsed = useUIStore((s) => s.toggleSidebarCollapsed)
  const sidebarOpen = useUIStore((s) => s.sidebarOpen)
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen)
  const location = useLocation()

  // Cambio pagina: il menu mobile si chiude
  useEffect(() => {
    setSidebarOpen(false)
  }, [location.pathname, setSidebarOpen])

  useEffect(() => {
    if (!sidebarOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSidebarOpen(false) }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [sidebarOpen, setSidebarOpen])

  // Sul mobile la barra è sempre "estesa": la compressione vale solo da lg in su
  const collapsed = sidebarCollapsed

  return (
    <>
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-[150] bg-black/40 backdrop-blur-xs lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
          data-testid="sidebar-backdrop"
        />
      )}
      <aside
        id="app-sidebar"
        aria-label="Menu principale"
        className={cn(
          "fixed left-0 top-0 z-[200] h-full border-r border-neutral-200 bg-white transition-transform duration-200 dark:border-neutral-700 dark:bg-neutral-900",
          "w-64",
          collapsed && "lg:w-16",
          sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
        data-open={sidebarOpen ? "true" : "false"}
      >
        <div className="flex h-full flex-col">
          {/* Brand / Toggle */}
          <div className="flex h-14 items-center justify-between px-4 border-b border-neutral-200 dark:border-neutral-700">
            <NavLink
              to="/"
              className={cn("flex items-center gap-2 font-semibold text-lg text-neutral-900 dark:text-neutral-50", collapsed && "lg:hidden")}
            >
              <Brain className="h-6 w-6 text-accent-500" />
              StudyHub
            </NavLink>
            <button
              onClick={toggleSidebarCollapsed}
              className="hidden lg:inline-flex p-2 rounded-md text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
              aria-label={collapsed ? "Espandi menu" : "Comprimi menu"}
              title={collapsed ? "Espandi menu" : "Comprimi menu"}
            >
              {collapsed ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
            </button>
            <button
              onClick={() => setSidebarOpen(false)}
              className="lg:hidden p-2 rounded-md text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
              aria-label="Chiudi menu"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 overflow-y-auto p-3 space-y-1" aria-label="Navigazione principale">
            {navigation.map((item) => (
              <NavLink
                key={item.name}
                to={item.href}
                end={item.href === "/"}
                aria-label={item.name}
                title={collapsed ? item.name : undefined}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-accent-50 text-accent-600 dark:bg-accent-950/30 dark:text-accent-400"
                      : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-50",
                    collapsed && "lg:justify-center lg:px-2"
                  )
                }
              >
                <item.icon className="h-5 w-5 flex-shrink-0" aria-hidden="true" />
                <span className={cn(collapsed && "lg:hidden")}>{item.name}</span>
              </NavLink>
            ))}
          </nav>
        </div>
      </aside>
    </>
  )
}
