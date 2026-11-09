import { describe, expect, it } from 'vitest'
import { expo, moveTowards, radialDeadzone } from './curves'

describe('radialDeadzone', () => {
  const out = { x: 0, y: 0 }

  it('zeroes input inside the deadzone', () => {
    expect(radialDeadzone(0.05, -0.08, 0.12, out)).toEqual({ x: 0, y: 0 })
  })

  it('rescales so full deflection still reaches 1', () => {
    radialDeadzone(1, 0, 0.2, out)
    expect(out.x).toBeCloseTo(1)
    radialDeadzone(0.6, 0, 0.2, out)
    expect(out.x).toBeCloseTo(0.5)
  })

  it('keeps the stick direction', () => {
    radialDeadzone(0.5, 0.5, 0.1, out)
    expect(out.x).toBeCloseTo(out.y)
  })

  it('clamps over-unit diagonals (square gates) to magnitude 1', () => {
    radialDeadzone(1, 1, 0.1, out)
    expect(Math.hypot(out.x, out.y)).toBeCloseTo(1)
  })
})

describe('expo', () => {
  it('is linear at 0 and cubic at 1, keeping endpoints and sign', () => {
    expect(expo(0.5, 0)).toBeCloseTo(0.5)
    expect(expo(0.5, 1)).toBeCloseTo(0.125)
    expect(expo(-1, 0.4)).toBeCloseTo(-1)
    expect(expo(-0.5, 1)).toBeCloseTo(-0.125)
  })
})

describe('moveTowards', () => {
  it('steps by at most maxDelta and never overshoots', () => {
    expect(moveTowards(0, 1, 0.25)).toBe(0.25)
    expect(moveTowards(0.9, 1, 0.25)).toBe(1)
    expect(moveTowards(0, -1, 0.5)).toBe(-0.5)
  })
})
