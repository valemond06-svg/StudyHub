import { Link } from "react-router-dom"
import { Card, CardContent } from "@/components/ui/card"
import { MathInline } from "@/components/ui/math-markdown"
import { ReadinessBadge } from "@/components/study/ReadinessBadge"
import { readinessInfo } from "@/lib/readiness"
import { cn } from "@/lib/utils"

export interface StudyOverview {
  ready_now?: number
  ready_exam?: number
  coverage?: number
  tried_items?: number
  n_items?: number
  horizon?: string
  exam?: { date: string; days_left?: number | null } | null
  grade_estimate?: string | null
  best_sim?: number | null
  overconfidence?: number | null
  verdict?: { tone?: string; title?: string; text?: string; gaps?: { id: number; name: string; level_name: string }[] }
}

function pct(v: number | undefined | null) {
  return typeof v === "number" ? `${Math.round(v * 100)}%` : "n.d."
}

/** Il giudizio sincero del backend (mastery.verdict) con i numeri che lo giustificano e l'incertezza dichiarata. */
export function CourseVerdict({ courseId, data }: { courseId: number; data: StudyOverview | undefined }) {
  if (!data) return null
  const info = readinessInfo(data)
  const v = data.verdict
  const tone = v?.tone === "ok" ? "ok" : v?.tone === "warn" ? "warn" : "info"
  return (
    <Card className={cn(
      tone === "ok" && "border-success-300 dark:border-success-800",
      tone === "warn" && "border-warning-300 dark:border-warning-800",
    )}>
      <CardContent className="space-y-4 p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">{v?.title ?? "Prontezza"}</h2>
            {v?.text && <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">{v.text}</p>}
          </div>
          <ReadinessBadge info={info} className="text-sm" />
        </div>
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div><dt className="text-neutral-500">Oggi</dt><dd className="font-semibold">{info.reliable ? pct(data.ready_now) : "dati insufficienti"}</dd></div>
          <div>
            <dt className="text-neutral-500" title="Proiezione della memoria al giorno dell'appello (o tra due settimane se non c'è)">
              All'esame{data.exam?.date ? "" : " (fra 14 gg)"}
            </dt>
            <dd className="font-semibold">{info.reliable ? pct(data.ready_exam) : "dati insufficienti"}</dd>
          </div>
          <div><dt className="text-neutral-500">Domande provate</dt><dd className="font-semibold">{data.tried_items ?? 0} di {data.n_items ?? 0} ({pct(data.coverage)})</dd></div>
          <div>
            <dt className="text-neutral-500" title="Stima grezza: serve a dire se ci sei, non a promettere un voto">Voto stimato</dt>
            <dd className="font-semibold">{data.grade_estimate ?? "non stimabile"}</dd>
          </div>
          <div><dt className="text-neutral-500">Simulazione migliore</dt><dd className="font-semibold">{data.best_sim != null ? `${data.best_sim}/30` : "nessuna"}</dd></div>
          <div className="col-span-2 sm:col-span-3">
            <dt className="text-neutral-500" title="Risposte date come «Sicuro» ma sbagliate, sulle ultime 60">Sicuro ma sbagliato</dt>
            <dd className="font-semibold">
              {data.overconfidence != null ? `${Math.round(data.overconfidence * 100)}% delle risposte date come «Sicuro»` : "troppe poche risposte «Sicuro» per dirlo"}
            </dd>
          </div>
        </dl>
        {!data.exam && (
          <p className="text-xs text-neutral-500">Senza una data d'appello la proiezione usa un orizzonte di 14 giorni: aggiungi l'appello nella scheda Esame.</p>
        )}
        {v?.gaps && v.gaps.length > 0 && (
          <div>
            <h3 className="mb-2 text-sm font-medium">Lacune sugli argomenti pesanti</h3>
            <ul className="flex flex-wrap gap-2">
              {v.gaps.map((g) => (
                <li key={g.id}>
                  <Link to={`/studio/${courseId}?topic=${g.id}&duration=25`}
                    className="inline-flex items-center gap-1 rounded-full border border-warning-300 px-3 py-1 text-xs hover:bg-warning-50 dark:border-warning-800 dark:hover:bg-warning-900/20">
                    <MathInline content={g.name} /> · {g.level_name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
