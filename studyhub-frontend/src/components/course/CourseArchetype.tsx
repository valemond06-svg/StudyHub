import { useQuery } from "@tanstack/react-query"
import { Compass } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { MathMarkdown } from "@/components/ui/math-markdown"
import { api } from "@/lib/api"

interface Archetype {
  title: string
  badge: string
  software_default: string
  exam_format_summary: string
  study_methodology_md: string
  moodle_download_priorities: string[]
}

/** Archetipo didattico del corso (nessuna AI): com'è fatto l'esame e come conviene prepararlo. */
export function CourseArchetype({ courseId }: { courseId: number }) {
  const { data } = useQuery<Archetype>({ queryKey: ["archetype", courseId], queryFn: () => api.getCourseArchetype(courseId), staleTime: 3600_000 })
  if (!data?.title) return null
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2"><Compass className="h-5 w-5" />Come si prepara questo esame</CardTitle>
        <div className="flex flex-wrap gap-2">
          {data.badge && <Badge variant="accent">{data.badge}</Badge>}
          {data.software_default && <Badge variant="outline">{data.software_default}</Badge>}
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="font-medium">{data.title}</p>
        {data.exam_format_summary && <p className="text-neutral-600 dark:text-neutral-300">{data.exam_format_summary}</p>}
        {data.study_methodology_md && (
          <details>
            <summary className="cursor-pointer font-medium">Metodo di studio consigliato</summary>
            <MathMarkdown className="mt-2" content={data.study_methodology_md} />
          </details>
        )}
        {data.moodle_download_priorities?.length > 0 && (
          <p className="text-xs text-neutral-500">Materiale Moodle più utile: {data.moodle_download_priorities.join(", ")}.</p>
        )}
      </CardContent>
    </Card>
  )
}
