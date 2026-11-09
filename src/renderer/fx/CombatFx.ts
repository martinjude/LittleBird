import { Color, PointLight, Vector3, type Scene } from 'three'
import { createRandom } from '../core/random'
import { Particles } from './Particles'
import { Tracers } from './Tracers'

export type ImpactKind = 'dirt' | 'metal' | 'flesh' | 'wood'

interface Burner {
  position: Vector3
  until: number
  intensity: number
}

const FLASH_LIGHTS = 4

/** Muzzle flashes, impacts, explosions, rocket trails, tracers and burning wrecks. */
export class CombatFx {
  readonly dust = new Particles(2500, false, 'Dust')
  readonly fire = new Particles(1200, true, 'Fire')
  readonly tracers = new Tracers()

  private readonly flashes: { light: PointLight; time: number; duration: number }[] = []
  private readonly burners: Burner[] = []
  private readonly rand = createRandom(77)
  private readonly v = new Vector3()
  private readonly p = new Vector3()
  private time = 0

  constructor(scene: Scene) {
    scene.add(this.dust.points, this.fire.points, this.tracers.lines)
    // A fixed set of lights, so turning flashes on and off never forces shader recompiles.
    for (let i = 0; i < FLASH_LIGHTS; i++) {
      const light = new PointLight(0xffaa55, 0, 60, 2)
      scene.add(light)
      this.flashes.push({ light, time: 0, duration: 0 })
    }
  }

  setViewport(height: number, fov: number): void {
    this.dust.setViewport(height, fov)
    this.fire.setViewport(height, fov)
  }

  clear(): void {
    this.dust.clear()
    this.fire.clear()
    this.burners.length = 0
  }

  muzzleFlash(position: Vector3, direction: Vector3, big = false): void {
    const r = this.rand
    this.fire.spawn(position, { life: 0.05, size: big ? [1.0, 1.4] : [0.6, 0.9], color: 0xffc070, alpha: 1 })
    this.fire.spawn(this.p.copy(position).addScaledVector(direction, 0.6), {
      life: 0.04,
      size: [0.4, 0.6],
      color: 0xffe0a0,
      velocity: this.v.copy(direction).multiplyScalar(20),
    })
    if (r() < 0.25) this.dust.spawn(position, { life: 1.2, size: [0.4, 1.6], color: 0x8a8580, alpha: 0.25, velocity: this.v.copy(direction).multiplyScalar(4), drag: 2 })
  }

  impact(position: Vector3, kind: ImpactKind): void {
    const r = this.rand
    if (kind === 'metal') {
      for (let i = 0; i < 4; i++) {
        this.fire.spawn(position, { life: 0.25, size: [0.25, 0.1], color: 0xffd080, velocity: this.v.set(r() - 0.5, r(), r() - 0.5).multiplyScalar(14), drag: 1, buoyancy: -9 })
      }
      return
    }
    const color = kind === 'flesh' ? 0x6b2a20 : kind === 'wood' ? 0x5a4630 : 0x7a6a50
    this.dust.spawn(position, { life: 1.4, size: [0.5, 2.6], color, alpha: 0.7, velocity: this.v.set((r() - 0.5) * 2, 3 + r() * 2, (r() - 0.5) * 2), drag: 2.5, buoyancy: -2 })
    if (r() < 0.5) this.dust.spawn(position, { life: 0.6, size: [0.2, 0.8], color: 0x4a3e30, alpha: 0.8, velocity: this.v.set((r() - 0.5) * 6, 6 + r() * 4, (r() - 0.5) * 6), buoyancy: -12 })
  }

  explosion(position: Vector3, scale = 1): void {
    const r = this.rand
    for (let i = 0; i < 14; i++) {
      this.fire.spawn(position, {
        life: 0.35 + r() * 0.4,
        size: [2 * scale, (6 + r() * 4) * scale],
        color: new Color().setHSL(0.07 + r() * 0.04, 1, 0.5 + r() * 0.2),
        velocity: this.v.set(r() - 0.5, r() * 0.8, r() - 0.5).multiplyScalar(18 * scale),
        drag: 4,
      })
    }
    for (let i = 0; i < 18; i++) {
      this.dust.spawn(position, {
        life: 4 + r() * 4,
        size: [2 * scale, (10 + r() * 8) * scale],
        color: new Color().setHSL(0.08, 0.1, 0.12 + r() * 0.15),
        alpha: 0.85,
        velocity: this.v.set(r() - 0.5, r() * 0.9 + 0.2, r() - 0.5).multiplyScalar(14 * scale),
        drag: 1.6,
        buoyancy: 1.5,
      })
    }
    for (let i = 0; i < 10; i++) {
      this.dust.spawn(position, { life: 1.5, size: [0.3, 0.5], color: 0x3a3028, velocity: this.v.set(r() - 0.5, r() + 0.5, r() - 0.5).multiplyScalar(25 * scale), buoyancy: -14 })
    }
    this.flash(position, 9 * scale, 0.35)
  }

  rocketTrail(position: Vector3, motor: boolean): void {
    const r = this.rand
    if (motor) this.fire.spawn(position, { life: 0.08, size: [0.7, 0.3], color: 0xffd090 })
    this.dust.spawn(position, { life: motor ? 2.5 : 1.5, size: [0.5, 2.8], color: 0xcfcac2, alpha: 0.6, velocity: this.v.set(r() - 0.5, r() - 0.3, r() - 0.5), drag: 1.5, buoyancy: 0.3 })
  }

  /** A wreck that keeps burning and smoking for a while. */
  burn(position: Vector3, seconds: number, intensity = 1): void {
    this.burners.push({ position: position.clone(), until: this.time + seconds, intensity })
  }

  update(dt: number, wind: Vector3): void {
    this.time += dt
    const r = this.rand
    for (let i = this.burners.length - 1; i >= 0; i--) {
      const b = this.burners[i]
      if (this.time > b.until) {
        this.burners.splice(i, 1)
        continue
      }
      if (r() < 18 * dt * b.intensity) {
        this.fire.spawn(this.p.copy(b.position).add(this.v.set((r() - 0.5) * 1.5, r() * 0.5, (r() - 0.5) * 1.5)), {
          life: 0.5 + r() * 0.4,
          size: [1, 2.2],
          color: new Color().setHSL(0.06 + r() * 0.04, 1, 0.5),
          velocity: this.v.set(0, 3 + r() * 2, 0),
        })
      }
      if (r() < 8 * dt * b.intensity) {
        this.dust.spawn(this.p.copy(b.position).setY(b.position.y + 2), {
          life: 8 + r() * 4,
          size: [2, 12],
          color: new Color().setHSL(0, 0, 0.06 + r() * 0.06),
          alpha: 0.7,
          velocity: this.v.set((r() - 0.5) * 0.6, 3 + r() * 1.5, (r() - 0.5) * 0.6),
          drag: 0.3,
          buoyancy: 0.2,
        })
      }
    }
    this.dust.update(dt, wind)
    this.fire.update(dt, wind)
    for (const f of this.flashes) {
      if (f.duration <= 0) continue
      f.time += dt
      const k = Math.max(0, 1 - f.time / f.duration)
      f.light.intensity = f.light.userData['peak'] * k * k
      if (k === 0) f.duration = 0
    }
  }

  private flash(position: Vector3, peak: number, duration: number): void {
    // Reuse the oldest light.
    const f = this.flashes.reduce((a, b) => (a.duration <= 0 ? a : b.duration <= 0 ? b : a.time > b.time ? a : b))
    f.light.position.copy(position).setY(position.y + 2)
    f.light.userData['peak'] = peak * 400
    f.light.intensity = f.light.userData['peak']
    f.time = 0
    f.duration = duration
  }
}
