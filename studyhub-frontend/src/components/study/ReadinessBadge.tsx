import { Badge } from "@/components/ui/badge"
import { readinessVariant, type ReadinessInfo } from "@/lib/readiness"
import { cn } from "@/lib/utils"

/** Badge della prontezza con l'incertezza dichiarata: "dati insufficienti" finché le risposte sono poche. */
export function ReadinessBadge({ info, className }: { info: ReadinessInfo; className?: string }) {
  return (
    <Badge
      variant={info.reliable ? readinessVariant(info.pct) : "outline"}
      className={cn("whitespace-nowrap", !info.reliable && "font-normal italic", className)}
      title={info.hint}
    >
      {info.label}
      {!info.reliable && info.pct !== null && <span className="sr-only"> (stima provvisoria {info.pct}%)</span>}
    </Badge>
  )
}
