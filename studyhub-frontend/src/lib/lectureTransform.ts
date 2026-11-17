export function transformLecture(lecture: any) {
  return {
    ...lecture,
    has_audio: Boolean(lecture.has_audio),
    has_slides: Boolean(lecture.n_slides && lecture.n_slides > 0),
    has_transcript: Boolean(lecture.transcript_source && lecture.transcript_source !== "none"),
  }
}

export function transformLectures(lectures: any[]) {
  return lectures.map((lecture: any) => ({
    ...lecture,
    has_audio: Boolean(lecture.has_audio),
    has_slides: Boolean(lecture.n_slides && lecture.n_slides > 0),
    has_transcript: Boolean(lecture.transcript_source && lecture.transcript_source !== "none"),
  }))
}