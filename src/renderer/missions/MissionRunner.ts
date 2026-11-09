import { Vector3 } from 'three'
import type { Site } from '../world/valley'
import type { Touchdown } from './landing'
import type { MissionDef } from './missions'

export type MissionPhase = 'briefing' | 'pickup' | 'boarding' | 'transit' | 'unloading' | 'rtb' | 'complete' | 'failed'

/** What the runner needs from the troops (implemented by TroopSquad; faked in tests). */
export interface TroopControl {
  spawn(site: Site, count: number): void
  clear(): void
  /** Troops may walk to the aircraft and climb aboard while true. */
  boardingAllowed: boolean
  /** Troops may climb off while true. */
  unloadAllowed: boolean
  readonly aboard: number
  readonly delivered: number
}

export interface MissionInput {
  heliPosition: Vector3
  /** Settled on the ground (LandingMonitor.settled). */
  landed: boolean
  crashed: string | null
  /** The most recent touchdown (LandingMonitor.lastTouchdown), graded when a landing completes an objective. */
  touchdown: Touchdown | null
  interactPressed: boolean
}

export type MissionEvent =
  | { type: 'objective'; text: string }
  | { type: 'landing'; site: Site; touchdown: Touchdown; accuracy: number; points: number }
  | { type: 'smoke'; site: Site }
  | { type: 'complete'; score: number }
  | { type: 'failed'; reason: string }

export interface ScoreLine {
  label: string
  points: number
}

/** Ground speed assumed for the par time (m/s, ~70 kt). */
const PAR_SPEED = 36
const PAR_GROUND_TIME = 90
const SMOKE_DISTANCE = 2000
/** Landing within this many meters of a site's centre (its panels / pad) earns an accuracy bonus. */
const ACCURACY_RADIUS = 15

/**
 * Transport mission state machine:
 * briefing → pickup → boarding → transit → unloading → (rtb) → complete, or failed on a crash.
 */
export class MissionRunner {
  phase: MissionPhase = 'briefing'
  mission: MissionDef | null = null
  pickup: Site | null = null
  drop: Site | null = null
  elapsed = 0
  readonly score: ScoreLine[] = []
  readonly events: MissionEvent[] = []

  private smokePopped = false
  /** Only landings that follow a flight are graded (not sitting on the pad you started on). */
  private airborne = false
  private lastObjective = ''

  constructor(
    private readonly sites: Site[],
    private readonly troops: TroopControl,
    private readonly base: Site,
  ) {}

  start(mission: MissionDef): void {
    this.mission = mission
    this.pickup = this.site(mission.pickup)
    this.drop = this.site(mission.drop)
    this.phase = 'briefing'
    this.elapsed = 0
    this.score.length = 0
    this.smokePopped = false
    this.airborne = false
    this.lastObjective = ''
    this.troops.clear()
    this.troops.boardingAllowed = this.troops.unloadAllowed = false
  }

  /** The site the player should currently fly to, if any. */
  get target(): Site | null {
    switch (this.phase) {
      case 'pickup':
      case 'boarding':
        return this.pickup
      case 'transit':
      case 'unloading':
        return this.drop
      case 'rtb':
        return this.base
      default:
        return null
    }
  }

  objectiveText(distance: number): string {
    const m = this.mission
    if (!m) return ''
    const km = distance >= 1000 ? `${(distance / 1000).toFixed(1)} km` : `${Math.round(distance)} m`
    switch (this.phase) {
      case 'briefing':
        return 'Press Interact to start'
      case 'pickup':
        return `Land at ${this.pickup!.name} to pick up ${m.troops} troops · ${km}`
      case 'boarding':
        return this.troops.boardingAllowed ? `Boarding ${this.troops.aboard}/${m.troops}. Hold on the ground` : 'Boarding paused. Land and hold'
      case 'transit':
        return `Fly to ${this.drop!.name} · ${km}`
      case 'unloading':
        return this.troops.unloadAllowed ? `Unloading ${this.troops.delivered}/${m.troops}. Hold on the ground` : 'Unloading paused. Land and hold'
      case 'rtb':
        return `Return to ${this.base.name} · ${km}`
      case 'complete':
        return 'Mission complete. Press Interact for the next mission'
      case 'failed':
        return 'Mission failed. Press Interact to retry'
    }
  }

  get totalScore(): number {
    return this.score.reduce((sum, l) => sum + l.points, 0)
  }

  update(dt: number, input: MissionInput): void {
    const m = this.mission
    if (!m) return
    if (this.phase !== 'briefing' && this.phase !== 'complete' && this.phase !== 'failed') this.elapsed += dt
    if (!input.landed && this.phase !== 'briefing') this.airborne = true

    if (input.crashed && this.phase !== 'complete' && this.phase !== 'failed' && this.phase !== 'briefing') {
      this.phase = 'failed'
      this.troops.boardingAllowed = this.troops.unloadAllowed = false
      this.events.push({ type: 'failed', reason: input.crashed })
      return
    }

    const inZone = (site: Site | null) =>
      !!site && input.landed && Math.hypot(input.heliPosition.x - site.x, input.heliPosition.z - site.z) <= site.radius
    const distanceTo = (site: Site) => Math.hypot(input.heliPosition.x - site.x, input.heliPosition.z - site.z)

    switch (this.phase) {
      case 'briefing':
        if (input.interactPressed) {
          this.troops.spawn(this.pickup!, m.troops)
          this.phase = 'pickup'
        }
        break

      case 'pickup':
        if (this.pickup!.kind === 'lz') this.maybePopSmoke(this.pickup!, distanceTo(this.pickup!))
        if (inZone(this.pickup)) {
          this.recordLanding(this.pickup!, input)
          this.phase = 'boarding'
          this.troops.boardingAllowed = true
        }
        break

      case 'boarding':
        this.troops.boardingAllowed = inZone(this.pickup)
        if (this.troops.aboard >= m.troops) {
          this.troops.boardingAllowed = false
          this.smokePopped = false
          this.phase = 'transit'
        }
        break

      case 'transit':
        if (this.drop!.kind === 'lz') this.maybePopSmoke(this.drop!, distanceTo(this.drop!))
        if (inZone(this.drop)) {
          this.recordLanding(this.drop!, input)
          this.phase = 'unloading'
          this.troops.unloadAllowed = true
        }
        break

      case 'unloading':
        this.troops.unloadAllowed = inZone(this.drop)
        if (this.troops.delivered >= m.troops) {
          this.troops.unloadAllowed = false
          this.score.push({ label: `${m.troops} troops delivered`, points: m.troops * 50 })
          // Extractions end at the base already.
          if (this.drop!.id === this.base.id) this.complete()
          else this.phase = 'rtb'
        }
        break

      case 'rtb':
        if (inZone(this.base)) {
          this.recordLanding(this.base, input)
          this.complete()
        }
        break

      case 'complete':
      case 'failed':
        break
    }

    const objective = this.objectiveText(0).split(' · ')[0]
    if (objective !== this.lastObjective) {
      this.lastObjective = objective
      if (this.phase !== 'briefing') this.events.push({ type: 'objective', text: objective })
    }
  }

  private complete(): void {
    const route = Math.hypot(this.pickup!.x - this.base.x, this.pickup!.z - this.base.z) +
      Math.hypot(this.drop!.x - this.pickup!.x, this.drop!.z - this.pickup!.z) +
      (this.drop!.id === this.base.id ? 0 : Math.hypot(this.base.x - this.drop!.x, this.base.z - this.drop!.z))
    const par = route / PAR_SPEED + PAR_GROUND_TIME
    const timeBonus = Math.max(0, Math.round((par - this.elapsed) * 2))
    this.score.push({ label: `Time ${formatTime(this.elapsed)} (par ${formatTime(par)})`, points: timeBonus })
    this.phase = 'complete'
    this.events.push({ type: 'complete', score: this.totalScore })
  }

  private recordLanding(site: Site, input: MissionInput): void {
    const td = input.touchdown
    if (!td || !this.airborne) return
    this.airborne = false
    const center = site.kind === 'base' ? null : site
    const accuracy = center ? Math.hypot(input.heliPosition.x - center.x, input.heliPosition.z - center.z) : 0
    const bonus = center && accuracy <= ACCURACY_RADIUS ? 25 : 0
    const points = td.points + bonus
    this.score.push({ label: `Landing at ${site.name}: ${td.grade} (${td.verticalSpeed.toFixed(1)} m/s)${bonus ? ' + on target' : ''}`, points })
    this.events.push({ type: 'landing', site, touchdown: td, accuracy, points })
  }

  private maybePopSmoke(site: Site, distance: number): void {
    if (this.smokePopped || distance > SMOKE_DISTANCE) return
    this.smokePopped = true
    this.events.push({ type: 'smoke', site })
  }

  private site(id: string): Site {
    const s = this.sites.find((x) => x.id === id)
    if (!s) throw new Error(`Unknown site "${id}"`)
    return s
  }
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
