export type EngineType = "linear_2d" | "pole_zero" | "vector_field" | "circuit_sim"

export interface BaseEngineProps {
  className?: string
  showControls?: boolean
}

// Linear 2D Engine Types
export interface Linear2DConfig {
  a?: number
  b?: number
  c?: number
  d?: number
}

export interface Linear2DEngineProps extends BaseEngineProps {
  config?: Linear2DConfig
}

// Pole-Zero Engine Types
export interface PoleZeroConfig {
  sigma?: number
  omega?: number
}

export interface PoleZeroEngineProps extends BaseEngineProps {
  config?: PoleZeroConfig
}

// Vector Field Engine Types
export type VectorFieldMode = "vortex" | "source" | "sink" | "saddle" | "sine" | "potential"

export interface VectorFieldConfig {
  mode?: VectorFieldMode
  speed?: number
  density?: number
}

export interface VectorFieldEngineProps extends BaseEngineProps {
  config?: VectorFieldConfig
}

// Circuit Sim Engine Types
export interface CircuitSimConfig {
  r1?: number // in kOhm
  r2?: number // in kOhm
  vin?: number // in Volt
  vsat?: number // in Volt (default 12)
  acFrequency?: number // in Hz
  mode?: "dc" | "ac"
}

export interface CircuitSimEngineProps extends BaseEngineProps {
  config?: CircuitSimConfig
}

// Interactive Engine Wrapper Props
export interface InteractiveEngineProps {
  type: EngineType
  title?: string
  description?: string
  initialConfig?: Record<string, any>
  className?: string
  showControls?: boolean
}
