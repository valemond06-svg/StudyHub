import { beforeEach, describe, expect, it } from "vitest"
import { useUIStore } from "./ui"

beforeEach(() => {
  localStorage.clear()
  useUIStore.setState({ theme: "system", sidebarCollapsed: false, commandPaletteOpen: false, sidebarOpen: false })
})

describe("useUIStore", () => {
  it("persiste solo tema e sidebar compressa, non gli stati transitori", () => {
    useUIStore.getState().setTheme("oled")
    useUIStore.getState().setCommandPaletteOpen(true)
    useUIStore.getState().toggleSidebarCollapsed()
    const saved = JSON.parse(localStorage.getItem("studyhub-ui")!).state
    expect(saved).toEqual({ theme: "oled", sidebarCollapsed: true })
  })
})

describe("menu mobile", () => {
  it("parte chiuso e non viene ricordato tra le sessioni", () => {
    expect(useUIStore.getInitialState().sidebarOpen).toBe(false)
    useUIStore.getState().setSidebarOpen(true)
    const saved = JSON.parse(localStorage.getItem("studyhub-ui")!).state
    expect(saved.sidebarOpen).toBeUndefined()
  })
})