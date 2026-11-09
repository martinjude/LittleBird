import { DEFAULT_BINDINGS, type AxisAction, type Bindings } from './bindings'

export type AssistMode = 'novice' | 'standard' | 'realistic'

export interface AxisTuning {
  /** 0 = linear, 1 = fully cubic (fine control near centre). Gamepad only. */
  expo: number
  sensitivity: number
}

export interface ControlsSettings {
  assist: AssistMode
  /** Radial deadzone applied to each gamepad stick. */
  stickDeadzone: number
  axes: Record<AxisAction, AxisTuning>
  /**
   * `rate`: stick deflection moves the collective lever, which stays put when released.
   * `absolute`: stick position is the lever position (centre = half collective).
   */
  gamepadCollective: 'rate' | 'absolute'
  /** Collective lever travel per second at full key/stick input. */
  collectiveRate: number
  /** How fast keyboard-driven centred axes move toward full deflection / back to centre (per second). */
  keyRampUp: number
  keyRampDown: number
  /** Free-look radians per mouse pixel. */
  mouseSensitivity: number
  /** Free-look radians per second at full stick. */
  lookSpeed: number
  invertLookY: boolean
}

export interface Settings {
  version: 1
  graphics: {
    fov: number
    /** Upper bound for devicePixelRatio; lower it to trade sharpness for speed. */
    pixelRatioCap: number
    shadows: boolean
    /** Trees beyond this distance (m) aren't drawn. */
    treeDistance: number
  }
  audio: {
    master: number
    vehicle: number
    weapons: number
    world: number
    ui: number
  }
  controls: ControlsSettings
  bindings: Bindings
  progress: {
    /** Best score per mission id. */
    best: Record<string, number>
    /** Index of the mission to continue with. */
    current: number
  }
}

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  graphics: { fov: 70, pixelRatioCap: 2, shadows: true, treeDistance: 2500 },
  audio: { master: 0.8, vehicle: 1, weapons: 1, world: 1, ui: 0.7 },
  controls: {
    assist: 'standard',
    stickDeadzone: 0.12,
    axes: {
      collective: { expo: 0, sensitivity: 1 },
      cyclicPitch: { expo: 0.35, sensitivity: 1 },
      cyclicRoll: { expo: 0.35, sensitivity: 1 },
      pedals: { expo: 0.25, sensitivity: 1 },
    },
    gamepadCollective: 'rate',
    collectiveRate: 0.5,
    keyRampUp: 3,
    keyRampDown: 5,
    mouseSensitivity: 0.0025,
    lookSpeed: 2.5,
    invertLookY: false,
  },
  bindings: DEFAULT_BINDINGS,
  progress: { best: {}, current: 0 },
}

/** Deep-merges a (possibly partial or outdated) saved settings object over the defaults. */
export function mergeSettings(saved: unknown): Settings {
  return mergeInto(structuredClone(DEFAULT_SETTINGS) as unknown as Record<string, unknown>, saved) as unknown as Settings
}

function mergeInto(target: Record<string, unknown>, source: unknown): Record<string, unknown> {
  if (!isRecord(source)) return target
  for (const key of Object.keys(target)) {
    const t = target[key]
    const s = source[key]
    // An empty record in the defaults is an open map (e.g. best scores): take the saved entries as-is.
    if (isRecord(t) && Object.keys(t).length === 0) {
      if (isRecord(s)) target[key] = structuredClone(s)
    } else if (isRecord(t)) mergeInto(t, s)
    else if (s !== undefined && typeof s === typeof t) target[key] = s
  }
  return target
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
