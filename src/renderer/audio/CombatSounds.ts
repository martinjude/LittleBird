import type { Vector3 } from 'three'
import type { AudioEngine } from './AudioEngine'
import { bulletCrack, dirtHit, explosion, metalHit, minigunLoop, minigunSpin, rifleShot, rocketLaunch } from './sfx'

export type SfxName = 'rocket' | 'explosion' | 'rifle' | 'dshk' | 'metalHit' | 'crack' | 'dirt'

/**
 * Weapon and impact sounds. One-shots go through the engine's voice pool (positional,
 * with speed-of-sound delay for distant events); the minigun is a managed loop that
 * follows the aircraft, with a spin-up motor layer.
 */
export class CombatSounds {
  private readonly buffers = {} as Record<SfxName, AudioBuffer>
  private readonly gunGain: GainNode
  private readonly spinGain: GainNode
  private readonly panner: PannerNode

  constructor(private readonly engine: AudioEngine) {
    const sr = engine.ctx.sampleRate
    const synth: Record<SfxName, () => Float32Array> = {
      rocket: () => rocketLaunch(sr),
      explosion: () => explosion(sr),
      rifle: () => rifleShot(sr),
      dshk: () => rifleShot(sr, true),
      metalHit: () => metalHit(sr),
      crack: () => bulletCrack(sr),
      dirt: () => dirtHit(sr),
    }
    for (const [name, make] of Object.entries(synth) as [SfxName, () => Float32Array][]) {
      this.buffers[name] = engine.bufferFrom(make())
      void engine.loadBuffer(`audio/sfx/${name}.ogg`).then((b) => b && (this.buffers[name] = b))
    }

    const ctx = engine.ctx
    this.panner = engine.createPanner(25)
    this.panner.connect(engine.buses.weapons)
    this.panner.connect(engine.reverbSend)
    this.gunGain = new GainNode(ctx, { gain: 0 })
    this.spinGain = new GainNode(ctx, { gain: 0 })
    this.gunGain.connect(this.panner)
    this.spinGain.connect(this.panner)
    this.startLoop(minigunLoop(ctx.sampleRate), 'minigun', this.gunGain)
    this.startLoop(minigunSpin(ctx.sampleRate), 'minigun-spin', this.spinGain)
  }

  /** Each frame: minigun loop level (firing) and motor whine (spin 0..1), at the aircraft. */
  updateMinigun(position: Vector3, firing: boolean, spin: number): void {
    const t = this.engine.ctx.currentTime
    this.panner.positionX.setTargetAtTime(position.x, t, 0.02)
    this.panner.positionY.setTargetAtTime(position.y, t, 0.02)
    this.panner.positionZ.setTargetAtTime(position.z, t, 0.02)
    this.gunGain.gain.setTargetAtTime(firing ? 1 : 0, t, firing ? 0.01 : 0.04)
    this.spinGain.gain.setTargetAtTime(0.25 * spin, t, 0.05)
  }

  play(name: SfxName, position: Vector3 | undefined, opts: { gain?: number; priority?: number; travelDelay?: boolean } = {}): void {
    this.engine.playOneShot(this.buffers[name], {
      bus: 'weapons',
      position,
      gain: opts.gain ?? 1,
      pitchVariance: 0.05,
      priority: opts.priority ?? 1,
      travelDelay: opts.travelDelay,
    })
  }

  /** Loudness falloff helper for very frequent sounds (impacts): skip quiet, far ones. */
  audible(position: Vector3, range: number): boolean {
    return position.distanceTo(this.engine.listenerPosition) < range
  }

  private startLoop(samples: Float32Array, file: string, destination: AudioNode): void {
    let source = new AudioBufferSourceNode(this.engine.ctx, { buffer: this.engine.bufferFrom(samples), loop: true })
    source.connect(destination)
    source.start()
    void this.engine.loadBuffer(`audio/sfx/${file}.ogg`).then((b) => {
      if (!b) return
      const old = source
      source = new AudioBufferSourceNode(this.engine.ctx, { buffer: b, loop: true })
      source.connect(destination)
      source.start()
      old.stop()
    })
  }
}
