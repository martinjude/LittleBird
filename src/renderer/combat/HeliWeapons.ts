import { MathUtils, Quaternion, Vector3 } from 'three'
import type { CombatSounds } from '../audio/CombatSounds'
import { createRandom } from '../core/random'
import type { CombatFx } from '../fx/CombatFx'
import type { Helicopter } from '../vehicles/Helicopter'
import type { Projectiles } from './Projectiles'

export interface WeaponMounts {
  /** Gun muzzles in body space (left, right). */
  guns: [Vector3, Vector3]
  /** Rocket pod fronts in body space (left, right). */
  rockets: [Vector3, Vector3]
}

/** AH-6 style: guns at the outboard pods, rockets just below them. Body space, +X = left. */
export const LITTLE_BIRD_MOUNTS: WeaponMounts = {
  guns: [new Vector3(1.55, 0.72, 1.3), new Vector3(-1.55, 0.72, 1.3)],
  rockets: [new Vector3(1.55, 0.6, 1.2), new Vector3(-1.55, 0.6, 1.2)],
}

const GUN_RATE = 2000 / 60 // per gun
const MUZZLE_VELOCITY = 850
const DISPERSION = 0.004
const SPIN_UP = 0.35
const SPIN_DOWN = 1.2
/** Guns and rockets are bore-sighted slightly nose-down, so a level cruise puts rounds ahead on the ground. */
export const BORESIGHT_DOWN = MathUtils.degToRad(2.5)
const ROCKET_INTERVAL = 0.25

/** Twin M134 miniguns (spin-up, ammo, tracers every 5th round) and a pair of Hydra 70 pods. */
export class HeliWeapons {
  gunAmmo = 0
  rockets = 0
  readonly maxGunAmmo = 3000
  readonly maxRockets = 14
  /** Barrel spin 0..1; rounds fly only at full speed. */
  spin = 0
  firing = false

  private shotAccumulator = 0
  private shotCount = 0
  private rocketCooldown = 0
  private nextPod = 0
  private readonly rand = createRandom(5)
  private readonly q = new Quaternion()
  private readonly dir = new Vector3()
  private readonly muzzle = new Vector3()
  private readonly vel = new Vector3()
  private readonly jitter = new Quaternion()

  constructor(
    private readonly heli: Helicopter,
    private readonly projectiles: Projectiles,
    private readonly fx: CombatFx,
    private readonly sounds: CombatSounds,
    private readonly mounts: WeaponMounts = LITTLE_BIRD_MOUNTS,
  ) {
    this.rearm()
  }

  rearm(): void {
    this.gunAmmo = this.maxGunAmmo
    this.rockets = this.maxRockets
    this.spin = 0
  }

  /** Bore-sight direction in world space. */
  boresight(out: Vector3): Vector3 {
    this.q.setFromAxisAngle(new Vector3(1, 0, 0), BORESIGHT_DOWN)
    return out.set(0, 0, 1).applyQuaternion(this.q).applyQuaternion(this.heli.object.quaternion)
  }

  update(dt: number, gunTrigger: boolean, rocketTrigger: boolean, rocketPressed: boolean): void {
    const wantGuns = gunTrigger && this.gunAmmo > 0
    this.spin = MathUtils.clamp(this.spin + (wantGuns ? dt / SPIN_UP : -dt / SPIN_DOWN), 0, 1)
    this.firing = wantGuns && this.spin >= 1

    if (this.firing) {
      this.shotAccumulator += dt * GUN_RATE * 2
      while (this.shotAccumulator >= 1 && this.gunAmmo > 0) {
        this.shotAccumulator -= 1
        this.fireRound(this.shotCount++ % 2)
      }
    } else {
      this.shotAccumulator = 0
    }
    this.sounds.updateMinigun(this.heli.object.position, this.firing, this.spin)

    this.rocketCooldown -= dt
    if ((rocketPressed || (rocketTrigger && this.rocketCooldown <= 0)) && this.rockets > 0 && this.rocketCooldown <= 0) {
      this.fireRocket()
      this.rocketCooldown = ROCKET_INTERVAL
    }
  }

  private fireRound(gun: number): void {
    const heli = this.heli.object
    this.gunAmmo--
    this.muzzle.copy(this.mounts.guns[gun]).applyQuaternion(heli.quaternion).add(heli.position)
    this.boresight(this.dir)
    // Random cone: rotate the bore-sight by a small random angle about a random perpendicular axis.
    const axis = new Vector3(this.rand() - 0.5, this.rand() - 0.5, this.rand() - 0.5).cross(this.dir).normalize()
    this.dir.applyQuaternion(this.jitter.setFromAxisAngle(axis, this.rand() * DISPERSION * 2))
    this.vel.copy(this.dir).multiplyScalar(MUZZLE_VELOCITY).add(this.heli.state.velocity)
    const tracer = this.shotCount % 5 === 0 ? ([1, 0.55, 0.2] as [number, number, number]) : null
    this.projectiles.fireBullet('player', this.muzzle, this.vel, 35, tracer)
    if (this.shotCount % 3 === 0) this.fx.muzzleFlash(this.muzzle, this.dir)
  }

  private fireRocket(): void {
    const heli = this.heli.object
    const pod = this.nextPod
    this.nextPod = 1 - pod
    this.rockets--
    this.muzzle.copy(this.mounts.rockets[pod]).applyQuaternion(heli.quaternion).add(heli.position)
    this.boresight(this.dir)
    this.vel.copy(this.dir).multiplyScalar(45).add(this.heli.state.velocity)
    this.projectiles.fireRocket(this.muzzle, this.vel, 450)
    this.fx.muzzleFlash(this.muzzle, this.dir, true)
    this.sounds.play('rocket', this.muzzle, { gain: 0.9, priority: 4 })
  }
}
