import type { ReactNode } from "react"

interface StatCardProps {
  label: string
  value: number | string
  icon: ReactNode
}

export function StatCard({ label, value, icon }: StatCardProps) {
  return (
    <div className="p-4 rounded-lg bg-neutral-50 dark:bg-neutral-800/50 text-center">
      <div className="flex items-center justify-center gap-1 mb-1">{icon}</div>
      <p className="text-2xl font-bold text-neutral-950 dark:text-neutral-50">{value}</p>
      <p className="text-xs text-neutral-500 dark:text-neutral-400">{label}</p>
    </div>
  )
}