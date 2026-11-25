import { Menu, Search, Bell, Sun, Moon, Monitor, MoonStar, CheckCheck } from "lucide-react"
import * as Popover from "@radix-ui/react-popover"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"
import { useUIStore } from "@/store/ui"
import { Button } from "@/components/ui/button"
import { api, describeError } from "@/lib/api"
import { shortcutLabel } from "@/lib/platform"
import { dedupeNotifications } from "@/lib/notifications"
import { safeFormatDistance } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import type { NotificationItem } from "@/types"

const THEME_LABEL = { system: "Sistema", light: "Chiaro", dark: "Scuro", oled: "OLED" } as const

export function Header() {
  const theme = useUIStore((s) => s.theme)
  const setTheme = useUIStore((s) => s.setTheme)
  const setCommandPaletteOpen = useUIStore((s) => s.setCommandPaletteOpen)
  const sidebarOpen = useUIStore((s) => s.sidebarOpen)
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen)

  const toggleTheme = () => {
    const themes: Array<"light" | "dark" | "oled" | "system"> = ["system", "light", "dark", "oled"]
    const currentIndex = themes.indexOf(theme)
    setTheme(themes[(currentIndex + 1) % themes.length])
  }

  const themeIcon = () => {
    switch (theme) {
      case "light": return <Sun className="h-5 w-5" />
      case "dark": return <Moon className="h-5 w-5" />
      case "oled": return <MoonStar className="h-5 w-5" />
      default: return <Monitor className="h-5 w-5" />
    }
  }

  return (
    <header className="sticky top-0 z-[100] h-14 border-b border-neutral-200 bg-white/80 backdrop-blur-sm dark:border-neutral-700 dark:bg-neutral-950/80">
      <div className="flex h-full items-center gap-2 sm:gap-4 px-3 sm:px-4">
        {/* Mobile menu button */}
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="lg:hidden p-2 rounded-md text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
          aria-label={sidebarOpen ? "Chiudi menu" : "Apri menu"}
          aria-expanded={sidebarOpen}
          aria-controls="app-sidebar"
        >
          <Menu className="h-5 w-5" />
        </button>

        {/* Search: apre la palette (Ctrl/Cmd+K funziona ovunque) */}
        <button
          type="button"
          onClick={() => setCommandPaletteOpen(true)}
          className="relative flex flex-1 max-w-xl items-center h-9 rounded-md border border-neutral-200 bg-white pl-10 pr-3 text-left text-sm text-neutral-400 hover:border-neutral-300 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:border-neutral-600 min-w-0"
          aria-label="Cerca in tutto il materiale"
        >
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" aria-hidden="true" />
          <span className="truncate">Cerca in tutto il materiale…</span>
          <kbd className="ml-auto hidden sm:inline-flex px-1.5 text-[10px] font-mono text-neutral-400">{shortcutLabel()}</kbd>
        </button>

        {/* Theme toggle */}
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleTheme}
          aria-label={`Tema: ${THEME_LABEL[theme]} (cambia)`}
          title={`Tema: ${THEME_LABEL[theme]}`}
        >
          {themeIcon()}
        </Button>

        <NotificationsBell />
      </div>
    </header>
  )
}

function NotificationsBell() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { data: notifications = [] } = useQuery<NotificationItem[]>({
    queryKey: ["notifications"],
    queryFn: api.getNotifications,
    refetchInterval: 120_000,
  })
  const items = dedupeNotifications(notifications)
  const unread = items.filter((n) => !n.read).length

  const markRead = useMutation({
    mutationFn: api.markNotificationsRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
    onError: (err) => toast({ variant: "destructive", title: "Impossibile segnare come lette", description: describeError(err) }),
  })

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button variant="ghost" size="icon" aria-label={unread ? `Notifiche: ${unread} non lette` : "Notifiche"} className="relative">
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-error-500 text-white text-[10px] font-semibold flex items-center justify-center">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="z-[300] w-[min(22rem,calc(100vw-1rem))] rounded-xl border border-neutral-200 bg-white p-2 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
        >
          <div className="flex items-center justify-between px-2 py-1.5">
            <p className="text-sm font-semibold">Novità</p>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs"
              disabled={!unread || markRead.isPending}
              onClick={() => markRead.mutate()}
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Segna tutte come lette
            </Button>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-2 py-6 text-center text-sm text-neutral-500">Nessuna novità.</p>
            ) : (
              items.slice(0, 20).map((n) => (
                <Popover.Close asChild key={n.id}>
                  <button
                    type="button"
                    disabled={!n.course_id}
                    onClick={() => n.course_id && navigate(`/corsi/${n.course_id}`)}
                    className="w-full text-left rounded-lg px-2 py-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:cursor-default disabled:hover:bg-transparent"
                  >
                    <p className="flex items-center gap-2 text-sm font-medium">
                      {!n.read && <span className="h-2 w-2 rounded-full bg-accent-500 shrink-0" aria-label="non letta" />}
                      <span className="truncate">{n.title}{n.count > 1 ? ` (${n.count})` : ""}</span>
                    </p>
                    {n.body && <p className="text-xs text-neutral-500 line-clamp-2 break-words">{n.body}</p>}
                    <p className="text-[11px] text-neutral-400 mt-0.5">
                      {n.course ? `${n.course} · ` : ""}{safeFormatDistance(n.created_at)}
                    </p>
                  </button>
                </Popover.Close>
              ))
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
