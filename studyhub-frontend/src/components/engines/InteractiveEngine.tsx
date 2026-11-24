import React, { useState } from "react"
import { Card, CardHeader, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Linear2DEngine } from "./Linear2DEngine"
import { PoleZeroEngine } from "./PoleZeroEngine"
import { VectorFieldEngine } from "./VectorFieldEngine"
import { CircuitSimEngine } from "./CircuitSimEngine"
import type { InteractiveEngineProps } from "./types"
import { Grid3X3, Radio, Compass, Zap, SlidersHorizontal } from "lucide-react"

export function InteractiveEngine({
  type,
  title,
  description,
  initialConfig = {},
  className = "",
  showControls = true,
}: InteractiveEngineProps) {
  const [controlsVisible, setControlsVisible] = useState(showControls)

  // Engine metadata defaults
  const getMetadata = () => {
    switch (type) {
      case "linear_2d":
        return {
          defaultTitle: "Laboratorio: Trasformazioni Lineari 2D & Determinante",
          defaultDesc: "Manipola i vettori di base e osserva la deformazione dell'area dello spazio vettoriale.",
          discipline: "Algebra Lineare",
          badgeVariant: "accent" as const,
          icon: Grid3X3,
        }
      case "pole_zero":
        return {
          defaultTitle: "Laboratorio: Poli nel Piano Complesso s & Risposta al Gradino",
          defaultDesc: "Esplora la stabilità asintotica dei sistemi robotici e dinamici tramite posizione dei poli.",
          discipline: "Sistemi di Controllo",
          badgeVariant: "warning" as const,
          icon: Radio,
        }
      case "vector_field":
        return {
          defaultTitle: "Laboratorio: Campi Vettoriali, Flusso e Rotore",
          defaultDesc: "Simulazione particellare lungo le linee di flusso del campo vettoriale con sonda di traiettoria.",
          discipline: "Analisi 2 & Fisica",
          badgeVariant: "success" as const,
          icon: Compass,
        }
      case "circuit_sim":
        return {
          defaultTitle: "Laboratorio: Amplificatore Operazionale Invertente",
          defaultDesc: "Schema circuitale interattivo e oscilloscopio a doppio canale con clipping di saturazione.",
          discipline: "Elettronica Analogica",
          badgeVariant: "secondary" as const,
          icon: Zap,
        }
    }
  }

  const meta = getMetadata()
  const displayTitle = title || meta.defaultTitle
  const displayDesc = description || meta.defaultDesc
  const IconComponent = meta.icon

  return (
    <Card className={`overflow-hidden border border-neutral-200 dark:border-neutral-800 shadow-sm transition-all duration-200 ${className}`}>
      {/* Header */}
      <CardHeader className="p-4 sm:p-5 border-b border-neutral-200/80 dark:border-neutral-800/80 bg-neutral-50/50 dark:bg-neutral-900/50">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-xl bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 shadow-xs text-neutral-800 dark:text-neutral-100">
              <IconComponent className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-base text-neutral-950 dark:text-neutral-50">
                  {displayTitle}
                </h3>
                <Badge variant={meta.badgeVariant} className="text-[10px] py-0 px-2 font-medium">
                  {meta.discipline}
                </Badge>
              </div>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
                {displayDesc}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-center">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs px-2.5 gap-1.5"
              onClick={() => setControlsVisible(!controlsVisible)}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              <span>{controlsVisible ? "Nascondi Slider" : "Mostra Slider"}</span>
            </Button>
          </div>
        </div>
      </CardHeader>

      {/* Engine Body */}
      <CardContent className="p-4 sm:p-5">
        {type === "linear_2d" && (
          <Linear2DEngine config={initialConfig} showControls={controlsVisible} />
        )}
        {type === "pole_zero" && (
          <PoleZeroEngine config={initialConfig} showControls={controlsVisible} />
        )}
        {type === "vector_field" && (
          <VectorFieldEngine config={initialConfig} showControls={controlsVisible} />
        )}
        {type === "circuit_sim" && (
          <CircuitSimEngine config={initialConfig} showControls={controlsVisible} />
        )}
      </CardContent>
    </Card>
  )
}
