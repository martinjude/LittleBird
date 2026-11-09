import type RAPIER from '@dimforge/rapier3d-compat'
import { BoxGeometry, CylinderGeometry, Group, MathUtils, Mesh, MeshStandardMaterial, Quaternion, Vector3, type Object3D } from 'three'
import type { CombatSounds } from '../audio/CombatSounds'
import { createRandom } from '../core/random'
import type { CombatFx } from '../fx/CombatFx'
import type { Physics } from '../physics/Physics'
import { buildSoldier, HOSTILE, poseSoldier, type SoldierRig } from '../troops/soldierModel'
import type { Site } from '../world/valley'
import { aimSpread, leadPoint } from './aim'
import type { Projectiles } from './Projectiles'

export type UnitKind = 'infantry' | 'technical'

interface WeaponSpec {
  range: number
  roundSpeed: number
  damage: number
  burst: [number, number]
  rate: number
  pause: [number, number]
  skill: number
  tracerEvery: number
  sound: 'rifle' | 'dshk'
}

const WEAPONS: Record<UnitKind, WeaponSpec> = {
  infantry: { range: 650, roundSpeed: 715, damage: 3, burst: [3, 6], rate: 9, pause: [1.6, 3.4], skill: 0.7, tracerEvery: 4, sound: 'rifle' },
  technical: { range: 1100, roundSpeed: 840, damage: 9, burst: [6, 12], rate: 10, pause: [1.8, 3], skill: 1.2, tracerEvery: 3, sound: 'dshk' },
}
const HP: Record<UnitKind, number> = { infantry: 100, technical: 700 }
const LOS_INTERVAL = 0.4
const ENEMY_TRACER: [number, number, number] = [0.45, 1, 0.45]

export interface Unit {
  kind: UnitKind
  position: Vector3
  heading: number
  hp: number
  state: 'idle' | 'engage' | 'dead'
  object: Group
  rig: SoldierRig
  /** For technicals: the turret group the gunner and gun turn with. */
  turret: Group | null
  collider: RAPIER.Collider | null
  losTimer: number
  hasLos: boolean
  burstLeft: number
  shotTimer: number
  deathTime: number
}

export interface TargetInfo {
  position: Vector3
  velocity: Vector3
  /** Rigid body of the aircraft, to recognise it in line-of-sight rays. */
  body: RAPIER.RigidBody
  alive: boolean
}

/**
 * Hostile infantry and technicals (pickups with a DShK). They watch for the helicopter,
 * check line of sight (terrain and trees block it), lead their shots and fire bursts with
 * range- and motion-dependent accuracy. Infantry die from a few rounds; technicals need
 * a rocket or sustained fire, then burn.
 */
export class EnemyForce {
  readonly root = new Group()
  units: Unit[] = []
  kills = 0

  private readonly body: RAPIER.RigidBody
  private readonly byCollider = new Map<number, Unit>()
  private readonly rand = createRandom(404)
  private readonly ray: RAPIER.Ray
  private readonly eye = new Vector3()
  private readonly aim = new Vector3()
  private readonly dir = new Vector3()
  private readonly axis = new Vector3()
  private readonly q = new Quaternion()

  constructor(
    private readonly physics: Physics,
    private readonly heightAt: (x: number, z: number) => number,
    private readonly projectiles: Projectiles,
    private readonly fx: CombatFx,
    private readonly sounds: CombatSounds,
    private readonly onCreate: (o: Object3D) => void,
  ) {
    this.root.name = 'Enemies'
    this.body = physics.world.createRigidBody(physics.R.RigidBodyDesc.fixed())
    this.ray = new physics.R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 })
  }

  get alive(): number {
    return this.units.filter((u) => u.state !== 'dead').length
  }

  unitFor(colliderHandle: number): Unit | undefined {
    return this.byCollider.get(colliderHandle)
  }

  /** Scatters a hostile group around a site: infantry in a loose ring, technicals further out. */
  spawnAround(site: Site, infantry = 9, technicals = 2): void {
    this.clear()
    const r = this.rand
    const place = (minR: number, maxR: number) => {
      const a = r() * Math.PI * 2
      const d = minR + r() * (maxR - minR)
      const x = site.x + Math.cos(a) * d
      const z = site.z + Math.sin(a) * d
      return new Vector3(x, this.heightAt(x, z), z)
    }
    for (let i = 0; i < infantry; i++) this.addUnit('infantry', place(site.radius + 60, site.radius + 260))
    for (let i = 0; i < technicals; i++) this.addUnit('technical', place(site.radius + 180, site.radius + 380))
  }

  clear(): void {
    for (const u of this.units) {
      u.object.removeFromParent()
      if (u.collider) this.physics.world.removeCollider(u.collider, false)
    }
    this.units = []
    this.byCollider.clear()
    this.kills = 0
  }

  /** @returns true if this damage killed the unit. */
  damage(unit: Unit, amount: number): boolean {
    if (unit.state === 'dead') return false
    unit.hp -= amount
    if (unit.state === 'idle') unit.state = 'engage' // getting shot gets their attention
    if (unit.hp > 0) return false
    this.kill(unit)
    return true
  }

  /** Blast damage with linear falloff. Returns the number of kills. */
  splash(point: Vector3, radius: number, damage: number): number {
    let kills = 0
    for (const u of this.units) {
      if (u.state === 'dead') continue
      const d = u.position.distanceTo(point)
      if (d < radius && this.damage(u, damage * (1 - d / radius) * (u.kind === 'technical' ? 1.6 : 1))) kills++
    }
    return kills
  }

  update(dt: number, target: TargetInfo): void {
    for (const u of this.units) {
      if (u.state === 'dead') {
        this.animateDeath(u, dt)
        continue
      }
      const spec = WEAPONS[u.kind]
      const distance = u.position.distanceTo(target.position)

      u.losTimer -= dt
      if (u.losTimer <= 0) {
        u.losTimer = LOS_INTERVAL * (0.8 + this.rand() * 0.4)
        u.hasLos = target.alive && distance < spec.range * 1.3 && this.lineOfSight(u, target)
        if (u.hasLos && distance < spec.range) u.state = 'engage'
      }

      if (u.state === 'engage' && u.hasLos) {
        // Turn to face (technicals traverse the turret).
        const yaw = Math.atan2(target.position.x - u.position.x, target.position.z - u.position.z)
        if (u.turret) u.turret.rotation.y = yaw - u.heading
        else u.heading = yaw
        this.fireControl(u, spec, dt, distance, target)
        poseSoldier(u.rig, 'idle')
        u.rig.armL.rotation.x = u.rig.armR.rotation.x = -1.4 // shouldering the rifle
      } else {
        poseSoldier(u.rig, u.kind === 'infantry' ? 'kneel' : 'idle')
      }
      u.object.rotation.y = u.heading
    }
  }

  private fireControl(u: Unit, spec: WeaponSpec, dt: number, distance: number, target: TargetInfo): void {
    u.shotTimer -= dt
    if (u.shotTimer > 0 || distance > spec.range) return
    if (u.burstLeft <= 0) u.burstLeft = Math.round(MathUtils.lerp(spec.burst[0], spec.burst[1], this.rand()))

    this.muzzle(u, this.eye)
    leadPoint(this.eye, target.position, target.velocity, spec.roundSpeed, this.aim)
    this.aim.y += 1.2 // aim at the cabin, not the skids
    this.dir.subVectors(this.aim, this.eye).normalize()
    const spread = aimSpread(distance, target.velocity.length(), spec.skill)
    this.axis.set(this.rand() - 0.5, this.rand() - 0.5, this.rand() - 0.5).cross(this.dir).normalize()
    this.dir.applyQuaternion(this.q.setFromAxisAngle(this.axis, (this.rand() + this.rand() - 1) * spread * 2))
    // Compensate drop roughly by aiming up with time of flight.
    const tof = distance / spec.roundSpeed
    this.dir.y += 0.5 * 9.81 * tof * tof / Math.max(distance, 1)

    const tracer = this.rand() < 1 / spec.tracerEvery ? ENEMY_TRACER : null
    this.projectiles.fireBullet('enemy', this.eye, this.dir.multiplyScalar(spec.roundSpeed), spec.damage, tracer)
    this.fx.muzzleFlash(this.eye, this.dir.normalize(), u.kind === 'technical')
    if (this.sounds.audible(this.eye, 2500)) this.sounds.play(spec.sound, this.eye, { gain: u.kind === 'technical' ? 1 : 0.7, travelDelay: true })

    u.burstLeft--
    u.shotTimer = u.burstLeft > 0 ? 1 / spec.rate : MathUtils.lerp(spec.pause[0], spec.pause[1], this.rand())
  }

  /** Muzzle position: in front of the shooter so rounds don't start inside their own collider. */
  private muzzle(u: Unit, out: Vector3): Vector3 {
    const yaw = u.heading + (u.turret ? u.turret.rotation.y : 0)
    const height = u.kind === 'technical' ? 2.6 : 1.45
    return out.set(u.position.x + Math.sin(yaw) * 1.2, u.position.y + height, u.position.z + Math.cos(yaw) * 1.2)
  }

  private lineOfSight(u: Unit, target: TargetInfo): boolean {
    this.muzzle(u, this.eye)
    this.dir.subVectors(target.position, this.eye)
    this.dir.y += 1.2
    const length = this.dir.length()
    this.ray.origin = { x: this.eye.x, y: this.eye.y, z: this.eye.z }
    this.ray.dir = { x: this.dir.x / length, y: this.dir.y / length, z: this.dir.z / length }
    const hit = this.physics.world.castRay(this.ray, length + 5, true, this.physics.R.QueryFilterFlags.EXCLUDE_SENSORS)
    return !!hit && hit.collider.parent()?.handle === target.body.handle
  }

  private kill(u: Unit): void {
    u.state = 'dead'
    u.deathTime = 0
    this.kills++
    if (u.collider) {
      this.byCollider.delete(u.collider.handle)
      this.physics.world.removeCollider(u.collider, false)
      u.collider = null
    }
    if (u.kind === 'technical') {
      const p = u.position.clone().setY(u.position.y + 1.5)
      this.fx.explosion(p, 1.3)
      this.fx.burn(p, 90)
      this.sounds.play('explosion', p, { gain: 1, priority: 6, travelDelay: true })
      u.object.traverse((o) => {
        const m = (o as Mesh).material as MeshStandardMaterial | undefined
        if (m?.color) {
          const burnt = m.clone()
          burnt.color.multiplyScalar(0.15)
          ;(o as Mesh).material = burnt
        }
      })
      if (u.turret) u.turret.visible = false
    }
  }

  private animateDeath(u: Unit, dt: number): void {
    if (u.kind !== 'infantry' || u.deathTime > 0.5) return
    u.deathTime += dt
    u.rig.root.rotation.x = -Math.min(1, u.deathTime / 0.45) * Math.PI / 2
    u.rig.root.position.y = 0.15
  }

  private addUnit(kind: UnitKind, position: Vector3): void {
    const R = this.physics.R
    const object = new Group()
    object.position.copy(position)
    let rig: SoldierRig
    let turret: Group | null = null
    let collider: RAPIER.Collider
    if (kind === 'infantry') {
      rig = buildSoldier(HOSTILE)
      object.add(rig.root)
      collider = this.physics.world.createCollider(R.ColliderDesc.capsule(0.5, 0.35).setTranslation(position.x, position.y + 0.9, position.z), this.body)
    } else {
      const truck = buildTechnical()
      object.add(truck.object)
      turret = truck.turret
      rig = buildSoldier(HOSTILE)
      rig.root.position.set(0, 1.05, -0.6)
      turret.add(rig.root)
      const heading = this.rand() * Math.PI * 2
      object.rotation.y = heading
      collider = this.physics.world.createCollider(
        R.ColliderDesc.cuboid(1.0, 1.0, 2.5)
          .setTranslation(position.x, position.y + 1.0, position.z)
          .setRotation(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), heading)),
        this.body,
      )
    }
    const unit: Unit = {
      kind,
      position,
      heading: kind === 'technical' ? object.rotation.y : this.rand() * Math.PI * 2,
      hp: HP[kind],
      state: 'idle',
      object,
      rig,
      turret,
      collider,
      losTimer: this.rand() * LOS_INTERVAL,
      hasLos: false,
      burstLeft: 0,
      shotTimer: 1 + this.rand() * 2,
      deathTime: 0,
    }
    this.units.push(unit)
    this.byCollider.set(collider.handle, unit)
    this.root.add(object)
    this.onCreate(object)
  }
}

/** Primitive "technical": a pickup with a DShK on a turret in the bed. Faces +Z. */
function buildTechnical(): { object: Group; turret: Group } {
  const object = new Group()
  const paint = new MeshStandardMaterial({ color: 0xd8d2c0, roughness: 0.6, metalness: 0.2 })
  const dark = new MeshStandardMaterial({ color: 0x1e1e1e, roughness: 0.8 })
  const glass = new MeshStandardMaterial({ color: 0x223038, roughness: 0.1, metalness: 0.5 })
  const box = (w: number, h: number, d: number, m: MeshStandardMaterial, x: number, y: number, z: number) => {
    const mesh = new Mesh(new BoxGeometry(w, h, d), m)
    mesh.position.set(x, y, z)
    mesh.castShadow = mesh.receiveShadow = true
    object.add(mesh)
    return mesh
  }
  box(1.9, 0.55, 4.9, paint, 0, 0.75, 0) // chassis
  box(1.85, 0.75, 1.7, paint, 0, 1.4, 0.9) // cab
  box(1.7, 0.4, 0.05, glass, 0, 1.5, 1.76) // windscreen
  box(1.9, 0.45, 0.08, paint, 0, 1.25, -2.4) // tailgate
  for (const [x, z] of [[-0.9, 1.5], [0.9, 1.5], [-0.9, -1.5], [0.9, -1.5]]) {
    const wheel = new Mesh(new CylinderGeometry(0.38, 0.38, 0.28, 12).rotateZ(Math.PI / 2), dark)
    wheel.position.set(x, 0.38, z)
    wheel.castShadow = true
    object.add(wheel)
  }
  const turret = new Group()
  turret.position.set(0, 1.05, -0.9)
  object.add(turret)
  const mount = new Mesh(new CylinderGeometry(0.06, 0.1, 0.9, 6), dark)
  mount.position.y = 0.45
  const gun = new Mesh(new BoxGeometry(0.12, 0.16, 1.6), dark)
  gun.position.set(0, 1.0, 0.5)
  turret.add(mount, gun)
  return { object, turret }
}
