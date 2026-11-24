import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { PhotoUpload, compressImage } from "./PhotoUpload"

describe("PhotoUpload Component & compressImage", () => {
  it("compressImage rejects non-image files", async () => {
    const textFile = new File(["test data"], "test.txt", { type: "text/plain" })
    await expect(compressImage(textFile)).rejects.toThrow("non è un'immagine valida")
  })

  it("renders PhotoUpload with label and upload triggers", () => {
    const onPhotosChange = vi.fn()
    render(
      <PhotoUpload
        photos={[]}
        onPhotosChange={onPhotosChange}
        maxPhotos={4}
        label="Foto Quaderno"
      />
    )

    expect(screen.getByText("Foto Quaderno")).toBeDefined()
    expect(screen.getByText("(0/4)")).toBeDefined()
    expect(screen.getByText("Scatta")).toBeDefined()
    expect(screen.getByText("Carica foto")).toBeDefined()
  })

  it("renders thumbnails, allows removal, and triggers onPhotosChange", () => {
    const onPhotosChange = vi.fn()
    const mockPhotos = ["data:image/jpeg;base64,photo1", "data:image/jpeg;base64,photo2"]

    render(
      <PhotoUpload
        photos={mockPhotos}
        onPhotosChange={onPhotosChange}
        maxPhotos={4}
      />
    )

    expect(screen.getByText("#1")).toBeDefined()
    expect(screen.getByText("#2")).toBeDefined()

    // Find remove button for first photo
    const removeButtons = screen.getAllByTitle("Rimuovi foto")
    expect(removeButtons.length).toBe(2)

    fireEvent.click(removeButtons[0])
    expect(onPhotosChange).toHaveBeenCalledWith(["data:image/jpeg;base64,photo2"])
  })

  it("opens fullscreen lightbox on thumbnail click and closes on close button", () => {
    const onPhotosChange = vi.fn()
    const mockPhotos = ["data:image/jpeg;base64,photo1", "data:image/jpeg;base64,photo2"]

    render(
      <PhotoUpload
        photos={mockPhotos}
        onPhotosChange={onPhotosChange}
      />
    )

    // Click on first thumbnail
    const img1 = screen.getByAltText("Miniatura pagina 1")
    fireEvent.click(img1)

    // Modal should be open
    expect(screen.getByRole("dialog")).toBeDefined()
    expect(screen.getByText("Foto 1 di 2")).toBeDefined()

    // Click close button
    const closeBtn = screen.getByLabelText("Chiudi visualizzatore")
    fireEvent.click(closeBtn)

    // Modal should be closed
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("navigates in lightbox using next and previous buttons", () => {
    const onPhotosChange = vi.fn()
    const mockPhotos = ["data:image/jpeg;base64,photo1", "data:image/jpeg;base64,photo2"]

    render(
      <PhotoUpload
        photos={mockPhotos}
        onPhotosChange={onPhotosChange}
      />
    )

    const img1 = screen.getByAltText("Miniatura pagina 1")
    fireEvent.click(img1)

    expect(screen.getByText("Foto 1 di 2")).toBeDefined()

    // Next
    const nextBtn = screen.getByLabelText("Foto successiva")
    fireEvent.click(nextBtn)
    expect(screen.getByText("Foto 2 di 2")).toBeDefined()

    // Prev
    const prevBtn = screen.getByLabelText("Foto precedente")
    fireEvent.click(prevBtn)
    expect(screen.getByText("Foto 1 di 2")).toBeDefined()
  })
})
