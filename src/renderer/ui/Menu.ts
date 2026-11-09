import { DEFAULT_BINDINGS, PAD, type AxisAction, type ButtonAction } from '../../shared/bindings'
import type { AssistMode } from '../../shared/settings'
import type { SettingsStore } from '../core/SettingsStore'
import type { InputState } from '../input/InputSystem'
import { keyLabel, padButtonLabel, padStickLabel, type KeyboardLayout } from '../input/labels'
import { MISSIONS } from '../missions/missions'

export type MenuScreen = 'main' | 'missions' | 'settings' | 'controls'

export interface MenuHooks {
  resume(): void
  startMission(index: number): void
  restartMission(): void
  quit(): void
  /** Graphics/audio/flight settings changed: re-apply them. */
  settingsChanged(): void
  bindingsChanged(): void
  /** A mission is under way (vs. sitting at its briefing). */
  inMission(): boolean
  siteName(id: string): string
}

type KeySlot = { kind: 'keyAxis'; axis: AxisAction; dir: 'positive' | 'negative' } | { kind: 'keyButton'; action: ButtonAction }
type PadSlot = { kind: 'padAxis'; axis: AxisAction } | { kind: 'padButton'; action: ButtonAction }
type Slot = KeySlot | PadSlot

interface ControlRow {
  label: string
  key: KeySlot
  pad: PadSlot | null
  /** Hint shown while capturing a stick axis. */
  push?: string
}

const ROWS: ControlRow[] = [
  { label: 'Collective up', key: { kind: 'keyAxis', axis: 'collective', dir: 'positive' }, pad: { kind: 'padAxis', axis: 'collective' }, push: 'Push the stick UP' },
  { label: 'Collective down', key: { kind: 'keyAxis', axis: 'collective', dir: 'negative' }, pad: null },
  { label: 'Cyclic forward', key: { kind: 'keyAxis', axis: 'cyclicPitch', dir: 'positive' }, pad: { kind: 'padAxis', axis: 'cyclicPitch' }, push: 'Push the stick FORWARD' },
  { label: 'Cyclic back', key: { kind: 'keyAxis', axis: 'cyclicPitch', dir: 'negative' }, pad: null },
  { label: 'Cyclic left', key: { kind: 'keyAxis', axis: 'cyclicRoll', dir: 'negative' }, pad: { kind: 'padAxis', axis: 'cyclicRoll' }, push: 'Push the stick RIGHT' },
  { label: 'Cyclic right', key: { kind: 'keyAxis', axis: 'cyclicRoll', dir: 'positive' }, pad: null },
  { label: 'Pedal left', key: { kind: 'keyAxis', axis: 'pedals', dir: 'negative' }, pad: { kind: 'padAxis', axis: 'pedals' }, push: 'Push the stick RIGHT' },
  { label: 'Pedal right', key: { kind: 'keyAxis', axis: 'pedals', dir: 'positive' }, pad: null },
  ...(
    [
      ['fireGuns', 'Fire guns'],
      ['fireRockets', 'Fire rockets'],
      ['freeLook', 'Free look (hold)'],
      ['toggleCamera', 'Switch camera'],
      ['interact', 'Interact'],
      ['reset', 'Reset to base'],
      ['pause', 'Menu / pause'],
    ] as [ButtonAction, string][]
  ).map(([action, label]) => ({ label, key: { kind: 'keyButton', action } as KeySlot, pad: { kind: 'padButton', action } as PadSlot })),
]

/**
 * Main / pause menu: missions with best scores, settings and control rebinding.
 * Works with mouse, keyboard (Tab/Enter, Esc = back) and gamepad (D-pad, A = select, B = back).
 */
export class Menu {
  isOpen = false
  private screen: MenuScreen = 'main'
  private readonly root: HTMLElement
  private readonly panel: HTMLElement
  private focus = 0
  private prevPad: number[] = []
  private prevStickY = 0
  private capture: { slot: Slot; cell: HTMLElement; baseline: number[] } | null = null

  constructor(
    parent: HTMLElement,
    private readonly settings: SettingsStore,
    private readonly hooks: MenuHooks,
    private readonly layout: KeyboardLayout,
  ) {
    this.root = el('div', 'menu', parent)
    this.panel = el('div', 'menu-panel', this.root)
    this.root.style.display = 'none'
    window.addEventListener('keydown', (e) => this.onKeyCapture(e), true)
    window.addEventListener('mousedown', (e) => this.onMouseCapture(e), true)
  }

  open(screen: MenuScreen = 'main'): void {
    this.isOpen = true
    this.root.style.display = ''
    this.show(screen)
  }

  close(): void {
    this.cancelCapture()
    this.isOpen = false
    this.root.style.display = 'none'
  }

  /** Esc / B: back out of a sub-screen, or close the menu from the main screen during a mission. */
  back(): void {
    if (this.capture) return this.cancelCapture()
    if (this.screen !== 'main') this.show('main')
    else this.hooks.resume()
  }

  /** Gamepad navigation, polled every frame while open. */
  update(input: InputState): void {
    if (!this.isOpen) return
    const pad = input.pad
    if (!pad) {
      this.prevPad = []
      return
    }
    if (this.capture) {
      this.capturePad(pad.buttons, pad.axes)
      return
    }
    const pressed = (i: number) => (pad.buttons[i] ?? 0) > 0.5 && (this.prevPad[i] ?? 0) <= 0.5
    const stickY = pad.axes[1] ?? 0
    const stickDown = stickY > 0.6 && this.prevStickY <= 0.6
    const stickUp = stickY < -0.6 && this.prevStickY >= -0.6
    if (pressed(PAD.DOWN) || stickDown) this.moveFocus(1)
    if (pressed(PAD.UP) || stickUp) this.moveFocus(-1)
    if (pressed(PAD.LEFT)) this.adjust(-1)
    if (pressed(PAD.RIGHT)) this.adjust(1)
    if (pressed(PAD.A)) (this.focusables()[this.focus] as HTMLElement | undefined)?.click()
    if (pressed(PAD.B)) this.back()
    this.prevPad = [...pad.buttons]
    this.prevStickY = stickY
  }

  private show(screen: MenuScreen): void {
    this.cancelCapture()
    this.screen = screen
    this.panel.replaceChildren()
    if (screen === 'main') this.buildMain()
    else if (screen === 'missions') this.buildMissions()
    else if (screen === 'settings') this.buildSettings()
    else this.buildControls()
    this.focus = 0
    this.applyFocus()
  }

  // --- screens -------------------------------------------------------------

  private buildMain(): void {
    el('div', 'menu-title', this.panel, 'LITTLEBIRD')
    el('div', 'menu-subtitle', this.panel, 'MH-6 / AH-6 operations · Mountain valley')
    const list = el('div', 'menu-list', this.panel)
    const mission = MISSIONS[this.settings.value.progress.current] ?? MISSIONS[0]
    button(list, this.hooks.inMission() ? 'Resume' : `Fly: ${mission.name}`, () => this.hooks.resume(), 'primary')
    if (this.hooks.inMission()) button(list, 'Restart mission', () => this.hooks.restartMission())
    button(list, 'Missions', () => this.show('missions'))
    button(list, 'Settings', () => this.show('settings'))
    button(list, 'Controls', () => this.show('controls'))
    button(list, 'Quit', () => this.hooks.quit())
  }

  private buildMissions(): void {
    el('div', 'menu-heading', this.panel, 'Missions')
    const list = el('div', 'menu-list', this.panel)
    MISSIONS.forEach((m, i) => {
      const best = this.settings.value.progress.best[m.id]
      const b = button(list, '', () => this.hooks.startMission(i), 'mission')
      el('div', 'mm-name', b, `${i + 1}. ${m.name}${m.hostiles ? '  ·  HOSTILE' : ''}`)
      el('div', 'mm-route', b, `${this.hooks.siteName(m.pickup)} → ${this.hooks.siteName(m.drop)} · ${m.troops} troops`)
      el('div', 'mm-best', b, best !== undefined ? `Best ${best}` : 'Not flown')
    })
    button(this.panel, 'Back', () => this.show('main'), 'back')
  }

  private buildSettings(): void {
    const s = this.settings.value
    const changed = () => {
      this.settings.changed()
      this.hooks.settingsChanged()
    }
    el('div', 'menu-heading', this.panel, 'Settings')
    const body = el('div', 'menu-form', this.panel)

    section(body, 'Flight')
    select(body, 'Assist', s.controls.assist, { novice: 'Novice: attitude hold', standard: 'Standard: rate + hold', realistic: 'Realistic: no assists' }, (v) => {
      s.controls.assist = v as AssistMode
      changed()
    })
    select(body, 'Gamepad collective', s.controls.gamepadCollective, { rate: 'Rate (stick moves lever)', absolute: 'Absolute (stick = lever)' }, (v) => {
      s.controls.gamepadCollective = v as 'rate' | 'absolute'
      changed()
    })

    section(body, 'Graphics')
    slider(body, 'Field of view', s.graphics.fov, 50, 100, 1, (v) => `${v}°`, (v) => {
      s.graphics.fov = v
      changed()
    })
    slider(body, 'Render scale', s.graphics.pixelRatioCap, 0.5, 2, 0.25, (v) => `${v}×`, (v) => {
      s.graphics.pixelRatioCap = v
      changed()
    })
    slider(body, 'Tree distance', s.graphics.treeDistance, 800, 4000, 100, (v) => `${(v / 1000).toFixed(1)} km`, (v) => {
      s.graphics.treeDistance = v
      changed()
    })
    toggle(body, 'Shadows', s.graphics.shadows, (v) => {
      s.graphics.shadows = v
      changed()
    })

    section(body, 'Audio')
    for (const [key, label] of [['master', 'Master'], ['vehicle', 'Helicopter'], ['weapons', 'Weapons'], ['world', 'World'], ['ui', 'Interface']] as const) {
      slider(body, label, s.audio[key], 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`, (v) => {
        s.audio[key] = v
        changed()
      })
    }

    section(body, 'Input')
    slider(body, 'Stick deadzone', s.controls.stickDeadzone, 0, 0.4, 0.01, (v) => `${Math.round(v * 100)}%`, (v) => {
      s.controls.stickDeadzone = v
      changed()
    })
    slider(body, 'Mouse look', s.controls.mouseSensitivity * 1000, 0.5, 10, 0.5, (v) => v.toFixed(1), (v) => {
      s.controls.mouseSensitivity = v / 1000
      changed()
    })
    toggle(body, 'Invert look', s.controls.invertLookY, (v) => {
      s.controls.invertLookY = v
      changed()
    })
    button(this.panel, 'Back', () => this.show('main'), 'back')
  }

  private buildControls(): void {
    el('div', 'menu-heading', this.panel, 'Controls')
    el('div', 'menu-hint', this.panel, 'Click a binding, then press the key, button or stick. Esc cancels.')
    const table = el('div', 'menu-bindings', this.panel)
    for (const row of ROWS) {
      el('div', 'mb-label', table, row.label)
      const keyCell = button(table, this.label(row.key), () => this.startCapture(row.key, keyCell), 'binding')
      if (row.pad) {
        const pad = row.pad
        const padCell = button(table, this.label(pad), () => this.startCapture(pad, padCell, row.push), 'binding')
      } else {
        el('div', 'mb-shared', table, '↑ same axis')
      }
    }
    const actions = el('div', 'menu-row', this.panel)
    button(actions, 'Reset to defaults', () => {
      // In place: the input layer and HUD hold references to this object.
      Object.assign(this.settings.value.bindings, structuredClone(DEFAULT_BINDINGS))
      this.settings.changed()
      this.hooks.bindingsChanged()
      this.show('controls')
    })
    button(actions, 'Back', () => this.show('main'), 'back')
  }

  // --- rebinding -------------------------------------------------------------

  private label(slot: Slot): string {
    const b = this.settings.value.bindings
    switch (slot.kind) {
      case 'keyAxis':
        return keyName(b.keyboard.axes[slot.axis][slot.dir][0], this.layout)
      case 'keyButton':
        return keyName(b.keyboard.buttons[slot.action][0], this.layout)
      case 'padAxis': {
        const a = b.gamepad.axes[slot.axis]
        return `${padStickLabel(a.axis)}${a.invert ? ' (inv)' : ''}`
      }
      case 'padButton': {
        const i = b.gamepad.buttons[slot.action][0]
        return i === undefined ? '—' : padButtonLabel(i, 'xbox')
      }
    }
  }

  private startCapture(slot: Slot, cell: HTMLElement, push?: string): void {
    this.cancelCapture()
    cell.textContent = slot.kind.startsWith('pad') ? (push ?? 'Press a button…') : 'Press a key…'
    cell.classList.add('capturing')
    // Ignore whatever is already held (e.g. the A button that opened the capture).
    this.capture = { slot, cell, baseline: [] }
    this.captureBaselinePending = true
  }

  private captureBaselinePending = false

  private cancelCapture(): void {
    if (!this.capture) return
    this.capture.cell.classList.remove('capturing')
    this.capture.cell.textContent = this.label(this.capture.slot)
    this.capture = null
  }

  private finishCapture(apply: () => void): void {
    apply()
    this.settings.changed()
    this.hooks.bindingsChanged()
    this.cancelCapture()
  }

  private onKeyCapture(e: KeyboardEvent): void {
    const c = this.capture
    if (!c || !c.slot.kind.startsWith('key')) return
    e.preventDefault()
    e.stopImmediatePropagation()
    if (e.code === 'Escape') return this.cancelCapture()
    this.assignKey(c.slot as KeySlot, e.code)
  }

  private onMouseCapture(e: MouseEvent): void {
    const c = this.capture
    if (!c || !c.slot.kind.startsWith('key') || e.target === c.cell) return
    e.preventDefault()
    e.stopImmediatePropagation()
    this.assignKey(c.slot as KeySlot, `Mouse${e.button}`)
  }

  private assignKey(slot: KeySlot, code: string): void {
    const b = this.settings.value.bindings.keyboard
    this.finishCapture(() => {
      if (slot.kind === 'keyAxis') b.axes[slot.axis][slot.dir][0] = code
      else b.buttons[slot.action][0] = code
    })
  }

  private capturePad(buttons: number[], axes: number[]): void {
    const c = this.capture!
    if (this.captureBaselinePending) {
      c.baseline = [...buttons]
      this.captureBaselinePending = false
      return
    }
    // Wait for buttons held at the start to be released before accepting them.
    c.baseline = c.baseline.map((v, i) => (buttons[i] > 0.5 ? v : 0))
    const g = this.settings.value.bindings.gamepad
    if (c.slot.kind === 'padAxis') {
      const slot = c.slot
      const i = axes.findIndex((v) => Math.abs(v) > 0.7)
      if (i >= 0) this.finishCapture(() => (g.axes[slot.axis] = { axis: i, invert: axes[i] < 0 }))
      else if ((buttons[PAD.B] ?? 0) > 0.5 && c.baseline[PAD.B] <= 0.5) this.cancelCapture()
    } else if (c.slot.kind === 'padButton') {
      const slot = c.slot
      const i = buttons.findIndex((v, k) => v > 0.5 && (c.baseline[k] ?? 0) <= 0.5)
      if (i >= 0) this.finishCapture(() => (g.buttons[slot.action][0] = i))
    }
  }

  // --- focus ---------------------------------------------------------------

  private focusables(): HTMLElement[] {
    return Array.from(this.panel.querySelectorAll<HTMLElement>('button, select, input'))
  }

  private moveFocus(delta: number): void {
    const items = this.focusables()
    if (!items.length) return
    this.focus = (this.focus + delta + items.length) % items.length
    this.applyFocus()
  }

  private applyFocus(): void {
    const item = this.focusables()[this.focus]
    item?.focus({ preventScroll: false })
    item?.scrollIntoView({ block: 'nearest' })
  }

  /** D-pad left/right on a slider or dropdown. */
  private adjust(delta: number): void {
    const item = this.focusables()[this.focus]
    if (item instanceof HTMLInputElement && item.type === 'range') {
      delta > 0 ? item.stepUp() : item.stepDown()
      item.dispatchEvent(new Event('input'))
    } else if (item instanceof HTMLSelectElement) {
      item.selectedIndex = (item.selectedIndex + delta + item.options.length) % item.options.length
      item.dispatchEvent(new Event('change'))
    } else if (item instanceof HTMLInputElement && item.type === 'checkbox') {
      item.click()
    }
  }
}

// --- DOM helpers -------------------------------------------------------------

function el(tag: string, className: string, parent: HTMLElement, text = ''): HTMLElement {
  const e = document.createElement(tag)
  e.className = className
  e.textContent = text
  parent.appendChild(e)
  return e
}

function button(parent: HTMLElement, text: string, onClick: () => void, variant = ''): HTMLButtonElement {
  const b = el('button', `menu-button ${variant}`, parent, text) as HTMLButtonElement
  b.type = 'button'
  b.addEventListener('click', onClick)
  return b
}

function section(parent: HTMLElement, title: string): void {
  el('div', 'mf-section', parent, title)
}

function field(parent: HTMLElement, label: string): HTMLElement {
  const row = el('label', 'mf-row', parent)
  el('span', 'mf-label', row, label)
  return row
}

function slider(parent: HTMLElement, label: string, value: number, min: number, max: number, step: number, fmt: (v: number) => string, onChange: (v: number) => void) {
  const row = field(parent, label)
  const input = el('input', '', row) as HTMLInputElement
  Object.assign(input, { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value) })
  const out = el('span', 'mf-value', row, fmt(value))
  input.addEventListener('input', () => {
    const v = Number(input.value)
    out.textContent = fmt(v)
    onChange(v)
  })
}

function select(parent: HTMLElement, label: string, value: string, options: Record<string, string>, onChange: (v: string) => void) {
  const row = field(parent, label)
  const s = el('select', '', row) as HTMLSelectElement
  for (const [k, text] of Object.entries(options)) {
    const o = el('option', '', s, text) as HTMLOptionElement
    o.value = k
  }
  s.value = value
  s.addEventListener('change', () => onChange(s.value))
}

function toggle(parent: HTMLElement, label: string, value: boolean, onChange: (v: boolean) => void) {
  const row = field(parent, label)
  const input = el('input', '', row) as HTMLInputElement
  input.type = 'checkbox'
  input.checked = value
  input.addEventListener('change', () => onChange(input.checked))
}

function keyName(code: string | undefined, layout: KeyboardLayout): string {
  return code ? keyLabel(code, layout) : '—'
}
