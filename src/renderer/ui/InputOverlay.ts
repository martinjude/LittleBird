import { BUTTON_ACTIONS, type ButtonAction } from '../../shared/bindings'
import type { InputState } from '../input/InputSystem'

const CHIP_LABELS: Record<ButtonAction, string> = {
  fireGuns: 'Guns',
  fireRockets: 'Rockets',
  toggleCamera: 'Camera',
  interact: 'Interact',
  freeLook: 'Look',
  pause: 'Pause',
  reset: 'Reset',
}

/** Debug readout of live input actions (shown with the F3 debug panel). */
export class InputOverlay {
  private readonly device: HTMLElement
  private readonly collectiveFill: HTMLElement
  private readonly collectiveValue: HTMLElement
  private readonly cyclicDot: HTMLElement
  private readonly cyclicValue: HTMLElement
  private readonly pedalsDot: HTMLElement
  private readonly pedalsValue: HTMLElement
  private readonly look: HTMLElement
  private readonly chips = {} as Record<ButtonAction, HTMLElement>
  private lookYaw = 0
  private lookPitch = 0

  constructor(parent: HTMLElement) {
    const root = el('div', 'input-overlay', parent)
    this.device = el('div', 'io-device', root)

    const gauges = el('div', 'io-gauges', root)

    const col = gauge(gauges, 'Collective')
    const colTrack = el('div', 'io-track io-vertical', col.body)
    this.collectiveFill = el('div', 'io-fill', colTrack)
    this.collectiveValue = col.value

    const cyc = gauge(gauges, 'Cyclic')
    const cycTrack = el('div', 'io-track io-square', cyc.body)
    this.cyclicDot = el('div', 'io-dot', cycTrack)
    this.cyclicValue = cyc.value

    const ped = gauge(gauges, 'Pedals')
    const pedTrack = el('div', 'io-track io-horizontal', ped.body)
    this.pedalsDot = el('div', 'io-dot', pedTrack)
    this.pedalsValue = ped.value

    const chips = el('div', 'io-chips', root)
    for (const action of BUTTON_ACTIONS) this.chips[action] = el('span', '', chips, CHIP_LABELS[action])
    this.look = el('div', 'io-look', root)
  }

  update(s: InputState): void {
    this.device.textContent = s.device === 'gamepad' && s.pad ? `🎮 ${s.pad.type} · ${s.pad.id}` : '⌨ Keyboard / mouse'
    if (s.device !== 'gamepad' && s.pad) this.device.textContent += `   (pad connected: ${s.pad.type})`

    this.collectiveFill.style.height = `${s.collective * 100}%`
    this.collectiveValue.textContent = s.collective.toFixed(2)

    // Track is 72px; stick forward (+pitch) moves the dot up.
    this.cyclicDot.style.transform = `translate(${s.cyclicRoll * 36}px, ${-s.cyclicPitch * 36}px)`
    this.cyclicValue.textContent = `${fmt(s.cyclicPitch)} / ${fmt(s.cyclicRoll)}`
    this.pedalsDot.style.transform = `translate(${s.pedals * 36}px, 0)`
    this.pedalsValue.textContent = fmt(s.pedals)

    for (const action of BUTTON_ACTIONS) this.chips[action].classList.toggle('on', s.buttons[action].down)

    this.lookYaw += s.lookYaw
    this.lookPitch += s.lookPitch
    this.look.textContent = `look Σ yaw ${deg(this.lookYaw)}°  pitch ${deg(this.lookPitch)}°`
  }
}

function el(tag: string, className: string, parent: HTMLElement, text = ''): HTMLElement {
  const e = document.createElement(tag)
  e.className = className
  e.textContent = text
  parent.appendChild(e)
  return e
}

function gauge(parent: HTMLElement, label: string) {
  const g = el('div', 'io-gauge', parent)
  el('div', 'io-label', g, label)
  const body = el('div', 'io-body', g)
  const value = el('div', 'io-value', g)
  return { body, value }
}

const fmt = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(2)
const deg = (rad: number) => Math.round((rad * 180) / Math.PI)
