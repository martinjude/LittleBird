import { MathUtils, Vector3 } from 'three'
import { airAbsorptionCutoff, dopplerFactor } from './acoustics'
import type { AudioEngine } from './AudioEngine'
import { bladeSlap, gearbox, rotorThump, tailRotorBuzz, turbineWhine, wind, type LoopSpec } from './synth'

export type LayerName = 'rotor' | 'slap' | 'turbine' | 'gearbox' | 'tail' | 'wind'

/** Flight state the rig listens to; refreshed every frame. */
export interface HeliSoundState {
  position: Vector3
  velocity: Vector3
  /** Rotor speed / nominal (1 = governed 100%). */
  rpmRatio: number
  /** Engine torque 0..1+. */
  torque: number
  /** Rotor thrust / weight (≈1 in a hover, >1 pulling g). */
  load: number
  /** m/s, + = climbing */
  verticalSpeed: number
  airspeed: number
  /** 0..1 tail rotor effort. */
  tailUse: number
  vortexRing: number
  /** Listener is in the cockpit (vs. outside). */
  interior: boolean
}

interface LayerConfig {
  /** File tried first (public/audio/heli/<name>.ogg); the synth stand-in is used when it's missing. */
  file: string
  synth: (spec: LoopSpec) => Float32Array
  /** How loud the layer is in each mix. */
  exterior: number
  interior: number
  /** Positional (radiates from the aircraft) or ambient (wind around the listener). */
  positional: boolean
}

interface Layer {
  config: LayerConfig
  source: AudioBufferSourceNode
  /** Driven by flight state. */
  drive: GainNode
  ext: GainNode
  int: GainNode
  usingSample: boolean
}

/** Main and tail rotor blade-pass rates at 100% rpm (MH-6M: 6 main blades, 2 tail blades). */
const MAIN_BLADE_PASS = (470 / 60) * 6
const TAIL_BLADE_PASS = ((470 * 6) / 60) * 2

const LAYERS: Record<LayerName, LayerConfig> = {
  rotor: { file: 'rotor', synth: (s) => rotorThump(s, MAIN_BLADE_PASS), exterior: 1.0, interior: 0.55, positional: true },
  slap: { file: 'slap', synth: (s) => bladeSlap(s, MAIN_BLADE_PASS), exterior: 0.9, interior: 0.3, positional: true },
  turbine: { file: 'turbine', synth: turbineWhine, exterior: 0.3, interior: 0.45, positional: true },
  gearbox: { file: 'gearbox', synth: gearbox, exterior: 0.06, interior: 0.4, positional: true },
  tail: { file: 'tail', synth: (s) => tailRotorBuzz(s, TAIL_BLADE_PASS), exterior: 0.35, interior: 0.1, positional: true },
  wind: { file: 'wind', synth: wind, exterior: 0.25, interior: 0.7, positional: false },
}

/**
 * Layered helicopter sound (PLAN.md §8.2). Each loop is shaped by flight state, then
 * split into an exterior mix (air absorption → HRTF panner → reverb send) and an
 * interior mix (muffled by the airframe and the pilot's headset), cross-faded by camera.
 */
export class HeliSoundRig {
  /** Per-layer trims for tuning from the debug panel. */
  readonly trim: Record<LayerName, number> = { rotor: 1, slap: 1, turbine: 1, gearbox: 1, tail: 1, wind: 1 }
  readonly layers = {} as Record<LayerName, Layer>

  private readonly panner: PannerNode
  private readonly absorption: BiquadFilterNode
  private readonly extBus: GainNode
  private readonly intBus: GainNode
  private readonly ambientExt: GainNode
  private interiorMix = 0
  private readonly ctx: AudioContext

  constructor(private readonly engine: AudioEngine) {
    const ctx = (this.ctx = engine.ctx)
    const vehicle = engine.buses.vehicle

    // Exterior: positional layers → distance low-pass → HRTF panner → vehicle bus (+ reverb).
    this.extBus = new GainNode(ctx)
    this.absorption = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 20000, Q: 0.5 })
    this.panner = engine.createPanner(20)
    this.extBus.connect(this.absorption).connect(this.panner).connect(vehicle)
    this.panner.connect(engine.reverbSend)

    // Interior: airframe + headset muffling.
    this.intBus = new GainNode(ctx)
    const airframe = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 2600, Q: 0.7 })
    const headset = new BiquadFilterNode(ctx, { type: 'highshelf', frequency: 4000, gain: -8 })
    this.intBus.connect(airframe).connect(headset).connect(vehicle)

    // Ambient (wind) bypasses the panner outside.
    this.ambientExt = new GainNode(ctx)
    this.ambientExt.connect(vehicle)

    const spec: LoopSpec = { sampleRate: ctx.sampleRate, seconds: 2 }
    for (const [name, config] of Object.entries(LAYERS) as [LayerName, LayerConfig][]) {
      const drive = new GainNode(ctx, { gain: 0 })
      const ext = new GainNode(ctx, { gain: config.exterior })
      const int = new GainNode(ctx, { gain: 0 })
      drive.connect(ext).connect(config.positional ? this.extBus : this.ambientExt)
      drive.connect(int).connect(this.intBus)
      const source = this.startLoop(engine.bufferFrom(config.synth({ ...spec, seed: name.length * 7 + 3 })), drive)
      this.layers[name] = { config, source, drive, ext, int, usingSample: false }
      void this.trySample(name)
    }
  }

  update(dt: number, s: HeliSoundState): void {
    const t = this.ctx.currentTime
    const set = (param: AudioParam, value: number, tau = 0.06) => param.setTargetAtTime(value, t, tau)
    const L = this.layers
    const trim = this.trim

    // Flight state → layer levels and pitches.
    const rpm = s.rpmRatio
    const torque = MathUtils.clamp(s.torque, 0, 1.2)
    const load = MathUtils.clamp(s.load, 0, 2)
    // Blade slap: descending under load (blade-vortex interaction), pulling g, or in vortex ring.
    const descentSlap = MathUtils.smoothstep(-s.verticalSpeed, 1, 6) * MathUtils.smoothstep(load, 0.5, 0.95) *
      (0.4 + 0.6 * MathUtils.smoothstep(s.airspeed, 8, 30))
    const gSlap = MathUtils.smoothstep(load, 1.15, 1.6)
    const slap = MathUtils.clamp(descentSlap + gSlap + s.vortexRing, 0, 1)
    const windLevel = MathUtils.smoothstep(s.airspeed, 4, 65)

    set(L.rotor.drive.gain, trim.rotor * rpm * (0.55 + 0.45 * MathUtils.clamp(load, 0, 1.3)))
    set(L.slap.drive.gain, trim.slap * rpm * slap, 0.12)
    set(L.turbine.drive.gain, trim.turbine * (0.45 + 0.55 * torque))
    set(L.gearbox.drive.gain, trim.gearbox * rpm * (0.7 + 0.3 * torque))
    set(L.tail.drive.gain, trim.tail * rpm * (0.35 + 0.65 * MathUtils.clamp(s.tailUse, 0, 1)))
    set(L.wind.drive.gain, trim.wind * windLevel, 0.2)

    // Cockpit ↔ outside cross-fade, eased so camera switches don't pop.
    this.interiorMix = MathUtils.damp(this.interiorMix, s.interior ? 1 : 0, 8, dt)
    const inside = this.interiorMix
    for (const layer of Object.values(L)) {
      set(layer.ext.gain, layer.config.exterior * (1 - inside), 0.03)
      set(layer.int.gain, layer.config.interior * inside, 0.03)
    }

    // Exterior: position, Doppler (fades out as we move inside), air absorption.
    const listener = this.engine.listenerPosition
    const p = s.position
    this.panner.positionX.setTargetAtTime(p.x, t, 0.02)
    this.panner.positionY.setTargetAtTime(p.y, t, 0.02)
    this.panner.positionZ.setTargetAtTime(p.z, t, 0.02)
    const doppler = MathUtils.lerp(dopplerFactor(p, s.velocity, listener, this.engine.listenerVelocity), 1, inside)
    set(this.absorption.frequency, airAbsorptionCutoff(p.distanceTo(listener)), 0.1)

    // Pitch: rotor and tail follow rpm; turbine and gearbox rise a little with torque.
    set(L.rotor.source.playbackRate, rpm * doppler, 0.05)
    set(L.slap.source.playbackRate, rpm * doppler, 0.05)
    set(L.tail.source.playbackRate, rpm * doppler * (1 + 0.03 * s.tailUse), 0.05)
    set(L.turbine.source.playbackRate, (0.96 + 0.07 * torque) * doppler, 0.15)
    set(L.gearbox.source.playbackRate, rpm * (0.99 + 0.02 * torque) * doppler, 0.15)
    set(L.wind.source.playbackRate, 0.8 + 0.4 * windLevel, 0.3)
  }

  private startLoop(buffer: AudioBuffer, destination: AudioNode): AudioBufferSourceNode {
    const source = new AudioBufferSourceNode(this.ctx, { buffer, loop: true })
    source.connect(destination)
    // Random start offset so layers don't all phase-lock at t=0.
    source.start(0, Math.random() * buffer.duration)
    return source
  }

  /** Swaps a layer's synth loop for a recording if public/audio/heli/<file>.ogg exists. */
  private async trySample(name: LayerName): Promise<void> {
    const layer = this.layers[name]
    const buffer = await this.engine.loadBuffer(`audio/heli/${layer.config.file}.ogg`)
    if (!buffer) return
    const old = layer.source
    layer.source = this.startLoop(buffer, layer.drive)
    layer.usingSample = true
    old.stop()
    old.disconnect()
  }
}
