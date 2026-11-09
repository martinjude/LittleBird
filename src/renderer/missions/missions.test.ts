import { Vector3 } from 'three'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Site } from '../world/valley'
import { gradeTouchdown, LandingMonitor, type LandingSample } from './landing'
import { MissionRunner, type MissionInput, type TroopControl } from './MissionRunner'
import { MISSIONS } from './missions'

const base: Site = { id: 'base', name: 'FOB Eagle', kind: 'base', x: 0, z: 0, radius: 90, y: 40 }
const lz: Site = { id: 'lz-alpha', name: 'LZ Alpha', kind: 'lz', x: 0, z: -3000, radius: 30, y: 40 }
const delta: Site = { id: 'lz-delta', name: 'LZ Delta', kind: 'lz', x: 1000, z: -1000, radius: 30, y: 40 }

class FakeTroops implements TroopControl {
  boardingAllowed = false
  unloadAllowed = false
  aboard = 0
  delivered = 0
  spawned = 0
  spawn(_site: Site, count: number) {
    this.spawned = count
  }
  clear() {
    this.aboard = this.delivered = this.spawned = 0
  }
}

describe('LandingMonitor', () => {
  const air = (vs: number): LandingSample => ({ onGround: false, verticalSpeed: vs, groundSpeed: 0, pitch: 0, roll: 0 })
  const ground = (vs = 0, roll = 0): LandingSample => ({ onGround: true, verticalSpeed: vs, groundSpeed: 0, pitch: 0, roll })

  it('grades a touchdown by the descent rate just before contact', () => {
    const m = new LandingMonitor()
    m.reset(false)
    m.update(0.05, air(-1.2))
    m.update(0.05, air(-1.0))
    const td = m.update(0.05, ground(0)) // physics already stopped it
    expect(td?.verticalSpeed).toBeCloseTo(1.2)
    expect(td?.grade).toBe('firm')
    expect(m.crashed).toBeNull()
  })

  it('settles after a moment of being still on the ground', () => {
    const m = new LandingMonitor()
    m.reset(false)
    m.update(0.05, air(-0.3))
    m.update(0.05, ground())
    expect(m.settled).toBe(false)
    for (let i = 0; i < 20; i++) m.update(0.05, ground())
    expect(m.settled).toBe(true)
    m.update(0.05, air(1))
    expect(m.settled).toBe(false)
  })

  it('flags crashes: slamming in and rolling over', () => {
    const m = new LandingMonitor()
    m.reset(false)
    m.update(0.05, air(-9))
    m.update(0.05, ground())
    expect(m.crashed).toMatch(/9\.0 m\/s/)
    m.reset(true)
    m.update(0.05, ground(0, 1.4))
    expect(m.crashed).toBe('Rolled over')
  })

  it('grades boundaries', () => {
    expect(gradeTouchdown(0.3).grade).toBe('smooth')
    expect(gradeTouchdown(1).grade).toBe('firm')
    expect(gradeTouchdown(2).grade).toBe('hard')
    expect(gradeTouchdown(4).grade).toBe('very hard')
  })
})

describe('MissionRunner', () => {
  let troops: FakeTroops
  let runner: MissionRunner
  const at = (site: Site, landed: boolean, extra: Partial<MissionInput> = {}): MissionInput => ({
    heliPosition: new Vector3(site.x + 3, site.y, site.z),
    landed,
    crashed: null,
    touchdown: { verticalSpeed: 0.4, groundSpeed: 0, grade: 'smooth', points: 100 },
    interactPressed: false,
    ...extra,
  })

  beforeEach(() => {
    troops = new FakeTroops()
    runner = new MissionRunner([base, lz, delta], troops, base)
  })

  it('runs an insertion from briefing to complete', () => {
    runner.start(MISSIONS[0])
    expect(runner.phase).toBe('briefing')
    runner.update(0.1, at(base, true, { interactPressed: true, touchdown: null }))
    expect(troops.spawned).toBe(4)
    runner.update(0.1, at(base, true))
    expect(runner.phase).toBe('boarding')
    expect(runner.events.some((e) => e.type === 'landing')).toBe(false) // never left the pad
    expect(troops.boardingAllowed).toBe(true)

    // Lifting off pauses boarding.
    runner.update(0.1, at(base, false))
    expect(troops.boardingAllowed).toBe(false)
    troops.aboard = 4
    runner.update(0.1, at(base, false))
    expect(runner.phase).toBe('transit')
    expect(runner.target?.id).toBe('lz-alpha')

    // Smoke pops once within 2 km.
    runner.update(10, { ...at(lz, false), heliPosition: new Vector3(0, 100, -1500) })
    runner.update(10, { ...at(lz, false), heliPosition: new Vector3(0, 100, -1600) })
    expect(runner.events.filter((e) => e.type === 'smoke')).toHaveLength(1)

    runner.update(0.1, at(lz, true))
    expect(runner.phase).toBe('unloading')
    expect(runner.events.some((e) => e.type === 'landing' && e.points === 125)).toBe(true) // smooth + on target
    troops.delivered = 4
    runner.update(0.1, at(lz, true))
    expect(runner.phase).toBe('rtb')
    runner.update(0.1, at(base, true))
    expect(runner.phase).toBe('complete')
    expect(runner.totalScore).toBeGreaterThan(125 + 200)
  })

  it('does not count a landing outside the zone', () => {
    runner.start(MISSIONS[0])
    runner.update(0.1, at(base, true, { interactPressed: true }))
    troops.aboard = 4
    runner.update(0.1, at(base, true))
    runner.update(0.1, at(base, false))
    expect(runner.phase).toBe('transit')
    runner.update(0.1, { ...at(lz, true), heliPosition: new Vector3(lz.x + 60, lz.y, lz.z) })
    expect(runner.phase).toBe('transit')
  })

  it('ends an extraction at the base without a separate return leg', () => {
    runner.start(MISSIONS[3])
    runner.update(0.1, at(base, true, { interactPressed: true }))
    expect(runner.target?.id).toBe('lz-delta')
    runner.update(0.1, at(delta, true))
    troops.aboard = 4
    runner.update(0.1, at(delta, true))
    runner.update(0.1, at(base, true))
    expect(runner.phase).toBe('unloading')
    troops.delivered = 4
    runner.update(0.1, at(base, true))
    expect(runner.phase).toBe('complete')
  })

  it('fails the mission on a crash', () => {
    runner.start(MISSIONS[0])
    runner.update(0.1, at(base, true, { interactPressed: true }))
    runner.update(0.1, at(base, false, { crashed: 'Rolled over' }))
    expect(runner.phase).toBe('failed')
    expect(runner.events.at(-1)).toEqual({ type: 'failed', reason: 'Rolled over' })
  })
})
