import { Link } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { studyApi } from "@/lib/api-study"
import { formatStudyDate, useStudyPlan } from "@/lib/study-navigation"
import { PlanBlockRow } from "@/components/study/PlanBlockRow"
import { StudyError, studyMuted } from "@/components/study/StudyFields"

export function OggiStudy() {
  const missedDay = useStudyPlan((state) => state.missedDay)
  const week = useQuery({ queryKey: ["study-week", undefined, missedDay], queryFn: () => studyApi.week(undefined, missedDay) })
  const review = useQuery({ queryKey: ["review-today"], queryFn: () => studyApi.review(undefined, 1) })
  const today = week.data?.days[0]

  return (
    <section aria-label="Studio di oggi" className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <Card className="min-w-0">
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle>Il piano di oggi</CardTitle>
          <Button variant="ghost" size="sm" asChild><Link to="/piano">Vedi settimana</Link></Button>
        </CardHeader>
        <CardContent className="space-y-2">
          <StudyError error={week.error} />
          {week.isPending && <p className={studyMuted}>Caricamento piano…</p>}
          {today && <p className={studyMuted}>{today.planned_minutes} min pianificati · {today.available_minutes} min disponibili</p>}
          {today && (today.blocks.length ? <ul>{today.blocks.map((block) => <PlanBlockRow key={block.id} block={block} />)}</ul> : <p className={studyMuted}>Nessuna attività in programma oggi.</p>)}
        </CardContent>
      </Card>
      <div className="grid min-w-0 gap-4">
        <Card>
          <CardHeader><CardTitle>Ripasso</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <StudyError error={review.error} />
            {review.isPending && <p className={studyMuted}>Caricamento ripasso…</p>}
            {review.data && <>
              <p className="text-2xl font-semibold tabular-nums">{review.data.estimated_minutes} min</p>
              <p className={studyMuted}>{review.data.due_count} carte dovute · {review.data.overdue_count} in arretrato</p>
              {review.data.due_count > 0 && <Button size="sm" asChild><Link to="/flashcard?ripasso=1">Ripassa le flashcard</Link></Button>}
            </>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Prossimi appelli</CardTitle></CardHeader>
          <CardContent>
            {week.data && (week.data.exams.length ? (
              <ul className="space-y-2 text-sm">
                {week.data.exams.slice(0, 3).map((exam) => (
                  <li key={exam.id} className="flex items-baseline justify-between gap-3">
                    <Link to="/piano#appelli" className="min-w-0 break-words font-medium hover:underline">{exam.course}</Link>
                    <span className="shrink-0 text-right text-neutral-500">{exam.days_left ? `Tra ${exam.days_left} ${exam.days_left === 1 ? "giorno" : "giorni"}` : "Oggi"}<br />{formatStudyDate(exam.date)}</span>
                  </li>
                ))}
              </ul>
            ) : <p className={studyMuted}>Nessun appello in calendario.</p>)}
          </CardContent>
        </Card>
      </div>
    </section>
  )
}
