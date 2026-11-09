import type { Object3D, Vector3 } from 'three'

/** What the Helicopter entity needs from a visual model (placeholder or loaded GLB). */
export interface HeliModel {
  readonly object: Object3D
  /** Pilot eye point in body space, if the model defines one (`Eye_Pilot`). */
  readonly eye: Vector3 | null
  /**
   * @param dt simulation-scaled seconds since the last frame (0 while paused)
   * @param tilt disc tilt in radians (forward = +pitch, right = +roll)
   */
  animate(dt: number, rotorRpm: number, tilt: { pitch: number; roll: number }): void
  setCockpitView(enabled: boolean): void
}
