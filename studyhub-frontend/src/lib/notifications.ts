import type { NotificationItem } from "@/types"

export type GroupedNotification = NotificationItem & { count: number }

/**
 * GET /api/notifications può contenere avvisi ripetuti (es. "Panopto: login necessario" a ogni sync):
 * si tiene il più recente per (tipo, titolo, corso, testo) con il numero di ripetizioni; è "letto" solo se lo sono tutti.
 */
export function dedupeNotifications(items: NotificationItem[]): GroupedNotification[] {
  const byKey = new Map<string, GroupedNotification>()
  for (const n of items) {
    const key = [n.kind, n.title, n.course_id ?? "", n.body ?? ""].join("|")
    const prev = byKey.get(key)
    if (!prev) {
      byKey.set(key, { ...n, count: 1 })
      continue
    }
    const newer = (n.created_at ?? "") > (prev.created_at ?? "")
    byKey.set(key, {
      ...(newer ? n : prev),
      count: prev.count + 1,
      read: prev.read && n.read ? 1 : 0,
    })
  }
  return [...byKey.values()].sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))
}
