import GUI from 'lil-gui'
import Stats from 'stats-gl'
import type { WebGLRenderer } from 'three'

/** lil-gui tuning panel + stats-gl frame/GPU timings. Toggled with F3. */
export class Debug {
  readonly gui = new GUI({ title: 'Debug  ·  F3' })
  private readonly stats = new Stats({ trackGPU: true, logsPerSecond: 4, samplesGraph: 60 })
  private visible = true

  constructor(renderer: WebGLRenderer) {
    this.stats.dom.id = 'stats'
    document.body.appendChild(this.stats.dom)
    this.stats.init(renderer).catch((err) => console.warn('stats-gl init failed', err))
    this.setVisible(import.meta.env.DEV)
  }

  toggle(): void {
    this.setVisible(!this.visible)
  }

  setVisible(visible: boolean): void {
    this.visible = visible
    document.body.classList.toggle('debug-hidden', !visible)
  }

  update(): void {
    this.stats.update()
  }
}
