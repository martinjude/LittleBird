import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { LITTLE_BIRD } from '../flight/littlebird.params'
import { HeliDamage } from '../vehicles/HeliDamage'
import { aimSpread, leadPoint } from './aim'

describe('leadPoint', () => {
  it('aims where a moving target will be when the round arrives', () => {
    const shooter = new Vector3(0, 0, 0)
    const target = new Vector3(0, 0, 700)
    const velocity = new Vector3(40, 0, 0)
    const aim = leadPoint(shooter, target, velocity, 700)
    // Round takes ~1 s, so lead by ~40 m.
    expect(aim.x).toBeGreaterThan(38)
    expect(aim.x).toBeLessThan(42)
    const tof = aim.distanceTo(shooter) / 700
    expect(aim.x).toBeCloseTo(velocity.x * tof, 1)
  })

  it('needs no lead for a stationary target', () => {
    expect(leadPoint(new Vector3(), new Vector3(5, 0, 300), new Vector3(), 800).toArray()).toEqual([5, 0, 300])
  })
})

describe('aimSpread', () => {
  it('grows with range and target speed, shrinks with skill', () => {
    expect(aimSpread(800, 0, 1)).toBeGreaterThan(aimSpread(200, 0, 1))
    expect(aimSpread(400, 50, 1)).toBeGreaterThan(aimSpread(400, 0, 1))
    expect(aimSpread(400, 0, 1.6)).toBeLessThan(aimSpread(400, 0, 1))
  })
})

describe('HeliDamage', () => {
  const fresh = () => {
    const params = structuredClone(LITTLE_BIRD)
    return { params, damage: new HeliDamage(params) }
  }

  it('engine hits cut available thrust, but a dead engine still leaves some', () => {
    const { params, damage } = fresh()
    const full = params.rotor.maxThrust
    damage.hit('engine', 60)
    expect(params.rotor.maxThrust).toBeLessThan(full)
    damage.hit('engine', 100)
    expect(damage.hp.engine).toBe(0)
    expect(params.rotor.maxThrust).toBeCloseTo(full * 0.25)
    expect(damage.warnings()).toContain('ENGINE FAILURE')
  })

  it('tail hits remove anti-torque authority', () => {
    const { params, damage } = fresh()
    damage.hit('fin', 200)
    expect(damage.hp.tailRotor).toBe(0)
    expect(params.tailRotor.maxMoment).toBe(0)
  })

  it('a rotor strike kills lift', () => {
    const { params, damage } = fresh()
    damage.rotorStrike()
    expect(params.rotor.maxThrust).toBe(0)
    expect(damage.vibration).toBe(1)
  })

  it('reports the aircraft lost when the pilot is killed', () => {
    const { damage } = fresh()
    damage.hit('cockpit', 400)
    expect(damage.destroyed).toBe('Pilot killed')
  })

  it('repairs fully on reset', () => {
    const { params, damage } = fresh()
    const full = params.rotor.maxThrust
    damage.hit('engine', 300)
    damage.reset()
    expect(params.rotor.maxThrust).toBe(full)
    expect(damage.destroyed).toBeNull()
  })
})
