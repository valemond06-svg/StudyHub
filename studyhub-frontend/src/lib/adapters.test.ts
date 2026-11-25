/**
 * Test di contratto: le fixture sono nel formato REALE del backend (app.py, search.py, media/*.py, exam.py),
 * non in quello che il frontend si aspettava. Se il backend cambia forma, questi test devono rompersi.
 */
import { describe, expect, it } from "vitest"
import { toLectureMedia, toSlides, toSilences, toTranscript, canOpenLecture, slideIndexAt, silenceEndAt, formatTime } from "./lecture-media"
import { toSearchResponse, groupSearchHits, searchTarget, splitSnippet, searchWhere } from "./search"
import { toExamProfile, toExamSims } from "./exam-profile"
import { readinessByCourse, processedMaterial, averageReadiness, readinessInfo } from "./readiness"
import { summarizeAIProblems, claudeUsagePct } from "./ai-health"
import { dedupeNotifications } from "./notifications"
import { diversifyFeed } from "./feed"
import { filterCourses, parseCourseFilter } from "./courses"
import type { AIPanelData, AIStatusResponse, Course, FeedShort, NotificationItem, StudyCourseOverview } from "@/types"

// GET /api/lectures/190 (forma di app.py::lecture)
const lectureJson = {
  id: 190, course_id: 25782, panopto_id: null, title: "Lezione 12", date: "2026-11-10", number: 12,
  folder: "x", viewer_url: null, duration: 5400.5, has_audio: 1, n_slides: 3, transcript_source: "whisper",
  status: "trascritta", error: null, updated_at: null,
  panopto_embed_url: null, media_url: null, has_local_audio: true, has_local_slides: true,
  video_modes: ["slides"], default_mode: "slides", videos: [],
  slides: [
    { file: "0002_00-05-00.png", start: 300, end: 900, shot_at: 880 },
    { file: "0001_00-00-00.png", start: 0, end: 300, shot_at: 290 },
    { file: "../evil.png", start: 1000, end: 1100, shot_at: 1050 },
  ],
  transcript: { source: "whisper", model: "large-v3", segments: [{ start: 754.2, end: 760, text: " La derivata. " }, { start: 0, end: 12.5, text: "Buongiorno" }] },
  silences: [[100.5, 104], [200, 199], "x", [300, 305]],
}

describe("lecture-media (GET /api/lectures/{id})", () => {
  it("trascrizione start/end → t_start/t_end ordinata e ripulita", () => {
    expect(toTranscript(lectureJson.transcript)).toEqual([
      { t_start: 0, t_end: 12.5, text: "Buongiorno" },
      { t_start: 754.2, t_end: 760, text: "La derivata." },
    ])
    expect(toTranscript(undefined)).toEqual([])
  })

  it("slide {file,start} → URL /media/{id}/slides/{file}, ordinate, scarta percorsi sospetti", () => {
    const slides = toSlides(lectureJson.slides, 190)
    expect(slides.map((s) => [s.index, s.timestamp, s.url])).toEqual([
      [0, 0, "/media/190/slides/0001_00-00-00.png"],
      [1, 300, "/media/190/slides/0002_00-05-00.png"],
    ])
  })

  it("silenzi [[a,b]] → {start,end}, scarta valori non validi", () => {
    expect(toSilences(lectureJson.silences)).toEqual([{ start: 100.5, end: 104 }, { start: 300, end: 305 }])
  })

  it("modalità, audio in streaming e niente slide inventate", () => {
    const m = toLectureMedia(lectureJson, 190)
    expect(m.modes).toEqual(["slides"])
    expect(m.defaultMode).toBe("slides")
    expect(m.audioUrl).toBe("/media/190/audio.opus")
    expect(m.slides).toHaveLength(2)
    expect(m.videoUrl).toBeNull()
  })

  it("senza slide né audio ma con Panopto e video Drive: si apre comunque", () => {
    const m = toLectureMedia({
      ...lectureJson, has_local_audio: false, has_local_slides: false, slides: [],
      panopto_embed_url: "https://univr.cloud.panopto.eu/Panopto/Pages/Embed.aspx?id=abc", videos: ["video", "screen"],
      video_modes: ["panopto", "drive"], default_mode: "panopto",
    }, 190)
    expect(m.modes).toEqual(["panopto", "video"])
    expect(m.defaultMode).toBe("panopto")
    expect(m.videoUrl).toBe("/video/190/screen")
    expect(m.audioUrl).toBeNull()
    expect(m.slides).toEqual([])
  })

  it("video Moodle remoto marcato come tale", () => {
    const m = toLectureMedia({ ...lectureJson, has_local_audio: false, slides: [], media_url: "https://moodle.univr.it/pluginfile.php/1/v.mp4", default_mode: "moodle" }, 190)
    expect(m.videoUrl).toBe("https://moodle.univr.it/pluginfile.php/1/v.mp4")
    expect(m.videoIsRemote).toBe(true)
    expect(m.defaultMode).toBe("video")
  })

  it("canOpenLecture sulle righe di /api/courses/{id}/lectures", () => {
    expect(canOpenLecture({ has_audio: 0, n_slides: 0, panopto_id: null, viewer_url: null, video_type: "standard" })).toBe(false)
    expect(canOpenLecture({ has_audio: 0, n_slides: 4, video_type: "standard" })).toBe(true)
    expect(canOpenLecture({ has_audio: 0, n_slides: 0, panopto_id: "abc", video_type: "panopto" })).toBe(true)
    expect(canOpenLecture({ has_audio: 0, n_slides: 0, media_url: "https://x/v.mp4", video_type: "moodle" })).toBe(true)
  })

  it("slide corrente, fine del silenzio e formato del tempo", () => {
    const slides = toSlides(lectureJson.slides, 190)
    expect(slideIndexAt(slides, -1)).toBe(-1)
    expect(slideIndexAt(slides, 299)).toBe(0)
    expect(slideIndexAt(slides, 301)).toBe(1)
    expect(silenceEndAt([{ start: 10, end: 12 }], 11)).toBe(12)
    expect(silenceEndAt([{ start: 10, end: 12 }], 12)).toBeNull()
    expect(formatTime(754.2)).toBe("12:34")
    expect(formatTime(3665)).toBe("1:01:05")
    expect(formatTime(NaN)).toBe("0:00")
  })
})

// GET /api/search?q=laplace (forma di search.py::search)
const searchJson = {
  semantic: false,
  results: [
    { id: 11, kind: "transcript", page: null, t_start: 754.2, t_end: 790, heading: null, doc_id: 5, path: "a/transcript.json", title: "Lezione 12", lecture_id: 190, course: "Analisi", course_id: 25782, snippet: "la [[trasformata]] di [[Laplace]]", score: 0.03 },
    { id: 12, kind: "pdf", page: 7, t_start: null, t_end: null, heading: "Teorema", doc_id: 8, path: "b/dispense.pdf", title: null, lecture_id: null, course: "Analisi", course_id: 25782, snippet: "[[Laplace]] inversa", score: 0.02 },
    { id: 13, kind: "md", page: null, t_start: null, t_end: null, heading: null, doc_id: 9, path: "c/note.md", title: "Note", lecture_id: null, course: null, course_id: null, snippet: "", score: 0.01 },
    { kind: "pdf" },
  ],
}

describe("search (GET /api/search)", () => {
  it("legge {results, semantic} e scarta righe malformate", () => {
    const r = toSearchResponse(searchJson)
    expect(r.semantic).toBe(false)
    expect(r.results.map((h) => h.id)).toEqual([11, 12, 13])
    expect(r.results[1].title).toBe("dispense.pdf")
    expect(toSearchResponse({ lectures: [] }).results).toEqual([])
  })

  it("raggruppa per tipo nell'ordine lezioni, documenti, appunti", () => {
    const groups = groupSearchHits(toSearchResponse(searchJson).results)
    expect(groups.map((g) => [g.group, g.hits.length])).toEqual([["lezioni", 1], ["documenti", 1], ["appunti", 1]])
  })

  it("apre la lezione al secondo e il PDF alla pagina", () => {
    const [lec, pdf, md] = toSearchResponse(searchJson).results
    expect(searchTarget(lec)).toEqual({ type: "lecture", courseId: 25782, lectureId: 190, t: 754 })
    expect(searchTarget(pdf)).toEqual({ type: "document", url: "/documento/8?pagina=7" })
    expect(searchTarget(md)).toEqual({ type: "document", url: "/documento/9" })
    expect(searchWhere(lec)).toBe("al minuto 12:34")
    expect(searchWhere(pdf)).toBe("p. 7")
  })

  it("evidenzia i termini marcati con [[ ]]", () => {
    expect(splitSnippet("la [[trasformata]] di x")).toEqual([
      { text: "la ", mark: false }, { text: "trasformata", mark: true }, { text: " di x", mark: false },
    ])
  })
})

// profilo_esame.json (PROFILE_SCHEMA di study/exam.py)
const profileJson = {
  sintesi_md: "Scritto con esercizi.",
  formato: { durata_min: 0, parti: [{ nome: "Esercizi", descrizione: "Tre esercizi", punti: 24 }, { nome: "Teoria", descrizione: "Domande", punti: 0, minimo: 0 }], orale: "", materiale_consentito: "Nessuno", regole_voto: "18/30" },
  argomenti: [
    { nome: "Serie", frequenza: "2 appelli su 4", peso: "medio", note: "" },
    { nome: "Laplace", frequenza: "4 appelli su 4", peso: "alto", note: "Sempre" },
  ],
  esercizi_tipo: [{ titolo: "Antitrasformata", metodo_md: "Fratti semplici $\\frac{1}{s}$", frequenza: "4/4", errori_tipici: "Segni" }],
  teoria_richiesta: ["Teorema del valore finale"],
  consigli_md: "Allenati a tempo.",
}

describe("exam-profile (GET /api/courses/{id}/exam)", () => {
  it("durata 0 → non indicata, pesi come etichette, esercizi con titolo e metodo", () => {
    const p = toExamProfile(profileJson)!
    expect(p.durationMin).toBeNull()
    expect(p.oral).toBeNull()
    expect(p.parts).toEqual([
      { name: "Esercizi", description: "Tre esercizi", points: 24, minimum: null },
      { name: "Teoria", description: "Domande", points: null, minimum: null },
    ])
    expect(p.topics.map((t) => [t.name, t.weight])).toEqual([["Laplace", "alto"], ["Serie", "medio"]])
    expect(p.exercises[0]).toEqual({ title: "Antitrasformata", methodMd: "Fratti semplici $\\frac{1}{s}$", frequency: "4/4", commonErrors: "Segni" })
    expect(p.adviceMd).toBe("Allenati a tempo.")
    expect(toExamProfile(null)).toBeNull()
  })

  it("simulazioni da exam.list_sims", () => {
    expect(toExamSims([{ id: 3, title: "Appello simulato", duration_min: 120, created_at: "2026-11-01", best: null }])).toEqual([
      { id: 3, title: "Appello simulato", durationMin: 120, bestGrade: null, createdAt: "2026-11-01" },
    ])
  })
})

describe("readiness: mastery reale, non lezioni elaborate", () => {
  const course = (id: number, lectures: number, ready: number): Course => ({ id, fullname: `C${id}`, year_of_study: 1, passed: false, active: 1, priority: 0, folder: "x", lectures, ready })
  it("usa ready_exam di /api/study", () => {
    const study = [{ id: 1, name: "AMM", ready_exam: 0.003 }, { id: 2, name: "X", ready_exam: 0.85 }] as StudyCourseOverview[]
    const m = readinessByCourse(study)
    expect(m.get(1)).toBe(0)
    expect(m.get(2)).toBe(85)
    expect(m.has(3)).toBe(false)
    // 18/20 lezioni trascritte NON è prontezza: è solo materiale
    expect(processedMaterial(course(1, 20, 18))).toEqual({ done: 18, total: 20, pct: 90 })
    expect(averageReadiness([])).toBeNull()
    expect(averageReadiness([0, 85])).toBe(43)
  })

  it("filtri dei corsi per stato di corsi.yaml, correnti con l'appello più vicino in testa", () => {
    const cs: Course[] = [
      { ...course(1, 0, 0), stage: "corrente", fullname: "B" },
      { ...course(2, 0, 0), active: 0, stage: "futuro" },
      { ...course(3, 0, 0), passed: true, stage: "archivio" },
      { ...course(4, 0, 0), stage: "arretrato" },
      { ...course(5, 0, 0), stage: "corrente", fullname: "A" },
      { ...course(6, 0, 0), active: 0, stage: "archivio" },
      { ...course(7, 0, 0), stage: null, fullname: "Z" },
    ]
    const days = new Map([[1, 5], [5, 30]])
    expect(filterCourses(cs, "seguo", days).map((c) => c.id)).toEqual([1, 5, 7])
    expect(filterCourses(cs, "seguo").map((c) => c.id)).toEqual([5, 1, 7])
    expect(filterCourses(cs, "arretrati").map((c) => c.id)).toEqual([4])
    expect(filterCourses(cs, "altri").map((c) => c.id)).toEqual([2, 6])
    expect(filterCourses(cs, "superati").map((c) => c.id)).toEqual([3])
    expect(filterCourses(cs, "tutti").map((c) => c.id).slice(0, 4)).toEqual([5, 1, 7, 4])
    expect(parseCourseFilter("attivi")).toBe("seguo")
  })

  it("prontezza onesta: dati insufficienti con poche risposte", () => {
    expect(readinessInfo(undefined).label).toBe("n.d.")
    expect(readinessInfo({ ready_exam: 0, n_items: 0, tried_items: 0 }).label).toBe("nessuna domanda")
    const few = readinessInfo({ ready_exam: 0.9, n_items: 200, tried_items: 3 })
    expect(few).toMatchObject({ reliable: false, label: "dati insufficienti", pct: 90 })
    expect(few.hint).toContain("3 domande su 200")
    const ok = readinessInfo({ ready_exam: 0.42, n_items: 100, tried_items: 40, coverage: 0.4 })
    expect(ok).toMatchObject({ reliable: true, label: "42%" })
    expect(ok.hint).toContain("40 domande provate (40% della banca)")
  })
})

describe("ai-health (GET /api/ai/status + /api/ai/pannello)", () => {
  const status = { jobs: [], paused_reason: null, usage: { utilization: 0, resets_at: null, status: "rejected", checked_at: 1 }, backlog: { enabled: true, stop_at: 0.7 } } as AIStatusResponse
  const panel = {
    coda: { per_stato: { errore: 3 }, per_tipo: {}, in_corso: [], ultimi_errori: [
      { id: 9, kind: "lecture_notes", titolo: "Lezione 3", messaggio: "Claude Code can't use your Claude subscription: payment is past due" },
      { id: 8, kind: "lecture_notes", titolo: "Lezione 2", messaggio: "'NoneType' object is not iterable" },
      { id: 7, kind: "lecture_notes", titolo: "Lezione 1", messaggio: "'NoneType' object is not iterable" },
    ] },
    arretrati: { trascritte_senza_appunti: 0, da_trascrivere: 0, unita_nuove: 0, unita_lezione_attesa_sonnet: 0 },
    finestra: { claude_backlog: true, uso_pct: 0, soglia_pct: 70, arretrati_in_pausa: false, reset_alle: null, coda_in_pausa: null },
    notte: { in_corso: false, ultimo: null },
  } as AIPanelData

  it("abbonamento Claude rifiutato e errori dei job, senza duplicati", () => {
    const p = summarizeAIProblems(status, panel)
    expect(p[0].level).toBe("error")
    expect(p[0].title).toContain("abbonamento")
    expect(p[0].detail).toContain("past due")
    expect(p.filter((x) => x.detail.includes("NoneType"))).toHaveLength(1)
    expect(p.find((x) => x.detail.includes("NoneType"))?.title).toContain("2 volte")
    expect(claudeUsagePct(status)).toBe(0)
  })

  it("nessun problema se tutto è a posto", () => {
    const ok = { ...status, usage: { utilization: 0.2, status: "allowed" } }
    expect(summarizeAIProblems(ok, { ...panel, coda: { ...panel.coda, ultimi_errori: [] } })).toEqual([])
    expect(claudeUsagePct({ ...status, usage: {} })).toBeNull()
  })
})

describe("notifiche e feed", () => {
  it("raggruppa gli avvisi ripetuti", () => {
    const n = (id: number, created_at: string, read = 0): NotificationItem => ({ id, kind: "errore", course_id: null, title: "Panopto: login necessario", body: "", ref: null, read, course: null, created_at })
    const out = dedupeNotifications([n(1, "2026-11-20"), n(2, "2026-11-24"), { ...n(3, "2026-11-22"), title: "Nuovo file" }])
    expect(out.map((x) => [x.id, x.count])).toEqual([[2, 2], [3, 1]])
  })

  it("StudyTok: niente argomenti ripetuti, alterna corso e tipo", () => {
    const s = (topic: number, course: number, audio: boolean): FeedShort => ({
      id: `short_${topic}`, topic_id: topic, course_id: course, course_name: "", title: "", hook_md: "", widget: null, slide: null,
      audio: audio ? { lecture_id: 1, start_s: 0, lecture_title: "" } : null, exam_trick: null, archetipo_nome: null, has_pcp: false, has_sniper: false,
    })
    const out = diversifyFeed([s(1, 1, true), s(1, 1, true), s(2, 1, true), s(3, 2, false), s(4, 1, false)])
    expect(out.map((x) => x.topic_id)).toEqual([1, 3, 2, 4])
  })
})
