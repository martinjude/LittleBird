export type PadType = 'xbox' | 'playstation' | 'generic'

export interface PadSnapshot {
  id: string
  type: PadType
  /** True when the browser recognised the pad and remapped it to the W3C standard layout. */
  standard: boolean
  axes: number[]
  /** Analog value 0..1 for each button (triggers are analog, others 0 or 1). */
  buttons: number[]
}

export interface GamepadSource {
  /** Returns the active pad's current state, or null when none is connected. */
  poll(): PadSnapshot | null
}

/** Gamepad API wrapper: follows hot-plugging and always reports a single "active" pad. */
export class BrowserGamepadSource implements GamepadSource {
  private index: number | null = null
  private readonly snapshot: PadSnapshot = { id: '', type: 'generic', standard: true, axes: [], buttons: [] }

  constructor() {
    window.addEventListener('gamepadconnected', (e) => {
      console.info(`Gamepad connected: ${e.gamepad.id} (mapping: "${e.gamepad.mapping}")`)
      if (this.index === null) this.index = e.gamepad.index
    })
    window.addEventListener('gamepaddisconnected', (e) => {
      console.info(`Gamepad disconnected: ${e.gamepad.id}`)
      if (this.index === e.gamepad.index) this.index = null
    })
  }

  poll(): PadSnapshot | null {
    const pads = navigator.getGamepads()
    let pad = this.index !== null ? pads[this.index] : null
    if (!pad?.connected) {
      // Active pad gone (or never picked): fall back to any other connected pad.
      pad = pads.find((p) => p?.connected) ?? null
      this.index = pad?.index ?? null
    }
    if (!pad) return null

    const s = this.snapshot
    if (s.id !== pad.id) {
      s.id = pad.id
      s.type = detectPadType(pad.id)
    }
    s.standard = pad.mapping === 'standard'
    s.axes.length = pad.axes.length
    for (let i = 0; i < pad.axes.length; i++) s.axes[i] = pad.axes[i]
    s.buttons.length = pad.buttons.length
    for (let i = 0; i < pad.buttons.length; i++) s.buttons[i] = pad.buttons[i].value
    return s
  }
}

export function detectPadType(id: string): PadType {
  const s = id.toLowerCase()
  // Microsoft's USB vendor id is 045e, Sony's 054c. Check Xbox first: both
  // "Xbox Wireless Controller" and the DualShock 4 ("Wireless Controller") share that phrase.
  if (/xbox|xinput|045e/.test(s)) return 'xbox'
  if (/dualsense|dualshock|playstation|wireless controller|054c/.test(s)) return 'playstation'
  return 'generic'
}
