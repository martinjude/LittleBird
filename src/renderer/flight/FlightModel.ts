import { MathUtils, Quaternion, Vector3 } from 'three'
import type { FlightParams } from './littlebird.params'

/** Rigid-body state as the physics engine reports it (world frame). */
export interface BodyState {
  /** Body origin (skid bottoms). */
  position: Vector3
  quaternion: Quaternion
  /** Linear velocity of the centre of mass. */
  velocity: Vector3
  angularVelocity: Vector3
  /** Rotor hub height above the ground below it; Infinity when nothing is in range. */
  hubHeightAgl: number
  wind: Vector3
}

/**
 * Control positions after the flight control system (see Fcs.ts).
 * pitch +1 = cyclic forward, roll +1 = cyclic right, yaw +1 = right pedal.
 */
export interface RotorControls {
  collective: number
  pitch: number
  roll: number
  yaw: number
  /** `auto`: tail rotor trims main-rotor torque by itself; `manual`: the pilot's pedals must. */
  antiTorque: 'auto' | 'manual'
}

export interface FlightTelemetry {
  thrust: number
  groundEffect: number
  etl: number
  inflow: number
  /** 0..1 vortex-ring severity. */
  vortexRing: number
  inducedVelocity: number
  torqueReaction: number
  tailMoment: number
  /** 0..1, how hard the tail rotor is working (for warnings). */
  tailSaturation: number
  airspeed: number
  discTilt: { pitch: number; roll: number }
}

export interface FlightResult {
  /** Total aerodynamic force, applied at the centre of mass (gravity excluded). */
  force: Vector3
  /** Total moment about the centre of mass. */
  torque: Vector3
  telemetry: FlightTelemetry
}

export function createFlightResult(): FlightResult {
  return {
    force: new Vector3(),
    torque: new Vector3(),
    telemetry: {
      thrust: 0,
      groundEffect: 1,
      etl: 1,
      inflow: 1,
      vortexRing: 0,
      inducedVelocity: 0,
      torqueReaction: 0,
      tailMoment: 0,
      tailSaturation: 0,
      airspeed: 0,
      discTilt: { pitch: 0, roll: 0 },
    },
  }
}

const X = new Vector3(1, 0, 0)
const Z = new Vector3(0, 0, 1)

/**
 * Helicopter forces: main rotor (thrust, ground effect, translational lift, climb inflow,
 * vortex ring state), hub moments, torque reaction, tail rotor, fin, stabiliser and drag.
 *
 * Point forces (rotor, tail rotor, fin, stabiliser) are applied where they act, so the
 * moments they create — e.g. the tail rotor's roll and drift — fall out of the geometry.
 */
export class FlightModel {
  constructor(public params: FlightParams) {}

  // Scratch vectors, reused every step.
  private readonly com = new Vector3()
  private readonly vAir = new Vector3()
  private readonly vBody = new Vector3()
  private readonly wBody = new Vector3()
  private readonly qInv = new Quaternion()
  private readonly tilt = new Quaternion()
  private readonly tmpQ = new Quaternion()
  private readonly n = new Vector3()
  private readonly p = new Vector3()
  private readonly r = new Vector3()
  private readonly f = new Vector3()
  private readonly v = new Vector3()
  private readonly m = new Vector3()

  compute(s: BodyState, c: RotorControls, out: FlightResult): FlightResult {
    const P = this.params
    const R = P.rotor
    const t = out.telemetry
    const rho = P.airDensity
    const q = s.quaternion
    out.force.set(0, 0, 0)
    out.torque.set(0, 0, 0)

    this.qInv.copy(q).invert()
    this.com.fromArray(P.centerOfMass).applyQuaternion(q).add(s.position)
    this.vAir.subVectors(s.velocity, s.wind)
    this.vBody.copy(this.vAir).applyQuaternion(this.qInv)
    this.wBody.copy(s.angularVelocity).applyQuaternion(this.qInv)
    t.airspeed = this.vAir.length()

    // --- Main rotor -------------------------------------------------------
    const collective = MathUtils.clamp(c.collective, 0, 1)
    const tiltPitch = MathUtils.clamp(c.pitch, -1, 1) * R.discTiltMax
    const tiltRoll = MathUtils.clamp(c.roll, -1, 1) * R.discTiltMax
    t.discTilt.pitch = tiltPitch
    t.discTilt.roll = tiltRoll
    // Disc normal: forward cyclic tips it toward +Z (rotation about +X), right cyclic toward -X (about +Z).
    this.tilt.setFromAxisAngle(Z, tiltRoll - R.mastRoll).multiply(this.tmpQ.setFromAxisAngle(X, tiltPitch))
    this.n.set(0, 1, 0).applyQuaternion(this.tilt).applyQuaternion(q)

    const vAxial = this.vAir.dot(this.n) // + = climbing through the disc
    const vInPlane = this.v.copy(this.vAir).addScaledVector(this.n, -vAxial).length()

    const baseThrust = P.rotor.maxThrust * collective
    t.inflow = MathUtils.clamp(1 - R.climbLoss * vAxial, 0.4, 1.3)
    t.groundEffect = groundEffect(s.hubHeightAgl, R.radius, R.groundEffectMax, vInPlane)
    t.etl = 1 + R.etlGain * MathUtils.smoothstep(vInPlane, R.etlStart, R.etlFull)

    const discArea = Math.PI * R.radius * R.radius
    t.inducedVelocity = Math.sqrt(Math.max(baseThrust, 1) / (2 * rho * discArea))
    t.vortexRing = P.vortexRing.enabled ? vortexRingSeverity(-vAxial / t.inducedVelocity, vInPlane) : 0

    const thrust = baseThrust * t.inflow * t.groundEffect * t.etl * (1 - P.vortexRing.maxLoss * t.vortexRing)
    t.thrust = thrust
    this.f.copy(this.n).multiplyScalar(thrust)
    this.p.fromArray(R.hub).applyQuaternion(q).add(s.position)
    this.addForceAt(this.f, this.p, out)

    // Hub moments from cyclic, rotor/airframe rate damping and speed stability (body frame).
    this.m.set(
      P.cyclicAuthority[0] * MathUtils.clamp(c.pitch, -1, 1) - P.rateDamping[0] * this.wBody.x - P.speedStability * this.vBody.z,
      -P.rateDamping[1] * this.wBody.y,
      P.cyclicAuthority[1] * MathUtils.clamp(c.roll, -1, 1) - P.rateDamping[2] * this.wBody.z,
    )

    // Main-rotor torque reaction: rotor turns CCW seen from above, so the fuselage yaws right (-Y).
    t.torqueReaction = P.torque.reactionPerThrust * thrust
    this.m.y -= t.torqueReaction
    out.torque.add(this.m.applyQuaternion(q))

    // --- Tail rotor: a sideways force at the tail, sized to give the wanted yaw moment ---
    const yaw = MathUtils.clamp(c.yaw, -1, 1)
    const tr = P.tailRotor
    const wanted =
      c.antiTorque === 'auto' ? t.torqueReaction - yaw * tr.maxMoment : tr.maxMoment * (tr.pedalNeutral - yaw)
    t.tailMoment = MathUtils.clamp(wanted, -tr.maxMoment, tr.maxMoment)
    t.tailSaturation = Math.abs(wanted) / tr.maxMoment
    const arm = P.centerOfMass[2] - tr.position[2]
    this.f.set(-t.tailMoment / arm, 0, 0).applyQuaternion(q)
    this.p.fromArray(tr.position).applyQuaternion(q).add(s.position)
    this.addForceAt(this.f, this.p, out)

    // --- Fin (side) and stabiliser (vertical) at the tail, from local airflow -------------
    this.surfaceForce(P.fin.position, P.fin.area, 0, s, out)
    this.surfaceForce(P.stabilizer.position, P.stabilizer.area, 1, s, out)

    // --- Fuselage drag, per body axis --------------------------------------------------
    const vb = this.vBody
    const d = P.dragArea
    this.f
      .set(-0.5 * rho * d[0] * vb.x * Math.abs(vb.x), -0.5 * rho * d[1] * vb.y * Math.abs(vb.y), -0.5 * rho * d[2] * vb.z * Math.abs(vb.z))
      .applyQuaternion(q)
    out.force.add(this.f)

    return out
  }

  /**
   * Flat-plate surface at the tail. `axis` 0 = fin (resists sideways flow),
   * 1 = stabiliser (resists vertical flow). Uses the local velocity, so it also damps rotation.
   */
  private surfaceForce(position: [number, number, number], area: number, axis: 0 | 1, s: BodyState, out: FlightResult) {
    const q = s.quaternion
    this.p.fromArray(position).applyQuaternion(q).add(s.position)
    this.r.subVectors(this.p, this.com)
    // Local air velocity = v_com + ω × r - wind.
    this.v.crossVectors(s.angularVelocity, this.r).add(this.vAir).applyQuaternion(this.qInv)
    const local = axis === 0 ? this.v.x : this.v.y
    const magnitude = -0.5 * this.params.airDensity * area * local * Math.abs(local)
    this.f.set(axis === 0 ? magnitude : 0, axis === 1 ? magnitude : 0, 0).applyQuaternion(q)
    this.addForceAt(this.f, this.p, out)
  }

  private addForceAt(force: Vector3, point: Vector3, out: FlightResult) {
    out.force.add(force)
    this.r.subVectors(point, this.com)
    out.torque.add(this.r.cross(force))
  }
}

/**
 * Cheeseman–Bennett ground effect, T_IGE/T_OGE = 1 / (1 - (R/4z)²), capped,
 * and washed out as forward speed blows the ground cushion away.
 */
export function groundEffect(hubHeight: number, radius: number, max: number, speed: number): number {
  if (!Number.isFinite(hubHeight)) return 1
  const z = Math.max(hubHeight, 0.01)
  const k = radius / (4 * z)
  const ige = k >= 1 ? max : Math.min(max, 1 / (1 - k * k))
  return 1 + (ige - 1) * (1 - MathUtils.smoothstep(speed, 5, 15))
}

/**
 * Vortex ring state: thrust loss when descending at roughly 0.3–1.5× the induced velocity
 * with little forward speed, so the rotor re-ingests its own downwash.
 * @param descentRatio descent rate through the disc ÷ induced velocity
 */
export function vortexRingSeverity(descentRatio: number, inPlaneSpeed: number): number {
  const band = MathUtils.smoothstep(descentRatio, 0.25, 0.6) * (1 - MathUtils.smoothstep(descentRatio, 1.3, 1.8))
  return band * (1 - MathUtils.smoothstep(inPlaneSpeed, 4, 9))
}
