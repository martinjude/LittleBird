/**
 * Input actions and their default bindings. Game code only ever reads actions;
 * which key / stick / button produces them is data, persisted with the settings.
 *
 * Sign conventions (pilot's point of view):
 *  - collective   0..1   lever position, 0 = full down
 *  - cyclicPitch  -1..1  +1 = stick forward (nose down)
 *  - cyclicRoll   -1..1  +1 = stick right
 *  - pedals       -1..1  +1 = right pedal (nose yaws right)
 */
export type AxisAction = 'collective' | 'cyclicPitch' | 'cyclicRoll' | 'pedals'
export type ButtonAction = 'fireGuns' | 'fireRockets' | 'toggleCamera' | 'interact' | 'freeLook' | 'pause' | 'reset'

export const AXIS_ACTIONS: readonly AxisAction[] = ['collective', 'cyclicPitch', 'cyclicRoll', 'pedals']
export const BUTTON_ACTIONS: readonly ButtonAction[] = [
  'fireGuns',
  'fireRockets',
  'toggleCamera',
  'interact',
  'freeLook',
  'pause',
  'reset',
]

/** Keys that push an axis toward -1 / +1. Values are `KeyboardEvent.code` (physical key, layout-independent). */
export interface KeyAxisBinding {
  negative: string[]
  positive: string[]
}

/** Index into `Gamepad.axes` (W3C standard mapping: 0 LX, 1 LY, 2 RX, 3 RY; up/left = -1). */
export interface PadAxisBinding {
  axis: number
  invert: boolean
}

export interface Bindings {
  keyboard: {
    axes: Record<AxisAction, KeyAxisBinding>
    /** `KeyboardEvent.code` values, or `Mouse0`/`Mouse1`/`Mouse2` for mouse buttons. */
    buttons: Record<ButtonAction, string[]>
  }
  gamepad: {
    axes: Record<AxisAction, PadAxisBinding>
    /** Indices into `Gamepad.buttons` (standard mapping). */
    buttons: Record<ButtonAction, number[]>
  }
}

/** Standard-mapping button indices, for readability. */
export const PAD = {
  A: 0, B: 1, X: 2, Y: 3,
  LB: 4, RB: 5, LT: 6, RT: 7,
  VIEW: 8, MENU: 9, LS: 10, RS: 11,
  UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15, HOME: 16,
} as const

export const DEFAULT_BINDINGS: Bindings = {
  keyboard: {
    axes: {
      collective: { negative: ['KeyS'], positive: ['KeyW'] },
      pedals: { negative: ['KeyA'], positive: ['KeyD'] },
      cyclicPitch: { negative: ['ArrowDown', 'Numpad2'], positive: ['ArrowUp', 'Numpad8'] },
      cyclicRoll: { negative: ['ArrowLeft', 'Numpad4'], positive: ['ArrowRight', 'Numpad6'] },
    },
    buttons: {
      fireGuns: ['Space', 'Mouse0'],
      fireRockets: ['KeyF'],
      toggleCamera: ['KeyC'],
      interact: ['KeyE'],
      freeLook: ['Mouse2'],
      pause: ['Escape', 'KeyP'],
      reset: ['KeyR'],
    },
  },
  gamepad: {
    axes: {
      collective: { axis: 1, invert: true },
      pedals: { axis: 0, invert: false },
      cyclicPitch: { axis: 3, invert: true },
      cyclicRoll: { axis: 2, invert: false },
    },
    buttons: {
      fireGuns: [PAD.RT],
      fireRockets: [PAD.LT],
      toggleCamera: [PAD.VIEW],
      interact: [PAD.A],
      freeLook: [PAD.LB],
      pause: [PAD.MENU],
      reset: [PAD.Y],
    },
  },
}
