import { describe, expect, it } from 'vitest'
import { Heightmap } from './Heightmap'
import { creekX, generateValley, VALLEY_SIZE } from './valley'

// Lower resolution keeps the test quick; the shape is the same.
const valley = generateValley(7, 129)
const { heightmap: map, sites } = valley

describe('Heightmap', () => {
  it('interpolates exactly through grid points and between them', () => {
    const m = Heightmap.sample(100, 3, (x, z) => x + 2 * z)
    expect(m.heightAt(-50, -50)).toBeCloseTo(-150)
    expect(m.heightAt(50, 50)).toBeCloseTo(150)
    expect(m.heightAt(25, 0)).toBeCloseTo(25) // planar data stays planar
    expect(m.heightAt(999, 0)).toBeCloseTo(50) // clamped at the edge
  })

  it('measures slope', () => {
    const m = Heightmap.sample(100, 11, (x) => x) // 45°
    expect(m.slopeAt(0, 0)).toBeCloseTo(Math.PI / 4)
  })
})

describe('valley generator', () => {
  it('is deterministic for a seed', () => {
    const again = generateValley(7, 129)
    expect(Array.from(again.heightmap.heights.slice(0, 50))).toEqual(Array.from(map.heights.slice(0, 50)))
    expect(generateValley(8, 129).heightmap.heights[1000]).not.toBe(map.heights[1000])
  })

  it('produces finite heights with mountains around a low valley', () => {
    for (const h of map.heights) expect(Number.isFinite(h)).toBe(true)
    const floor = map.heightAt(creekX(0) + 100, 0)
    const corner = map.heightAt(VALLEY_SIZE / 2 - 50, VALLEY_SIZE / 2 - 50)
    expect(floor).toBeLessThan(120)
    expect(corner).toBeGreaterThan(floor + 200)
  })

  it('keeps every site inside the playable area', () => {
    expect(sites.map((s) => s.id)).toEqual(['base', 'lz-alpha', 'lz-bravo', 'lz-charlie', 'lz-delta'])
    for (const s of sites) {
      expect(Math.abs(s.x) + s.radius).toBeLessThan(VALLEY_SIZE / 2 - 150)
      expect(Math.abs(s.z) + s.radius).toBeLessThan(VALLEY_SIZE / 2 - 150)
    }
  })

  it('flattens each site to a level pad', () => {
    for (const s of sites) {
      for (const [dx, dz] of [[0, 0], [s.radius * 0.6, 0], [0, -s.radius * 0.6], [-s.radius * 0.4, s.radius * 0.4]]) {
        expect(Math.abs(map.heightAt(s.x + dx, s.z + dz) - s.y), `${s.id}`).toBeLessThan(0.5)
      }
    }
  })

  it('puts the LZs at varied altitudes (valley floor to mountain)', () => {
    const heights = sites.filter((s) => s.kind === 'lz').map((s) => s.y)
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(150)
  })
})
