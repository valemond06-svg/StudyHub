import * as React from "react"
import { cn } from "@/lib/utils"

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "accent"
}

function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors",
        {
          "bg-neutral-100 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200": variant === "default",
          "bg-neutral-200 text-neutral-900 dark:bg-neutral-700 dark:text-neutral-100": variant === "secondary",
          "bg-error-500/10 text-error-600 dark:bg-error-500/20 dark:text-error-400": variant === "destructive",
          "border border-neutral-300 text-neutral-700 dark:border-neutral-700 dark:text-neutral-300": variant === "outline",
          "bg-success-500/10 text-success-600 dark:bg-success-500/20 dark:text-success-400": variant === "success",
          "bg-warning-500/10 text-warning-600 dark:bg-warning-500/20 dark:text-warning-400": variant === "warning",
          "bg-accent-500/10 text-accent-600 dark:bg-accent-500/20 dark:text-accent-400": variant === "accent",
        },
        className
      )}
      {...props}
    />
  )
}

export { Badge }