import { Object3D, Quaternion, Vector3 } from 'three'

/**
 * Holds the previous and current simulation transform of a body so rendering can
 * blend between them (see GameLoop `alpha`). Without this, motion stutters whenever
 * the render rate and the 120 Hz simulation rate don't divide evenly.
 */
export class InterpolatedTransform {
  readonly position = new Vector3()
  readonly quaternion = new Quaternion()
  private readonly prevPosition = new Vector3()
  private readonly prevQuaternion = new Quaternion()

  /** Call at the start of each fixed step, before the simulation moves the body. */
  snapshot(): void {
    this.prevPosition.copy(this.position)
    this.prevQuaternion.copy(this.quaternion)
  }

  /** Sets the transform with no blending (spawns, respawns, teleports). */
  teleport(position: Vector3, quaternion: Quaternion): void {
    this.position.copy(position)
    this.quaternion.copy(quaternion)
    this.snapshot()
  }

  applyTo(object: Object3D, alpha: number): void {
    object.position.lerpVectors(this.prevPosition, this.position, alpha)
    object.quaternion.slerpQuaternions(this.prevQuaternion, this.quaternion, alpha)
  }
}
