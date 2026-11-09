import { MathUtils, Quaternion, Vector3 } from 'three'
import type { AssistMode } from '../../shared/settings'
import type { BodyState, RotorControls } from './FlightModel'
import type { FlightParams } from './littlebird.params'

export interface PilotControls {
  collective: number
  cyclicPitch: number
  cyclicRoll: number
  pedals: number
}

export interface FcsTuning {
  /** Rate-command limits (rad/s): pitch, roll, yaw. */
  maxRate: [number, number, number]
  /** Novice attitude-command limits (rad): pitch, roll. */
  maxAttitude: [number, number]
  /** Standard-mode soft envelope (rad): pitch, roll. The FCS won't rate the aircraft past these. */
  attitudeLimit: [number, number]
  /** Rate-loop feedback gain (multiples of natural damping). */
  rateGain: number
  /** Attitude/heading-hold gain (1/s). */
  holdGain: number
  /** Below this rate (rad/s) after the stick is centred, the current attitude is captured and held. */
  captureRate: number
  /** Realistic mode: light stability augmentation, as a fraction of natural damping. */
  sasGain: number
  /** Airspeed band (m/s) over which heading hold hands over to turn coordination. */
  coordinationSpeed: [number, number]
}

export const DEFAULT_FCS: FcsTuning = {
  maxRate: [0.6, 1.2, 1.0],
  maxAttitude: [0.4, 0.55],
  attitudeLimit: [0.45, 0.8],
  rateGain: 1.5,
  holdGain: 2.5,
  captureRate: 0.08,
  sasGain: 0.3,
  coordinationSpeed: [10, 18],
}

const CENTRED = 0.02
const G = 9.81

/** Pitch (nose down +), roll (right wing down +) and compass heading (0 = -Z, 90 = +X), in radians. */
export function attitudeOf(q: Quaternion, out = { pitch: 0, roll: 0, heading: 0 }) {
  const f = new Vector3(0, 0, 1).applyQuaternion(q)
  const left = new Vector3(1, 0, 0).applyQuaternion(q)
  out.pitch = -Math.asin(MathUtils.clamp(f.y, -1, 1))
  out.roll = Math.asin(MathUtils.clamp(left.y, -1, 1))
  out.heading = Math.atan2(f.x, -f.z)
  return out
}

/**
 * Flight control system: turns pilot stick positions into rotor control positions
 * according to the assist mode.
 *  - realistic: direct control + light SAS; the pilot must trim torque with the pedals.
 *  - standard:  rate command with attitude and heading hold when the stick is centred; auto anti-torque.
 *  - novice:    attitude command (stick = bank/pitch angle, centre = level); auto anti-torque.
 */
export class FlightControlSystem {
  tuning: FcsTuning = structuredClone(DEFAULT_FCS)

  private readonly att = { pitch: 0, roll: 0, heading: 0 }
  private readonly wBody = new Vector3()
  private readonly qInv = new Quaternion()
  private readonly airVelocity = new Vector3()
  /** Held attitude per axis (pitch, roll, heading); null while the pilot is manoeuvring or not yet settled. */
  private readonly hold: [number | null, number | null, number | null] = [null, null, null]

  constructor(public params: FlightParams) {}

  reset(): void {
    this.hold.fill(null)
  }

  compute(mode: AssistMode, pilot: PilotControls, s: BodyState, out: RotorControls): RotorControls {
    const P = this.params
    const T = this.tuning
    out.collective = pilot.collective

    this.wBody.copy(s.angularVelocity).applyQuaternion(this.qInv.copy(s.quaternion).invert())
    // Rates in pilot terms: nose-down, right roll, right yaw.
    const rates = [this.wBody.x, this.wBody.z, -this.wBody.y]
    const sticks = [pilot.cyclicPitch, pilot.cyclicRoll, pilot.pedals]
    attitudeOf(s.quaternion, this.att)
    const angles = [this.att.pitch, this.att.roll, this.att.heading]
    // Moment per unit control and natural damping, per pilot axis.
    const authority = [P.cyclicAuthority[0], P.cyclicAuthority[1], P.tailRotor.maxMoment]
    const damping = [P.rateDamping[0], P.rateDamping[2], P.rateDamping[1]]
    this.airVelocity.subVectors(s.velocity, s.wind).setY(0)
    const airspeed = this.airVelocity.length()

    const u = [0, 0, 0]
    if (mode === 'realistic') {
      for (let i = 0; i < 3; i++) u[i] = sticks[i] - (T.sasGain * damping[i] * rates[i]) / authority[i]
      this.hold.fill(null)
    } else {
      for (let i = 0; i < 3; i++) {
        let targetRate: number
        if (mode === 'novice' && i < 2) {
          // Attitude command: the stick sets the angle; centred = level.
          const targetAngle = sticks[i] * T.maxAttitude[i]
          targetRate = MathUtils.clamp(T.holdGain * (targetAngle - angles[i]), -T.maxRate[i], T.maxRate[i])
        } else {
          targetRate = this.rateWithHold(i, sticks[i], rates[i], angles[i])
          if (i < 2) {
            // Soft envelope: approaching the limit, the allowed rate toward it shrinks to zero (and reverses past it).
            const limit = T.attitudeLimit[i]
            targetRate = MathUtils.clamp(targetRate, T.holdGain * (-limit - angles[i]), T.holdGain * (limit - angles[i]))
          } else {
            // In forward flight, heading hold would fight a banked turn and make the aircraft slip.
            // Hand over to turn coordination: yaw at the rate the bank dictates, pedals trim on top.
            const coordination = MathUtils.smoothstep(airspeed, T.coordinationSpeed[0], T.coordinationSpeed[1])
            if (coordination > 0) {
              const turnRate = (G / Math.max(airspeed, 1)) * Math.sin(angles[1]) + sticks[2] * T.maxRate[2]
              targetRate = MathUtils.lerp(targetRate, turnRate, coordination)
              if (coordination > 0.5) this.hold[2] = null
            }
          }
        }
        // Feed-forward (rate the natural damping settles at) + feedback on the rate error.
        u[i] = (damping[i] * (targetRate + T.rateGain * (targetRate - rates[i]))) / authority[i]
      }
    }

    out.pitch = MathUtils.clamp(u[0], -1, 1)
    out.roll = MathUtils.clamp(u[1], -1, 1)
    out.yaw = MathUtils.clamp(u[2], -1, 1)
    out.antiTorque = mode === 'realistic' ? 'manual' : 'auto'
    return out
  }

  /** Rate command; once the stick is centred and the motion has settled, hold that attitude/heading. */
  private rateWithHold(axis: number, stick: number, rate: number, angle: number): number {
    const T = this.tuning
    if (Math.abs(stick) > CENTRED) {
      this.hold[axis] = null
      return stick * T.maxRate[axis]
    }
    if (this.hold[axis] === null) {
      if (Math.abs(rate) > T.captureRate) return 0
      this.hold[axis] = angle
    }
    const error = axis === 2 ? wrapAngle(this.hold[axis]! - angle) : this.hold[axis]! - angle
    return MathUtils.clamp(T.holdGain * error, -T.maxRate[axis], T.maxRate[axis])
  }
}

function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a))
}
