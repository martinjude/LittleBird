import { BoxGeometry, Mesh, MeshStandardMaterial, Vector3, type Camera, type Object3D } from 'three'
import type { AudioEngine } from '../audio/AudioEngine'
import type { Combat } from '../combat/Combat'
import { chime } from '../audio/synth'
import { attitudeOf } from '../flight/Fcs'
import { Smoke } from '../fx/Smoke'
import { TROOP_MASS, TroopSquad } from '../troops/TroopSquad'
import { MissionHud, type MissionCard } from '../ui/MissionHud'
import type { Helicopter } from '../vehicles/Helicopter'
import type { ValleyWorld } from '../world/ValleyWorld'
import { LandingMonitor } from './landing'
import { MissionRunner } from './MissionRunner'
import { MISSIONS, SMOKE_COLORS } from './missions'

/** MH-6 style outboard benches, two passengers a side (body space, +X = left). */
const SEATS = [new Vector3(1.2, 0.95, 0.75), new Vector3(-1.2, 0.95, 0.75), new Vector3(1.2, 0.95, 0.05), new Vector3(-1.2, 0.95, 0.05)]
/** Skids count as touching the ground below this height (m). */
const ON_GROUND = 0.2

/**
 * Glue for the transport loop: runs the current mission, the troops, LZ smoke, landing
 * grading and the mission HUD, and turns mission events into toasts and chimes.
 */
export class MissionDirector {
  readonly runner: MissionRunner
  readonly squad: TroopSquad
  readonly smoke = new Smoke()
  readonly landing = new LandingMonitor()
  missionIndex = 0
  /** Set by the game to put the helicopter back on the pad when retrying after a crash. */
  onRetry?: () => void

  private readonly hud: MissionHud
  private readonly chimes: { up: AudioBuffer; good: AudioBuffer; bad: AudioBuffer }
  private readonly attitude = { pitch: 0, roll: 0, heading: 0 }
  private readonly hub = new Vector3()
  private readonly targetPos = new Vector3()
  private failure = ''

  constructor(
    private readonly world: ValleyWorld,
    private readonly heli: Helicopter,
    private readonly audio: AudioEngine,
    private readonly combat: Combat,
    hudRoot: HTMLElement,
  ) {
    this.squad = new TroopSquad((x, z) => world.heightAt(x, z), SEATS, (o) => world.registerMaterials(o))
    this.runner = new MissionRunner(world.map.sites, this.squad, world.base)
    this.hud = new MissionHud(hudRoot)
    world.scene.add(this.squad.root, this.smoke.points)
    this.addBenches(heli.object)

    const sr = audio.ctx.sampleRate
    this.chimes = {
      up: audio.bufferFrom(chime(sr, [660, 880])),
      good: audio.bufferFrom(chime(sr, [523, 659, 784])),
      bad: audio.bufferFrom(chime(sr, [392, 311])),
    }
    this.start(0)
  }

  start(index: number): void {
    this.missionIndex = ((index % MISSIONS.length) + MISSIONS.length) % MISSIONS.length
    const mission = MISSIONS[this.missionIndex]
    this.runner.start(mission)
    this.smoke.clear()
    this.heli.setPayload(0)
    this.landing.reset(true)
    // Repaired and rearmed at the FOB between sorties.
    this.heli.damage.reset()
    this.combat.reset()
    if (mission.hostiles) {
      const lz = this.runner.drop!.kind === 'lz' ? this.runner.drop! : this.runner.pickup!
      this.combat.enemies.spawnAround(lz)
    }
  }

  /** Every physics step: watch the skids. */
  fixedUpdate(dt: number): void {
    const s = this.heli.state
    attitudeOf(s.quaternion, this.attitude)
    this.landing.update(dt, {
      onGround: this.heli.agl < ON_GROUND,
      verticalSpeed: s.velocity.y,
      groundSpeed: Math.hypot(s.velocity.x, s.velocity.z),
      pitch: this.attitude.pitch,
      roll: this.attitude.roll,
    })
  }

  /**
   * Every frame.
   * @param simDt simulation-scaled seconds (0 while paused)
   */
  update(simDt: number, interactPressed: boolean, interactLabel: string, camera: Camera, width: number, height: number, wind: Vector3): void {
    const r = this.runner
    const heliPos = this.heli.object.position

    if (interactPressed && (r.phase === 'complete' || r.phase === 'failed')) {
      const next = r.phase === 'complete' ? this.missionIndex + 1 : this.missionIndex
      if (r.phase === 'failed') this.onRetry?.()
      this.start(next)
    } else if (simDt > 0 || interactPressed) {
      r.update(simDt, {
        heliPosition: heliPos,
        landed: this.landing.settled,
        crashed: this.landing.crashed ?? this.heli.damage.destroyed,
        touchdown: this.landing.lastTouchdown,
        interactPressed,
      })
    }
    this.handleEvents()
    if (this.combat.newKills > 0) {
      const alive = this.combat.enemies.alive
      this.hud.toast(this.combat.newKills > 1 ? `${this.combat.newKills} enemies down` : `Enemy down${alive ? ` · ${alive} left` : ' · area clear'}`, 'good')
      this.combat.newKills = 0
    }

    if (simDt > 0) {
      this.squad.update(simDt, this.heli.object)
      this.heli.setPayload(this.squad.aboard * TROOP_MASS)
      const t = this.heli.result.telemetry
      this.hub.fromArray(this.heli.params.rotor.hub).applyQuaternion(this.heli.object.quaternion).add(heliPos)
      const lift = t.thrust / (this.heli.params.mass * 9.81)
      this.smoke.update(simDt, wind, { position: this.hub, strength: Math.min(1.2, lift) })
    }

    const target = r.target
    // While loading/unloading you're already there; the marker would just sit under the aircraft.
    const showMarker = r.phase === 'pickup' || r.phase === 'transit' || r.phase === 'rtb'
    const distance = target ? Math.hypot(heliPos.x - target.x, heliPos.z - target.z) : 0
    this.hud.update(
      {
        missionName: r.mission?.name ?? '',
        // The briefing/debrief card says what to do; don't repeat it in the panel.
        objective: r.phase === 'briefing' || r.phase === 'complete' || r.phase === 'failed' ? '' : r.objectiveText(distance),
        troopsAboard: this.squad.aboard,
        troopsTotal: r.mission?.troops ?? 0,
        elapsed: r.phase === 'briefing' ? null : r.elapsed,
        target: target && showMarker
          ? { position: this.targetPos.set(target.x, target.y + 3, target.z), label: `${target.name.toUpperCase()} ${formatDistance(distance)}` }
          : null,
        card: this.card(interactLabel),
      },
      camera,
      width,
      height,
    )
  }

  setViewport(height: number, fov: number): void {
    this.smoke.setViewport(height, fov)
  }

  private card(interact: string): MissionCard | null {
    const r = this.runner
    const m = r.mission
    if (!m) return null
    if (r.phase === 'briefing') {
      return {
        kind: 'briefing',
        title: `Mission ${this.missionIndex + 1}/${MISSIONS.length}: ${m.name}`,
        lines: [{ text: m.briefing }],
        footer: `Press ${interact} to start`,
      }
    }
    if (r.phase === 'complete') {
      return { kind: 'debrief', title: 'Mission complete', lines: r.score.map((l) => ({ text: l.label, points: l.points })), footer: `Press ${interact} for the next mission` }
    }
    if (r.phase === 'failed') {
      return { kind: 'failed', title: 'Mission failed', lines: [{ text: this.failure }], footer: `Press ${interact} to retry` }
    }
    return null
  }

  private handleEvents(): void {
    for (const e of this.runner.events.splice(0)) {
      switch (e.type) {
        case 'objective':
          this.hud.toast(e.text)
          this.play('up')
          break
        case 'landing': {
          const good = e.touchdown.grade === 'smooth' || e.touchdown.grade === 'firm'
          this.hud.toast(`${capitalize(e.touchdown.grade)} landing · ${e.touchdown.verticalSpeed.toFixed(1)} m/s · +${e.points}`, good ? 'good' : 'bad')
          break
        }
        case 'smoke':
          this.smoke.emit(new Vector3(e.site.x + 6, e.site.y, e.site.z + 6), SMOKE_COLORS[this.runner.mission!.smoke])
          this.hud.toast(`${e.site.name} popping ${this.runner.mission!.smoke} smoke`)
          break
        case 'complete': {
          const kills = this.combat.enemies.kills
          if (kills > 0) this.runner.score.push({ label: `Enemies neutralised ×${kills}`, points: kills * 20 })
          this.play('good')
          break
        }
        case 'failed':
          this.failure = e.reason
          this.play('bad')
          break
      }
    }
  }

  private play(which: keyof MissionDirector['chimes']): void {
    this.audio.playOneShot(this.chimes[which], { bus: 'ui', gain: 0.6, priority: 5 })
  }

  private addBenches(heli: Object3D): void {
    const material = new MeshStandardMaterial({ color: 0x3a3d35, roughness: 0.7, metalness: 0.4 })
    for (const side of [1, -1]) {
      const bench = new Mesh(new BoxGeometry(0.42, 0.05, 1.5), material)
      bench.position.set(side * 1.2, 0.85, 0.4)
      bench.castShadow = true
      heli.add(bench)
    }
    this.world.registerMaterials(heli)
  }
}

function formatDistance(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
