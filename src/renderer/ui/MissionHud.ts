import { Vector3, type Camera } from 'three'

export interface MissionCard {
  kind: 'briefing' | 'debrief' | 'failed'
  title: string
  lines: { text: string; points?: number }[]
  footer: string
}

export interface MissionView {
  missionName: string
  objective: string
  troopsAboard: number
  troopsTotal: number
  /** Seconds, or null to hide the timer. */
  elapsed: number | null
  target: { position: Vector3; label: string } | null
  card: MissionCard | null
}

/** Mission panel (top centre), on-screen waypoint marker, toasts and briefing/debrief cards. */
export class MissionHud {
  private readonly panel: HTMLElement
  private readonly title: HTMLElement
  private readonly objective: HTMLElement
  private readonly troops: HTMLElement
  private readonly timer: HTMLElement
  private readonly marker: HTMLElement
  private readonly markerLabel: HTMLElement
  private readonly arrow: HTMLElement
  private readonly toasts: HTMLElement
  private readonly card: HTMLElement
  private cardKey = ''
  private readonly ndc = new Vector3()

  constructor(root: HTMLElement) {
    this.panel = el('div', 'mission-panel', root)
    this.title = el('div', 'mp-title', this.panel)
    this.objective = el('div', 'mp-objective', this.panel)
    const row = el('div', 'mp-row', this.panel)
    this.troops = el('div', 'mp-troops', row)
    this.timer = el('div', 'mp-timer', row)

    this.marker = el('div', 'waypoint', root)
    el('div', 'wp-diamond', this.marker)
    this.markerLabel = el('div', 'wp-label', this.marker)
    this.arrow = el('div', 'wp-arrow', this.marker, '▲')

    this.toasts = el('div', 'toasts', root)
    this.card = el('div', 'mission-card', root)
  }

  toast(text: string, kind: 'info' | 'good' | 'bad' = 'info'): void {
    const t = el('div', `toast toast-${kind}`, this.toasts, text)
    setTimeout(() => t.classList.add('toast-out'), 3200)
    setTimeout(() => t.remove(), 3800)
    while (this.toasts.children.length > 4) this.toasts.firstElementChild?.remove()
  }

  update(v: MissionView, camera: Camera, width: number, height: number): void {
    this.title.textContent = v.missionName.toUpperCase()
    this.objective.textContent = v.objective
    this.troops.textContent = v.troopsTotal ? '● '.repeat(v.troopsAboard) + '○ '.repeat(Math.max(0, v.troopsTotal - v.troopsAboard)) : ''
    this.timer.textContent = v.elapsed === null ? '' : formatClock(v.elapsed)
    this.updateMarker(v.target, camera, width, height)
    this.updateCard(v.card)
  }

  private updateMarker(target: MissionView['target'], camera: Camera, width: number, height: number): void {
    if (!target) {
      this.marker.style.display = 'none'
      return
    }
    this.marker.style.display = ''
    this.markerLabel.textContent = target.label
    this.ndc.copy(target.position).project(camera)
    const behind = this.ndc.z > 1
    let x = this.ndc.x
    let y = this.ndc.y
    if (behind) {
      x = -x
      y = -y
    }
    const margin = 0.88
    const offscreen = behind || Math.abs(x) > margin || Math.abs(y) > margin
    if (offscreen) {
      // Push to the screen edge along the direction to the target.
      const s = margin / Math.max(Math.abs(x), Math.abs(y), 1e-6)
      x *= s
      y *= s
      this.arrow.style.display = ''
      this.arrow.style.transform = `rotate(${Math.atan2(x, y)}rad)`
    } else {
      this.arrow.style.display = 'none'
    }
    this.marker.classList.toggle('wp-edge', offscreen)
    this.marker.style.transform = `translate(${((x + 1) / 2) * width}px, ${((1 - y) / 2) * height}px)`
  }

  private updateCard(card: MissionCard | null): void {
    const key = card ? JSON.stringify(card) : ''
    if (key === this.cardKey) return
    this.cardKey = key
    this.card.style.display = card ? '' : 'none'
    if (!card) return
    this.card.className = `mission-card mc-${card.kind}`
    this.card.replaceChildren()
    el('div', 'mc-title', this.card, card.title)
    const body = el('div', 'mc-body', this.card)
    let total = 0
    for (const line of card.lines) {
      const row = el('div', 'mc-line', body)
      el('span', '', row, line.text)
      if (line.points !== undefined) {
        el('span', 'mc-points', row, `+${line.points}`)
        total += line.points
      }
    }
    if (card.kind === 'debrief') {
      const row = el('div', 'mc-line mc-total', body)
      el('span', '', row, 'Total')
      el('span', 'mc-points', row, String(total))
    }
    el('div', 'mc-footer', this.card, card.footer)
  }
}

function el(tag: string, className: string, parent: HTMLElement, text = ''): HTMLElement {
  const e = document.createElement(tag)
  e.className = className
  e.textContent = text
  parent.appendChild(e)
  return e
}

function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
