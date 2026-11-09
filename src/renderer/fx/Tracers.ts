import { AdditiveBlending, BufferAttribute, BufferGeometry, LineBasicMaterial, LineSegments, type Vector3 } from 'three'

const MAX = 400

/** Glowing tracer streaks (one line segment each), redrawn every frame from live projectiles. */
export class Tracers {
  readonly lines: LineSegments<BufferGeometry, LineBasicMaterial>
  private readonly positions = new Float32Array(MAX * 6)
  private readonly colors = new Float32Array(MAX * 6)
  private count = 0

  constructor() {
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(this.positions, 3))
    g.setAttribute('color', new BufferAttribute(this.colors, 3))
    this.lines = new LineSegments(
      g,
      new LineBasicMaterial({ vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false, fog: false }),
    )
    this.lines.frustumCulled = false
    this.lines.renderOrder = 3
    this.lines.name = 'Tracers'
  }

  begin(): void {
    this.count = 0
  }

  /** Streak from `head` back along `velocity` for `seconds` of travel. */
  add(head: Vector3, velocity: Vector3, seconds: number, r: number, g: number, b: number): void {
    if (this.count >= MAX) return
    const k = this.count++ * 6
    this.positions[k] = head.x
    this.positions[k + 1] = head.y
    this.positions[k + 2] = head.z
    this.positions[k + 3] = head.x - velocity.x * seconds
    this.positions[k + 4] = head.y - velocity.y * seconds
    this.positions[k + 5] = head.z - velocity.z * seconds
    this.colors.set([r, g, b, r * 0.3, g * 0.3, b * 0.3], k)
  }

  end(): void {
    const g = this.lines.geometry
    g.setDrawRange(0, this.count * 2)
    g.getAttribute('position').needsUpdate = true
    g.getAttribute('color').needsUpdate = true
  }
}
