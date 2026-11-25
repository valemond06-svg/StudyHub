export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false
  return /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || "")
}

/** Scorciatoia della ricerca globale nel formato del sistema operativo. */
export function shortcutLabel(): string {
  return isMacPlatform() ? "⌘K" : "Ctrl K"
}
