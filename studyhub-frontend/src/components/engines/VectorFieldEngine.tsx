import React, { useState, useRef, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Play, Pause, RotateCcw, Compass } from "lucide-react"
import type { VectorFieldEngineProps, VectorFieldMode } from "./types"

interface Particle {
  x: number
  y: number
  age: number
  maxAge: number
  speedMult: number
}

export function VectorFieldEngine({ config = {}, className = "", showControls = true }: VectorFieldEngineProps) {
  const [mode, setMode] = useState<VectorFieldMode>(config.mode ?? "vortex")
  const [intensity, setIntensity] = useState<number>(1.2)
  const [speed, setSpeed] = useState<number>(config.speed ?? 1.5)
  const [particleDensity, setParticleDensity] = useState<number>(config.density ?? 180)
  const [showArrows, setShowArrows] = useState<boolean>(true)
  const [isPlaying, setIsPlaying] = useState<boolean>(true)

  // Interactive probe / robot trajectory position
  const [probe, setProbe] = useState<{ x: number; y: number } | null>({ x: -1.8, y: 1.4 })

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const particlesRef = useRef<Particle[]>([])

  // Calculate field vector F(x, y) = (fx, fy)
  const getField = useCallback(
    (x: number, y: number): { fx: number; fy: number } => {
      let fx = 0
      let fy = 0
      switch (mode) {
        case "vortex":
          // F(x, y) = (-y, x) -> pure rotation, rot != 0, div = 0
          fx = -y
          fy = x
          break
        case "source":
          // F(x, y) = (x, y) -> divergence > 0
          fx = x
          fy = y
          break
        case "sink":
          // F(x, y) = (-x, -y) -> divergence < 0, gradient to minimum
          fx = -x
          fy = -y
          break
        case "saddle":
          // F(x, y) = (x, -y) -> saddle point at origin
          fx = x
          fy = -y
          break
        case "sine":
          // F(x, y) = (sin(1.2y), cos(1.2x)) -> periodic vortex cells
          fx = Math.sin(1.2 * y)
          fy = Math.cos(1.2 * x)
          break
        case "potential":
          // Artificial potential repulsive field around obstacle at (0, 0)
          const d2 = x * x + y * y + 0.15
          fx = 0.9 + (0.7 * x) / d2
          fy = (0.7 * y) / d2
          break
        default:
          fx = -y
          fy = x
      }
      return { fx: fx * intensity, fy: fy * intensity }
    },
    [mode, intensity]
  )

  // Initialize particles
  const initParticles = useCallback((count: number) => {
    const particles: Particle[] = []
    for (let i = 0; i < count; i++) {
      particles.push({
        x: (Math.random() - 0.5) * 8.0,
        y: (Math.random() - 0.5) * 5.0,
        age: Math.floor(Math.random() * 120),
        maxAge: 80 + Math.floor(Math.random() * 80),
        speedMult: 0.8 + Math.random() * 0.4,
      })
    }
    particlesRef.current = particles
  }, [])

  useEffect(() => {
    initParticles(particleDensity)
  }, [particleDensity, initParticles])

  // Animation Loop
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const animate = () => {
      const dpr = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      const width = rect.width || 560
      const height = rect.height || 340

      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr
        canvas.height = height * dpr
        ctx.scale(dpr, dpr)
      }

      const cx = width / 2
      const cy = height / 2
      const scale = 40 // px per unit in x/y

      // Fade trail effect for smooth glowing lines
      ctx.fillStyle = "rgba(12, 14, 20, 0.18)"
      ctx.fillRect(0, 0, width, height)

      // Optional static vector arrows grid
      if (showArrows) {
        ctx.lineWidth = 1.0
        const stepX = 0.8
        const stepY = 0.8
        for (let gx = -4.0; gx <= 4.0; gx += stepX) {
          for (let gy = -2.4; gy <= 2.4; gy += stepY) {
            const { fx, fy } = getField(gx, gy)
            const len = Math.hypot(fx, fy) || 0.001
            const px = cx + gx * scale
            const py = cy - gy * scale

            const arrowLen = Math.min(16, len * 8 + 4)
            const tox = px + (fx / len) * arrowLen
            const toy = py - (fy / len) * arrowLen

            // Gradient color based on magnitude
            ctx.strokeStyle = "rgba(56, 189, 248, 0.22)"
            ctx.beginPath()
            ctx.moveTo(px, py)
            ctx.lineTo(tox, toy)
            ctx.stroke()

            // Small arrowhead
            ctx.fillStyle = "rgba(56, 189, 248, 0.28)"
            ctx.beginPath()
            ctx.arc(tox, toy, 1.2, 0, Math.PI * 2)
            ctx.fill()
          }
        }
      }

      // Update and draw flow particles
      if (isPlaying) {
        const particles = particlesRef.current
        for (let i = 0; i < particles.length; i++) {
          const p = particles[i]
          const { fx, fy } = getField(p.x, p.y)

          const oldPx = cx + p.x * scale
          const oldPy = cy - p.y * scale

          // Move along field
          const stepSpeed = speed * p.speedMult * 0.03
          p.x += fx * stepSpeed
          p.y += fy * stepSpeed
          p.age++

          const newPx = cx + p.x * scale
          const newPy = cy - p.y * scale

          // Draw streak line
          const alpha = Math.sin((p.age / p.maxAge) * Math.PI) * 0.85
          ctx.strokeStyle = `rgba(56, 189, 248, ${alpha})`
          ctx.lineWidth = 1.8
          ctx.beginPath()
          ctx.moveTo(oldPx, oldPy)
          ctx.lineTo(newPx, newPy)
          ctx.stroke()

          // Draw head
          ctx.fillStyle = `rgba(186, 230, 253, ${alpha})`
          ctx.beginPath()
          ctx.arc(newPx, newPy, 1.2, 0, Math.PI * 2)
          ctx.fill()

          // Boundary or age check: respawn
          if (
            p.age > p.maxAge ||
            p.x < -4.5 ||
            p.x > 4.5 ||
            p.y < -3.0 ||
            p.y > 3.0 ||
            (Math.abs(fx) < 0.001 && Math.abs(fy) < 0.001)
          ) {
            p.x = (Math.random() - 0.5) * 8.0
            p.y = (Math.random() - 0.5) * 5.0
            p.age = 0
            p.maxAge = 70 + Math.floor(Math.random() * 80)
          }
        }
      }

      // Draw interactive probe trajectory
      if (probe) {
        let simX = probe.x
        let simY = probe.y
        ctx.strokeStyle = "#f59e0b"
        ctx.lineWidth = 2.5
        ctx.setLineDash([4, 2])
        ctx.beginPath()
        ctx.moveTo(cx + simX * scale, cy - simY * scale)

        const simSteps = 100
        for (let step = 0; step < simSteps; step++) {
          const { fx, fy } = getField(simX, simY)
          const simDt = 0.04
          simX += fx * simDt
          simY += fy * simDt
          ctx.lineTo(cx + simX * scale, cy - simY * scale)
          if (Math.abs(simX) > 4.5 || Math.abs(simY) > 3.2) break
        }
        ctx.stroke()
        ctx.setLineDash([])

        // Draw probe robot marker
        const probePx = cx + probe.x * scale
        const probePy = cy - probe.y * scale
        ctx.fillStyle = "#ef4444"
        ctx.beginPath()
        ctx.arc(probePx, probePy, 6, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = "#ffffff"
        ctx.lineWidth = 2
        ctx.stroke()

        // Label
        ctx.fillStyle = "#f59e0b"
        ctx.font = "bold 11px sans-serif"
        ctx.fillText("Robot (Traiettoria)", probePx + 9, probePy - 7)
      }

      animationFrameRef.current = requestAnimationFrame(animate)
    }

    animationFrameRef.current = requestAnimationFrame(animate)

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [getField, isPlaying, showArrows, speed, probe])

  // Canvas click to move probe
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const cx = rect.width / 2
    const cy = rect.height / 2
    const scale = 40

    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top

    const x = (mx - cx) / scale
    const y = -(my - cy) / scale
    setProbe({ x, y })
  }

  // Math description of active mode
  const getModeInfo = () => {
    switch (mode) {
      case "vortex":
        return {
          title: "Vortice / Rotore (Rot F ≠ 0, Div F = 0)",
          formula: "F(x, y) = (-y, x)",
          desc: "Moto rotazionale puro (campo solenoidale). La circuitazione lungo qualsiasi curva chiusa attorno all'origine è non nulla.",
          variant: "accent" as const,
        }
      case "source":
        return {
          title: "Sorgente (Divergenza Positiva Div F > 0)",
          formula: "F(x, y) = (x, y)",
          desc: "Flusso uscente netto. La divergenza è pari a 2: le particelle si espandono e fuggono radialmente dall'origine.",
          variant: "success" as const,
        }
      case "sink":
        return {
          title: "Pozzo / Gradiente a Minimo (Div F < 0)",
          formula: "F(x, y) = (-x, -y)",
          desc: "Campo conservativo F = -∇V con minimo in (0,0). Le linee di flusso precipitano verso il punto di equilibrio stabile.",
          variant: "secondary" as const,
        }
      case "saddle":
        return {
          title: "Punto di Sella (Saddle Point Iperbolico)",
          formula: "F(x, y) = (x, -y)",
          desc: "Equilibrio iperbolico: asse Y attrattivo (stabile), asse X repulsivo (instabile). Tipico paesaggio di energia o controllo.",
          variant: "warning" as const,
        }
      case "sine":
        return {
          title: "Campo Sinusoidale Multi-Cella",
          formula: "F(x, y) = (sin(1.2y), cos(1.2x))",
          desc: "Struttura vorticosa non-lineare con celle di convezione multiple periodiche e punti di ristagno alternati.",
          variant: "default" as const,
        }
      case "potential":
        return {
          title: "Navigazione Robotica con Ostacolo",
          formula: "F(x, y) = F_nav + ∇U_rep(x, y)",
          desc: "Algoritmo a potenziali artificiali: il robot avanza verso destra mentre il campo repulsivo devia la traiettoria attorno all'ostacolo centrale.",
          variant: "accent" as const,
        }
    }
  }

  const modeInfo = getModeInfo()

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Preset bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-1 border-b border-neutral-200 dark:border-neutral-800">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mr-1">Modalità:</span>
          <Button
            variant={mode === "vortex" ? "default" : "outline"}
            size="sm"
            className="h-7 text-xs px-2.5"
            onClick={() => setMode("vortex")}
          >
            Vortice
          </Button>
          <Button
            variant={mode === "source" ? "default" : "outline"}
            size="sm"
            className="h-7 text-xs px-2.5"
            onClick={() => setMode("source")}
          >
            Sorgente
          </Button>
          <Button
            variant={mode === "sink" ? "default" : "outline"}
            size="sm"
            className="h-7 text-xs px-2.5"
            onClick={() => setMode("sink")}
          >
            Pozzo (∇f)
          </Button>
          <Button
            variant={mode === "saddle" ? "default" : "outline"}
            size="sm"
            className="h-7 text-xs px-2.5"
            onClick={() => setMode("saddle")}
          >
            Punto Sella
          </Button>
          <Button
            variant={mode === "sine" ? "default" : "outline"}
            size="sm"
            className="h-7 text-xs px-2.5"
            onClick={() => setMode("sine")}
          >
            Sinusoidale
          </Button>
          <Button
            variant={mode === "potential" ? "default" : "outline"}
            size="sm"
            className="h-7 text-xs px-2.5"
            onClick={() => setMode("potential")}
          >
            Evita Ostacolo
          </Button>
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs px-2"
            onClick={() => setIsPlaying(!isPlaying)}
            title={isPlaying ? "Pausa" : "Avvia"}
          >
            {isPlaying ? <Pause className="h-3.5 w-3.5 mr-1" /> : <Play className="h-3.5 w-3.5 mr-1" />}
            {isPlaying ? "Pausa" : "Play"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs px-2 text-neutral-500"
            onClick={() => {
              setMode("vortex")
              setIntensity(1.2)
              setSpeed(1.5)
              setProbe({ x: -1.8, y: 1.4 })
              initParticles(particleDensity)
            }}
          >
            <RotateCcw className="h-3.5 w-3.5 mr-1" />
            Reset
          </Button>
        </div>
      </div>

      {/* Physics Card description */}
      <div className="p-3.5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 space-y-1">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
          <div className="flex items-center gap-2">
            <Compass className="h-4 w-4 text-sky-500" />
            <span className="font-semibold text-sm text-neutral-900 dark:text-neutral-50">{modeInfo.title}</span>
          </div>
          <code className="text-xs font-mono px-2 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300">
            {modeInfo.formula}
          </code>
        </div>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">{modeInfo.desc}</p>
      </div>

      {/* Main Canvas View */}
      <div className="relative rounded-xl overflow-hidden border border-neutral-800 bg-[#0c0e14] shadow-inner">
        <canvas
          ref={canvasRef}
          onClick={handleCanvasClick}
          className="w-full h-[320px] sm:h-[360px] block cursor-crosshair select-none"
        />
        {/* Interactive help watermark */}
        <div className="absolute bottom-2 left-2 pointer-events-none px-2.5 py-1 rounded bg-black/60 backdrop-blur-sm text-[11px] text-neutral-400 border border-white/5">
          🎯 Clicca ovunque sul piano per posizionare il robot e tracciare la linea di flusso
        </div>
      </div>

      {/* Controls Bar */}
      {showControls && (
        <div className="p-4 rounded-xl bg-neutral-50 dark:bg-neutral-900/60 border border-neutral-200 dark:border-neutral-800 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-1">
            <div className="flex justify-between text-xs font-medium">
              <span className="text-neutral-600 dark:text-neutral-400">Intensità Campo</span>
              <span className="font-mono text-neutral-900 dark:text-neutral-100">{intensity.toFixed(1)}x</span>
            </div>
            <input
              type="range"
              min="0.5"
              max="2.5"
              step="0.1"
              value={intensity}
              onChange={(e) => setIntensity(parseFloat(e.target.value))}
              className="w-full accent-sky-500 h-1.5 bg-neutral-200 dark:bg-neutral-800 rounded-lg cursor-pointer"
            />
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-xs font-medium">
              <span className="text-neutral-600 dark:text-neutral-400">Velocità Flusso</span>
              <span className="font-mono text-neutral-900 dark:text-neutral-100">{speed.toFixed(1)}x</span>
            </div>
            <input
              type="range"
              min="0.5"
              max="3.0"
              step="0.1"
              value={speed}
              onChange={(e) => setSpeed(parseFloat(e.target.value))}
              className="w-full accent-sky-500 h-1.5 bg-neutral-200 dark:bg-neutral-800 rounded-lg cursor-pointer"
            />
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-xs font-medium">
              <span className="text-neutral-600 dark:text-neutral-400">Densità Particelle</span>
              <span className="font-mono text-neutral-900 dark:text-neutral-100">{particleDensity}</span>
            </div>
            <input
              type="range"
              min="60"
              max="300"
              step="20"
              value={particleDensity}
              onChange={(e) => setParticleDensity(parseInt(e.target.value, 10))}
              className="w-full accent-sky-500 h-1.5 bg-neutral-200 dark:bg-neutral-800 rounded-lg cursor-pointer"
            />
          </div>

          <div className="sm:col-span-3 pt-2 border-t border-neutral-200 dark:border-neutral-800 flex items-center justify-between text-xs">
            <label className="flex items-center gap-2 cursor-pointer font-medium text-neutral-700 dark:text-neutral-300">
              <input
                type="checkbox"
                checked={showArrows}
                onChange={(e) => setShowArrows(e.target.checked)}
                className="rounded accent-sky-500 cursor-pointer"
              />
              Mostra Frecce Direzionali della Griglia (Vettori di Campo)
            </label>
            {probe && (
              <span className="text-[11px] text-neutral-400">
                Sonda: ({probe.x.toFixed(2)}, {probe.y.toFixed(2)})
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
