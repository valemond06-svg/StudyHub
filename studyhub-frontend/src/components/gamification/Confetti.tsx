import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react"

const DEFAULT_COLORS = [
  "#3d52ff", // accent-500
  "#22c55e", // success-500
  "#f59e0b", // warning-500
  "#ef4444", // error-500
  "#bccdff", // accent-200
  "#8fa2ff", // accent-300
]

interface ConfettiPiece {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  color: string
  rotation: number
  rotationSpeed: number
  shape: "rect" | "circle"
  opacity: number
}

export interface ConfettiHandle {
  play: () => void
}

interface ConfettiProps {
  /** When it flips to true, confetti explodes (declarative trigger). */
  trigger?: boolean
  /** Number of particles. Default 80. */
  count?: number
  /** Custom particle colors. */
  colors?: string[]
  /** Milliseconds before cleanup. Default 900. */
  duration?: number
}

/** Explodes colored particles over the viewport on trigger. Use with a ref to call `play()`. */
export const Confetti = forwardRef<ConfettiHandle, ConfettiProps>(function Confetti(
  { trigger = false, count = 80, colors = DEFAULT_COLORS, duration = 900 },
  ref
) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [exploding, setExploding] = useState(false)
  const burstId = useRef(0)
  const prevTrigger = useRef(trigger)

  const doPlay = () => {
    burstId.current += 1
    setExploding(true)
  }

  useImperativeHandle(ref, () => ({ play: doPlay }), [])

  // Declarative trigger on prop change.
  useEffect(() => {
    if (trigger && trigger !== prevTrigger.current) {
      prevTrigger.current = trigger
      doPlay()
    } else {
      prevTrigger.current = trigger
    }
  }, [trigger])

  // Run the animation while "exploding".
  useEffect(() => {
    if (!exploding) return
    const id = burstId.current
    const reducedMotion =
      typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width
    canvas.height = rect.height

    const pieces: ConfettiPiece[] = []
    const spawn = reducedMotion ? Math.min(count, 10) : count
    for (let i = 0; i < spawn; i++) {
      pieces.push({
        x: canvas.width / 2,
        y: canvas.height / 2,
        vx: (Math.random() - 0.5) * 14,
        vy: -Math.random() * 12 - 3,
        size: 6 + Math.random() * 6,
        color: colors[Math.floor(Math.random() * colors.length)],
        rotation: Math.random() * Math.PI * 2,
        rotationSpeed: (Math.random() - 0.5) * 0.3,
        shape: Math.random() > 0.4 ? "rect" : "circle",
        opacity: 1,
      })
    }

    let raf = 0
    const start = performance.now()
    const loop = (now: number) => {
      const elapsed = now - start
      const progress = Math.min(elapsed / duration, 1)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      for (const p of pieces) {
        p.vy += 0.4 // gravity
        p.x += p.vx
        p.y += p.vy
        p.rotation += p.rotationSpeed
        p.opacity = 1 - progress

        ctx.save()
        ctx.globalAlpha = Math.max(p.opacity, 0)
        ctx.translate(p.x, p.y)
        ctx.rotate(p.rotation)
        ctx.fillStyle = p.color
        if (p.shape === "circle") {
          ctx.beginPath()
          ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2)
          ctx.fill()
        } else {
          ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6)
        }
        ctx.restore()
      }
      if (progress < 1) {
        raf = requestAnimationFrame(loop)
      } else if (id === burstId.current) {
        setExploding(false)
      }
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [exploding, count, colors, duration])

  // Resize with the container.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      canvas.width = rect.width
      canvas.height = rect.height
    }
    resize()
    window.addEventListener("resize", resize)
    return () => window.removeEventListener("resize", resize)
  }, [])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-100"
    />
  )
})