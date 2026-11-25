import { useState, type FormEvent } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus } from "lucide-react"
import { api } from "@/lib/api"
import { studyApi, toReviewCard, type StudyCard } from "@/lib/api-study"
import { FlashcardReviewModal } from "@/components/flashcards/FlashcardReviewModal"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { MathMarkdown } from "@/components/ui/math-markdown"
import { CoursePicker, Field, SourceFields, SourceLink, StudyError, studyMuted, studyTextarea } from "@/components/study/StudyFields"
import { sourceDraft, sourcePayload } from "@/lib/study-navigation"
import type { Course } from "@/types"

const PAGE_SIZE = 30
const ORIGIN: Record<StudyCard["origin"], string> = { ai: "Appunti AI", manuale: "Manuale", errore: "Da un errore" }

function CardForm({ card, selectedCourse, courses, close, refresh }: {
  card?: StudyCard; selectedCourse?: number; courses: Course[]; close: () => void; refresh: () => Promise<unknown>
}) {
  const [course, setCourse] = useState(card?.course_id ?? selectedCourse)
  const [front, setFront] = useState(card?.front ?? "")
  const [back, setBack] = useState(card?.back ?? "")
  const [source, setSource] = useState(() => sourceDraft(card, card?.t_start))
  const lectures = useQuery({ queryKey: ["lectures", course], queryFn: () => api.getCourseLectures(course!), enabled: !!course })
  const save = useMutation({
    mutationFn: (id: number) => {
      const { timestamp_s, ...attachment } = sourcePayload(source)
      const payload = { ...attachment, t_start: timestamp_s, front: front.trim(), back: back.trim() }
      return card ? studyApi.editCard(card.id, payload) : studyApi.createCard({ ...payload, course_id: id })
    },
    onSuccess: async () => { await refresh(); close() },
  })
  function submit(event: FormEvent) {
    event.preventDefault()
    if (course && front.trim() && back.trim()) save.mutate(course)
  }
  return (
    <Card>
      <CardHeader><CardTitle>{card ? "Modifica flashcard" : "Nuova flashcard"}</CardTitle></CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={submit}>
          <fieldset className="space-y-3" disabled={save.isPending}>
            {!card && <Field name="Corso della flashcard"><CoursePicker required courses={courses} value={course} onChange={(id) => { setCourse(id); setSource(sourceDraft()) }} /></Field>}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field name="Fronte"><textarea rows={3} required maxLength={100000} className={studyTextarea} value={front} onChange={(e) => setFront(e.target.value)} /></Field>
              <Field name="Retro"><textarea rows={3} required maxLength={100000} className={studyTextarea} value={back} onChange={(e) => setBack(e.target.value)} /></Field>
            </div>
            <SourceFields draft={source} onChange={setSource} lectures={lectures.data} />
          </fieldset>
          <StudyError error={save.error} />
          <div className="flex gap-2">
            <Button disabled={!course || !front.trim() || !back.trim() || save.isPending}>Salva flashcard</Button>
            <Button type="button" variant="ghost" disabled={save.isPending} onClick={close}>Annulla</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

function ReviewSession({ cards, close, refresh }: { cards: StudyCard[]; close: () => void; refresh: () => Promise<unknown> }) {
  const [snapshot] = useState(() => cards.map(toReviewCard))
  return (
    <FlashcardReviewModal isOpen cards={snapshot}
      onClose={() => { close(); void refresh() }}
      onSessionComplete={() => { void refresh() }} />
  )
}

export function FlashcardPage() {
  const [params, setParams] = useSearchParams()
  const courseId = Number(params.get("corso")) || undefined
  const reviewOpen = params.get("ripasso") === "1"
  const [offset, setOffset] = useState(0)
  const [editing, setEditing] = useState<StudyCard | "new" | null>(null)
  const [deleting, setDeleting] = useState<number | null>(null)
  const client = useQueryClient()
  const courses = useQuery({ queryKey: ["courses"], queryFn: api.getCourses })
  const cards = useQuery({ queryKey: ["study-cards", courseId, offset], queryFn: () => studyApi.cards(courseId, PAGE_SIZE, offset) })
  const review = useQuery({ queryKey: ["review-today", courseId, 50], queryFn: () => studyApi.review(courseId) })
  function refresh() {
    return Promise.all(["study-cards", "review-today", "flashcards-due", "flashcardStats", "study-week"].map((key) => client.invalidateQueries({ queryKey: [key] })))
  }
  function setReview(open: boolean) {
    const next = new URLSearchParams(params)
    if (open) next.set("ripasso", "1")
    else next.delete("ripasso")
    setParams(next, { replace: true })
  }
  const change = useMutation({
    mutationFn: async ({ card, remove }: { card: StudyCard; remove?: boolean }) => {
      if (remove) await studyApi.deleteCard(card.id)
      else await studyApi.editCard(card.id, { suspended: !card.suspended })
    },
    onSuccess: async () => { setDeleting(null); await refresh() },
  })
  const courseList = courses.data ?? []
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">Flashcard</h1>
        <Button disabled={!!editing} onClick={() => setEditing("new")}><Plus className="size-4" /> Nuova flashcard</Button>
      </div>
      {editing && <CardForm key={editing === "new" ? "new" : editing.id} card={editing === "new" ? undefined : editing} selectedCourse={courseId} courses={courseList} close={() => setEditing(null)} refresh={refresh} />}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-5">
          <div className="min-w-0 flex-1">
            <Field name="Corso"><CoursePicker courses={courseList} value={courseId} empty="Tutti i corsi" onChange={(id) => {
              const next = new URLSearchParams(params)
              if (id) next.set("corso", String(id))
              else next.delete("corso")
              next.delete("ripasso")
              setOffset(0)
              setParams(next, { replace: true })
            }} /></Field>
          </div>
          <Button variant="outline" disabled={!review.data?.due_count} onClick={() => setReview(true)}>Ripassa{review.data ? ` (${review.data.due_count})` : ""}</Button>
          <Button variant="ghost" asChild><Link to="/lab">Torna al Lab</Link></Button>
        </CardContent>
      </Card>
      <StudyError error={courses.error || cards.error || review.error || change.error} />
      {cards.isPending && <p className={studyMuted}>Caricamento flashcard…</p>}
      {cards.data?.cards.length === 0 && <p className={studyMuted}>Nessuna flashcard per il filtro selezionato.</p>}
      {cards.data?.cards.map((card) => (
        <Card key={card.id} className="min-w-0">
          <CardContent className="space-y-3 pt-5">
            <div className="flex flex-wrap items-center gap-2">
              <p className={studyMuted}>{courseList.find((course) => course.id === card.course_id)?.fullname ?? `Corso ${card.course_id}`}</p>
              <Badge variant="outline">{ORIGIN[card.origin]}</Badge>
              {card.suspended && <Badge variant="secondary">Sospesa</Badge>}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="min-w-0 break-words"><p className={studyMuted}>Fronte</p><MathMarkdown content={card.front} /></div>
              <div className="min-w-0 break-words"><p className={studyMuted}>Retro</p><MathMarkdown content={card.back} /></div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <SourceLink courseId={card.course_id} source={card} seconds={card.t_start} />
              {deleting === card.id ? <>
                <Button size="sm" variant="destructive" disabled={change.isPending} onClick={() => change.mutate({ card, remove: true })}>Conferma eliminazione</Button>
                <Button size="sm" variant="ghost" disabled={change.isPending} onClick={() => { change.reset(); setDeleting(null) }}>Annulla</Button>
              </> : <>
                <Button size="sm" variant="outline" disabled={!!editing || deleting !== null || change.isPending} onClick={() => { setEditing(card); window.scrollTo(0, 0) }}>Modifica</Button>
                <Button size="sm" variant="outline" disabled={!!editing || deleting !== null || change.isPending} onClick={() => change.mutate({ card })}>{card.suspended ? "Riattiva" : "Sospendi"}</Button>
                <Button size="sm" variant="ghost" disabled={!!editing || deleting !== null || change.isPending} onClick={() => setDeleting(card.id)}>Elimina</Button>
              </>}
            </div>
          </CardContent>
        </Card>
      ))}
      <div className="flex gap-2">
        {offset > 0 && <Button variant="outline" onClick={() => setOffset(offset - PAGE_SIZE)}>Carte precedenti</Button>}
        {cards.data?.cards.length === PAGE_SIZE && <Button variant="outline" onClick={() => setOffset(offset + PAGE_SIZE)}>Altre carte</Button>}
      </div>
      {reviewOpen && review.data && <ReviewSession key={courseId ?? "all"} cards={review.data.cards} close={() => setReview(false)} refresh={refresh} />}
    </div>
  )
}
