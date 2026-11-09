import { MathUtils } from 'three'
import { Heightmap } from './Heightmap'
import { createPerlin, fbm, ridged } from './noise'

const { smoothstep } = MathUtils

/** A named flat area: the home base or a landing zone. */
export interface Site {
  id: string
  name: string
  kind: 'base' | 'lz'
  x: number
  z: number
  /** Flattened radius (m). */
  radius: number
  /** Ground height after flattening; filled in by generateValley. */
  y: number
}

export interface ValleyMap {
  heightmap: Heightmap
  /** Raw height function, defined everywhere (also beyond the playable square). */
  rawHeight: (x: number, z: number) => number
  sites: Site[]
  /** Creek centre-line x for a given z. */
  creekX: (z: number) => number
}

export const VALLEY_SIZE = 4096
export const VALLEY_RESOLUTION = 513
const FLATTEN_BLEND = 45

/** The creek meanders down the middle of the valley along Z. */
export function creekX(z: number): number {
  return 280 * Math.sin(z / 850) + 120 * Math.sin(z / 330 + 1.3)
}

/**
 * Temperate mountain valley: a meandering creek on a gently rolling floor, ridged
 * mountains on both flanks and a rim that closes the valley off at the map edge.
 */
export function createValleyHeight(seed: number): (x: number, z: number) => number {
  const floorNoise = createPerlin(seed)
  const peakNoise = createPerlin(seed + 1)
  const detailNoise = createPerlin(seed + 2)
  return (x, z) => {
    const d = Math.abs(x - creekX(z))
    const floor = 30 + 25 * smoothstep(d, 30, 500) + fbm(floorNoise, x / 600, z / 600, 4) * 18
    const flanks = smoothstep(d, 350, 1500) * (220 + 520 * ridged(peakNoise, x / 1400, z / 1400, 6))
    const edge = Math.max(Math.abs(x), Math.abs(z))
    const rim = smoothstep(edge, 1500, 2700) * 380 * (0.6 + 0.4 * fbm(detailNoise, x / 500, z / 500, 3))
    const creekBed = -7 * (1 - smoothstep(d, 8, 35))
    const detail = fbm(detailNoise, x / 90, z / 90, 3) * 3
    return floor + flanks + rim + creekBed + detail
  }
}

function defaultSites(): Omit<Site, 'y'>[] {
  return [
    { id: 'base', name: 'FOB Eagle', kind: 'base', x: creekX(1350) + 260, z: 1350, radius: 90 },
    { id: 'lz-alpha', name: 'LZ Alpha', kind: 'lz', x: creekX(-1350) - 280, z: -1350, radius: 30 },
    { id: 'lz-bravo', name: 'LZ Bravo', kind: 'lz', x: creekX(-250) + 800, z: -250, radius: 30 },
    { id: 'lz-charlie', name: 'LZ Charlie', kind: 'lz', x: creekX(500) - 1250, z: 500, radius: 30 },
    { id: 'lz-delta', name: 'LZ Delta', kind: 'lz', x: creekX(150) + 220, z: 150, radius: 30 },
  ]
}

export function generateValley(seed = 7, resolution = VALLEY_RESOLUTION): ValleyMap {
  const rawHeight = createValleyHeight(seed)
  const heightmap = Heightmap.sample(VALLEY_SIZE, resolution, rawHeight)
  const sites = defaultSites().map((s) => ({ ...s, y: rawHeight(s.x, s.z) }))
  for (const site of sites) flatten(heightmap, site.x, site.z, site.radius, site.y)
  return { heightmap, rawHeight, sites, creekX }
}

/** Levels the terrain to `height` within `radius`, blending back to natural ground beyond it. */
export function flatten(map: Heightmap, cx: number, cz: number, radius: number, height: number): void {
  const reach = radius + FLATTEN_BLEND
  const r = map.resolution
  const i0 = Math.max(0, Math.floor((cx - reach + map.half) / map.spacing))
  const i1 = Math.min(r - 1, Math.ceil((cx + reach + map.half) / map.spacing))
  const j0 = Math.max(0, Math.floor((cz - reach + map.half) / map.spacing))
  const j1 = Math.min(r - 1, Math.ceil((cz + reach + map.half) / map.spacing))
  for (let iz = j0; iz <= j1; iz++) {
    for (let ix = i0; ix <= i1; ix++) {
      const x = -map.half + ix * map.spacing
      const z = -map.half + iz * map.spacing
      const w = 1 - smoothstep(Math.hypot(x - cx, z - cz), radius, reach)
      if (w <= 0) continue
      const k = iz * r + ix
      map.heights[k] = MathUtils.lerp(map.heights[k], height, w)
    }
  }
}
