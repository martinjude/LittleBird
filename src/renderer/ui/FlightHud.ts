import type { AssistMode } from '../../shared/settings'

export interface FlightReadout {
  /** m/s */
  airspeed: number
  /** Skid height above ground, m. */
  agl: number
  /** m/s, + = climbing */
  verticalSpeed: number
  /** Compass radians (0 = north). */
  heading: number
  collective: number
  /** Engine torque, 0..1+. */
  torque: number
  assist: AssistMode
  camera: string
  inGroundEffect: boolean
  landed: boolean
  warnings: string[]
}

const KT = 1.943844
const FT = 3.28084
const FPM = 196.8504
const ASSIST_LABEL: Record<AssistMode, string> = { novice: 'NOVICE', standard: 'STANDARD', realistic: 'REALISTIC' }

/** Bottom-centre flight data strip: speed, altitude, vertical speed, heading, power, warnings. */
export class FlightHud {
  private readonly cells: Record<'spd' | 'alt' | 'vs' | 'hdg' | 'col' | 'tq', HTMLElement>
  private readonly status: HTMLElement
  private readonly warnings: HTMLElement
  private lastWarnings = ''

  constructor(root: HTMLElement) {
    const panel = el('div', 'flight-hud', root)
    const strip = el('div', 'fh-strip', panel)
    const cell = (label: string, unit: string) => {
      const c = el('div', 'fh-cell', strip)
      el('div', 'fh-label', c, label)
      const v = el('div', 'fh-value', c)
      el('div', 'fh-unit', c, unit)
      return v
    }
    this.cells = {
      spd: cell('SPD', 'kt'),
      alt: cell('ALT', 'ft agl'),
      vs: cell('V/S', 'ft/min'),
      hdg: cell('HDG', '°'),
      col: cell('COLL', '%'),
      tq: cell('TQ', '%'),
    }
    this.status = el('div', 'fh-status', panel)
    this.warnings = el('div', 'fh-warnings', panel)
  }

  update(r: FlightReadout): void {
    this.cells.spd.textContent = Math.round(r.airspeed * KT).toString()
    this.cells.alt.textContent = Number.isFinite(r.agl) ? Math.round(r.agl * FT).toString() : '—'
    const vs = Math.round((r.verticalSpeed * FPM) / 10) * 10
    this.cells.vs.textContent = (vs > 0 ? '+' : '') + vs
    const hdg = Math.round(((r.heading * 180) / Math.PI + 360) % 360) % 360
    this.cells.hdg.textContent = hdg.toString().padStart(3, '0')
    this.cells.col.textContent = Math.round(r.collective * 100).toString()
    this.cells.tq.textContent = Math.round(r.torque * 100).toString()
    this.cells.tq.classList.toggle('fh-caution', r.torque > 0.95)

    const flags = [ASSIST_LABEL[r.assist], r.camera.toUpperCase()]
    if (r.landed) flags.push('ON GROUND')
    else if (r.inGroundEffect) flags.push('IGE')
    this.status.textContent = flags.join(' · ')

    const w = r.warnings.join('|')
    if (w !== this.lastWarnings) {
      this.lastWarnings = w
      this.warnings.replaceChildren(...r.warnings.map((text) => el('span', '', null, text)))
    }
  }
}

function el(tag: string, className: string, parent: HTMLElement | null, text = ''): HTMLElement {
  const e = document.createElement(tag)
  e.className = className
  e.textContent = text
  parent?.appendChild(e)
  return e
}
