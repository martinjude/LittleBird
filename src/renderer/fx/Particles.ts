import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  NormalBlending,
  Points,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  type Vector3,
} from 'three'

export interface ParticleSpec {
  life: number
  /** Start and end size (m). */
  size: [number, number]
  color: Color | number
  /** Peak opacity. */
  alpha?: number
  velocity?: Vector3
  /** Fraction of velocity lost per second. */
  drag?: number
  /** Upward acceleration (m/s²); negative falls. */
  buoyancy?: number
}

/**
 * Generic billboard particle pool in one draw call. Use `additive` for fire, flashes and
 * sparks; normal blending for dust and smoke.
 */
export class Particles {
  readonly points: Points<BufferGeometry, ShaderMaterial>

  private readonly max: number
  private readonly pos: Float32Array
  private readonly vel: Float32Array
  private readonly color: Float32Array
  private readonly size: Float32Array
  private readonly alpha: Float32Array
  private readonly age: Float32Array
  private readonly life: Float32Array
  private readonly sizes: Float32Array
  private readonly peak: Float32Array
  private readonly drag: Float32Array
  private readonly buoyancy: Float32Array
  private next = 0
  private readonly tmpColor = new Color()

  constructor(max: number, additive: boolean, name: string) {
    this.max = max
    this.pos = new Float32Array(max * 3)
    this.vel = new Float32Array(max * 3)
    this.color = new Float32Array(max * 3)
    this.size = new Float32Array(max)
    this.alpha = new Float32Array(max)
    this.age = new Float32Array(max)
    this.life = new Float32Array(max)
    this.sizes = new Float32Array(max * 2)
    this.peak = new Float32Array(max)
    this.drag = new Float32Array(max)
    this.buoyancy = new Float32Array(max)

    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(this.pos, 3))
    g.setAttribute('color', new BufferAttribute(this.color, 3))
    g.setAttribute('size', new BufferAttribute(this.size, 1))
    g.setAttribute('alpha', new BufferAttribute(this.alpha, 1))
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
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.05, d) * vAlpha;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vColor, a);
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      blending: additive ? AdditiveBlending : NormalBlending,
      fog: true,
    })
    this.points = new Points(g, material)
    this.points.frustumCulled = false
    this.points.name = name
    // Additive glow draws after the smoke it sits in.
    this.points.renderOrder = additive ? 2 : 1
  }

  setViewport(heightPx: number, fovDeg: number): void {
    this.points.material.uniforms['pixelScale'].value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360))
  }

  spawn(position: Vector3, spec: ParticleSpec): void {
    const i = this.next
    this.next = (this.next + 1) % this.max
    const k = i * 3
    this.pos[k] = position.x
    this.pos[k + 1] = position.y
    this.pos[k + 2] = position.z
    this.vel[k] = spec.velocity?.x ?? 0
    this.vel[k + 1] = spec.velocity?.y ?? 0
    this.vel[k + 2] = spec.velocity?.z ?? 0
    const c = typeof spec.color === 'number' ? this.tmpColor.set(spec.color) : spec.color
    this.color[k] = c.r
    this.color[k + 1] = c.g
    this.color[k + 2] = c.b
    this.age[i] = 0
    this.life[i] = spec.life
    this.sizes[i * 2] = spec.size[0]
    this.sizes[i * 2 + 1] = spec.size[1]
    this.size[i] = spec.size[0]
    this.peak[i] = spec.alpha ?? 1
    this.alpha[i] = 0
    this.drag[i] = spec.drag ?? 0
    this.buoyancy[i] = spec.buoyancy ?? 0
  }

  clear(): void {
    this.life.fill(0)
    this.alpha.fill(0)
  }

  update(dt: number, wind: Vector3): void {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue
      const age = (this.age[i] += dt)
      if (age >= this.life[i]) {
        this.life[i] = 0
        this.alpha[i] = 0
        continue
      }
      const k = i * 3
      const keep = Math.max(0, 1 - this.drag[i] * dt)
      // Slow particles end up riding the wind.
      this.vel[k] = this.vel[k] * keep + wind.x * (1 - keep)
      this.vel[k + 1] = this.vel[k + 1] * keep + this.buoyancy[i] * dt
      this.vel[k + 2] = this.vel[k + 2] * keep + wind.z * (1 - keep)
      this.pos[k] += this.vel[k] * dt
      this.pos[k + 1] += this.vel[k + 1] * dt
      this.pos[k + 2] += this.vel[k + 2] * dt
      const t = age / this.life[i]
      this.size[i] = this.sizes[i * 2] + (this.sizes[i * 2 + 1] - this.sizes[i * 2]) * Math.sqrt(t)
      this.alpha[i] = this.peak[i] * Math.min(1, age * 12) * (1 - t) ** 1.5
    }
    const g = this.points.geometry
    for (const name of ['position', 'size', 'alpha', 'color']) g.getAttribute(name).needsUpdate = true
  }
}
