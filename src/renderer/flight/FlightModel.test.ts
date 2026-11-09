import { Quaternion, Vector3 } from 'three'
import { beforeEach, describe, expect, it } from 'vitest'
import { attitudeOf, FlightControlSystem } from './Fcs'
import { createFlightResult, FlightModel, groundEffect, vortexRingSeverity, type BodyState, type RotorControls } from './FlightModel'
import { LITTLE_BIRD } from './littlebird.params'

const G = 9.81
const params = structuredClone(LITTLE_BIRD)
const weight = params.mass * G
/** Collective that exactly carries the weight out of ground effect, at rest. */
const hoverCollective = weight / params.rotor.maxThrust

function state(overrides: Partial<BodyState> = {}): BodyState {
  return {
    position: new Vector3(0, 100, 0),
    quaternion: new Quaternion(),
    velocity: new Vector3(),
    angularVelocity: new Vector3(),
    hubHeightAgl: Infinity,
    wind: new Vector3(),
    ...overrides,
  }
}

function controls(overrides: Partial<RotorControls> = {}): RotorControls {
  return { collective: hoverCollective, pitch: 0, roll: 0, yaw: 0, antiTorque: 'auto', ...overrides }
}

describe('FlightModel', () => {
  let model: FlightModel
  const out = createFlightResult()

  beforeEach(() => {
    model = new FlightModel(structuredClone(LITTLE_BIRD))
  })

  it('carries its weight at hover collective out of ground effect', () => {
    model.compute(state(), controls(), out)
    // Within 0.5% (the small built-in mast tilt costs a little vertical thrust).
    expect(Math.abs(out.force.y - weight) / weight).toBeLessThan(0.005)
  })

  it('mast tilt roughly cancels the tail rotor push in a hover', () => {
    model.compute(state(), controls(), out)
    expect(Math.abs(out.force.x)).toBeLessThan(0.02 * weight)
  })

  it('gains thrust in ground effect, washing out with speed', () => {
    model.compute(state({ hubHeightAgl: 3 }), controls(), out)
    expect(out.telemetry.groundEffect).toBeGreaterThan(1.05)
    expect(groundEffect(3, 4.15, 1.2, 20)).toBe(1)
    expect(groundEffect(Infinity, 4.15, 1.2, 0)).toBe(1)
  })

  it('loses thrust while climbing and gains it while descending', () => {
    model.compute(state({ velocity: new Vector3(0, 5, 0) }), controls(), out)
    const climbing = out.telemetry.thrust
    model.compute(state({ velocity: new Vector3(0, -2, 0) }), controls(), out)
    expect(climbing).toBeLessThan(out.telemetry.thrust)
  })

  it('pitches nose-down with forward cyclic and rolls right with right cyclic', () => {
    model.compute(state(), controls({ pitch: 1 }), out)
    expect(out.torque.x).toBeGreaterThan(1000)
    model.compute(state(), controls({ roll: 1 }), out)
    expect(out.torque.z).toBeGreaterThan(1000)
  })

  it('auto anti-torque trims yaw; manual needs pedal as collective changes', () => {
    model.compute(state(), controls({ collective: 0.9 }), out)
    expect(Math.abs(out.torque.y)).toBeLessThan(80)

    model.compute(state(), controls({ collective: 0.95, antiTorque: 'manual' }), out)
    expect(out.torque.y).toBeLessThan(-500) // torque wins: nose swings right
    model.compute(state(), controls({ collective: 0.2, antiTorque: 'manual' }), out)
    expect(out.torque.y).toBeGreaterThan(500) // tail wins: nose swings left
  })

  it('yaws right with right pedal', () => {
    model.compute(state(), controls({ yaw: 1 }), out)
    expect(out.torque.y).toBeLessThan(-3000)
  })

  it('drag opposes motion', () => {
    model.compute(state({ velocity: new Vector3(0, 0, 50) }), controls({ collective: 0 }), out)
    expect(out.force.z).toBeLessThan(-1000)
  })

  it('weathervanes: the fin turns the nose into a sideways airflow', () => {
    // Sliding toward +X (left): nose should swing left (+Y moment).
    model.compute(state({ velocity: new Vector3(10, 0, 0) }), controls({ collective: 0 }), out)
    expect(out.torque.y).toBeGreaterThan(0)
  })

  it('damps rotation', () => {
    model.compute(state({ angularVelocity: new Vector3(1, 0, 0) }), controls(), out)
    expect(out.torque.x).toBeLessThan(0)
  })

  it('loses thrust in vortex ring state only when descending slowly near the induced velocity', () => {
    expect(vortexRingSeverity(0.8, 0)).toBeCloseTo(1)
    expect(vortexRingSeverity(0.8, 15)).toBe(0)
    expect(vortexRingSeverity(0.1, 0)).toBe(0)
    expect(vortexRingSeverity(2.5, 0)).toBe(0)

    model.compute(state({ velocity: new Vector3(0, -7, 0) }), controls(), out)
    expect(out.telemetry.vortexRing).toBeGreaterThan(0.5)
    model.params.vortexRing.enabled = false
    model.compute(state({ velocity: new Vector3(0, -7, 0) }), controls(), out)
    expect(out.telemetry.vortexRing).toBe(0)
  })
})

describe('FlightControlSystem', () => {
  const pilot = { collective: 0.6, cyclicPitch: 0, cyclicRoll: 0, pedals: 0 }
  const rotor = controls()

  it('selects manual anti-torque only in realistic mode', () => {
    const fcs = new FlightControlSystem(params)
    expect(fcs.compute('realistic', pilot, state(), rotor).antiTorque).toBe('manual')
    expect(fcs.compute('standard', pilot, state(), rotor).antiTorque).toBe('auto')
    expect(fcs.compute('novice', pilot, state(), rotor).antiTorque).toBe('auto')
  })

  it('standard: centred stick opposes an existing rotation', () => {
    const fcs = new FlightControlSystem(params)
    fcs.compute('standard', pilot, state({ angularVelocity: new Vector3(0.5, 0, 0) }), rotor)
    expect(rotor.pitch).toBeLessThan(0)
  })

  it('standard: holds the captured attitude', () => {
    const fcs = new FlightControlSystem(params)
    const level = state()
    fcs.compute('standard', pilot, level, rotor) // captures level
    const bankedRight = state({ quaternion: new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.2) })
    fcs.compute('standard', pilot, bankedRight, rotor)
    expect(rotor.roll).toBeLessThan(0) // rolls back left
  })

  it('standard: will not rate the aircraft past its attitude envelope', () => {
    const fcs = new FlightControlSystem(params)
    const steepNoseDown = state({ quaternion: new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.55) })
    fcs.compute('standard', { ...pilot, cyclicPitch: 1 }, steepNoseDown, rotor)
    expect(rotor.pitch).toBeLessThan(0) // full forward stick, yet it pulls back toward the limit
  })

  it('standard: holds heading in a hover but coordinates turns in forward flight', () => {
    const fcs = new FlightControlSystem(params)
    const bankRight = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.4)
    fcs.compute('standard', pilot, state({ quaternion: bankRight }), rotor) // hover: captures heading
    expect(Math.abs(rotor.yaw)).toBeLessThan(0.05)
    fcs.compute('standard', pilot, state({ quaternion: bankRight, velocity: new Vector3(0, 0, 40) }), rotor)
    expect(rotor.yaw).toBeGreaterThan(0.05) // yaws right into the turn
  })

  it('novice: stick commands a bank angle, centred levels the aircraft', () => {
    const fcs = new FlightControlSystem(params)
    fcs.compute('novice', { ...pilot, cyclicRoll: 1 }, state(), rotor)
    expect(rotor.roll).toBeGreaterThan(0)
    const banked = state({ quaternion: new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.3) })
    fcs.compute('novice', pilot, banked, rotor)
    expect(rotor.roll).toBeLessThan(0)
  })

  it('realistic: passes the stick straight through when not rotating', () => {
    const fcs = new FlightControlSystem(params)
    fcs.compute('realistic', { ...pilot, cyclicPitch: 0.5, pedals: -0.3 }, state(), rotor)
    expect(rotor.pitch).toBeCloseTo(0.5)
    expect(rotor.yaw).toBeCloseTo(-0.3)
  })
})

describe('attitudeOf', () => {
  it('reports nose-down pitch, right roll and compass heading', () => {
    const deg = Math.PI / 180
    expect(attitudeOf(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 10 * deg)).pitch).toBeCloseTo(10 * deg)
    expect(attitudeOf(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 15 * deg)).roll).toBeCloseTo(15 * deg)
    // Identity faces +Z = south (180°); yawing so the nose points +X = east (90°).
    expect(Math.abs(attitudeOf(new Quaternion()).heading)).toBeCloseTo(Math.PI)
    expect(attitudeOf(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 90 * deg)).heading).toBeCloseTo(90 * deg)
  })
})
