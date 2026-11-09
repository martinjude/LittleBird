import { BUTTON_ACTIONS, type AxisAction, type Bindings, type ButtonAction } from '../../shared/bindings'
import type { ControlsSettings } from '../../shared/settings'
import { clamp, expo, moveTowards, radialDeadzone } from './curves'
import type { GamepadSource, PadSnapshot } from './GamepadSource'
import type { KeyboardMouseSource } from './KeyboardMouseSource'

export type InputDevice = 'keyboard' | 'gamepad'
type CentredAxis = Exclude<AxisAction, 'collective'>

export interface ButtonState {
  down: boolean
  /** True only on the frame the button went down. Read edges in per-frame code, not in fixed steps. */
  pressed: boolean
  released: boolean
  /** 0..1 (analog for triggers). */
  value: number
}

/** Snapshot of all actions, refreshed once per frame by `InputSystem.update`. See bindings.ts for sign conventions. */
export class InputState {
  collective = 0
  cyclicPitch = 0
  cyclicRoll = 0
  pedals = 0
  /** Free-look rotation requested this frame, in radians (+yaw = right, +pitch = up). */
  lookYaw = 0
  lookPitch = 0
  readonly buttons = Object.fromEntries(
    BUTTON_ACTIONS.map((a) => [a, { down: false, pressed: false, released: false, value: 0 }]),
  ) as Record<ButtonAction, ButtonState>
  /** The device the player used most recently; drives on-screen prompts. */
  device: InputDevice = 'keyboard'
  pad: PadSnapshot | null = null
}

const CENTRED_AXES: readonly CentredAxis[] = ['cyclicPitch', 'cyclicRoll', 'pedals']
const PRESS_THRESHOLD = 0.5
/** Stick deflection that counts as "the player switched to the gamepad". */
const PAD_ACTIVITY_THRESHOLD = 0.25

/**
 * Turns raw keyboard/mouse/gamepad state into actions. Reads `controls` and
 * `bindings` live, so changes from the settings UI apply immediately.
 */
export class InputSystem {
  readonly state = new InputState()

  private readonly keyAxes: Record<CentredAxis, number> = { cyclicPitch: 0, cyclicRoll: 0, pedals: 0 }
  private readonly padAxes: number[] = []
  private readonly heldPadCyclic = { cyclicPitch: 0, cyclicRoll: 0 }
  private warnedNonStandard = false
  private readonly stick = { x: 0, y: 0 }
  private readonly mouse = { x: 0, y: 0 }

  constructor(
    private readonly keyboard: KeyboardMouseSource,
    private readonly gamepad: GamepadSource,
    private readonly controls: ControlsSettings,
    private readonly bindings: Bindings,
  ) {}

  /** Call once per rendered frame, before the simulation steps. */
  update(dt: number): void {
    const s = this.state
    const c = this.controls
    const pad = this.gamepad.poll()
    s.pad = pad
    this.processPadAxes(pad)

    const padActive =
      pad !== null &&
      (this.padAxes.some((v) => Math.abs(v) > PAD_ACTIVITY_THRESHOLD) || pad.buttons.some((v) => v > PRESS_THRESHOLD))
    const keyboardActive = this.keyboard.takeActivity()
    if (padActive) s.device = 'gamepad'
    else if (keyboardActive || pad === null) s.device = 'keyboard'

    this.updateButtons(pad)

    // Gamepad free-look borrows the cyclic stick, so the cyclic stays where it was on the
    // last frame before look was engaged instead of letting the helicopter follow the camera.
    const padLook = pad !== null && this.bindings.gamepad.buttons.freeLook.some((i) => (pad.buttons[i] ?? 0) > PRESS_THRESHOLD)
    if (!padLook) {
      this.heldPadCyclic.cyclicPitch = this.padAxis('cyclicPitch')
      this.heldPadCyclic.cyclicRoll = this.padAxis('cyclicRoll')
    }

    for (const axis of CENTRED_AXES) {
      const target = this.keyAxisTarget(axis)
      const rate = target === 0 ? c.keyRampDown : c.keyRampUp
      this.keyAxes[axis] = moveTowards(this.keyAxes[axis], target, rate * dt)

      const padValue = padLook && axis !== 'pedals' ? this.heldPadCyclic[axis] : this.padAxis(axis)
      const keyValue = this.keyAxes[axis]
      s[axis] = clamp(Math.abs(padValue) > Math.abs(keyValue) ? padValue : keyValue, -1, 1)
    }

    // The collective is a lever: it stays where it was left.
    const padCollective = this.padAxis('collective')
    if (c.gamepadCollective === 'absolute' && s.device === 'gamepad') {
      s.collective = 0.5 + 0.5 * padCollective
    } else {
      s.collective += (this.keyAxisTarget('collective') + padCollective) * c.collectiveRate * dt
    }
    s.collective = clamp(s.collective, 0, 1)

    this.keyboard.takeMouseDelta(this.mouse)
    s.lookYaw = 0
    s.lookPitch = 0
    if (s.buttons.freeLook.down) {
      const ySign = c.invertLookY ? -1 : 1
      s.lookYaw += this.mouse.x * c.mouseSensitivity
      s.lookPitch -= this.mouse.y * c.mouseSensitivity * ySign
      if (padLook) {
        s.lookYaw += this.rawPadAxis('cyclicRoll') * c.lookSpeed * dt
        s.lookPitch += this.rawPadAxis('cyclicPitch') * c.lookSpeed * dt * ySign
      }
    }

    this.keyboard.endFrame()
  }

  /** Puts the collective lever at a position (spawn, respawn, auto-start). */
  setCollective(value: number): void {
    this.state.collective = clamp(value, 0, 1)
  }

  private processPadAxes(pad: PadSnapshot | null): void {
    this.padAxes.length = 0
    if (!pad) return
    if (!pad.standard && !this.warnedNonStandard) {
      console.warn(`Gamepad "${pad.id}" has no standard mapping; default bindings may not match.`)
      this.warnedNonStandard = true
    }
    const dz = this.controls.stickDeadzone
    for (let i = 0; i < pad.axes.length; i += 2) {
      radialDeadzone(pad.axes[i], pad.axes[i + 1] ?? 0, dz, this.stick)
      this.padAxes[i] = this.stick.x
      if (i + 1 < pad.axes.length) this.padAxes[i + 1] = this.stick.y
    }
  }

  /** Bound pad axis after deadzone and invert, before the response curve. */
  private rawPadAxis(axis: AxisAction): number {
    const b = this.bindings.gamepad.axes[axis]
    const v = this.padAxes[b.axis] ?? 0
    return b.invert ? -v : v
  }

  private padAxis(axis: AxisAction): number {
    const t = this.controls.axes[axis]
    return clamp(expo(this.rawPadAxis(axis), t.expo) * t.sensitivity, -1, 1)
  }

  private keyAxisTarget(axis: AxisAction): number {
    const b = this.bindings.keyboard.axes[axis]
    const isDown = (code: string) => this.keyboard.isDown(code)
    return (b.positive.some(isDown) ? 1 : 0) - (b.negative.some(isDown) ? 1 : 0)
  }

  private updateButtons(pad: PadSnapshot | null): void {
    for (const action of BUTTON_ACTIONS) {
      const b = this.state.buttons[action]
      let value = this.bindings.keyboard.buttons[action].some((code) => this.keyboard.isDown(code)) ? 1 : 0
      if (pad) for (const i of this.bindings.gamepad.buttons[action]) value = Math.max(value, pad.buttons[i] ?? 0)
      const down = value > PRESS_THRESHOLD
      b.pressed = down && !b.down
      b.released = !down && b.down
      b.down = down
      b.value = value
    }
  }
}
