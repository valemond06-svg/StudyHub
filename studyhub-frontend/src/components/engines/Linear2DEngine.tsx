import React, { useState, useRef, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { RotateCcw, AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react"
import type { Linear2DEngineProps } from "./types"

export function Linear2DEngine({ config = {}, className = "", showControls = true }: Linear2DEngineProps) {
  const [a, setA] = useState<number>(config.a ?? 1.5)
  const [b, setB] = useState<number>(config.b ?? 0.5)
  const [c, setC] = useState<number>(config.c ?? 0.0)
  const [d, setD] = useState<number>(config.d ?? 1.2)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [draggingVector, setDraggingVector] = useState<"v1" | "v2" | null>(null)
  const [hoveredVector, setHoveredVector] = useState<"v1" | "v2" | null>(null)

  const det = a * d - b * c

  // Helper function to draw an arrow
  const drawArrow = (
    ctx: CanvasRenderingContext2D,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    color: string,
    label: string
  ) => {
    const headLength = 12
    const dx = toX - fromX
    const dy = toY - fromY
    const angle = Math.atan2(dy, dx)
    const len = Math.hypot(dx, dy)

    ctx.save()
    ctx.strokeStyle = color
    ctx.fillStyle = color
    ctx.lineWidth = 2.5
    ctx.lineCap = "round"

    // Line
    ctx.beginPath()
    ctx.moveTo(fromX, fromY)
    ctx.lineTo(toX, toY)
    ctx.stroke()

    // Arrowhead
    if (len > 8) {
      ctx.beginPath()
      ctx.moveTo(toX, toY)
      ctx.lineTo(
        toX - headLength * Math.cos(angle - Math.PI / 6),
        toY - headLength * Math.sin(angle - Math.PI / 6)
      )
      ctx.lineTo(
        toX - headLength * Math.cos(angle + Math.PI / 6),
        toY - headLength * Math.sin(angle + Math.PI / 6)
      )
      ctx.closePath()
      ctx.fill()
    }

    // Handle circle for dragging
    ctx.beginPath()
    ctx.arc(toX, toY, 5, 0, Math.PI * 2)
    ctx.fill()

    // Label
    ctx.font = "bold 12px sans-serif"
    ctx.fillStyle = color
    const offset = 14
    ctx.fillText(label, toX + offset * Math.cos(angle), toY + offset * Math.sin(angle) + 4)
    ctx.restore()
  }

  // Render canvas
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    const width = rect.width || 480
    const height = rect.height || 320

    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr
      canvas.height = height * dpr
    }

    ctx.save()
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, width, height)

    const cx = width / 2
    const cy = height / 2
    const scale = 36 // pixels per unit

    // Subtle background
    ctx.fillStyle = "#0c0e14"
    ctx.fillRect(0, 0, width, height)

    // Draw deformed grid
    ctx.strokeStyle = "rgba(148, 163, 184, 0.12)"
    ctx.lineWidth = 1
    const gridRange = 6
    for (let x = -gridRange; x <= gridRange; x++) {
      // Lines of constant x (varying y)
      const x1 = cx + (x * a - gridRange * b) * scale
      const y1 = cy - (x * c - gridRange * d) * scale
      const x2 = cx + (x * a + gridRange * b) * scale
      const y2 = cy - (x * c + gridRange * d) * scale
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.stroke()

      // Lines of constant y (varying x)
      const y1_x = cx + (-gridRange * a + x * b) * scale
      const y1_y = cy - (-gridRange * c + x * d) * scale
      const y2_x = cx + (gridRange * a + x * b) * scale
      const y2_y = cy - (gridRange * c + x * d) * scale
      ctx.beginPath()
      ctx.moveTo(y1_x, y1_y)
      ctx.lineTo(y2_x, y2_y)
      ctx.stroke()
    }

    // Standard Cartesian Reference Axes
    ctx.strokeStyle = "rgba(100, 116, 139, 0.4)"
    ctx.lineWidth = 1.5
    ctx.setLineDash([3, 3])
    ctx.beginPath()
    ctx.moveTo(0, cy)
    ctx.lineTo(width, cy)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(cx, 0)
    ctx.lineTo(cx, height)
    ctx.stroke()
    ctx.setLineDash([])

    // Origin point
    ctx.fillStyle = "rgba(148, 163, 184, 0.6)"
    ctx.beginPath()
    ctx.arc(cx, cy, 3, 0, Math.PI * 2)
    ctx.fill()

    // Parallelogram of transformed unit square
    const p0x = cx, p0y = cy
    const p1x = cx + a * scale, p1y = cy - c * scale
    const p2x = cx + (a + b) * scale, p2y = cy - (c + d) * scale
    const p3x = cx + b * scale, p3y = cy - d * scale

    ctx.beginPath()
    ctx.moveTo(p0x, p0y)
    ctx.lineTo(p1x, p1y)
    ctx.lineTo(p2x, p2y)
    ctx.lineTo(p3x, p3y)
    ctx.closePath()

    if (Math.abs(det) < 0.05) {
      // Degenerate (flat) line
      ctx.strokeStyle = "rgba(239, 68, 68, 0.8)"
      ctx.lineWidth = 3
      ctx.stroke()
    } else if (det > 0) {
      // Standard orientation: pleasant cyan-blue
      ctx.fillStyle = "rgba(56, 189, 248, 0.22)"
      ctx.fill()
      ctx.strokeStyle = "rgba(56, 189, 248, 0.6)"
      ctx.lineWidth = 1.5
      ctx.stroke()
    } else {
      // Inverted orientation: reddish/amber
      ctx.fillStyle = "rgba(244, 63, 94, 0.22)"
      ctx.fill()
      ctx.strokeStyle = "rgba(244, 63, 94, 0.6)"
      ctx.lineWidth = 1.5
      ctx.stroke()
    }

    // Basis Vector 1: T(i) = (a, c) (Red)
    drawArrow(ctx, cx, cy, p1x, p1y, "#f43f5e", "T(i)")

    // Basis Vector 2: T(j) = (b, d) (Emerald)
    drawArrow(ctx, cx, cy, p3x, p3y, "#10b981", "T(j)")

    ctx.restore()
  }, [a, b, c, d, det])

  useEffect(() => {
    renderCanvas()
  }, [renderCanvas])

  // Mouse interaction: direct manipulation of vectors on canvas
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const cx = rect.width / 2
    const cy = rect.height / 2
    const scale = 36

    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top

    const p1x = cx + a * scale
    const p1y = cy - c * scale
    const p2x = cx + b * scale
    const p2y = cy - d * scale

    const dist1 = Math.hypot(mx - p1x, my - p1y)
    const dist2 = Math.hypot(mx - p2x, my - p2y)

    if (dist1 <= 18) {
      setDraggingVector("v1")
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    } else if (dist2 <= 18) {
      setDraggingVector("v2")
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    }
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const cx = rect.width / 2
    const cy = rect.height / 2
    const scale = 36

    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top

    if (!draggingVector) {
      const p1x = cx + a * scale
      const p1y = cy - c * scale
      const p2x = cx + b * scale
      const p2y = cy - d * scale
      const dist1 = Math.hypot(mx - p1x, my - p1y)
      const dist2 = Math.hypot(mx - p2x, my - p2y)

      if (dist1 <= 18) setHoveredVector("v1")
      else if (dist2 <= 18) setHoveredVector("v2")
      else setHoveredVector(null)
      return
    }

    // Convert mouse coordinate back to cartesian (x, y)
    const rawX = (mx - cx) / scale
    const rawY = -(my - cy) / scale
    const clampedX = Math.max(-3, Math.min(3, Math.round(rawX * 10) / 10))
    const clampedY = Math.max(-3, Math.min(3, Math.round(rawY * 10) / 10))

    if (draggingVector === "v1") {
      setA(clampedX)
      setC(clampedY)
    } else if (draggingVector === "v2") {
      setB(clampedX)
      setD(clampedY)
    }
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (draggingVector) {
      try {
        ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
      } catch {}
      setDraggingVector(null)
    }
  }

  // Presets
  const applyPreset = (preset: "identity" | "rot45" | "shear" | "singular" | "reflection" | "scale") => {
    switch (preset) {
      case "identity":
        setA(1.0); setB(0.0); setC(0.0); setD(1.0); break
      case "rot45":
        setA(0.7); setB(-0.7); setC(0.7); setD(0.7); break
      case "shear":
        setA(1.0); setB(1.0); setC(0.0); setD(1.0); break
      case "singular":
        setA(1.0); setB(2.0); setC(0.5); setD(1.0); break
      case "reflection":
        setA(-1.0); setB(0.0); setC(0.0); setD(1.0); break
      case "scale":
        setA(1.5); setB(0.0); setC(0.0); setD(1.5); break
    }
  }

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Top Presets bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-1 border-b border-neutral-200 dark:border-neutral-800">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mr-1">Preset:</span>
          <Button variant="outline" size="sm" className="h-7 text-xs px-2.5" onClick={() => applyPreset("identity")}>
            Identità
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs px-2.5" onClick={() => applyPreset("rot45")}>
            Rotazione 45°
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs px-2.5" onClick={() => applyPreset("shear")}>
            Shear (Taglio)
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs px-2.5 text-amber-600 dark:text-amber-400" onClick={() => applyPreset("singular")}>
            Singolare (det=0)
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs px-2.5" onClick={() => applyPreset("reflection")}>
            Riflessione
          </Button>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs px-2 text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
          onClick={() => { setA(1.5); setB(0.5); setC(0.0); setD(1.2); }}
          title="Ripristina valori iniziali"
        >
          <RotateCcw className="h-3.5 w-3.5 mr-1" />
          Reset
        </Button>
      </div>

      {/* Main interactive area: Canvas + Controls */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Canvas Display */}
        <div className="lg:col-span-7 flex flex-col items-center">
          <div className="w-full relative rounded-xl overflow-hidden border border-neutral-800 shadow-inner bg-[#0c0e14]">
            <canvas
              ref={canvasRef}
              className={`w-full h-[300px] sm:h-[340px] block select-none ${
                draggingVector ? "cursor-grabbing" : hoveredVector ? "cursor-grab" : "cursor-crosshair"
              }`}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
            />
            {/* Direct manipulation tooltip overlay */}
            <div className="absolute bottom-2 left-2 pointer-events-none px-2 py-1 rounded bg-black/60 backdrop-blur-sm text-[10px] text-neutral-400 border border-white/5">
              💡 Trascina la punta dei vettori T(i) o T(j) direttamente sulla griglia
            </div>
          </div>
        </div>

        {/* Controls & Math metrics */}
        <div className="lg:col-span-5 space-y-4">
          {/* Live Matrix Block */}
          <div className="p-4 rounded-xl bg-neutral-50 dark:bg-neutral-900/60 border border-neutral-200 dark:border-neutral-800">
            <div className="text-xs font-medium text-neutral-500 mb-2">Matrice di Trasformazione A</div>
            <div className="flex items-center justify-center gap-3 py-1 font-mono">
              <span className="text-3xl font-light text-neutral-400 select-none">[</span>
              <div className="grid grid-cols-2 gap-x-5 gap-y-1 text-center">
                <span className="text-rose-500 font-semibold text-lg">{a >= 0 ? ` ${a.toFixed(2)}` : a.toFixed(2)}</span>
                <span className="text-emerald-500 font-semibold text-lg">{b >= 0 ? ` ${b.toFixed(2)}` : b.toFixed(2)}</span>
                <span className="text-rose-500 font-semibold text-lg">{c >= 0 ? ` ${c.toFixed(2)}` : c.toFixed(2)}</span>
                <span className="text-emerald-500 font-semibold text-lg">{d >= 0 ? ` ${d.toFixed(2)}` : d.toFixed(2)}</span>
              </div>
              <span className="text-3xl font-light text-neutral-400 select-none">]</span>
            </div>
            <div className="flex justify-between text-[11px] text-neutral-400 mt-2 px-6">
              <span className="text-rose-500/80">Colonna 1: T(î)</span>
              <span className="text-emerald-500/80">Colonna 2: T(ĵ)</span>
            </div>
          </div>

          {/* Determinant badge & explanation */}
          <div className="p-3.5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-neutral-600 dark:text-neutral-400">
                Determinante det(A) = ad - bc
              </span>
              <span className="font-mono text-base font-bold text-neutral-900 dark:text-neutral-50">
                {det.toFixed(2)}
              </span>
            </div>

            {Math.abs(det) < 0.05 ? (
              <div className="flex items-start gap-2 p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-xs">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold block">⚠️ Collasso Dimensionale (det = 0)</span>
                  I vettori sono linearmente dipendenti. L'area si è ridotta a zero: la matrice ha rango 1 (non invertibile).
                </div>
              </div>
            ) : det < 0 ? (
              <div className="flex items-start gap-2 p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-xs">
                <RefreshCw className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold block">Inversione di Orientamento (det &lt; 0)</span>
                  Lo spazio 2D è stato riflesso. L'area orientata del parallelogramma ha cambiato segno.
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2 p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs">
                <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold block">Orientamento Preservato (det &gt; 0)</span>
                  L'area unitaria è scalata esattamente di un fattore |det| = {Math.abs(det).toFixed(2)}.
                </div>
              </div>
            )}
          </div>

          {/* Interactive Sliders */}
          {showControls && (
            <div className="space-y-2.5 pt-1">
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="font-medium text-rose-500">T(î).x (a)</span>
                  <span className="font-mono text-neutral-500">{a.toFixed(1)}</span>
                </div>
                <input
                  type="range"
                  min="-3"
                  max="3"
                  step="0.1"
                  value={a}
                  onChange={(e) => setA(parseFloat(e.target.value))}
                  className="w-full accent-rose-500 h-1.5 bg-neutral-200 dark:bg-neutral-800 rounded-lg cursor-pointer"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="font-medium text-rose-500">T(î).y (c)</span>
                  <span className="font-mono text-neutral-500">{c.toFixed(1)}</span>
                </div>
                <input
                  type="range"
                  min="-3"
                  max="3"
                  step="0.1"
                  value={c}
                  onChange={(e) => setC(parseFloat(e.target.value))}
                  className="w-full accent-rose-500 h-1.5 bg-neutral-200 dark:bg-neutral-800 rounded-lg cursor-pointer"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="font-medium text-emerald-500">T(ĵ).x (b)</span>
                  <span className="font-mono text-neutral-500">{b.toFixed(1)}</span>
                </div>
                <input
                  type="range"
                  min="-3"
                  max="3"
                  step="0.1"
                  value={b}
                  onChange={(e) => setB(parseFloat(e.target.value))}
                  className="w-full accent-emerald-500 h-1.5 bg-neutral-200 dark:bg-neutral-800 rounded-lg cursor-pointer"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="font-medium text-emerald-500">T(ĵ).y (d)</span>
                  <span className="font-mono text-neutral-500">{d.toFixed(1)}</span>
                </div>
                <input
                  type="range"
                  min="-3"
                  max="3"
                  step="0.1"
                  value={d}
                  onChange={(e) => setD(parseFloat(e.target.value))}
                  className="w-full accent-emerald-500 h-1.5 bg-neutral-200 dark:bg-neutral-800 rounded-lg cursor-pointer"
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
