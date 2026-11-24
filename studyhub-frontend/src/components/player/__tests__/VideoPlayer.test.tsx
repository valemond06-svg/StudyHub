import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react"
import React from "react"
import { VideoPlayer, formatTime } from "../VideoPlayer"
import type { VideoPlayerHandle } from "../VideoPlayer"
import { api } from "@/lib/api"

// Mock api
vi.mock("@/lib/api", () => ({
  api: {
    getLecture: vi.fn(),
  },
}))

describe("VideoPlayer Component", () => {
  const originalScrollIntoView = Element.prototype.scrollIntoView

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    Element.prototype.scrollIntoView = vi.fn()

    // Mock HTMLMediaElement methods
    window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
    window.HTMLMediaElement.prototype.pause = vi.fn()
    ;(window.HTMLMediaElement.prototype as any).requestPictureInPicture = vi.fn().mockResolvedValue(undefined)
  })

  afterEach(() => {
    Element.prototype.scrollIntoView = originalScrollIntoView
  })

  it("formats time correctly", () => {
    expect(formatTime(0)).toBe("0:00")
    expect(formatTime(65)).toBe("1:05")
    expect(formatTime(3665)).toBe("1:01:05")
    expect(formatTime(-10)).toBe("0:00")
    expect(formatTime(NaN)).toBe("0:00")
  })

  it("loads and renders Panopto iframe mode by default when Panopto source is available", async () => {
    const mockPanoptoLecture = {
      id: 101,
      course_id: 1,
      title: "Lezione 1: Introduzione ad Algoritmi",
      status: "pronta",
      source: "panopto",
      date: "2026-10-01",
      duration: 3600,
      has_audio: false,
      has_slides: false,
      has_transcript: true,
      has_notes: false,
      folder: "corso_1/lezione_1",
      panopto_id: "panopto-uuid-12345",
      panopto_embed_url: "https://univr.cloud.panopto.eu/Panopto/Pages/Embed.aspx?id=panopto-uuid-12345",
      viewer_url: "https://univr.cloud.panopto.eu/Panopto/Pages/Viewer.aspx?id=panopto-uuid-12345",
      transcript: {
        segments: [
          { t_start: 0, t_end: 10, text: "Benvenuti al corso di algoritmi." },
          { t_start: 10, t_end: 25, text: "Oggi parleremo di complessità computazionale." },
        ],
      },
    }

    vi.mocked(api.getLecture).mockResolvedValueOnce(mockPanoptoLecture as any)

    render(
      <VideoPlayer
        lectureId={101}
        lectureTitle="Lezione 1: Introduzione ad Algoritmi"
        onClose={vi.fn()}
      />
    )

    // Initially loading
    expect(screen.getByText(/Caricamento player multimodale.../i)).toBeDefined()

    // Wait for lecture data to load
    await waitFor(() => {
      expect(screen.getByText("Lezione 1: Introduzione ad Algoritmi")).toBeDefined()
    })

    // Check Panopto pill is selected
    const panoptoPill = screen.getByRole("tab", { name: /Modalità Panopto/i })
    expect(panoptoPill).toBeDefined()
    expect(panoptoPill.getAttribute("aria-selected")).toBe("true")

    // Check iframe presence and attributes
    const iframe = document.querySelector("iframe")
    expect(iframe).not.toBeNull()
    expect(iframe?.getAttribute("src")).toContain("panopto-uuid-12345")
    expect(iframe?.getAttribute("allow")).toContain("autoplay; fullscreen")
    expect(iframe?.hasAttribute("allowfullscreen")).toBe(true)

    // Check Panopto badge and external portal link
    expect(screen.getByText(/Panopto UniVR/i)).toBeDefined()
    const portalLink = screen.getByRole("link", { name: /Apri nel portale/i })
    expect(portalLink.getAttribute("href")).toBe(
      "https://univr.cloud.panopto.eu/Panopto/Pages/Viewer.aspx?id=panopto-uuid-12345"
    )

    // Check transcript segments are rendered
    expect(screen.getByText("Benvenuti al corso di algoritmi.")).toBeDefined()
    expect(screen.getByText("Oggi parleremo di complessità computazionale.")).toBeDefined()
  })

  it("loads and renders HTML5 Video mode with full controls and speed presets", async () => {
    const mockMoodleVideoLecture = {
      id: 102,
      course_id: 1,
      title: "Lezione 2: Strutture Dati MP4",
      status: "pronta",
      source: "moodle",
      date: "2026-10-03",
      duration: 1800,
      has_audio: false,
      has_slides: false,
      has_transcript: true,
      has_notes: false,
      folder: "corso_1/lezione_2",
      media_url: "/media/102/video.mp4",
      video_modes: ["moodle"],
      default_mode: "moodle",
      transcript: {
        segments: [
          { t_start: 0, t_end: 15, text: "Iniziamo con gli alberi binari di ricerca." },
        ],
      },
      silences: [{ start: 120, end: 125 }],
    }

    vi.mocked(api.getLecture).mockResolvedValueOnce(mockMoodleVideoLecture as any)

    render(
      <VideoPlayer
        lectureId={102}
        lectureTitle="Lezione 2: Strutture Dati MP4"
        onClose={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.getByText("Lezione 2: Strutture Dati MP4")).toBeDefined()
    })

    // Check HTML5 video element is rendered
    const video = document.querySelector("video")
    expect(video).not.toBeNull()
    expect(video?.getAttribute("src")).toBe("/media/102/video.mp4")

    // Check speed presets are rendered: 0.75x, 1x, 1.25x, 1.5x, 2x
    expect(screen.getByRole("button", { name: "Velocità 0.75x" })).toBeDefined()
    expect(screen.getByRole("button", { name: "Velocità 1x" })).toBeDefined()
    expect(screen.getByRole("button", { name: "Velocità 1.25x" })).toBeDefined()
    expect(screen.getByRole("button", { name: "Velocità 1.5x" })).toBeDefined()
    expect(screen.getByRole("button", { name: "Velocità 2x" })).toBeDefined()

    // Click 1.5x speed preset
    const speed15Btn = screen.getByRole("button", { name: "Velocità 1.5x" })
    fireEvent.click(speed15Btn)
    expect(speed15Btn.getAttribute("aria-pressed")).toBe("true")

    // Check PiP and Fullscreen buttons
    expect(screen.getByTitle(/Picture in Picture/i)).toBeDefined()
    expect(screen.getByTitle(/Schermo intero/i)).toBeDefined()

    // Check silence skipping switch
    expect(screen.getByText(/Salta silenzi/i)).toBeDefined()
  })

  it("loads and renders Slide Sincronizzate + Audio Whisper mode", async () => {
    const mockSlideAudioLecture = {
      id: 103,
      course_id: 2,
      title: "Lezione 3: Slide e Audio Locale",
      status: "pronta",
      source: "manual",
      date: "2026-10-05",
      duration: 2400,
      has_audio: true,
      has_slides: true,
      has_transcript: true,
      has_notes: false,
      folder: "corso_2/lezione_3",
      audio_path: "/media/103/audio.opus",
      slides: [
        { index: 0, timestamp: 0, url: "/media/103/slides/1.png", thumbnailUrl: "/media/103/slides/1.png" },
        { index: 1, timestamp: 60, url: "/media/103/slides/2.png", thumbnailUrl: "/media/103/slides/2.png" },
      ],
      transcript: {
        segments: [
          { t_start: 0, t_end: 30, text: "Prima slide introduttiva." },
          { t_start: 60, t_end: 90, text: "Passiamo alla seconda slide." },
        ],
      },
    }

    vi.mocked(api.getLecture).mockResolvedValueOnce(mockSlideAudioLecture as any)

    render(
      <VideoPlayer
        lectureId={103}
        lectureTitle="Lezione 3: Slide e Audio Locale"
        onClose={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.getByText("Lezione 3: Slide e Audio Locale")).toBeDefined()
    })

    // Check slide badge shows Slide 1 / 2
    expect(screen.getByText(/Slide 1 \/ 2/i)).toBeDefined()

    // Check slide navigation buttons
    expect(screen.getByTitle(/Slide successiva/i)).toBeDefined()
    expect(screen.getByTitle(/Slide precedente/i)).toBeDefined()

    // Check audio play button
    const playBtn = screen.getByTitle(/Riproduci \(Spazio\)/i)
    expect(playBtn).toBeDefined()
  })

  it("allows switching between available modes via the pill selector", async () => {
    const mockMultiModalLecture = {
      id: 104,
      course_id: 1,
      title: "Lezione 4: Multimodale Completa",
      status: "pronta",
      source: "panopto",
      date: "2026-10-07",
      duration: 3000,
      has_audio: true,
      has_slides: true,
      has_transcript: true,
      has_notes: false,
      folder: "corso_1/lezione_4",
      panopto_embed_url: "https://univr.cloud.panopto.eu/Panopto/Pages/Embed.aspx?id=test-multi-id",
      media_url: "/media/104/video.mp4",
      video_modes: ["panopto", "moodle", "slides"],
      default_mode: "panopto",
      slides: [
        { index: 0, timestamp: 0, url: "/media/104/slides/1.png", thumbnailUrl: "/media/104/slides/1.png" },
      ],
      transcript: {
        segments: [{ t_start: 0, t_end: 10, text: "Test multimodale." }],
      },
    }

    vi.mocked(api.getLecture).mockResolvedValueOnce(mockMultiModalLecture as any)

    render(
      <VideoPlayer
        lectureId={104}
        lectureTitle="Lezione 4: Multimodale Completa"
        onClose={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.getByText("Lezione 4: Multimodale Completa")).toBeDefined()
    })

    // All 3 mode pills should be present
    const panoptoTab = screen.getByRole("tab", { name: /Modalità Panopto/i })
    const videoTab = screen.getByRole("tab", { name: /Modalità Video MP4/i })
    const slidesTab = screen.getByRole("tab", { name: /Modalità Slide & Audio/i })

    expect(panoptoTab).toBeDefined()
    expect(videoTab).toBeDefined()
    expect(slidesTab).toBeDefined()

    // Initially in Panopto mode
    expect(document.querySelector("iframe")).not.toBeNull()
    expect(document.querySelector("video")).toBeNull()

    // Switch to Video MP4
    fireEvent.click(videoTab)
    expect(videoTab.getAttribute("aria-selected")).toBe("true")
    expect(document.querySelector("video")).not.toBeNull()
    expect(document.querySelector("iframe")).toBeNull()

    // Switch to Slide & Audio
    fireEvent.click(slidesTab)
    expect(slidesTab.getAttribute("aria-selected")).toBe("true")
    expect(screen.getByText(/Slide 1 \/ 1/i)).toBeDefined()
    expect(document.querySelector("video")).toBeNull()

    // Switch back to Panopto
    fireEvent.click(panoptoTab)
    expect(panoptoTab.getAttribute("aria-selected")).toBe("true")
    expect(document.querySelector("iframe")).not.toBeNull()
  })

  it("synchronizes clickable Whisper transcript segments with player seek", async () => {
    const mockLecture = {
      id: 105,
      course_id: 1,
      title: "Lezione 5: Sincronizzazione Whisper",
      status: "pronta",
      source: "moodle",
      date: "2026-10-09",
      duration: 1200,
      has_audio: false,
      has_slides: false,
      has_transcript: true,
      has_notes: false,
      folder: "corso_1/lezione_5",
      media_url: "/media/105/video.mp4",
      transcript: {
        segments: [
          { t_start: 0, t_end: 10, text: "Primo segmento a 0 secondi." },
          { t_start: 45, t_end: 60, text: "Secondo segmento a 45 secondi." },
        ],
      },
    }

    vi.mocked(api.getLecture).mockResolvedValueOnce(mockLecture as any)

    render(
      <VideoPlayer
        lectureId={105}
        lectureTitle="Lezione 5: Sincronizzazione Whisper"
        onClose={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.getByText("Secondo segmento a 45 secondi.")).toBeDefined()
    })

    const video = document.querySelector("video")
    expect(video).not.toBeNull()

    // Click second segment (at 45 seconds)
    const secondSegment = screen.getByText("Secondo segmento a 45 secondi.")
    fireEvent.click(secondSegment)

    // Check video.currentTime is updated to 45
    expect(video?.currentTime).toBe(45)
  })

  it("filters transcript segments with search input", async () => {
    const mockLecture = {
      id: 106,
      course_id: 1,
      title: "Lezione 6: Ricerca Whisper",
      status: "pronta",
      source: "moodle",
      date: "2026-10-10",
      duration: 1000,
      has_audio: false,
      has_slides: false,
      has_transcript: true,
      has_notes: false,
      folder: "corso_1/lezione_6",
      media_url: "/media/106/video.mp4",
      transcript: {
        segments: [
          { t_start: 0, t_end: 10, text: "Introduzione alle matrici sparse." },
          { t_start: 20, t_end: 35, text: "Spiegazione degli algoritmi greedy." },
        ],
      },
    }

    vi.mocked(api.getLecture).mockResolvedValueOnce(mockLecture as any)

    render(
      <VideoPlayer
        lectureId={106}
        lectureTitle="Lezione 6: Ricerca Whisper"
        onClose={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.getAllByText("Introduzione alle matrici sparse.").length).toBeGreaterThan(0)
      expect(screen.getByText("Spiegazione degli algoritmi greedy.")).toBeDefined()
    })

    // Both segments exist in transcript initially
    expect(document.querySelector('[data-segment-index="0"]')).not.toBeNull()
    expect(document.querySelector('[data-segment-index="1"]')).not.toBeNull()

    // Search for "greedy"
    const searchInput = screen.getByPlaceholderText(/Cerca nella trascrizione.../i)
    fireEvent.change(searchInput, { target: { value: "greedy" } })

    // Only greedy segment should remain visible in transcript list
    expect(document.querySelector('[data-segment-index="1"]')).not.toBeNull()
    expect(document.querySelector('[data-segment-index="0"]')).toBeNull()
  })

  it("creates, saves, displays, and deletes timestamped notes in localStorage", async () => {
    const mockLecture = {
      id: 107,
      course_id: 1,
      title: "Lezione 7: Note e Segnalibri",
      status: "pronta",
      source: "moodle",
      date: "2026-10-12",
      duration: 1500,
      has_audio: false,
      has_slides: false,
      has_transcript: true,
      has_notes: false,
      folder: "corso_1/lezione_7",
      media_url: "/media/107/video.mp4",
      transcript: {
        segments: [{ t_start: 0, t_end: 10, text: "Segmento base." }],
      },
    }

    vi.mocked(api.getLecture).mockResolvedValueOnce(mockLecture as any)

    render(
      <VideoPlayer
        lectureId={107}
        lectureTitle="Lezione 7: Note e Segnalibri"
        onClose={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.getByText("Lezione 7: Note e Segnalibri")).toBeDefined()
    })

    // Switch to Notes tab
    const notesTabBtn = screen.getByRole("button", { name: /Note/i })
    fireEvent.click(notesTabBtn)

    // Add a note via input form
    const noteInput = screen.getByPlaceholderText(/Nota a 0:00.../i)
    fireEvent.change(noteInput, { target: { value: "Importante: rivedere questa definizione" } })

    const saveNoteBtn = screen.getByRole("button", { name: /Salva/i })
    fireEvent.click(saveNoteBtn)

    // Check note appears in UI
    expect(screen.getByText("Importante: rivedere questa definizione")).toBeDefined()

    // Check note is stored in localStorage
    const stored = JSON.parse(localStorage.getItem("studyhub-notes-107") || "[]")
    expect(stored.length).toBe(1)
    expect(stored[0].text).toBe("Importante: rivedere questa definizione")

    // Delete note
    const deleteBtn = screen.getByTitle(/Elimina nota/i)
    fireEvent.click(deleteBtn)

    expect(screen.queryByText("Importante: rivedere questa definizione")).toBeNull()
    const storedAfter = JSON.parse(localStorage.getItem("studyhub-notes-107") || "[]")
    expect(storedAfter.length).toBe(0)
  })

  it("exposes imperative ref handle correctly", async () => {
    const mockLecture = {
      id: 108,
      course_id: 1,
      title: "Lezione 8: Handle Ref",
      status: "pronta",
      source: "moodle",
      date: "2026-10-15",
      duration: 500,
      has_audio: false,
      has_slides: false,
      has_transcript: true,
      has_notes: false,
      folder: "corso_1/lezione_8",
      media_url: "/media/108/video.mp4",
      transcript: {
        segments: [{ t_start: 0, t_end: 10, text: "Ref test." }],
      },
    }

    vi.mocked(api.getLecture).mockResolvedValueOnce(mockLecture as any)

    const playerRef = React.createRef<VideoPlayerHandle>()

    render(
      <VideoPlayer
        ref={playerRef}
        lectureId={108}
        lectureTitle="Lezione 8: Handle Ref"
        onClose={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.getByText("Lezione 8: Handle Ref")).toBeDefined()
    })

    expect(playerRef.current).not.toBeNull()
    expect(typeof playerRef.current?.seek).toBe("function")
    expect(typeof playerRef.current?.play).toBe("function")
    expect(typeof playerRef.current?.pause).toBe("function")
    expect(typeof playerRef.current?.setRate).toBe("function")
    expect(typeof playerRef.current?.getCurrentTime).toBe("function")
    expect(typeof playerRef.current?.getDuration).toBe("function")

    // Seek via handle
    act(() => {
      playerRef.current?.seek(35)
    })
    expect(playerRef.current?.getCurrentTime()).toBe(35)
  })
})
