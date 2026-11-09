import {
  BufferAttribute,
  BufferGeometry,
  Color,
  NormalBlending,
  Points,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector3,
} from 'three'
import { createRandom } from '../core/random'

const MAX_PARTICLES = 600

interface Emitter {
  position: Vector3
  color: Color
  /** Seconds left of active burning. */
  burn: number
  accumulator: number
}

export interface Downwash {
  /** Rotor hub position. */
  position: Vector3
  /** 0..1 strength (thrust / weight works). */
  strength: number
}

/**
 * Coloured smoke grenades: soft billboard puffs that rise, grow, drift with the wind and get
 * blasted outward by rotor downwash. All emitters share one Points draw call.
 */
export class Smoke {
  readonly points: Points<BufferGeometry, ShaderMaterial>

  private readonly emitters: Emitter[] = []
  private readonly pos = new Float32Array(MAX_PARTICLES * 3)
  private readonly vel = new Float32Array(MAX_PARTICLES * 3)
  private readonly color = new Float32Array(MAX_PARTICLES * 3)
  private readonly size = new Float32Array(MAX_PARTICLES)
  private readonly alpha = new Float32Array(MAX_PARTICLES)
  private readonly age = new Float32Array(MAX_PARTICLES)
  private readonly life = new Float32Array(MAX_PARTICLES)
  /** Height each puff can't sink below (the ground where its grenade lies). */
  private readonly ground = new Float32Array(MAX_PARTICLES)
  private next = 0
  private readonly rand = createRandom(31)

  /** Puffs per second while a grenade burns. */
  rate = 14

  constructor() {
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(this.pos, 3))
    g.setAttribute('color', new BufferAttribute(this.color, 3))
    g.setAttribute('size', new BufferAttribute(this.size, 1))
    g.setAttribute('alpha', new BufferAttribute(this.alpha, 1))
    this.life.fill(0)

    const material = new ShaderMaterial({
      uniforms: UniformsUtils.merge([UniformsLib.fog, { pixelScale: { value: 600 } }]),
      vertexShader: /* glsl */ `
        attribute float size;
        attribute float alpha;
        attribute vec3 color;
        uniform float pixelScale;
        varying float vAlpha;
        varying vec3 vColor;
        #include <fog_pars_vertex>
        void main() {
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * pixelScale / max(-mvPosition.z, 0.1);
          gl_Position = projectionMatrix * mvPosition;
          vAlpha = alpha;
          vColor = color;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        varying vec3 vColor;
        #include <fog_pars_fragment>
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          // Soft, slightly lumpy puff.
          float a = smoothstep(0.5, 0.1, d) * vAlpha * (0.85 + 0.15 * sin(c.x * 23.0 + c.y * 17.0));
          if (a < 0.01) discard;
          gl_FragColor = vec4(vColor, a);
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
      fog: true,
    })
    this.points = new Points(g, material)
    this.points.frustumCulled = false
    this.points.name = 'Smoke'
  }

  /** Call on resize/FOV change: point sizes are in world meters at this projection. */
  setViewport(heightPx: number, fovDeg: number): void {
    this.points.material.uniforms['pixelScale'].value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360))
  }

  /** Pops a grenade at `position` that burns for `seconds`. */
  emit(position: Vector3, color: number, seconds = 90): void {
    this.emitters.push({ position: position.clone(), color: new Color(color), burn: seconds, accumulator: 0 })
  }

  clear(): void {
    this.emitters.length = 0
    this.life.fill(0)
    this.alpha.fill(0)
  }

  update(dt: number, wind: Vector3, downwash: Downwash | null): void {
    for (const e of this.emitters) {
      if (e.burn <= 0) continue
      e.burn -= dt
      e.accumulator += dt * this.rate
      while (e.accumulator >= 1) {
        e.accumulator -= 1
        this.spawn(e)
      }
    }
    for (let i = this.emitters.length - 1; i >= 0; i--) if (this.emitters[i].burn <= 0) this.emitters.splice(i, 1)

    const r = this.rand
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.life[i] <= 0) continue
      const age = (this.age[i] += dt)
      if (age >= this.life[i]) {
        this.life[i] = 0
        this.alpha[i] = 0
        continue
      }
      const k = i * 3
      // Drift toward the wind, with a little turbulence; the plume slows its rise as it cools.
      this.vel[k] += ((wind.x - this.vel[k]) * 0.6 + (r() - 0.5) * 0.8) * dt
      this.vel[k + 1] += ((0.4 - this.vel[k + 1]) * 0.3) * dt
      this.vel[k + 2] += ((wind.z - this.vel[k + 2]) * 0.6 + (r() - 0.5) * 0.8) * dt

      if (downwash) {
        const dx = this.pos[k] - downwash.position.x
        const dy = this.pos[k + 1] - downwash.position.y
        const dz = this.pos[k + 2] - downwash.position.z
        const horiz = Math.hypot(dx, dz)
        // A cylinder of air under the disc pushes down, then spreads out along the ground.
        if (dy < 2 && dy > -30 && horiz < 18) {
          const push = downwash.strength * 16 * (1 - horiz / 18) * dt
          this.vel[k] += (dx / (horiz + 0.5)) * push
          this.vel[k + 2] += (dz / (horiz + 0.5)) * push
          this.vel[k + 1] -= push * 0.5
        }
      }

      this.pos[k] += this.vel[k] * dt
      this.pos[k + 1] = Math.max(this.pos[k + 1] + this.vel[k + 1] * dt, this.ground[i])
      this.pos[k + 2] += this.vel[k + 2] * dt

      const t = age / this.life[i]
      this.size[i] = 1.2 + t * 11
      this.alpha[i] = Math.min(1, age * 2) * (1 - t) ** 1.5 * 0.75
    }

    const g = this.points.geometry
    for (const name of ['position', 'size', 'alpha', 'color']) g.getAttribute(name).needsUpdate = true
  }

  private spawn(e: Emitter): void {
    const i = this.next
    this.next = (this.next + 1) % MAX_PARTICLES
    const r = this.rand
    const k = i * 3
    this.pos[k] = e.position.x + (r() - 0.5) * 0.4
    this.pos[k + 1] = e.position.y + 0.3
    this.pos[k + 2] = e.position.z + (r() - 0.5) * 0.4
    this.ground[i] = e.position.y + 0.2
    this.vel[k] = (r() - 0.5) * 0.6
    this.vel[k + 1] = 1.6 + r() * 0.8
    this.vel[k + 2] = (r() - 0.5) * 0.6
    // Slight per-puff shade variation.
    const shade = 0.85 + r() * 0.25
    this.color[k] = e.color.r * shade
    this.color[k + 1] = e.color.g * shade
    this.color[k + 2] = e.color.b * shade
    this.age[i] = 0
    this.life[i] = 9 + r() * 5
    this.size[i] = 1.2
    this.alpha[i] = 0
  }
}
