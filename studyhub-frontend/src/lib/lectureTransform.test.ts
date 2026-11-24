import { describe, expect, it } from "vitest"
import { transformLecture, transformLectures } from "./lectureTransform"

describe("transformLecture", () => {
  it("deriva i flag dai campi del backend", () => {
    const t = transformLecture({ id: 1, has_audio: 1, n_slides: 12, transcript_source: "whisper" })
    expect(t).toMatchObject({ has_audio: true, has_slides: true, has_transcript: true })
  })
  it("nessuna slide e trascrizione 'none' = falso", () => {
    const t = transformLecture({ id: 2, has_audio: 0, n_slides: 0, transcript_source: "none" })
    expect(t).toMatchObject({ has_audio: false, has_slides: false, has_transcript: false })
  })
  it("la versione di lista è coerente con quella singola", () => {
    const l = { id: 3, has_audio: 1, n_slides: 1, transcript_source: "panopto" }
    expect(transformLectures([l])[0]).toEqual(transformLecture(l))
  })
})
