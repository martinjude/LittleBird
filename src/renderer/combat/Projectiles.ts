import type RAPIER from '@dimforge/rapier3d-compat'
import { Vector3 } from 'three'
import type { CombatFx } from '../fx/CombatFx'
import type { Physics } from '../physics/Physics'

export type Side = 'player' | 'enemy'

export interface Projectile {
  kind: 'bullet' | 'rocket'
  side: Side
  position: Vector3
  velocity: Vector3
  age: number
  maxAge: number
  damage: number
  tracer: [number, number, number] | null
  /** Rockets: seconds of motor burn left. */
  motor: number
  /** Enemy rounds: already made their supersonic crack near the listener. */
  cracked: boolean
}

export interface ProjectileHit {
  projectile: Projectile
  point: Vector3
  /** null when the projectile expired in the air (rockets self-destruct). */
  collider: RAPIER.Collider | null
}

const GRAVITY = 9.81
const ROCKET_ACCEL = 620
const ROCKET_MAX_SPEED = 740

/** Ballistic rounds and rockets, swept with raycasts each step so fast rounds never tunnel. */
export class Projectiles {
  readonly live: Projectile[] = []
  private readonly from = new Vector3()
  private readonly step = new Vector3()
  private readonly ray: RAPIER.Ray

  constructor(
    private readonly physics: Physics,
    /** Player rounds ignore the player's own aircraft. */
    private readonly playerBody: RAPIER.RigidBody,
  ) {
    this.ray = new physics.R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 })
  }

  fireBullet(side: Side, position: Vector3, velocity: Vector3, damage: number, tracer: Projectile['tracer']): void {
    this.live.push({ kind: 'bullet', side, position: position.clone(), velocity: velocity.clone(), age: 0, maxAge: 2.5, damage, tracer, motor: 0, cracked: false })
  }

  fireRocket(position: Vector3, velocity: Vector3, damage: number): void {
    this.live.push({ kind: 'rocket', side: 'player', position: position.clone(), velocity: velocity.clone(), age: 0, maxAge: 6, damage, tracer: null, motor: 1.1, cracked: false })
  }

  clear(): void {
    this.live.length = 0
  }

  update(dt: number, fx: CombatFx, onHit: (hit: ProjectileHit) => void): void {
    const tracers = fx.tracers
    tracers.begin()
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i]
      p.age += dt
      if (p.kind === 'rocket') {
        if (p.motor > 0) {
          p.motor -= dt
          const speed = p.velocity.length()
          if (speed < ROCKET_MAX_SPEED) p.velocity.multiplyScalar(Math.min(ROCKET_MAX_SPEED, speed + ROCKET_ACCEL * dt) / speed)
        }
        fx.rocketTrail(p.position, p.motor > 0)
      }
      p.velocity.y -= GRAVITY * dt * (p.kind === 'rocket' && p.motor > 0 ? 0.2 : 1)

      this.from.copy(p.position)
      this.step.copy(p.velocity).multiplyScalar(dt)
      const length = this.step.length()
      const hit = this.cast(this.from, this.step, length, p.side)
      if (hit) {
        const point = this.from.clone().addScaledVector(this.step, hit.timeOfImpact / length)
        this.live.splice(i, 1)
        onHit({ projectile: p, point, collider: hit.collider })
        continue
      }
      p.position.add(this.step)
      if (p.age > p.maxAge) {
        this.live.splice(i, 1)
        if (p.kind === 'rocket') onHit({ projectile: p, point: p.position.clone(), collider: null })
        continue
      }
      if (p.tracer) tracers.add(p.position, p.velocity, 0.022, ...p.tracer)
    }
    tracers.end()
  }

  private cast(origin: Vector3, step: Vector3, length: number, side: Side) {
    if (length < 1e-6) return null
    this.ray.origin = { x: origin.x, y: origin.y, z: origin.z }
    this.ray.dir = { x: step.x / length, y: step.y / length, z: step.z / length }
    const exclude = side === 'player' ? this.playerBody : undefined
    // Sensors (e.g. the rotor-strike volume) never stop rounds.
    return this.physics.world.castRay(this.ray, length, true, this.physics.R.QueryFilterFlags.EXCLUDE_SENSORS, undefined, undefined, exclude)
  }
}
