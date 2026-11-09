import { MathUtils } from 'three'
import type { FlightParams } from '../flight/littlebird.params'

/** Where a round hit, from the collider it struck. */
export type HeliPart = 'cockpit' | 'engine' | 'tailboom' | 'fin' | 'skids'
export type Component = 'pilot' | 'engine' | 'tailRotor' | 'mainRotor' | 'airframe'

/** How a hit on each part spreads over the components (fractions of the damage). */
const SPREAD: Record<HeliPart, Partial<Record<Component, number>>> = {
  cockpit: { pilot: 0.3, airframe: 0.25 },
  engine: { engine: 1, airframe: 0.2 },
  tailboom: { tailRotor: 0.6, airframe: 0.3 },
  fin: { tailRotor: 0.9, airframe: 0.2 },
  skids: { airframe: 0.3 },
}

/**
 * Component damage and what it does to the flight model:
 *  - engine: less power available (dead engine ≈ 25%, enough to cushion a landing)
 *  - tail rotor: less anti-torque authority (dead = the aircraft spins with torque)
 *  - main rotor: less thrust and heavy vibration; a rotor strike destroys it
 *  - pilot / airframe: at zero the aircraft is lost
 */
export class HeliDamage {
  readonly hp: Record<Component, number> = { pilot: 100, engine: 100, tailRotor: 100, mainRotor: 100, airframe: 100 }
  /** Set when the aircraft is lost (mission failure reason). */
  destroyed: string | null = null

  private readonly base: { maxThrust: number; tailMoment: number }

  constructor(private readonly params: FlightParams) {
    this.base = { maxThrust: params.rotor.maxThrust, tailMoment: params.tailRotor.maxMoment }
  }

  reset(): void {
    for (const k of Object.keys(this.hp) as Component[]) this.hp[k] = 100
    this.destroyed = null
    this.apply()
  }

  hit(part: HeliPart, damage: number): void {
    for (const [component, share] of Object.entries(SPREAD[part]) as [Component, number][]) {
      this.hp[component] = Math.max(0, this.hp[component] - damage * share)
    }
    this.apply()
  }

  rotorStrike(): void {
    if (this.hp.mainRotor <= 0) return
    this.hp.mainRotor = 0
    this.apply()
  }

  /** 0..1 vibration from a damaged main rotor (for camera shake). */
  get vibration(): number {
    return 1 - MathUtils.smoothstep(this.hp.mainRotor, 10, 70)
  }

  get smoking(): boolean {
    return this.hp.engine < 50
  }

  get burning(): boolean {
    return this.hp.engine <= 0
  }

  warnings(): string[] {
    const w: string[] = []
    if (this.hp.engine <= 0) w.push('ENGINE FAILURE')
    else if (this.hp.engine < 50) w.push('ENGINE DAMAGE')
    if (this.hp.tailRotor <= 0) w.push('TAIL ROTOR FAILURE')
    else if (this.hp.tailRotor < 50) w.push('TAIL ROTOR DAMAGE')
    if (this.hp.mainRotor <= 0) w.push('ROTOR STRIKE')
    return w
  }

  /** Pushes current damage into the flight params. */
  private apply(): void {
    const engine = 0.25 + 0.75 * MathUtils.smoothstep(this.hp.engine, 0, 60)
    const rotor = this.hp.mainRotor <= 0 ? 0 : 0.75 + 0.25 * MathUtils.smoothstep(this.hp.mainRotor, 10, 70)
    this.params.rotor.maxThrust = this.base.maxThrust * engine * rotor
    this.params.tailRotor.maxMoment = this.base.tailMoment * MathUtils.smoothstep(this.hp.tailRotor, 0, 70)

    if (!this.destroyed) {
      if (this.hp.pilot <= 0) this.destroyed = 'Pilot killed'
      else if (this.hp.airframe <= 0) this.destroyed = 'Aircraft destroyed'
    }
  }
}
