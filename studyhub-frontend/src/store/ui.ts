import { create } from "zustand"
import { persist } from "zustand/middleware"

type Theme = "light" | "dark" | "oled" | "system"

interface UIState {
  theme: Theme
  setTheme: (theme: Theme) => void
  /** Solo menu a scomparsa su schermi piccoli: su desktop la barra è sempre visibile. Parte chiuso. */
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
  sidebarCollapsed: boolean
  toggleSidebarCollapsed: () => void
  commandPaletteOpen: boolean
  setCommandPaletteOpen: (open: boolean) => void
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      theme: "system",
      setTheme: (theme) => set({ theme }),
      sidebarOpen: false,
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      sidebarCollapsed: false,
      toggleSidebarCollapsed: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      commandPaletteOpen: false,
      setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
    }),
    {
      name: "studyhub-ui",
      // Si ricordano solo le preferenze: palette comandi e menu mobile ripartono sempre chiusi.
      partialize: (s) => ({ theme: s.theme, sidebarCollapsed: s.sidebarCollapsed }),
    }
  )
)
