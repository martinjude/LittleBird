import RAPIER from '@dimforge/rapier3d-compat'
import { BufferAttribute, BufferGeometry, LineBasicMaterial, LineSegments, type Vector3 } from 'three'

export type Rapier = typeof RAPIER

let loading: Promise<Rapier> | null = null

/** Loads the Rapier WASM module once. */
export function loadRapier(): Promise<Rapier> {
  loading ??= RAPIER.init().then(() => RAPIER)
  return loading
}

/** Thin wrapper over the Rapier world: stepping, ground probes and debug drawing. */
export class Physics {
  readonly world: RAPIER.World
  readonly debugLines: LineSegments
  debugEnabled = false

  private readonly ray: RAPIER.Ray

  constructor(
    readonly R: Rapier,
    timestep: number,
  ) {
    this.world = new R.World({ x: 0, y: -9.81, z: 0 })
    this.world.timestep = timestep
    this.ray = new R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 })

    this.debugLines = new LineSegments(
      new BufferGeometry(),
      new LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.8 }),
    )
    this.debugLines.frustumCulled = false
    this.debugLines.renderOrder = 999
    this.debugLines.visible = false
  }

  step(): void {
    this.world.step()
  }

  /** Distance straight down from `origin` to the first collider (ignoring `exclude`), or Infinity. */
  distanceDown(origin: Vector3, maxDistance: number, exclude?: RAPIER.RigidBody): number {
    this.ray.origin = { x: origin.x, y: origin.y, z: origin.z }
    const hit = this.world.castRay(this.ray, maxDistance, true, undefined, undefined, undefined, exclude)
    return hit ? hit.timeOfImpact : Infinity
  }

  /** Refreshes the collider wireframe when debug drawing is on. */
  updateDebug(): void {
    this.debugLines.visible = this.debugEnabled
    if (!this.debugEnabled) return
    const { vertices, colors } = this.world.debugRender()
    const g = this.debugLines.geometry
    g.setAttribute('position', new BufferAttribute(vertices, 3))
    g.setAttribute('color', new BufferAttribute(colors, 4))
  }
}
