import type { Bindings } from '../../shared/bindings'
import type { InputState } from '../input/InputSystem'
import type { PadType } from '../input/GamepadSource'
import { keyLabel, padButtonLabel, padStickLabel, type KeyboardLayout } from '../input/labels'

/** Controls hint along the bottom of the screen; follows the active input device. */
export class Hud {
  private readonly banner: HTMLElement
  private shown = ''

  constructor(
    root: HTMLElement,
    private readonly bindings: Bindings,
    private readonly layout: KeyboardLayout,
  ) {
    this.banner = document.createElement('div')
    this.banner.className = 'hud-banner'
    root.appendChild(this.banner)
  }

  update(input: InputState): void {
    const padType = input.device === 'gamepad' ? (input.pad?.type ?? 'generic') : null
    const key = padType ?? 'keyboard'
    if (key === this.shown) return
    this.shown = key
    this.banner.innerHTML = `<strong>LITTLEBIRD</strong> · M5 valley<br />${padType ? this.padHint(padType) : this.keyboardHint()}`
  }

  private keyboardHint(): string {
    const kb = this.bindings.keyboard
    const k = (code: string | undefined) => (code ? `<kbd>${escape(keyLabel(code, this.layout))}</kbd>` : '?')
    const pair = (a: { negative: string[]; positive: string[] }) => `${k(a.positive[0])}${k(a.negative[0])}`
    return [
      `Collective ${pair(kb.axes.collective)}`,
      `Pedals ${k(kb.axes.pedals.negative[0])}${k(kb.axes.pedals.positive[0])}`,
      `Cyclic ${pair(kb.axes.cyclicPitch)}${k(kb.axes.cyclicRoll.negative[0])}${k(kb.axes.cyclicRoll.positive[0])}`,
      `Look hold ${k(kb.buttons.freeLook[0])}`,
      `Camera ${k(kb.buttons.toggleCamera[0])}`,
      `Reset ${k(kb.buttons.reset[0])}`,
      `Pause ${k(kb.buttons.pause[0])}`,
      `<kbd>F3</kbd> debug · <kbd>F11</kbd> fullscreen`,
    ].join(' · ')
  }

  private padHint(type: PadType): string {
    const pad = this.bindings.gamepad
    const b = (i: number | undefined) => `<kbd>${escape(i === undefined ? '?' : padButtonLabel(i, type))}</kbd>`
    const s = (axis: number) => `<kbd>${escape(padStickLabel(axis))}</kbd>`
    return [
      `Collective ${s(pad.axes.collective.axis)}`,
      `Pedals ${s(pad.axes.pedals.axis)}`,
      `Cyclic <kbd>Right stick</kbd>`,
      `Look hold ${b(pad.buttons.freeLook[0])} + right stick`,
      `Camera ${b(pad.buttons.toggleCamera[0])}`,
      `Reset ${b(pad.buttons.reset[0])}`,
      `Pause ${b(pad.buttons.pause[0])}`,
    ].join(' · ')
  }
}

function escape(s: string): string {
  return s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)
}
