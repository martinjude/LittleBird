import { Vector3 } from 'three'
import type { AudioEngine } from '../audio/AudioEngine'
import { CombatSounds } from '../audio/CombatSounds'
import { CombatFx } from '../fx/CombatFx'
import type { Physics } from '../physics/Physics'
import type { Helicopter } from '../vehicles/Helicopter'
import type { ValleyWorld } from '../world/ValleyWorld'
import { EnemyForce } from './EnemyForce'
import { HeliWeapons } from './HeliWeapons'
import { Projectiles, type ProjectileHit } from './Projectiles'

const ROCKET_BLAST_RADIUS = 14
/** Rockets arm after this long in flight (~60 m); earlier impacts are duds, so you can't blow yourself up. */
const ROCKET_ARMING_TIME = 0.3
/** Enemy rounds passing closer than this to your ears make a supersonic crack. */
const CRACK_DISTANCE = 9

export interface CombatTriggers {
  guns: boolean
  rockets: boolean
  rocketsPressed: boolean
}

/** Owns weapons, projectiles, enemies and effects, and routes every hit to the right place. */
export class Combat {
  readonly fx: CombatFx
  readonly sounds: CombatSounds
  readonly projectiles: Projectiles
  readonly weapons: HeliWeapons
  readonly enemies: EnemyForce
  /** 0..1, flashes the HUD red when the aircraft takes a hit. */
  hitFlash = 0
  /** Kills reported since last read (for HUD toasts). */
  newKills = 0

  private readonly exhaust = new Vector3()

  constructor(
    world: ValleyWorld,
    physics: Physics,
    private readonly heli: Helicopter,
    private readonly audio: AudioEngine,
  ) {
    this.fx = new CombatFx(world.scene)
    this.sounds = new CombatSounds(audio)
    this.projectiles = new Projectiles(physics, heli.body)
    this.weapons = new HeliWeapons(heli, this.projectiles, this.fx, this.sounds)
    this.enemies = new EnemyForce(physics, (x, z) => world.heightAt(x, z), this.projectiles, this.fx, this.sounds, (o) =>
      world.registerMaterials(o),
    )
    world.scene.add(this.enemies.root)
  }

  reset(): void {
    this.projectiles.clear()
    this.enemies.clear()
    this.fx.clear()
    this.weapons.rearm()
    this.hitFlash = 0
  }

  setViewport(height: number, fov: number): void {
    this.fx.setViewport(height, fov)
  }

  /** After each physics step. */
  fixedUpdate(): void {
    if (this.heli.damage.hp.mainRotor > 0 && this.heli.rotorStrike()) {
      this.heli.damage.rotorStrike()
      const hub = this.exhaust.fromArray(this.heli.params.rotor.hub).applyQuaternion(this.heli.object.quaternion).add(this.heli.object.position)
      for (let i = 0; i < 4; i++) this.fx.impact(hub, 'metal')
      this.sounds.play('metalHit', hub, { gain: 1, priority: 8 })
      this.hitFlash = 1
    }
  }

  update(dt: number, triggers: CombatTriggers, wind: Vector3): void {
    const heli = this.heli
    const alive = !heli.damage.destroyed
    this.weapons.update(dt, alive && triggers.guns, alive && triggers.rockets, alive && triggers.rocketsPressed)
    this.enemies.update(dt, { position: heli.object.position, velocity: heli.state.velocity, body: heli.body, alive })
    this.projectiles.update(dt, this.fx, (hit) => this.onHit(hit))

    const ears = this.audio.listenerPosition
    for (const p of this.projectiles.live) {
      if (p.side === 'enemy' && !p.cracked && p.position.distanceTo(ears) < CRACK_DISTANCE) {
        p.cracked = true
        this.sounds.play('crack', p.position, { gain: 0.8, priority: 3 })
      }
    }

    // A damaged engine trails smoke; a dead one burns.
    if (heli.damage.smoking) {
      this.exhaust.set(0, 2.1, -1.3).applyQuaternion(heli.object.quaternion).add(heli.object.position)
      this.fx.dust.spawn(this.exhaust, {
        life: 3,
        size: [0.6, 4],
        color: heli.damage.burning ? 0x151515 : 0x55524e,
        alpha: 0.6,
        velocity: heli.state.velocity.clone().multiplyScalar(0.3),
        drag: 1.5,
        buoyancy: 0.6,
      })
      if (heli.damage.burning) this.fx.fire.spawn(this.exhaust, { life: 0.3, size: [0.8, 1.6], color: 0xff8a30 })
    }

    this.fx.update(dt, wind)
    this.hitFlash = Math.max(0, this.hitFlash - dt * 2.5)
  }

  private onHit(hit: ProjectileHit): void {
    const { projectile: p, point, collider } = hit
    if (p.kind === 'rocket') {
      if (p.age >= ROCKET_ARMING_TIME) this.explode(point, p.damage)
      else this.fx.impact(point, 'dirt')
      return
    }
    if (!collider) return

    const part = this.heli.partHit(collider.handle, point)
    if (part) {
      this.heli.damage.hit(part, p.damage)
      this.fx.impact(point, 'metal')
      this.sounds.play('metalHit', point, { gain: 0.8, priority: 5 })
      this.hitFlash = Math.min(1, this.hitFlash + 0.35)
      return
    }

    const unit = this.enemies.unitFor(collider.handle)
    if (unit) {
      this.fx.impact(point, unit.kind === 'technical' ? 'metal' : 'flesh')
      if (this.enemies.damage(unit, unit.kind === 'technical' ? p.damage * 0.25 : p.damage)) this.newKills++
      return
    }

    this.fx.impact(point, 'dirt')
    if (Math.random() < 0.25 && this.sounds.audible(point, 150)) this.sounds.play('dirt', point, { gain: 0.5 })
  }

  private explode(point: Vector3, damage: number): void {
    this.fx.explosion(point)
    this.sounds.play('explosion', point, { gain: 1, priority: 6, travelDelay: true })
    this.newKills += this.enemies.splash(point, ROCKET_BLAST_RADIUS, damage)
    // Too close for comfort: shrapnel reaches the aircraft.
    const d = point.distanceTo(this.heli.object.position)
    if (d < ROCKET_BLAST_RADIUS) {
      this.heli.damage.hit('engine', 60 * (1 - d / ROCKET_BLAST_RADIUS))
      this.hitFlash = 1
    }
  }
}
