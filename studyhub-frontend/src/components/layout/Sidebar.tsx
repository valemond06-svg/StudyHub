import { NavLink, useLocation } from "react-router-dom"
import { BookOpen, Brain, Zap, Settings, Menu, X, ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { useUIStore } from "@/store/ui"

const navigation = [
  { name: "Home", href: "/", icon: BookOpen },
  { name: "Corsi", href: "/corsi", icon: Brain },
  { name: "Lab", href: "/lab", icon: Zap },
  { name: "Impostazioni", href: "/impostazioni", icon: Settings },
] as const

export function Sidebar() {
  const { sidebarCollapsed, toggleSidebarCollapsed, sidebarOpen, setSidebarOpen } = useUIStore()
  const location = useLocation()

  if (!sidebarOpen) return null

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-200 h-full border-r border-neutral-200 bg-white transition-all duration-200 dark:border-neutral-700 dark:bg-neutral-900",
        sidebarCollapsed ? "w-16" : "w-64"
      )}
    >
      <div className="flex h-full flex-col">
        {/* Brand / Toggle */}
        <div className={cn("flex h-16 items-center justify-between px-4 border-b border-neutral-200 dark:border-neutral-700")}>
          {!sidebarCollapsed && (
            <NavLink to="/" className="flex items-center gap-2 font-semibold text-lg text-neutral-900 dark:text-neutral-50">
              <Brain className="h-6 w-6 text-accent-500" />
              StudyHub
            </NavLink>
          )}
          <button
            onClick={toggleSidebarCollapsed}
            className={cn(
              "p-2 rounded-md text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800",
              sidebarCollapsed && "rotate-180"
            )}
            aria-label={sidebarCollapsed ? "Espandi sidebar" : "Comprimi sidebar"}
          >
            {sidebarCollapsed ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto p-3 space-y-1" role="navigation" aria-label="Navigazione principale">
          {navigation.map((item) => (
            <NavLink
              key={item.name}
              to={item.href}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-accent-50 text-accent-600 dark:bg-accent-950/30 dark:text-accent-400"
                    : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-50",
                  sidebarCollapsed && "justify-center px-2"
                )
              }
              onClick={() => setSidebarOpen(true)}
            >
              <item.icon className="h-5 w-5 flex-shrink-0" aria-hidden="true" />
              {!sidebarCollapsed && <span>{item.name}</span>}
            </NavLink>
          ))}
        </nav>

        {/* Mobile close button */}
        <div className="lg:hidden p-3 border-t border-neutral-200 dark:border-neutral-700">
          <button
            onClick={() => setSidebarOpen(false)}
            className="w-full flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
          >
            <X className="h-5 w-5" />
            <span>Chiudi</span>
          </button>
        </div>
      </div>
    </aside>
  )
}