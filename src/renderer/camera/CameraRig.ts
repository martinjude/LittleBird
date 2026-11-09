import { MathUtils, Quaternion, Vector3, type Object3D, type PerspectiveCamera } from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

export type CameraMode = 'chase' | 'cockpit' | 'orbit'

export interface LookInput {
  /** Radians this frame (+ = right / up). */
  yaw: number
  pitch: number
  /** Free-look held: offsets accumulate. Released: they ease back to centre. */
  active: boolean
}

const X = new Vector3(1, 0, 0)
const Y = new Vector3(0, 1, 0)

/**
 * Chase (third person), cockpit (first person) and orbit (dev) cameras around a target.
 * The target is the interpolated helicopter object, so cameras never see physics stutter.
 */
export class CameraRig {
  mode: CameraMode = 'chase'

  readonly chase = {
    distance: 13,
    height: 3.2,
    lookHeight: 1.8,
    /** How quickly the camera swings round behind a turning helicopter (1/s). */
    yawStiffness: 3.5,
    /** Positional smoothing (1/s); higher = stiffer. */
    stiffness: 14,
  }
  /** Pilot eye point in body space (right seat; +X is left). Set from the model's `Eye_Pilot`. */
  readonly eye = new Vector3(-0.35, 1.75, 0.55)

  readonly orbit: OrbitControls
  /** Camera shake amount 0..1 (rotor damage vibration). */
  shake = 0
  /** Called after the projection changes (near plane on mode switch), e.g. to refit shadow cascades. */
  onProjectionChange?: () => void

  private heading = 0
  private initialised = false
  private lookYaw = 0
  private lookPitch = 0
  private readonly smoothed = new Vector3()
  private readonly desired = new Vector3()
  private readonly focus = new Vector3()
  private readonly forward = new Vector3()
  private readonly q = new Quaternion()

  constructor(
    private readonly camera: PerspectiveCamera,
    dom: HTMLElement,
  ) {
    this.orbit = new OrbitControls(camera, dom)
    this.orbit.enableDamping = true
    this.orbit.enablePan = false
    this.orbit.minDistance = 4
    this.orbit.maxDistance = 400
    this.setMode('chase')
  }

  setMode(mode: CameraMode): void {
    this.mode = mode
    this.orbit.enabled = mode === 'orbit'
    this.camera.near = mode === 'cockpit' ? 0.05 : 0.2
    this.camera.updateProjectionMatrix()
    this.onProjectionChange?.()
    this.lookYaw = this.lookPitch = 0
    this.initialised = false
  }

  /** Switches between the two in-game views. */
  toggleView(): void {
    this.setMode(this.mode === 'chase' ? 'cockpit' : 'chase')
  }

  update(dt: number, target: Object3D, look: LookInput): void {
    this.updateLook(dt, look)
    if (this.mode === 'chase') this.updateChase(dt, target)
    else if (this.mode === 'cockpit') this.updateCockpit(target)
    else this.updateOrbit(dt, target)
    if (this.shake > 0 && this.mode !== 'orbit') {
      const a = this.shake * (this.mode === 'cockpit' ? 0.03 : 0.12)
      this.camera.position.x += (Math.random() - 0.5) * a
      this.camera.position.y += (Math.random() - 0.5) * a
      this.camera.position.z += (Math.random() - 0.5) * a
    }
  }

  private updateLook(dt: number, look: LookInput): void {
    if (look.active) {
      this.lookYaw += look.yaw
      this.lookPitch += look.pitch
    } else {
      const decay = Math.exp(-5 * dt)
      this.lookYaw *= decay
      this.lookPitch *= decay
    }
    if (this.mode === 'cockpit') {
      this.lookYaw = MathUtils.clamp(this.lookYaw, -2.6, 2.6)
      this.lookPitch = MathUtils.clamp(this.lookPitch, -1.2, 1.0)
    } else {
      this.lookYaw = wrap(this.lookYaw)
      this.lookPitch = MathUtils.clamp(this.lookPitch, -1.0, 1.2)
    }
  }

  private updateChase(dt: number, target: Object3D): void {
    const c = this.chase
    // Follow heading only, so pitching and rolling don't throw the camera around.
    this.forward.set(0, 0, 1).applyQuaternion(target.quaternion)
    const targetHeading = Math.atan2(this.forward.x, this.forward.z)
    if (!this.initialised) this.heading = targetHeading
    this.heading += wrap(targetHeading - this.heading) * (1 - Math.exp(-c.yawStiffness * dt))

    // Rotation about +Y is counter-clockwise from above, so looking right subtracts.
    const yaw = this.heading - this.lookYaw
    const elevation = MathUtils.clamp(Math.atan2(c.height, c.distance) - this.lookPitch, -0.25, 1.35)
    this.focus.copy(target.position).y += c.lookHeight
    this.desired.set(
      -Math.sin(yaw) * Math.cos(elevation) * c.distance,
      Math.sin(elevation) * c.distance,
      -Math.cos(yaw) * Math.cos(elevation) * c.distance,
    )
    this.desired.add(this.focus)
    this.desired.y = Math.max(this.desired.y, 0.5)

    if (!this.initialised) this.smoothed.copy(this.desired)
    else this.smoothed.lerp(this.desired, 1 - Math.exp(-c.stiffness * dt))
    this.initialised = true

    this.camera.position.copy(this.smoothed)
    this.camera.lookAt(this.focus)
  }

  private updateCockpit(target: Object3D): void {
    this.camera.position.copy(this.eye).applyQuaternion(target.quaternion).add(target.position)
    // Camera looks down its -Z; the nose is +Z, so turn round, then apply head look.
    this.camera.quaternion
      .copy(target.quaternion)
      .multiply(this.q.setFromAxisAngle(Y, Math.PI - this.lookYaw))
      .multiply(this.q.setFromAxisAngle(X, this.lookPitch))
  }

  private updateOrbit(dt: number, target: Object3D): void {
    this.focus.copy(target.position).y += this.chase.lookHeight
    if (!this.initialised) {
      this.camera.position.copy(this.focus).add(new Vector3(-14, 5, -14))
      this.orbit.target.copy(this.focus)
      this.initialised = true
    }
    // Carry the camera along with the helicopter, keeping the user's chosen angle.
    this.camera.position.add(this.desired.subVectors(this.focus, this.orbit.target))
    this.orbit.target.copy(this.focus)
    this.orbit.update(dt)
  }
}

function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a))
}
