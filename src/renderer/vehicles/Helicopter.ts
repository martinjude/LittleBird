import type RAPIER from '@dimforge/rapier3d-compat'
import { Quaternion, Vector3, type Object3D } from 'three'
import type { AssistMode } from '../../shared/settings'
import { InterpolatedTransform } from '../core/Interpolation'
import { FlightControlSystem, type PilotControls } from '../flight/Fcs'
import { createFlightResult, FlightModel, type BodyState, type RotorControls } from '../flight/FlightModel'
import type { FlightParams } from '../flight/littlebird.params'
import type { Physics } from '../physics/Physics'
import { HeliDamage, type HeliPart } from './HeliDamage'
import type { HeliModel } from './HeliModel'
import { PlaceholderHeliModel } from './PlaceholderHeliModel'

/** How far down to look for the ground (also drives the altitude readout). */
const GROUND_PROBE = 2000
const Y_AXIS = new Vector3(0, 1, 0)

/**
 * The player's helicopter: a Rapier rigid body driven by the flight model,
 * plus its visual model (interpolated between physics steps).
 */
export class Helicopter {
  readonly transform = new InterpolatedTransform()
  readonly flight: FlightModel
  readonly fcs: FlightControlSystem
  readonly body: RAPIER.RigidBody
  readonly state: BodyState = {
    position: new Vector3(),
    quaternion: new Quaternion(),
    velocity: new Vector3(),
    angularVelocity: new Vector3(),
    hubHeightAgl: Infinity,
    wind: new Vector3(),
  }
  readonly result = createFlightResult()
  readonly rotor: RotorControls = { collective: 0, pitch: 0, roll: 0, yaw: 0, antiTorque: 'auto' }
  readonly damage: HeliDamage
  /** Height of the skids above the ground (m). */
  agl = 0
  /** Aircraft mass without passengers or cargo (kg); `params.mass` = this + payload. */
  emptyMass: number
  private payload = 0

  private readonly hub = new Vector3()
  private readonly tmp = new Vector3()
  /** Collider handle → which part of the airframe it represents. */
  private readonly partByCollider = new Map<number, 'cabin' | HeliPart>()
  /** Thin disc around the main rotor; anything solid inside it is a rotor strike. */
  private readonly rotorSensor: RAPIER.Collider

  constructor(
    private readonly physics: Physics,
    readonly params: FlightParams,
    readonly model: HeliModel = new PlaceholderHeliModel(),
  ) {
    const { R, world } = physics
    this.emptyMass = params.mass
    this.flight = new FlightModel(params)
    this.fcs = new FlightControlSystem(params)
    this.damage = new HeliDamage(params)

    // Mass and inertia come from the flight params, not from collider volumes.
    this.body = world.createRigidBody(R.RigidBodyDesc.dynamic().setCcdEnabled(true).setCanSleep(false))
    this.applyMassProperties()

    const toZ = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2)
    const part = (name: 'cabin' | HeliPart, desc: RAPIER.ColliderDesc, x: number, y: number, z: number, rot?: Quaternion) => {
      desc.setTranslation(x, y, z).setDensity(0).setFriction(0.7).setRestitution(0.05)
      if (rot) desc.setRotation(rot)
      this.partByCollider.set(world.createCollider(desc, this.body).handle, name)
    }
    // Simple proxies sized to the Little Bird model (see assets/littlebird.model.json).
    for (const x of [-0.95, 0.95]) part('skids', R.ColliderDesc.capsule(1.5, 0.06), x, 0.06, 0.4, toZ)
    part('cabin', R.ColliderDesc.capsule(0.85, 0.95), 0, 1.45, 0.55, toZ)
    part('tailboom', R.ColliderDesc.cuboid(0.15, 0.2, 2.2), 0, 1.75, -3.6)
    part('fin', R.ColliderDesc.cuboid(0.05, 0.6, 0.35), 0, 2.0, -5.85)

    const [hx, hy, hz] = params.rotor.hub
    this.rotorSensor = world.createCollider(
      R.ColliderDesc.cylinder(0.12, params.rotor.radius).setTranslation(hx, hy, hz).setSensor(true).setDensity(0),
      this.body,
    )
  }

  /** Which part a round hit, or null if the collider isn't ours. Cabin hits split into cockpit (front) and engine (rear). */
  partHit(colliderHandle: number, worldPoint: Vector3): HeliPart | null {
    const part = this.partByCollider.get(colliderHandle)
    if (!part) return null
    if (part !== 'cabin') return part
    const local = this.tmp.copy(worldPoint).sub(this.state.position).applyQuaternion(this.state.quaternion.clone().invert())
    return local.z > 0.5 ? 'cockpit' : 'engine'
  }

  /** True if anything solid (terrain, trees, buildings, people) is inside the rotor disc. Call after a physics step. */
  rotorStrike(): boolean {
    let struck = false
    this.physics.world.intersectionPairsWith(this.rotorSensor, (other) => {
      if (other.parent()?.handle !== this.body.handle && !other.isSensor()) struck = true
      return !struck
    })
    return struck
  }

  get object(): Object3D {
    return this.model.object
  }

  /** Re-applies mass, centre of mass and inertia after the params change. */
  applyMassProperties(): void {
    const p = this.params
    const [cx, cy, cz] = p.centerOfMass
    const [ix, iy, iz] = p.inertia
    this.body.setAdditionalMassProperties(p.mass, { x: cx, y: cy, z: cz }, { x: ix, y: iy, z: iz }, { x: 0, y: 0, z: 0, w: 1 }, true)
  }

  /** Sets the carried load (kg) on top of the empty mass. */
  setPayload(kg: number): void {
    if (kg === this.payload && this.params.mass === this.emptyMass + kg) return
    this.payload = kg
    this.params.mass = this.emptyMass + kg
    this.applyMassProperties()
  }

  /** Places the helicopter at rest; `heading` is compass radians (0 = north/-Z). */
  respawn(position: Vector3, heading: number): void {
    // Identity faces +Z (south); compass heading increases clockwise, rotation about +Y counter-clockwise.
    const q = new Quaternion().setFromAxisAngle(Y_AXIS, Math.PI - heading)
    this.body.setTranslation(position, true)
    this.body.setRotation(q, true)
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    this.body.resetForces(true)
    this.body.resetTorques(true)
    this.transform.teleport(position, q)
    this.readBody()
    this.fcs.reset()
    this.damage.reset()
  }

  /** Runs before each physics step: computes and applies the aerodynamic forces. */
  beforeStep(pilot: PilotControls, assist: AssistMode, wind: Vector3): void {
    this.transform.snapshot()
    this.readBody()
    this.state.wind.copy(wind)

    this.hub.fromArray(this.params.rotor.hub).applyQuaternion(this.state.quaternion).add(this.state.position)
    this.state.hubHeightAgl = this.physics.distanceDown(this.hub, GROUND_PROBE, this.body)
    const hubAboveOrigin = this.hub.y - this.state.position.y
    this.agl = Math.max(0, this.state.hubHeightAgl - hubAboveOrigin)

    this.fcs.compute(assist, pilot, this.state, this.rotor)
    this.flight.compute(this.state, this.rotor, this.result)

    this.body.resetForces(false)
    this.body.resetTorques(false)
    this.body.addForce(this.result.force, true)
    this.body.addTorque(this.result.torque, true)
  }

  /** Runs after each physics step: records the new pose for interpolation. */
  afterStep(): void {
    const t = this.body.translation()
    const r = this.body.rotation()
    this.transform.position.set(t.x, t.y, t.z)
    this.transform.quaternion.set(r.x, r.y, r.z, r.w)
  }

  render(alpha: number, dt: number): void {
    this.transform.applyTo(this.model.object, alpha)
    this.model.animate(dt, this.params.rotor.rpm, this.result.telemetry.discTilt)
  }

  /** Vertical speed (m/s, + = climbing). */
  get verticalSpeed(): number {
    return this.state.velocity.y
  }

  /** Ground speed (m/s). */
  get groundSpeed(): number {
    return this.tmp.set(this.state.velocity.x, 0, this.state.velocity.z).length()
  }

  private readBody(): void {
    const s = this.state
    const t = this.body.translation()
    const r = this.body.rotation()
    const v = this.body.linvel()
    const w = this.body.angvel()
    s.position.set(t.x, t.y, t.z)
    s.quaternion.set(r.x, r.y, r.z, r.w)
    s.velocity.set(v.x, v.y, v.z)
    s.angularVelocity.set(w.x, w.y, w.z)
  }
}
