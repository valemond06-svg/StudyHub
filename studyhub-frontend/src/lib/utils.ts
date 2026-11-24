import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { formatDistanceToNow, parseISO, isValid, differenceInCalendarDays } from "date-fns"
import { it } from "date-fns/locale"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function safeFormatDistance(dateStr?: string | null, fallback = "Data non disponibile"): string {
  if (!dateStr) return fallback
  try {
    const d = typeof dateStr === "string" ? parseISO(dateStr) : new Date(dateStr)
    if (!isValid(d)) return fallback
    return formatDistanceToNow(d, { addSuffix: true, locale: it })
  } catch {
    return fallback
  }
}

export function safeDaysLeft(dateStr?: string | null): number | null {
  if (!dateStr) return null
  try {
    const d = typeof dateStr === "string" ? parseISO(dateStr) : new Date(dateStr)
    if (!isValid(d)) return null
    return Math.max(0, differenceInCalendarDays(d, new Date()))
  } catch {
    return null
  }
}
