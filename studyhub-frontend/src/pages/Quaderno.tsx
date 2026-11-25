import { useState, type FormEvent } from "react"
import { useSearchParams } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus } from "lucide-react"
import { api } from "@/lib/api"
import { studyApi, type StudyNote } from "@/lib/api-study"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { MathMarkdown } from "@/components/ui/math-markdown"
import { CoursePicker, Field, SourceFields, SourceLink, StudyError, studyMuted, studySelect, studyTextarea } from "@/components/study/StudyFields"
import { sourceDraft, sourcePayload } from "@/lib/study-navigation"
import type { Course } from "@/types"

const PAGE_SIZE = 30

function NoteForm({ note, initial, courses, close }: {
  note?: StudyNote
  initial: { courseId?: number; lectureId?: number; seconds?: number }
  courses: Course[]
  close: () => void
}) {
  const client = useQueryClient()
  const [courseId, setCourseId] = useState(note?.course_id ?? initial.courseId)
  const [body, setBody] = useState(note?.body ?? "")
  const [tags, setTags] = useState(note?.tags.join(", ") ?? "")
  const [source, setSource] = useState(() => note ? sourceDraft(note, note.timestamp_s) : sourceDraft({ lecture_id: initial.lectureId }, initial.seconds))
  const [preview, setPreview] = useState(false)
  const lectures = useQuery({ queryKey: ["lectures", courseId], queryFn: () => api.getCourseLectures(courseId!), enabled: !!courseId })
  const save = useMutation({
    mutationFn: (id: number) => {
      const payload = { ...sourcePayload(source), body: body.trim(), tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean) }
      return note ? studyApi.editNote(note.id, payload) : studyApi.createNote({ ...payload, course_id: id })
    },
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ["study-notes"] }); close() },
  })
  function submit(event: FormEvent) {
    event.preventDefault()
    if (courseId && body.trim()) save.mutate(courseId)
  }
  return (
    <Card>
      <CardHeader><CardTitle>{note ? "Modifica nota" : "Nuova nota"}</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-4">
          <fieldset disabled={save.isPending} className="grid gap-4">
            {!note && <Field name="Corso della nota"><CoursePicker required courses={courses} value={courseId} onChange={(id) => { setCourseId(id); setSource(sourceDraft()) }} /></Field>}
            <Field name="Testo della nota"><textarea autoFocus={!!initial.lectureId} className={studyTextarea} rows={6} required maxLength={100000} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
            <Field name="Tag della nota, separati da virgole"><Input value={tags} onChange={(e) => setTags(e.target.value)} /></Field>
            <SourceFields draft={source} onChange={setSource} lectures={lectures.data} />
          </fieldset>
          {preview && <div className="min-w-0 break-words rounded-xl border border-neutral-200 p-4 dark:border-neutral-800"><MathMarkdown content={body || "La nota è vuota."} /></div>}
          <StudyError error={save.error} />
          <div className="flex flex-wrap gap-2">
            <Button disabled={!courseId || !body.trim() || save.isPending}>Salva nota</Button>
            <Button type="button" variant="outline" aria-pressed={preview} onClick={() => setPreview(!preview)}>{preview ? "Chiudi anteprima" : "Anteprima"}</Button>
            <Button type="button" variant="ghost" disabled={save.isPending} onClick={close}>Annulla</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

export function Quaderno() {
  const [params, setParams] = useSearchParams()
  const noteId = Number(params.get("nota")) || undefined
  const [courseId, setCourseId] = useState<number | undefined>(() => Number(params.get("corso")) || undefined)
  const [lectureId, setLectureId] = useState<number | undefined>()
  const [search, setSearch] = useState("")
  const [q, setQ] = useState("")
  const [tag, setTag] = useState("")
  const [offset, setOffset] = useState(0)
  const [editing, setEditing] = useState<StudyNote | "new" | null>(() => params.has("nuova") ? "new" : null)
  const [deleting, setDeleting] = useState<number | null>(null)
  const client = useQueryClient()
  const courses = useQuery({ queryKey: ["courses"], queryFn: api.getCourses })
  const lectures = useQuery({ queryKey: ["lectures", courseId], queryFn: () => api.getCourseLectures(courseId!), enabled: !!courseId })
  const filters = { course_id: courseId, lecture_id: lectureId, q, tag: tag.trim(), limit: PAGE_SIZE, offset }
  const list = useQuery({ queryKey: ["study-notes", filters], queryFn: () => studyApi.notes(filters), enabled: !noteId })
  const selected = useQuery({ queryKey: ["study-notes", noteId], queryFn: () => studyApi.getNote(noteId!), enabled: !!noteId })
  const notes = noteId ? (selected.data ? [selected.data] : []) : list.data?.notes
  const remove = useMutation({
    mutationFn: studyApi.deleteNote,
    onSuccess: async (_, deletedId) => {
      setDeleting(null)
      if (deletedId === noteId) showAllNotes()
      await client.invalidateQueries({ queryKey: ["study-notes"] })
    },
  })
  const activeCourses = courses.data ?? []
  function showAllNotes() {
    setEditing(null)
    const next = new URLSearchParams(params)
    next.delete("nota")
    setParams(next)
  }
  function closeEditor() {
    setEditing(null)
    if (params.has("nuova")) {
      const next = new URLSearchParams(params)
      for (const key of ["nuova", "lezione", "t"]) next.delete(key)
      setParams(next, { replace: true })
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Quaderno</h1>
        {noteId
          ? <Button variant="outline" onClick={showAllNotes}>Tutte le note</Button>
          : <Button disabled={!!editing} onClick={() => setEditing("new")}><Plus className="size-4" /> Nuova nota</Button>}
      </div>
      {editing && <NoteForm key={editing === "new" ? "new" : editing.id} note={editing === "new" ? undefined : editing}
        initial={{ courseId, lectureId: Number(params.get("lezione")) || lectureId, seconds: params.has("t") ? Math.max(0, Number(params.get("t")) || 0) : undefined }} courses={activeCourses} close={closeEditor} />}
      {!noteId && <Card>
        <CardContent className="space-y-3 pt-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field name="Corso"><CoursePicker courses={activeCourses} value={courseId} empty="Tutti i corsi" onChange={(id) => { setCourseId(id); setLectureId(undefined); setOffset(0) }} /></Field>
            <Field name="Lezione">
              <select className={studySelect} disabled={!courseId} value={lectureId ?? ""} onChange={(e) => { setLectureId(Number(e.target.value) || undefined); setOffset(0) }}>
                <option value="">Tutte le lezioni</option>
                {lectures.data?.map((lecture) => <option key={lecture.id} value={lecture.id}>{lecture.title}</option>)}
              </select>
            </Field>
            <Field name="Tag"><Input placeholder="Tutti i tag" value={tag} onChange={(e) => { setTag(e.target.value); setOffset(0) }} /></Field>
          </div>
          <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); setQ(search.trim()); setOffset(0) }}>
            <div className="min-w-0 flex-1"><Field name="Cerca nelle note"><Input type="search" value={search} onChange={(e) => { setSearch(e.target.value); if (!e.target.value) { setQ(""); setOffset(0) } }} /></Field></div>
            <Button variant="outline">Cerca</Button>
          </form>
        </CardContent>
      </Card>}
      <StudyError error={(noteId ? selected.error : list.error) || courses.error || lectures.error || remove.error} />
      {(noteId ? selected.isPending : list.isPending) && <p className={studyMuted}>Caricamento note…</p>}
      {!noteId && notes?.length === 0 && <p className={studyMuted}>Nessuna nota corrisponde ai filtri.</p>}
      {notes?.map((note) => (
        <Card key={note.id} className="min-w-0">
          <CardContent className="space-y-3 pt-5">
            <p className={studyMuted}>{activeCourses.find((course) => course.id === note.course_id)?.fullname ?? `Corso ${note.course_id}`}</p>
            <MathMarkdown content={note.body} className="break-words" />
            <div className="flex flex-wrap gap-2">
              {note.tags.map((value, i) => <Button key={`${value}:${i}`} variant="secondary" size="sm" onClick={() => { setTag(value); setOffset(0) }}>{value}</Button>)}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <SourceLink courseId={note.course_id} source={note} seconds={note.timestamp_s} />
              {deleting === note.id ? <>
                <Button variant="destructive" size="sm" disabled={remove.isPending} onClick={() => remove.mutate(note.id)}>Conferma eliminazione</Button>
                <Button variant="ghost" size="sm" disabled={remove.isPending} onClick={() => { remove.reset(); setDeleting(null) }}>Annulla</Button>
              </> : <>
                <Button variant="outline" size="sm" disabled={!!editing || deleting !== null} onClick={() => { setEditing(note); window.scrollTo(0, 0) }}>Modifica</Button>
                <Button variant="ghost" size="sm" disabled={!!editing || deleting !== null} onClick={() => setDeleting(note.id)}>Elimina</Button>
              </>}
            </div>
          </CardContent>
        </Card>
      ))}
      {!noteId && <div className="flex gap-2">
        {offset > 0 && <Button variant="outline" onClick={() => setOffset(offset - PAGE_SIZE)}>Note precedenti</Button>}
        {list.data?.notes.length === PAGE_SIZE && <Button variant="outline" onClick={() => setOffset(offset + PAGE_SIZE)}>Altre note</Button>}
      </div>}
    </div>
  )
}
