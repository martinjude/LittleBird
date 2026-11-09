export type AssistMode = 'novice' | 'standard' | 'realistic'

export interface Settings {
  version: 1
  graphics: {
    fov: number
    /** Upper bound for devicePixelRatio; lower it to trade sharpness for speed. */
    pixelRatioCap: number
    shadows: boolean
  }
  audio: {
    master: number
    vehicle: number
    weapons: number
    world: number
    ui: number
  }
  controls: {
    assist: AssistMode
  }
}

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  graphics: { fov: 70, pixelRatioCap: 2, shadows: true },
  audio: { master: 0.8, vehicle: 1, weapons: 1, world: 1, ui: 0.7 },
  controls: { assist: 'standard' },
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
    if (isRecord(t)) mergeInto(t, s)
    else if (s !== undefined && typeof s === typeof t) target[key] = s
  }
  return target
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
