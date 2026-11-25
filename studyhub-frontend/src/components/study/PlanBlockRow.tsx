import { Link } from "react-router-dom"
import { ChevronRight, Timer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { MathInline } from "@/components/ui/math-markdown"
import { blockHref, blockLabels, useFocusDraft } from "@/lib/study-navigation"
import type { PlanBlock } from "@/lib/api-study"

export function PlanBlockRow({ block }: { block: PlanBlock }) {
  const openFocus = useFocusDraft((state) => state.openFocus)
  const label = blockLabels[block.kind]
  return (
    <li className="flex min-w-0 items-center gap-2 border-b border-neutral-200 last:border-0 dark:border-neutral-800">
      <Link to={blockHref(block)} className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-md p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800">
        <span className="min-w-0 break-words">
          <span className="block text-sm font-medium">{label}{block.topic && <> · <MathInline content={block.topic} /></>}</span>
          <span className="block text-xs text-neutral-500 dark:text-neutral-400">{block.course}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1 text-xs text-neutral-500">{block.minutes} min<ChevronRight className="size-4" /></span>
      </Link>
      <Button variant="ghost" size="icon" aria-label={`Avvia focus per ${block.topic ?? label}`} onClick={() => openFocus({ courseId: block.course_id, task: block.topic ? `${label} · ${block.topic}` : label, minutes: block.minutes })}>
        <Timer className="size-4" />
      </Button>
    </li>
  )
}
