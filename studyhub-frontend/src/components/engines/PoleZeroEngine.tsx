import React, { useState, useRef, useEffect, useCallback } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { CheckCircle2, AlertTriangle, XCircle, RotateCcw } from "lucide-react"
import type { PoleZeroEngineProps } from "./types"

export function PoleZeroEngine({ config = {}, className = "", showControls = true }: PoleZeroEngineProps) {
  // sigma: attenuation factor where pole Re(s) = -sigma.
  // When sigma > 0, Re(s) < 0 (LHP, stable).
  // When sigma < 0, Re(s) > 0 (RHP, unstable).
  const [sigma, setSigma] = useState<number>(config.sigma ?? 0.8)
  const [omega, setOmega] = useState<number>(config.omega ?? 2.8)
  const [hasZero, setHasZero] = useState<boolean>(false)
  const [zeroReal, setZeroReal] = useState<number>(2.0) // Zero at s = -zeroReal

  const sPlaneCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const timeCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const [isDraggingPole, setIsDraggingPole] = useState<boolean>(false)

  // System dynamic calculations
  const wn = Math.hypot(sigma, omega) // natural frequency
  const zeta = wn > 0.001 ? sigma / wn : 0 // damping ratio
  const isLHP = sigma > 0.05
  const isMarginal = Math.abs(sigma) <= 0.05
  const isRHP = sigma < -0.05

  // Settling time (2% criterion) ~ 4 / sigma (if stable)
  const settlingTime = isLHP ? (4 / sigma).toFixed(2) : "∞"
  // Overshoot percentage
  const overshoot =
    zeta > 0 && zeta < 1
      ? (100 * Math.exp((-Math.PI * zeta) / Math.sqrt(1 - zeta * zeta))).toFixed(1)
      : zeta >= 1
      ? "0.0"
      : "∞"

  // 1. Draw S-Plane
  const renderSPlane = useCallback(() => {
    const canvas = sPlaneCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    const width = rect.width || 240
    const height = rect.height || 260

    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr
      canvas.height = height * dpr
    }

    ctx.save()
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, width, height)

    const cx = width / 2
    const cy = height / 2
    const scale = 26 // px per unit

    // Background: LHP (Left Half Plane, Re < 0) vs RHP (Right Half Plane, Re > 0)
    // In our plane, Left of cx is Re < 0 (Stable LHP)
    ctx.fillStyle = "rgba(34, 197, 94, 0.10)"
    ctx.fillRect(0, 0, cx, height)

    ctx.fillStyle = "rgba(239, 68, 68, 0.10)"
    ctx.fillRect(cx, 0, width - cx, height)

    // Axes
    ctx.strokeStyle = "rgba(148, 163, 184, 0.4)"
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(0, cy)
    ctx.lineTo(width, cy)
    ctx.stroke()

    // Imaginary Axis (jω axis)
    ctx.strokeStyle = "rgba(99, 102, 241, 0.5)"
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(cx, 0)
    ctx.lineTo(cx, height)
    ctx.stroke()

    // Axis Labels
    ctx.font = "10px sans-serif"
    ctx.fillStyle = "rgba(148, 163, 184, 0.8)"
    ctx.fillText("Re(s)", width - 34, cy - 6)
    ctx.fillText("+jω", cx + 6, 14)
    ctx.fillText("-jω", cx + 6, height - 6)

    // LHP / RHP indicators
    ctx.font = "9px sans-serif"
    ctx.fillStyle = "rgba(34, 197, 94, 0.6)"
    ctx.fillText("LHP (Stabile)", 10, 16)
    ctx.fillStyle = "rgba(239, 68, 68, 0.6)"
    ctx.fillText("RHP (Instabile)", cx + 10, 16)

    // Draw Pole (x)
    // Pole location: real part is -sigma, imaginary part is +omega and -omega
    const px = cx - sigma * scale
    const py1 = cy - omega * scale
    const py2 = cy + omega * scale

    const drawPoleX = (x: number, y: number) => {
      ctx.strokeStyle = isLHP ? "#10b981" : isMarginal ? "#f59e0b" : "#ef4444"
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(x - 6, y - 6)
      ctx.lineTo(x + 6, y + 6)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(x + 6, y - 6)
      ctx.lineTo(x - 6, y + 6)
      ctx.stroke()
    }

    drawPoleX(px, py1)
    if (Math.abs(omega) > 0.05) {
      drawPoleX(px, py2)
    }

    // Draw Zero (o) if active
    if (hasZero) {
      const zx = cx - zeroReal * scale
      ctx.strokeStyle = "#38bdf8"
      ctx.lineWidth = 2.5
      ctx.beginPath()
      ctx.arc(zx, cy, 6, 0, Math.PI * 2)
      ctx.stroke()
      ctx.fillStyle = "#38bdf8"
      ctx.font = "bold 10px sans-serif"
      ctx.fillText("z₁", zx - 4, cy - 9)
    }

    // Pole labels
    ctx.fillStyle = isLHP ? "#10b981" : isMarginal ? "#f59e0b" : "#ef4444"
    ctx.font = "bold 11px monospace"
    ctx.fillText(`p₁ (-${sigma.toFixed(1)} + j${omega.toFixed(1)})`, Math.min(width - 95, Math.max(10, px + 8)), py1 - 4)

    ctx.restore()
  }, [sigma, omega, hasZero, zeroReal, isLHP, isMarginal])

  // 2. Draw Step Response y(t)
  const renderTimeResponse = useCallback(() => {
    const canvas = timeCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    const width = rect.width || 360
    const height = rect.height || 260

    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr
      canvas.height = height * dpr
    }

    ctx.save()
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, width, height)

    // Time axis mapping: t in [0, 6] seconds
    const tMax = 6.0
    const scaleX = (width - 45) / tMax
    const originX = 35
    const originY = height - 35
    const unitHeight = 80 // height for y = 1.0

    // Background
    ctx.fillStyle = "#0c0e14"
    ctx.fillRect(0, 0, width, height)

    // Grid lines
    ctx.strokeStyle = "rgba(148, 163, 184, 0.12)"
    ctx.lineWidth = 1
    for (let t = 1; t <= 5; t++) {
      const gx = originX + t * scaleX
      ctx.beginPath()
      ctx.moveTo(gx, 15)
      ctx.lineTo(gx, originY)
      ctx.stroke()
      ctx.fillStyle = "rgba(148, 163, 184, 0.5)"
      ctx.font = "9px monospace"
      ctx.fillText(`${t}s`, gx - 6, originY + 14)
    }

    // Baseline y=0
    ctx.strokeStyle = "rgba(148, 163, 184, 0.4)"
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(originX, originY)
    ctx.lineTo(width - 10, originY)
    ctx.stroke()

    // Reference Target y=1.0 (Dashed)
    const refY = originY - unitHeight
    ctx.strokeStyle = "rgba(56, 189, 248, 0.5)"
    ctx.setLineDash([4, 4])
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(originX, refY)
    ctx.lineTo(width - 10, refY)
    ctx.stroke()
    ctx.setLineDash([])

    // Target label
    ctx.fillStyle = "rgba(56, 189, 248, 0.8)"
    ctx.font = "10px sans-serif"
    ctx.fillText("y = 1.0 (Target)", originX + 8, refY - 5)

    // 2% tolerance band for settling time
    if (isLHP) {
      ctx.fillStyle = "rgba(34, 197, 94, 0.05)"
      ctx.fillRect(originX, refY - unitHeight * 0.02, width - originX - 10, unitHeight * 0.04)
    }

    // Step Response Curve
    const strokeColor = isLHP ? "#10b981" : isMarginal ? "#f59e0b" : "#ef4444"
    ctx.strokeStyle = strokeColor
    ctx.lineWidth = 2.5
    ctx.lineJoin = "round"
    ctx.beginPath()

    const dt = 0.02
    let started = false

    for (let t = 0; t <= tMax; t += dt) {
      let yt = 0

      if (Math.abs(omega) < 0.05) {
        // Real poles (overdamped or critically damped)
        yt = 1 - Math.exp(-sigma * t) * (1 + sigma * t)
      } else {
        // Underdamped complex conjugate poles
        const cosTerm = Math.cos(omega * t)
        const sinTerm = Math.sin(omega * t)
        const dampedSin = (sigma / (omega || 1)) * sinTerm
        yt = 1 - Math.exp(-sigma * t) * (cosTerm + dampedSin)
      }

      // If zero exists, add derivative influence: y_zero(t) = y(t) + (1/z) * dy/dt
      if (hasZero && Math.abs(zeroReal) > 0.1) {
        const dydt = Math.exp(-sigma * t) * (wn * wn / Math.max(0.1, omega)) * Math.sin(omega * t)
        yt += (1 / zeroReal) * dydt
      }

      // Clamp visual clipping to avoid drawing off the canvas
      const clampedYt = Math.max(-0.5, Math.min(2.5, yt))
      const px = originX + t * scaleX
      const py = originY - clampedYt * unitHeight

      if (!started) {
        ctx.moveTo(px, py)
        started = true
      } else {
        ctx.lineTo(px, py)
      }
    }
    ctx.stroke()

    // Y Axis label
    ctx.fillStyle = "rgba(148, 163, 184, 0.7)"
    ctx.font = "10px sans-serif"
    ctx.fillText("y(t)", 8, 20)
    ctx.fillText("0", 22, originY + 4)
    ctx.fillText("1", 22, refY + 4)
    ctx.fillText("2", 22, refY - unitHeight + 4)

    ctx.restore()
  }, [sigma, omega, hasZero, zeroReal, isLHP, isMarginal, wn])

  useEffect(() => {
    renderSPlane()
  }, [renderSPlane])

  useEffect(() => {
    renderTimeResponse()
  }, [renderTimeResponse])

  // Canvas interaction on S-Plane: click or drag to position pole
  const handleSPlanePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    setIsDraggingPole(true)
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    updatePoleFromPointer(e)
  }

  const handleSPlanePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDraggingPole) return
    updatePoleFromPointer(e)
  }

  const handleSPlanePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    setIsDraggingPole(false)
    try {
      ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
    } catch {}
  }

  const updatePoleFromPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = sPlaneCanvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const cx = rect.width / 2
    const cy = rect.height / 2
    const scale = 26

    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top

    // px = cx - sigma * scale  =>  sigma = (cx - mx) / scale
    // py = cy - omega * scale  =>  omega = Math.abs((cy - my) / scale)
    const rawSigma = (cx - mx) / scale
    const rawOmega = Math.abs((cy - my) / scale)

    const clampedSigma = Math.max(-1.5, Math.min(3.0, Math.round(rawSigma * 10) / 10))
    const clampedOmega = Math.max(0.0, Math.min(6.0, Math.round(rawOmega * 10) / 10))

    setSigma(clampedSigma)
    setOmega(clampedOmega)
  }

  // Presets
  const applyPreset = (preset: "standard" | "fast_oscillatory" | "critical" | "slow" | "oscillator" | "unstable") => {
    switch (preset) {
      case "standard":
        setSigma(1.4); setOmega(1.4); setHasZero(false); break
      case "fast_oscillatory":
        setSigma(0.5); setOmega(3.2); setHasZero(false); break
      case "critical":
        setSigma(2.0); setOmega(0.0); setHasZero(false); break
      case "slow":
        setSigma(0.6); setOmega(0.0); setHasZero(false); break
      case "oscillator":
        setSigma(0.0); setOmega(3.0); setHasZero(false); break
      case "unstable":
        setSigma(-0.6); setOmega(2.4); setHasZero(false); break
    }
  }

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Presets header */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-1 border-b border-neutral-200 dark:border-neutral-800">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mr-1">Preset:</span>
          <Button variant="outline" size="sm" className="h-7 text-xs px-2.5" onClick={() => applyPreset("standard")}>
            Ottimale (ζ ≈ 0.7)
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs px-2.5" onClick={() => applyPreset("fast_oscillatory")}>
            Sottosmorzato
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs px-2.5" onClick={() => applyPreset("critical")}>
            Critico (ζ = 1)
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs px-2.5 text-amber-600 dark:text-amber-400" onClick={() => applyPreset("oscillator")}>
            Oscillatore (ζ = 0)
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs px-2.5 text-rose-600 dark:text-rose-400" onClick={() => applyPreset("unstable")}>
            Instabile Divergente
          </Button>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs px-2 text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
          onClick={() => { setSigma(0.8); setOmega(2.8); setHasZero(false); }}
        >
          <RotateCcw className="h-3.5 w-3.5 mr-1" />
          Reset
        </Button>
      </div>

      {/* Stability Banner */}
      <div className="p-3.5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {isLHP ? (
              <Badge variant="success" className="gap-1.5 py-1 px-3 text-xs font-semibold">
                <CheckCircle2 className="h-4 w-4" />
                SISTEMA STABILE (Semipiano Sinistro LHP)
              </Badge>
            ) : isMarginal ? (
              <Badge variant="warning" className="gap-1.5 py-1 px-3 text-xs font-semibold">
                <AlertTriangle className="h-4 w-4" />
                SEMPLICEMENTE STABILE (Oscillatore Puro)
              </Badge>
            ) : (
              <Badge variant="destructive" className="gap-1.5 py-1 px-3 text-xs font-semibold">
                <XCircle className="h-4 w-4" />
                SISTEMA INSTABILE (Semipiano Destro RHP)
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-4 text-xs font-mono text-neutral-500">
            <span>Smorzamento ζ = <b className="text-neutral-900 dark:text-neutral-100">{zeta.toFixed(2)}</b></span>
            <span>Pulsazione ωₙ = <b className="text-neutral-900 dark:text-neutral-100">{wn.toFixed(2)} rad/s</b></span>
          </div>
        </div>

        <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-2">
          {isLHP && "I poli si trovano nel semipiano sinistro (Re < 0). I modi esponenziali e^(-σt) si estinguono e il robot o sistema raggiunge il riferimento desiderato in tempo finito."}
          {isMarginal && "I poli si trovano esattamente sull'asse immaginario (σ = 0). L'energia non viene dissipata: il sistema oscilla indefinitamente con frequenza costante senza mai fermarsi."}
          {isRHP && "I poli si trovano nel semipiano destro (Re > 0). I modi esponenziali divergono (e^+|σ|t): il sistema va in crash, gli attuatori saturano o la struttura entra in risonanza distruttiva."}
        </p>
      </div>

      {/* Dual Display: S-Plane & Step Response */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
        {/* S-Plane Canvas */}
        <div className="md:col-span-5 flex flex-col space-y-1.5">
          <div className="flex items-center justify-between text-xs font-semibold text-neutral-600 dark:text-neutral-400">
            <span>Piano Complesso s = -σ ± jω</span>
            <span className="text-[10px] text-neutral-400">Clicca/Trascina i poli</span>
          </div>
          <div className="w-full relative rounded-xl overflow-hidden border border-neutral-800 bg-[#0c0e14]">
            <canvas
              ref={sPlaneCanvasRef}
              className="w-full h-[240px] block cursor-crosshair select-none"
              onPointerDown={handleSPlanePointerDown}
              onPointerMove={handleSPlanePointerMove}
              onPointerUp={handleSPlanePointerUp}
              onPointerCancel={handleSPlanePointerUp}
            />
          </div>
        </div>

        {/* Step Response Canvas */}
        <div className="md:col-span-7 flex flex-col space-y-1.5">
          <div className="flex items-center justify-between text-xs font-semibold text-neutral-600 dark:text-neutral-400">
            <span>Risposta al Gradino Unitario y(t)</span>
            <div className="flex gap-3 text-[11px] font-mono">
              <span>Sovraelongazione: <b className="text-neutral-900 dark:text-neutral-100">{overshoot}%</b></span>
              <span>Tempo Assestamento: <b className="text-neutral-900 dark:text-neutral-100">{settlingTime}s</b></span>
            </div>
          </div>
          <div className="w-full relative rounded-xl overflow-hidden border border-neutral-800 bg-[#0c0e14]">
            <canvas
              ref={timeCanvasRef}
              className="w-full h-[240px] block select-none"
            />
          </div>
        </div>
      </div>

      {/* Sliders & Parameters */}
      {showControls && (
        <div className="p-4 rounded-xl bg-neutral-50 dark:bg-neutral-900/60 border border-neutral-200 dark:border-neutral-800 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <div className="flex justify-between text-xs font-medium">
                <span className="text-neutral-600 dark:text-neutral-400">Smorzamento σ (Parte Reale Polo: {-sigma.toFixed(1)})</span>
                <span className="font-mono text-neutral-900 dark:text-neutral-100">{sigma.toFixed(1)}</span>
              </div>
              <input
                type="range"
                min="-1.5"
                max="3.0"
                step="0.1"
                value={sigma}
                onChange={(e) => setSigma(parseFloat(e.target.value))}
                className="w-full accent-emerald-500 h-1.5 bg-neutral-200 dark:bg-neutral-800 rounded-lg cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-neutral-400">
                <span>-1.5 (Instabile RHP)</span>
                <span>0.0 (Asse jω)</span>
                <span>+3.0 (Super Stabile LHP)</span>
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-xs font-medium">
                <span className="text-neutral-600 dark:text-neutral-400">Pulsazione Oscillazione ω (Parte Immaginaria: ±{omega.toFixed(1)})</span>
                <span className="font-mono text-neutral-900 dark:text-neutral-100">{omega.toFixed(1)} rad/s</span>
              </div>
              <input
                type="range"
                min="0.0"
                max="6.0"
                step="0.2"
                value={omega}
                onChange={(e) => setOmega(parseFloat(e.target.value))}
                className="w-full accent-indigo-500 h-1.5 bg-neutral-200 dark:bg-neutral-800 rounded-lg cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-neutral-400">
                <span>0.0 (Reali Pura)</span>
                <span>3.0 (Oscillazioni Moderate)</span>
                <span>6.0 (Alta Frequenza)</span>
              </div>
            </div>
          </div>

          {/* Optional Zero toggle */}
          <div className="pt-2 border-t border-neutral-200 dark:border-neutral-800 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="zeroToggle"
                checked={hasZero}
                onChange={(e) => setHasZero(e.target.checked)}
                className="rounded accent-sky-500 cursor-pointer"
              />
              <label htmlFor="zeroToggle" className="cursor-pointer font-medium text-neutral-700 dark:text-neutral-300">
                Aggiungi Zero nel Piano Complesso z₁ (Aumenta sovraelongazione o introduce sottoelongazione)
              </label>
            </div>
            {hasZero && (
              <div className="flex items-center gap-2">
                <span className="text-neutral-500">Posizione Zero: -{zeroReal.toFixed(1)}</span>
                <input
                  type="range"
                  min="0.5"
                  max="5.0"
                  step="0.5"
                  value={zeroReal}
                  onChange={(e) => setZeroReal(parseFloat(e.target.value))}
                  className="w-28 accent-sky-500 h-1.5 bg-neutral-200 dark:bg-neutral-800 rounded cursor-pointer"
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
