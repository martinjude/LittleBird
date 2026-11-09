import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_BINDINGS, PAD } from '../../shared/bindings'
import { DEFAULT_SETTINGS, type ControlsSettings } from '../../shared/settings'
import type { GamepadSource, PadSnapshot } from './GamepadSource'
import { InputSystem } from './InputSystem'
import type { KeyboardMouseSource } from './KeyboardMouseSource'

class FakeKeyboard implements KeyboardMouseSource {
  down = new Set<string>()
  tapped = new Set<string>()
  mouse = { x: 0, y: 0 }
  activity = false
  isDown(code: string) {
    return this.down.has(code) || this.tapped.has(code)
  }
  endFrame() {
    this.tapped.clear()
  }
  takeMouseDelta(out: { x: number; y: number }) {
    out.x = this.mouse.x
    out.y = this.mouse.y
    this.mouse = { x: 0, y: 0 }
    return out
  }
  takeActivity() {
    const a = this.activity
    this.activity = false
    return a
  }
  press(code: string) {
    this.down.add(code)
    this.activity = true
  }
  /** Key went down and up again between two frames. */
  tap(code: string) {
    this.tapped.add(code)
    this.activity = true
  }
}

class FakePad implements GamepadSource {
  pad: PadSnapshot | null = null
  connect() {
    this.pad = { id: 'Xbox Wireless Controller', type: 'xbox', standard: true, axes: [0, 0, 0, 0], buttons: new Array(17).fill(0) }
    return this.pad
  }
  poll() {
    return this.pad
  }
}

const DT = 1 / 60

describe('InputSystem', () => {
  let kb: FakeKeyboard
  let pad: FakePad
  let controls: ControlsSettings
  let input: InputSystem

  beforeEach(() => {
    kb = new FakeKeyboard()
    pad = new FakePad()
    const settings = structuredClone(DEFAULT_SETTINGS)
    controls = settings.controls
    input = new InputSystem(kb, pad, controls, settings.bindings)
  })

  it('ramps keyboard cyclic toward full deflection and back to centre', () => {
    kb.press('ArrowUp')
    input.update(0.1)
    expect(input.state.cyclicPitch).toBeCloseTo(controls.keyRampUp * 0.1)
    for (let i = 0; i < 60; i++) input.update(DT)
    expect(input.state.cyclicPitch).toBe(1)
    kb.down.clear()
    for (let i = 0; i < 60; i++) input.update(DT)
    expect(input.state.cyclicPitch).toBe(0)
  })

  it('holds the collective lever where the keys left it', () => {
    kb.press('KeyW')
    input.update(0.5)
    const level = controls.collectiveRate * 0.5
    expect(input.state.collective).toBeCloseTo(level)
    kb.down.clear()
    input.update(1)
    expect(input.state.collective).toBeCloseTo(level)
    kb.press('KeyS')
    input.update(10)
    expect(input.state.collective).toBe(0)
  })

  it('maps standard-layout sticks with inversion, deadzone and switches active device', () => {
    const p = pad.connect()
    p.axes[3] = -1 // right stick fully up = cyclic forward
    p.axes[0] = 0.05 // inside deadzone
    input.update(DT)
    expect(input.state.device).toBe('gamepad')
    expect(input.state.cyclicPitch).toBeCloseTo(1)
    expect(input.state.pedals).toBe(0)
  })

  it('applies expo on the gamepad cyclic', () => {
    controls.stickDeadzone = 0
    controls.axes.cyclicRoll.expo = 1
    pad.connect().axes[2] = 0.5
    input.update(DT)
    expect(input.state.cyclicRoll).toBeCloseTo(0.125)
  })

  it('moves the collective by rate in rate mode and sets it directly in absolute mode', () => {
    const p = pad.connect()
    p.axes[1] = -1 // left stick up
    input.update(0.5)
    expect(input.state.collective).toBeCloseTo(controls.collectiveRate * 0.5)

    controls.gamepadCollective = 'absolute'
    p.axes[1] = 0
    input.update(DT)
    expect(input.state.collective).toBeCloseTo(0.5)
  })

  it('reports button edges once', () => {
    const p = pad.connect()
    p.buttons[PAD.MENU] = 1
    input.update(DT)
    expect(input.state.buttons.pause.pressed).toBe(true)
    input.update(DT)
    expect(input.state.buttons.pause.pressed).toBe(false)
    expect(input.state.buttons.pause.down).toBe(true)
    p.buttons[PAD.MENU] = 0
    input.update(DT)
    expect(input.state.buttons.pause.released).toBe(true)
  })

  it('registers a key tapped between two frames for exactly one frame', () => {
    kb.tap('Escape')
    input.update(DT)
    expect(input.state.buttons.pause.pressed).toBe(true)
    input.update(DT)
    expect(input.state.buttons.pause.down).toBe(false)
    expect(input.state.buttons.pause.released).toBe(true)
  })

  it('treats analog triggers as pressed past half travel', () => {
    const p = pad.connect()
    p.buttons[PAD.RT] = 0.3
    input.update(DT)
    expect(input.state.buttons.fireGuns.down).toBe(false)
    expect(input.state.buttons.fireGuns.value).toBeCloseTo(0.3)
    p.buttons[PAD.RT] = 0.8
    input.update(DT)
    expect(input.state.buttons.fireGuns.down).toBe(true)
  })

  it('freezes the cyclic while the gamepad free-look button is held, and looks instead', () => {
    const p = pad.connect()
    p.axes[2] = 0.6
    input.update(DT)
    const held = input.state.cyclicRoll

    p.buttons[PAD.LB] = 1
    p.axes[2] = 1
    input.update(DT)
    expect(input.state.cyclicRoll).toBeCloseTo(held)
    expect(input.state.lookYaw).toBeGreaterThan(0)

    p.buttons[PAD.LB] = 0
    input.update(DT)
    expect(input.state.cyclicRoll).toBeGreaterThan(held)
    expect(input.state.lookYaw).toBe(0)
  })

  it('uses mouse movement for free-look only while the look button is held', () => {
    kb.mouse = { x: 100, y: 0 }
    input.update(DT)
    expect(input.state.lookYaw).toBe(0)

    kb.press('Mouse2')
    kb.mouse = { x: 100, y: -40 }
    input.update(DT)
    expect(input.state.lookYaw).toBeCloseTo(100 * controls.mouseSensitivity)
    expect(input.state.lookPitch).toBeCloseTo(40 * controls.mouseSensitivity)
  })

  it('falls back to keyboard when the pad disconnects', () => {
    pad.connect().axes[0] = 1
    input.update(DT)
    expect(input.state.device).toBe('gamepad')
    pad.pad = null
    input.update(DT)
    expect(input.state.device).toBe('keyboard')
    expect(input.state.pedals).toBe(0)
  })

  it('uses whichever source deflects further when keyboard and pad disagree', () => {
    pad.connect().axes[0] = -0.4
    kb.press('KeyD')
    for (let i = 0; i < 60; i++) input.update(DT)
    expect(input.state.pedals).toBe(1)
  })
})

describe('bindings defaults', () => {
  it('bind every action on both devices', () => {
    for (const [action, keys] of Object.entries(DEFAULT_BINDINGS.keyboard.buttons)) expect(keys.length, action).toBeGreaterThan(0)
    for (const [action, buttons] of Object.entries(DEFAULT_BINDINGS.gamepad.buttons)) expect(buttons.length, action).toBeGreaterThan(0)
  })
})
