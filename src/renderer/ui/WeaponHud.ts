import { Vector3, type Camera } from 'three'
import type { Component } from '../vehicles/HeliDamage'

export interface WeaponView {
  /** World point the guns are aimed at (where rounds would land), or null to hide. */
  aimPoint: Vector3 | null
  gunAmmo: number
  rockets: number
  spin: number
  hp: Record<Component, number>
  hitFlash: number
}

const LABELS: [Component, string][] = [
  ['engine', 'ENG'],
  ['mainRotor', 'M/R'],
  ['tailRotor', 'T/R'],
  ['airframe', 'A/F'],
  ['pilot', 'PLT'],
]

/** Gun pipper, ammo counters, component damage lights and a red hit flash. */
export class WeaponHud {
  private readonly reticle: HTMLElement
  private readonly ammo: HTMLElement
  private readonly lights: Record<Component, HTMLElement>
  private readonly flash: HTMLElement
  private readonly ndc = new Vector3()

  constructor(root: HTMLElement) {
    this.flash = el('div', 'hit-flash', root)
    this.reticle = el('div', 'reticle', root)
    el('div', 'reticle-dot', this.reticle)
    const panel = el('div', 'weapon-panel', root)
    this.ammo = el('div', 'wp-ammo', panel)
    const lights = el('div', 'wp-lights', panel)
    this.lights = Object.fromEntries(LABELS.map(([c, label]) => [c, el('span', '', lights, label)])) as Record<Component, HTMLElement>
  }

  update(v: WeaponView, camera: Camera, width: number, height: number): void {
    if (v.aimPoint) {
      this.ndc.copy(v.aimPoint).project(camera)
      const visible = this.ndc.z < 1 && Math.abs(this.ndc.x) < 1.1 && Math.abs(this.ndc.y) < 1.1
      this.reticle.style.display = visible ? '' : 'none'
      this.reticle.style.transform = `translate(${((this.ndc.x + 1) / 2) * width}px, ${((1 - this.ndc.y) / 2) * height}px)`
      this.reticle.classList.toggle('spinning', v.spin > 0)
    } else {
      this.reticle.style.display = 'none'
    }
    this.ammo.textContent = `GUN ${v.gunAmmo}   RKT ${v.rockets}`
    for (const [c] of LABELS) {
      const hp = v.hp[c]
      this.lights[c].className = hp <= 0 ? 'dmg-dead' : hp < 50 ? 'dmg-bad' : hp < 90 ? 'dmg-warn' : 'dmg-ok'
    }
    this.flash.style.opacity = String(v.hitFlash * 0.55)
  }
}

function el(tag: string, className: string, parent: HTMLElement, text = ''): HTMLElement {
  const e = document.createElement(tag)
  e.className = className
  e.textContent = text
  parent.appendChild(e)
  return e
}
