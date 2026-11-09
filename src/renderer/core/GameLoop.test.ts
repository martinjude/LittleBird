import { describe, expect, it } from 'vitest'
import { GameLoop } from './GameLoop'

function makeLoop(hz = 120) {
  const record = { steps: 0, simTime: 0, frames: [] as { dt: number; alpha: number }[] }
  const loop = new GameLoop(
    {
      fixedUpdate: (dt) => {
        record.steps++
        record.simTime += dt
      },
      frame: (dt, alpha) => record.frames.push({ dt, alpha }),
    },
    hz,
  )
  return { loop, record }
}

describe('GameLoop', () => {
  it('runs two 120 Hz steps for a 60 Hz frame', () => {
    const { loop, record } = makeLoop()
    expect(loop.advance(1 / 60)).toBe(2)
    expect(record.simTime).toBeCloseTo(1 / 60)
    expect(record.frames[0].alpha).toBeCloseTo(0)
  })

  it('carries the remainder and reports it as alpha', () => {
    const { loop, record } = makeLoop()
    loop.advance(1.5 / 120)
    expect(record.steps).toBe(1)
    expect(record.frames[0].alpha).toBeCloseTo(0.5)
    loop.advance(0.5 / 120)
    expect(record.steps).toBe(2)
  })

  it('keeps simulation time in lockstep with wall time over many uneven frames', () => {
    const { loop, record } = makeLoop()
    let wall = 0
    for (let i = 0; i < 1000; i++) {
      const dt = 0.005 + (i % 7) * 0.003
      wall += dt
      loop.advance(dt)
    }
    expect(Math.abs(record.simTime - wall)).toBeLessThan(loop.fixedDt)
  })

  it('clamps huge frame times and caps sub-steps', () => {
    const { loop, record } = makeLoop()
    loop.advance(5)
    expect(record.steps).toBe(loop.maxSubSteps)
    expect(record.frames[0].dt).toBe(loop.maxFrameDt)
    expect(record.frames[0].alpha).toBeLessThan(1)
  })

  it('does not simulate while paused but still renders', () => {
    const { loop, record } = makeLoop()
    loop.paused = true
    loop.advance(0.1)
    expect(record.steps).toBe(0)
    expect(record.frames).toHaveLength(1)
    loop.step()
    expect(record.steps).toBe(1)
  })

  it('applies time scale', () => {
    const { loop, record } = makeLoop()
    loop.timeScale = 0.5
    loop.advance(1 / 60)
    expect(record.steps).toBe(1)
  })
})
