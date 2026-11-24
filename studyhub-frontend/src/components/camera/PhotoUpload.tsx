import React, { useState, useRef, useEffect, useCallback } from "react"
import { Camera, Upload, X, ZoomIn, ChevronLeft, ChevronRight, Loader2, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

export interface PhotoUploadProps {
  photos: string[]
  onPhotosChange: (photos: string[]) => void
  maxPhotos?: number
  label?: string
  className?: string
  disabled?: boolean
  onPhotoAdded?: (photo: string) => void
}

/**
 * Ridimensiona l'immagine mantenendo il rapporto d'aspetto (massimo maxDim px sul lato lungo)
 * ed esporta come data URL JPEG compresso con qualità quality.
 */
export async function compressImage(
  file: File,
  maxDim: number = 1600,
  quality: number = 0.82
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("Il file selezionato non è un'immagine valida."))
      return
    }

    const reader = new FileReader()
    reader.onerror = () => reject(new Error("Errore nella lettura del file immagine."))
    reader.onload = () => {
      const dataUrl = reader.result as string

      // Fallback per ambienti non-browser o privi di supporto canvas completo
      if (typeof window === "undefined" || typeof document === "undefined") {
        resolve(dataUrl)
        return
      }

      const img = new Image()
      img.onerror = () => {
        // Se non caricabile via Image (es. mock o svg), usa il dataUrl originale
        resolve(dataUrl)
      }
      img.onload = () => {
        try {
          let { width, height } = img

          if (!width || !height) {
            resolve(dataUrl)
            return
          }

          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round((height * maxDim) / width)
              width = maxDim
            } else {
              width = Math.round((width * maxDim) / height)
              height = maxDim
            }
          }

          const canvas = document.createElement("canvas")
          canvas.width = width
          canvas.height = height
          const ctx = canvas.getContext("2d")

          if (!ctx) {
            resolve(dataUrl)
            return
          }

          ctx.imageSmoothingEnabled = true
          ctx.imageSmoothingQuality = "high"
          ctx.drawImage(img, 0, 0, width, height)

          const compressed = canvas.toDataURL("image/jpeg", quality)
          resolve(compressed)
        } catch (err) {
          console.warn("Compressione canvas fallita, fallback:", err)
          resolve(dataUrl)
        }
      }
      img.src = dataUrl
    }
    reader.readAsDataURL(file)
  })
}

export function PhotoUpload({
  photos,
  onPhotosChange,
  maxPhotos = 6,
  label = "Svolgimento a mano sul quaderno",
  className,
  disabled = false,
  onPhotoAdded,
}: PhotoUploadProps) {
  const [isCompressing, setIsCompressing] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [activeLightboxIndex, setActiveLightboxIndex] = useState<number | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)

  // Gestione tasti per lightbox (ESC, Frecce)
  useEffect(() => {
    if (activeLightboxIndex === null) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setActiveLightboxIndex(null)
      } else if (e.key === "ArrowLeft") {
        setActiveLightboxIndex((prev) => (prev !== null && prev > 0 ? prev - 1 : prev))
      } else if (e.key === "ArrowRight") {
        setActiveLightboxIndex((prev) => (prev !== null && prev < photos.length - 1 ? prev + 1 : prev))
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [activeLightboxIndex, photos.length])

  const handleFiles = useCallback(
    async (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return
      setErrorMessage(null)

      const availableSlots = maxPhotos - photos.length
      if (availableSlots <= 0) {
        setErrorMessage(`Hai raggiunto il limite massimo di ${maxPhotos} foto per questo esercizio.`)
        return
      }

      const filesToProcess = Array.from(fileList).slice(0, availableSlots)
      setIsCompressing(true)

      try {
        const compressedPromises = filesToProcess.map((f) => compressImage(f))
        const compressedResults = await Promise.all(compressedPromises)
        const updated = [...photos, ...compressedResults]
        onPhotosChange(updated)
        if (onPhotoAdded) {
          compressedResults.forEach((p) => onPhotoAdded(p))
        }
      } catch (err: any) {
        setErrorMessage(err.message || "Errore durante la compressione o il caricamento delle foto.")
      } finally {
        setIsCompressing(false)
        if (fileInputRef.current) fileInputRef.current.value = ""
        if (cameraInputRef.current) cameraInputRef.current.value = ""
      }
    },
    [maxPhotos, onPhotoAdded, onPhotosChange, photos]
  )

  const handleRemove = (indexToRemove: number) => {
    const updated = photos.filter((_, idx) => idx !== indexToRemove)
    onPhotosChange(updated)
    if (activeLightboxIndex !== null) {
      if (updated.length === 0) {
        setActiveLightboxIndex(null)
      } else if (activeLightboxIndex >= updated.length) {
        setActiveLightboxIndex(updated.length - 1)
      }
    }
  }

  const canAddMore = photos.length < maxPhotos && !disabled && !isCompressing

  return (
    <div className={cn("space-y-3", className)}>
      {/* Hidden inputs */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
        disabled={disabled || isCompressing}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
        disabled={disabled || isCompressing}
      />

      {/* Header and Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {label && (
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
              {label}
            </span>
            <span className="text-2xs font-mono text-neutral-400">
              ({photos.length}/{maxPhotos})
            </span>
          </div>
        )}

        <div className="flex items-center gap-2 ml-auto">
          {/* Badge compressione in corso */}
          {isCompressing && (
            <Badge
              variant="secondary"
              className="text-xs py-1 px-2.5 gap-1.5 animate-pulse bg-accent-500/10 text-accent-600 dark:text-accent-400 border border-accent-500/20"
            >
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>Elaborazione in corso...</span>
            </Badge>
          )}

          {canAddMore && (
            <>
              {/* Pulsante fotocamera diretta per mobile */}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => cameraInputRef.current?.click()}
                className="h-8 rounded-xl text-xs gap-1.5 border-dashed hover:border-accent-500 hover:text-accent-600"
              >
                <Camera className="h-3.5 w-3.5" />
                <span>Scatta</span>
              </Button>

              {/* Pulsante upload file standard */}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                className="h-8 rounded-xl text-xs gap-1.5 hover:border-accent-500 hover:text-accent-600"
              >
                <Upload className="h-3.5 w-3.5" />
                <span>Carica foto</span>
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Error Message */}
      {errorMessage && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-700 dark:text-rose-300">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Grid of Thumbnails */}
      {photos.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
          {photos.map((photo, index) => (
            <div
              key={index}
              className="group relative aspect-4/3 rounded-2xl overflow-hidden border border-neutral-200/90 dark:border-neutral-800 bg-neutral-100 dark:bg-neutral-900 shadow-2xs hover:shadow-md transition-all"
            >
              <img
                src={photo}
                alt={`Miniatura pagina ${index + 1}`}
                className="w-full h-full object-cover cursor-pointer transition-transform duration-300 group-hover:scale-105"
                onClick={() => setActiveLightboxIndex(index)}
              />

              {/* Index Badge */}
              <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full text-2xs font-semibold bg-black/60 text-white backdrop-blur-xs">
                #{index + 1}
              </span>

              {/* Zoom overlay hint on hover */}
              <button
                type="button"
                onClick={() => setActiveLightboxIndex(index)}
                className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer text-white"
                title="Ingrandisci a tutto schermo"
                aria-label={`Ingrandisci foto ${index + 1}`}
              >
                <ZoomIn className="h-6 w-6 drop-shadow" />
              </button>

              {/* Delete Button */}
              {!disabled && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleRemove(index)
                  }}
                  className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 hover:bg-rose-600 text-white backdrop-blur-xs transition-colors z-10"
                  title="Rimuovi foto"
                  aria-label={`Rimuovi foto ${index + 1}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Fullscreen Lightbox Modal */}
      {activeLightboxIndex !== null && photos[activeLightboxIndex] && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Visualizzatore foto a schermo intero"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-in fade-in duration-200"
          onClick={() => setActiveLightboxIndex(null)}
        >
          <div
            className="relative max-w-4xl w-full max-h-[90vh] flex flex-col items-center justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Top Control Bar */}
            <div className="w-full flex items-center justify-between pb-3 text-white">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">
                  Foto {activeLightboxIndex + 1} di {photos.length}
                </span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setActiveLightboxIndex(null)}
                className="text-white hover:bg-white/20 rounded-full h-9 w-9"
                aria-label="Chiudi visualizzatore"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>

            {/* Image Display */}
            <div className="relative overflow-hidden rounded-2xl bg-neutral-900 border border-white/10 shadow-2xl flex items-center justify-center max-h-[75vh] w-full">
              <img
                src={photos[activeLightboxIndex]}
                alt={`Svolgimento pagina ${activeLightboxIndex + 1}`}
                className="max-h-[75vh] w-auto max-w-full object-contain select-none"
              />
            </div>

            {/* Navigation Arrows if > 1 */}
            {photos.length > 1 && (
              <div className="flex items-center justify-center gap-4 mt-4">
                <Button
                  variant="outline"
                  size="icon"
                  disabled={activeLightboxIndex === 0}
                  onClick={() =>
                    setActiveLightboxIndex((prev) => (prev !== null && prev > 0 ? prev - 1 : prev))
                  }
                  className="rounded-full bg-white/10 border-white/20 text-white hover:bg-white/20 h-10 w-10 disabled:opacity-30"
                  aria-label="Foto precedente"
                >
                  <ChevronLeft className="h-5 w-5" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  disabled={activeLightboxIndex === photos.length - 1}
                  onClick={() =>
                    setActiveLightboxIndex((prev) =>
                      prev !== null && prev < photos.length - 1 ? prev + 1 : prev
                    )
                  }
                  className="rounded-full bg-white/10 border-white/20 text-white hover:bg-white/20 h-10 w-10 disabled:opacity-30"
                  aria-label="Foto successiva"
                >
                  <ChevronRight className="h-5 w-5" />
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
