import { Menu, Search, Bell, Sun, Moon, Monitor, Command } from "lucide-react"
import { useState } from "react"
import { useUIStore } from "@/store/ui"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"

export function Header() {
  const { theme, setTheme, commandPaletteOpen, setCommandPaletteOpen, sidebarOpen, setSidebarOpen } = useUIStore()
  const [searchQuery, setSearchQuery] = useState("")

  const toggleTheme = () => {
    const themes: Array<"light" | "dark" | "oled" | "system"> = ["system", "light", "dark", "oled"]
    const currentIndex = themes.indexOf(theme)
    setTheme(themes[(currentIndex + 1) % themes.length])
  }

  const themeIcon = () => {
    switch (theme) {
      case "light": return <Sun className="h-5 w-5" />
      case "dark": return <Moon className="h-5 w-5" />
      case "oled": return <Monitor className="h-5 w-5" />
      default: return <Monitor className="h-5 w-5" />
    }
  }

  return (
    <header className="sticky top-0 z-100 h-14 border-b border-neutral-200 bg-white/80 backdrop-blur-sm dark:border-neutral-700 dark:bg-neutral-950/80">
      <div className="flex h-full items-center gap-4 px-4">
        {/* Mobile menu button */}
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="lg:hidden p-2 rounded-md text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
          aria-label="Menu"
        >
          <Menu className="h-5 w-5" />
        </button>

        {/* Search / Command Palette */}
        <div className="relative flex-1 max-w-xl">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" aria-hidden="true" />
            <kbd className="absolute right-3 top-1/2 hidden -translate-y-1/2 px-1.5 text-[10px] font-mono text-neutral-400 sm:inline-flex">
              ⌘K
            </kbd>
            <Input
              placeholder="Cerca in tutto il materiale… (⌘K)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "k") {
                  e.preventDefault()
                  setCommandPaletteOpen(true)
                }
              }}
              className="pl-10 pr-10"
              onFocus={() => setCommandPaletteOpen(true)}
            />
          </div>
        </div>

        {/* Theme toggle */}
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleTheme}
          aria-label={`Tema: ${theme}`}
        >
          {themeIcon()}
        </Button>

        {/* Notifications */}
        <Button variant="ghost" size="icon" aria-label="Notifiche">
          <Bell className="h-5 w-5" />
        </Button>
      </div>
    </header>
  )
}