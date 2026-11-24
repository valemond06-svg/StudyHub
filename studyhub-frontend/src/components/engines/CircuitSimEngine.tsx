import React, { useState, useRef, useEffect } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { AlertTriangle, CheckCircle2, RotateCcw, Play, Pause, Activity } from "lucide-react"
import type { CircuitSimEngineProps } from "./types"

export function CircuitSimEngine({ config = {}, className = "", showControls = true }: CircuitSimEngineProps) {
  const [r1, setR1] = useState<number>(config.r1 ?? 10) // kOhm
  const [r2, setR2] = useState<number>(config.r2 ?? 50) // kOhm
  const [vin, setVin] = useState<number>(config.vin ?? 1.2) // Volt
  const [vsat, setVsat] = useState<number>(config.vsat ?? 12.0) // Volt
  const [mode, setMode] = useState<"ac" | "dc">(config.mode ?? "ac")
  const [frequency, setFrequency] = useState<number>(config.acFrequency ?? 2.0) // Hz
  const [isPlaying, setIsPlaying] = useState<boolean>(true)

  const oscCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const animFrameRef = useRef<number | null>(null)
  const timeRef = useRef<number>(0)

  // Circuit calculations
  const gain = -r2 / r1
  const voutIdeal = gain * vin
  const isSaturated = Math.abs(voutIdeal) > vsat
  const voutClipped = isSaturated ? (voutIdeal > 0 ? vsat : -vsat) : voutIdeal
  const currentIn = (vin / (r1 * 1000)) * 1e6 // microAmperes

  // Real-time animated oscilloscope
  useEffect(() => {
    const canvas = oscCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    let lastTimestamp = performance.now()

    const renderOscilloscope = (now: number) => {
      const dt = Math.min((now - lastTimestamp) / 1000, 0.05)
      lastTimestamp = now

      if (isPlaying) {
        timeRef.current += dt
      }

      const dpr = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      const width = rect.width || 460
      const height = rect.height || 220

      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr
        canvas.height = height * dpr
        ctx.scale(dpr, dpr)
      }

      // Clear with oscilloscope phosphor-dark background
      ctx.fillStyle = "#07090e"
      ctx.fillRect(0, 0, width, height)

      const cy = height / 2

      // Draw Oscilloscope Graticule (Grid)
      ctx.strokeStyle = "rgba(30, 41, 59, 0.8)"
      ctx.lineWidth = 1

      const numDivsX = 10
      const numDivsY = 8
      const stepX = width / numDivsX
      const stepY = height / numDivsY

      for (let i = 1; i < numDivsX; i++) {
        const x = i * stepX
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, height)
        ctx.stroke()
      }
      for (let j = 1; j < numDivsY; j++) {
        const y = j * stepY
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(width, y)
        ctx.stroke()
      }

      // Center crosshairs (dotted)
      ctx.strokeStyle = "rgba(56, 189, 248, 0.25)"
      ctx.setLineDash([2, 2])
      ctx.beginPath()
      ctx.moveTo(0, cy)
      ctx.lineTo(width, cy)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(width / 2, 0)
      ctx.lineTo(width / 2, height)
      ctx.stroke()
      ctx.setLineDash([])

      // Saturation Rails Indicators (+Vsat, -Vsat)
      const scaleV = (height / 2 - 20) / (vsat * 1.3)
      const railTop = cy - vsat * scaleV
      const railBottom = cy + vsat * scaleV

      ctx.strokeStyle = "rgba(239, 68, 68, 0.4)"
      ctx.setLineDash([4, 4])
      ctx.beginPath()
      ctx.moveTo(0, railTop)
      ctx.lineTo(width, railTop)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(0, railBottom)
      ctx.lineTo(width, railBottom)
      ctx.stroke()
      ctx.setLineDash([])

      ctx.fillStyle = "rgba(239, 68, 68, 0.7)"
      ctx.font = "9px monospace"
      ctx.fillText(`+Vsat (+${vsat.toFixed(0)}V)`, width - 75, railTop - 3)
      ctx.fillText(`-Vsat (-${vsat.toFixed(0)}V)`, width - 75, railBottom + 11)

      // Timebase setup: window spans 2 periods of frequency
      const period = 1 / Math.max(0.1, frequency)
      const timeWindow = mode === "ac" ? period * 2 : 2.0
      const t0 = timeRef.current

      // Channel 1: Vin(t) (Sky Blue)
      ctx.strokeStyle = "#38bdf8"
      ctx.lineWidth = 2
      ctx.beginPath()
      for (let x = 0; x < width; x += 2) {
        const t = (x / width) * timeWindow
        const v = mode === "ac" ? vin * Math.sin(2 * Math.PI * frequency * (t0 + t)) : vin
        const y = cy - v * scaleV
        if (x === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()

      // Channel 2: Vout(t) (Inverted with saturation clipping) (Rose/Amber)
      ctx.strokeStyle = isSaturated ? "#f43f5e" : "#10b981"
      ctx.lineWidth = 2.5
      ctx.beginPath()
      for (let x = 0; x < width; x += 2) {
        const t = (x / width) * timeWindow
        let v =
          mode === "ac"
            ? gain * vin * Math.sin(2 * Math.PI * frequency * (t0 + t))
            : gain * vin
        // Non-linear clipping
        if (v > vsat) v = vsat
        else if (v < -vsat) v = -vsat

        const y = cy - v * scaleV
        if (x === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()

      // Legend in top-left
      ctx.font = "bold 10px monospace"
      ctx.fillStyle = "#38bdf8"
      ctx.fillText(`CH1 Vin: ${mode === "ac" ? `${vin.toFixed(1)} Vpk` : `${vin.toFixed(1)} V`}`, 10, 16)
      ctx.fillStyle = isSaturated ? "#f43f5e" : "#10b981"
      ctx.fillText(
        `CH2 Vout: ${mode === "ac" ? `${Math.abs(voutClipped).toFixed(1)} Vpk` : `${voutClipped.toFixed(1)} V`} ${
          isSaturated ? "[CLIPPING SATURAZIONE]" : ""
        }`,
        10,
        30
      )

      animFrameRef.current = requestAnimationFrame(renderOscilloscope)
    }

    animFrameRef.current = requestAnimationFrame(renderOscilloscope)

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current)
      }
    }
  }, [gain, vin, vsat, mode, frequency, isPlaying, isSaturated, voutClipped])

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Preset / Mode bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-1 border-b border-neutral-200 dark:border-neutral-800">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mr-1">Modalità:</span>
          <Button
            variant={mode === "ac" ? "default" : "outline"}
            size="sm"
            className="h-7 text-xs px-2.5"
            onClick={() => setMode("ac")}
          >
            AC (Onda Sinusoidale)
          </Button>
          <Button
            variant={mode === "dc" ? "default" : "outline"}
            size="sm"
            className="h-7 text-xs px-2.5"
            onClick={() => setMode("dc")}
          >
            DC (Tensione Continua)
          </Button>
        </div>

        <div className="flex items-center gap-1.5">
          {mode === "ac" && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs px-2"
              onClick={() => setIsPlaying(!isPlaying)}
            >
              {isPlaying ? <Pause className="h-3.5 w-3.5 mr-1" /> : <Play className="h-3.5 w-3.5 mr-1" />}
              {isPlaying ? "Congela" : "Avvia"}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs px-2 text-neutral-500"
            onClick={() => {
              setR1(10)
              setR2(50)
              setVin(1.2)
              setVsat(12.0)
            }}
          >
            <RotateCcw className="h-3.5 w-3.5 mr-1" />
            Reset
          </Button>
        </div>
      </div>

      {/* Gain & Saturation Status Banner */}
      <div className="p-3.5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {!isSaturated ? (
              <Badge variant="success" className="gap-1.5 py-1 px-3 text-xs font-semibold">
                <CheckCircle2 className="h-4 w-4" />
                REGIONE LINEARE (|Vout| ≤ Vsat)
              </Badge>
            ) : (
              <Badge variant="destructive" className="gap-1.5 py-1 px-3 text-xs font-semibold">
                <AlertTriangle className="h-4 w-4" />
                SATURAZIONE RAILS ALIMENTAZIONE (|Vout| &gt; {vsat}V)
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-4 text-xs font-mono text-neutral-500">
            <span>Guadagno Av = <b className="text-neutral-900 dark:text-neutral-100">{gain.toFixed(2)}x (Inverte 180°)</b></span>
            <span>Vout = <b className={isSaturated ? "text-rose-500" : "text-emerald-500"}>{voutClipped.toFixed(2)} V</b></span>
          </div>
        </div>

        <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-2">
          {!isSaturated
            ? "Massa virtuale verificata: poiché il guadagno ad anello aperto A_OL → ∞, il morsetto invertente V⁻ è bloccato a 0V (V⁻ = V⁺ = 0V). L'uscita è fedele e scalata perfettamente."
            : `Attenzione: l'uscita richiesta (${voutIdeal.toFixed(2)}V) eccede le tensioni dei rail di alimentazione (±${vsat}V). La forma d'onda subisce clipping orizzontale, generando distorsione armonica.`}
        </p>
      </div>

      {/* Main Dual View: Circuit Schematic SVG + Oscilloscope Canvas */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Schematic SVG */}
        <div className="lg:col-span-6 flex flex-col space-y-1.5">
          <div className="text-xs font-semibold text-neutral-600 dark:text-neutral-400">
            Schema Circuitale: Amplificatore Operazionale Invertente
          </div>
          <div className="w-full h-[240px] rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/40 p-3 flex items-center justify-center">
            <svg viewBox="0 0 320 180" className="w-full h-full max-h-[220px] select-none">
              {/* Op-Amp Triangle Body */}
              <polygon
                points="130,50 130,130 205,90"
                fill="currentColor"
                className="text-neutral-200 dark:text-neutral-800"
                stroke="currentColor"
                strokeWidth="2"
              />

              {/* Inverting input (-) and Non-inverting input (+) */}
              <text x="136" y="74" fontSize="13" fontWeight="bold" fill="#ef4444">-</text>
              <text x="136" y="114" fontSize="13" fontWeight="bold" fill="#10b981">+</text>

              {/* Non-inverting (+) connected to Ground */}
              <line x1="110" y1="110" x2="130" y2="110" stroke="currentColor" strokeWidth="2" />
              <line x1="110" y1="110" x2="110" y2="135" stroke="currentColor" strokeWidth="2" />
              {/* Ground symbol */}
              <line x1="100" y1="135" x2="120" y2="135" stroke="currentColor" strokeWidth="2" />
              <line x1="103" y1="139" x2="117" y2="139" stroke="currentColor" strokeWidth="2" />
              <line x1="106" y1="143" x2="114" y2="143" stroke="currentColor" strokeWidth="2" />
              <text x="100" y="156" fontSize="9" fill="gray">0V (GND)</text>

              {/* Input wire from Vin to R1 */}
              <circle cx="20" cy="70" r="4" fill="#38bdf8" />
              <text x="10" y="60" fontSize="10" fontWeight="bold" fill="#38bdf8">Vin</text>
              <line x1="24" y1="70" x2="50" y2="70" stroke="currentColor" strokeWidth="2" />

              {/* Resistor R1 */}
              <rect x="50" y="63" width="35" height="14" rx="2" fill="#38bdf8" fillOpacity="0.15" stroke="#38bdf8" strokeWidth="1.5" />
              <text x="56" y="74" fontSize="9" fontWeight="bold" fill="#38bdf8">R₁</text>
              <text x="46" y="92" fontSize="9" fill="gray">{r1} kΩ</text>

              {/* Wire from R1 to Inverting node V- */}
              <line x1="85" y1="70" x2="130" y2="70" stroke="currentColor" strokeWidth="2" />
              <circle cx="108" cy="70" r="3" fill="#ef4444" />
              <text x="96" y="63" fontSize="8" fill="#ef4444">V⁻ = 0V</text>

              {/* Feedback Loop with R2 */}
              <line x1="108" y1="70" x2="108" y2="25" stroke="currentColor" strokeWidth="2" />
              <line x1="108" y1="25" x2="145" y2="25" stroke="currentColor" strokeWidth="2" />

              {/* Resistor R2 */}
              <rect x="145" y="18" width="45" height="14" rx="2" fill="#f59e0b" fillOpacity="0.15" stroke="#f59e0b" strokeWidth="1.5" />
              <text x="156" y="29" fontSize="9" fontWeight="bold" fill="#f59e0b">R₂ (Rf)</text>
              <text x="146" y="44" fontSize="9" fill="gray">{r2} kΩ</text>

              <line x1="190" y1="25" x2="230" y2="25" stroke="currentColor" strokeWidth="2" />
              <line x1="230" y1="25" x2="230" y2="90" stroke="currentColor" strokeWidth="2" />

              {/* Output Wire from Op-Amp to Vout */}
              <line x1="205" y1="90" x2="270" y2="90" stroke="currentColor" strokeWidth="2" />
              <circle cx="230" cy="90" r="3" fill="currentColor" />
              <circle cx="270" cy="90" r="4" fill={isSaturated ? "#f43f5e" : "#10b981"} />
              <text x="278" y="94" fontSize="11" fontWeight="bold" fill={isSaturated ? "#f43f5e" : "#10b981"}>
                Vout
              </text>
              <text x="260" y="110" fontSize="9" fill="gray">{voutClipped.toFixed(1)}V</text>

              {/* Power supply rails annotation */}
              <text x="150" y="62" fontSize="8" fill="gray">+Vsat (+{vsat}V)</text>
              <text x="150" y="125" fontSize="8" fill="gray">-Vsat (-{vsat}V)</text>
            </svg>
          </div>
        </div>

        {/* Oscilloscope Canvas */}
        <div className="lg:col-span-6 flex flex-col space-y-1.5">
          <div className="flex items-center justify-between text-xs font-semibold text-neutral-600 dark:text-neutral-400">
            <div className="flex items-center gap-1.5">
              <Activity className="h-3.5 w-3.5 text-sky-500" />
              <span>Oscilloscopio Laboratorio (Real-Time)</span>
            </div>
            <span className="font-mono text-[11px] text-neutral-400">
              Iin = {currentIn.toFixed(1)} µA
            </span>
          </div>
          <div className="w-full relative rounded-xl overflow-hidden border border-neutral-800 bg-[#07090e]">
            <canvas ref={oscCanvasRef} className="w-full h-[240px] block select-none" />
          </div>
        </div>
      </div>

      {/* Sliders and Controls */}
      {showControls && (
        <div className="p-4 rounded-xl bg-neutral-50 dark:bg-neutral-900/60 border border-neutral-200 dark:border-neutral-800 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="space-y-1">
            <div className="flex justify-between text-xs font-medium">
              <span className="text-neutral-600 dark:text-neutral-400">Tensione Vin {mode === "ac" ? "(Ampiezza)" : ""}</span>
              <span className="font-mono text-neutral-900 dark:text-neutral-100">{vin.toFixed(1)} V</span>
            </div>
            <input
              type="range"
              min={mode === "ac" ? "0.1" : "-5.0"}
              max="5.0"
              step="0.1"
              value={vin}
              onChange={(e) => setVin(parseFloat(e.target.value))}
              className="w-full accent-sky-500 h-1.5 bg-neutral-200 dark:bg-neutral-800 rounded-lg cursor-pointer"
            />
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-xs font-medium">
              <span className="text-neutral-600 dark:text-neutral-400">Resistenza R₁ (Ingresso)</span>
              <span className="font-mono text-neutral-900 dark:text-neutral-100">{r1} kΩ</span>
            </div>
            <input
              type="range"
              min="1"
              max="50"
              step="1"
              value={r1}
              onChange={(e) => setR1(parseInt(e.target.value, 10))}
              className="w-full accent-sky-500 h-1.5 bg-neutral-200 dark:bg-neutral-800 rounded-lg cursor-pointer"
            />
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-xs font-medium">
              <span className="text-neutral-600 dark:text-neutral-400">Resistenza R₂ (Feedback)</span>
              <span className="font-mono text-neutral-900 dark:text-neutral-100">{r2} kΩ</span>
            </div>
            <input
              type="range"
              min="5"
              max="250"
              step="5"
              value={r2}
              onChange={(e) => setR2(parseInt(e.target.value, 10))}
              className="w-full accent-amber-500 h-1.5 bg-neutral-200 dark:bg-neutral-800 rounded-lg cursor-pointer"
            />
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-xs font-medium">
              <span className="text-neutral-600 dark:text-neutral-400">Rails Alimentazione ±Vsat</span>
              <span className="font-mono text-neutral-900 dark:text-neutral-100">±{vsat.toFixed(0)} V</span>
            </div>
            <input
              type="range"
              min="5"
              max="18"
              step="1"
              value={vsat}
              onChange={(e) => setVsat(parseInt(e.target.value, 10))}
              className="w-full accent-rose-500 h-1.5 bg-neutral-200 dark:bg-neutral-800 rounded-lg cursor-pointer"
            />
          </div>

          {mode === "ac" && (
            <div className="space-y-1 sm:col-span-2 lg:col-span-4 pt-2 border-t border-neutral-200 dark:border-neutral-800">
              <div className="flex justify-between text-xs font-medium">
                <span className="text-neutral-600 dark:text-neutral-400">Frequenza AC Segnale</span>
                <span className="font-mono text-neutral-900 dark:text-neutral-100">{frequency.toFixed(1)} Hz</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="5.0"
                step="0.5"
                value={frequency}
                onChange={(e) => setFrequency(parseFloat(e.target.value))}
                className="w-full accent-sky-500 h-1.5 bg-neutral-200 dark:bg-neutral-800 rounded-lg cursor-pointer"
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
