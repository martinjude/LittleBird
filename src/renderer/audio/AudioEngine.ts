import { Quaternion, Vector3, type Camera } from 'three'
import type { Settings } from '../../shared/settings'
import { createRandom } from '../core/random'
import { soundDelay } from './acoustics'
import { pickVoiceToSteal, type VoiceInfo } from './VoicePool'

export type BusName = 'vehicle' | 'weapons' | 'world' | 'ui'

export interface OneShotOptions {
  bus: BusName
  /** World position; omit for non-positional (UI, cockpit). */
  position?: Vector3
  gain?: number
  /** Random playback-rate spread, e.g. 0.03 = ±3%. */
  pitchVariance?: number
  priority?: number
  /** Delay by the time sound takes to reach the listener (distant explosions). */
  travelDelay?: boolean
}

interface Voice extends VoiceInfo {
  source: AudioBufferSourceNode
}

const MAX_VOICES = 48

/**
 * Web Audio graph: buses → master → limiter → speakers, a shared outdoor reverb,
 * an HRTF listener that follows the camera, and a capped one-shot voice pool.
 */
export class AudioEngine {
  readonly ctx: AudioContext
  readonly master: GainNode
  readonly buses: Record<BusName, GainNode>
  /** Send into the outdoor reverb. */
  readonly reverbSend: GainNode
  /** Smoothed listener velocity (m/s), for Doppler. */
  readonly listenerVelocity = new Vector3()
  readonly listenerPosition = new Vector3()

  private readonly voices: Voice[] = []
  private readonly lastListener = new Vector3()
  private hasListener = false
  private readonly fwd = new Vector3()
  private readonly up = new Vector3()
  private readonly q = new Quaternion()
  private readonly rand = createRandom(99)

  constructor(volumes: Settings['audio']) {
    this.ctx = new AudioContext({ latencyHint: 'interactive' })

    // Gentle bus limiter so a firefight on top of the rotor never clips.
    const limiter = this.ctx.createDynamicsCompressor()
    limiter.threshold.value = -6
    limiter.knee.value = 6
    limiter.ratio.value = 12
    limiter.attack.value = 0.003
    limiter.release.value = 0.25
    limiter.connect(this.ctx.destination)

    this.master = this.gain(limiter)
    this.buses = {
      vehicle: this.gain(this.master),
      weapons: this.gain(this.master),
      world: this.gain(this.master),
      ui: this.gain(this.master),
    }

    const reverb = this.ctx.createConvolver()
    reverb.buffer = this.impulseResponse(2.2)
    const reverbReturn = this.gain(this.master, 0.5)
    reverb.connect(reverbReturn)
    this.reverbSend = this.gain(reverb)

    this.applyVolumes(volumes)
    this.unlockOnGesture()
  }

  applyVolumes(v: Settings['audio']): void {
    const t = this.ctx.currentTime
    this.master.gain.setTargetAtTime(v.master, t, 0.05)
    this.buses.vehicle.gain.setTargetAtTime(v.vehicle, t, 0.05)
    this.buses.weapons.gain.setTargetAtTime(v.weapons, t, 0.05)
    this.buses.world.gain.setTargetAtTime(v.world, t, 0.05)
    this.buses.ui.gain.setTargetAtTime(v.ui, t, 0.05)
  }

  /** Suspends all audio (pause menu) or resumes it. */
  setPaused(paused: boolean): void {
    if (paused) void this.ctx.suspend()
    else void this.ctx.resume()
  }

  /** Moves the ears to the camera and tracks their velocity. */
  updateListener(camera: Camera, dt: number): void {
    camera.getWorldPosition(this.listenerPosition)
    camera.getWorldQuaternion(this.q)
    this.fwd.set(0, 0, -1).applyQuaternion(this.q)
    this.up.set(0, 1, 0).applyQuaternion(this.q)

    if (this.hasListener && dt > 0) {
      const instant = this.lastListener.sub(this.listenerPosition).multiplyScalar(-1 / dt)
      this.listenerVelocity.lerp(instant, 1 - Math.exp(-10 * dt))
    }
    this.lastListener.copy(this.listenerPosition)
    this.hasListener = true

    const l = this.ctx.listener
    const p = this.listenerPosition
    const t = this.ctx.currentTime
    l.positionX.setValueAtTime(p.x, t)
    l.positionY.setValueAtTime(p.y, t)
    l.positionZ.setValueAtTime(p.z, t)
    l.forwardX.setValueAtTime(this.fwd.x, t)
    l.forwardY.setValueAtTime(this.fwd.y, t)
    l.forwardZ.setValueAtTime(this.fwd.z, t)
    l.upX.setValueAtTime(this.up.x, t)
    l.upY.setValueAtTime(this.up.y, t)
    l.upZ.setValueAtTime(this.up.z, t)
  }

  /** HRTF panner with the game's distance model. */
  createPanner(refDistance = 15): PannerNode {
    return new PannerNode(this.ctx, {
      panningModel: 'HRTF',
      distanceModel: 'inverse',
      refDistance,
      rolloffFactor: 1,
      maxDistance: 10000,
    })
  }

  bufferFrom(samples: Float32Array): AudioBuffer {
    const buffer = this.ctx.createBuffer(1, samples.length, this.ctx.sampleRate)
    buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0)
    return buffer
  }

  /** Loads and decodes an audio file; resolves to null if it doesn't exist or can't be decoded. */
  async loadBuffer(url: string): Promise<AudioBuffer | null> {
    try {
      const res = await fetch(url)
      if (!res.ok) return null
      return await this.ctx.decodeAudioData(await res.arrayBuffer())
    } catch {
      return null
    }
  }

  /** Plays a sound once, stealing a less important voice if the pool is full. */
  playOneShot(buffer: AudioBuffer, o: OneShotOptions): AudioBufferSourceNode | null {
    const priority = o.priority ?? 1
    if (this.voices.length >= MAX_VOICES) {
      const victim = pickVoiceToSteal(this.voices, priority)
      if (victim < 0) return null
      this.voices[victim].source.stop()
      this.voices.splice(victim, 1)
    }

    const source = new AudioBufferSourceNode(this.ctx, { buffer })
    const spread = o.pitchVariance ?? 0
    source.playbackRate.value = 1 + (this.rand() * 2 - 1) * spread
    const gain = new GainNode(this.ctx, { gain: o.gain ?? 1 })
    source.connect(gain)

    let when = this.ctx.currentTime
    if (o.position) {
      const panner = this.createPanner()
      panner.positionX.value = o.position.x
      panner.positionY.value = o.position.y
      panner.positionZ.value = o.position.z
      gain.connect(panner).connect(this.buses[o.bus])
      if (o.travelDelay) when += soundDelay(o.position.distanceTo(this.listenerPosition))
    } else {
      gain.connect(this.buses[o.bus])
    }

    const voice: Voice = { source, priority, startTime: when }
    this.voices.push(voice)
    source.onended = () => {
      const i = this.voices.indexOf(voice)
      if (i >= 0) this.voices.splice(i, 1)
      gain.disconnect()
    }
    source.start(when)
    return source
  }

  get activeVoices(): number {
    return this.voices.length
  }

  private gain(destination: AudioNode, value = 1): GainNode {
    const g = new GainNode(this.ctx, { gain: value })
    g.connect(destination)
    return g
  }

  /** Synthetic outdoor reverb tail: decaying, darkening stereo noise. */
  private impulseResponse(seconds: number): AudioBuffer {
    const sr = this.ctx.sampleRate
    const n = Math.round(seconds * sr)
    const ir = this.ctx.createBuffer(2, n, sr)
    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch)
      let lp = 0
      for (let i = 0; i < n; i++) {
        const t = i / n
        // Darken over time with a one-pole low-pass whose cutoff falls along the tail.
        const a = 0.6 * (1 - t) + 0.05
        lp += a * (this.rand() * 2 - 1 - lp)
        data[i] = lp * (1 - t) ** 3
      }
    }
    return ir
  }

  /** Browsers start audio suspended until the user interacts; Electron is configured to allow autoplay. */
  private unlockOnGesture(): void {
    if (this.ctx.state === 'running') return
    const resume = () => {
      void this.ctx.resume().then(() => {
        // Only needed once; afterwards suspend/resume belongs to setPaused().
        window.removeEventListener('pointerdown', resume)
        window.removeEventListener('keydown', resume)
      })
    }
    window.addEventListener('pointerdown', resume)
    window.addEventListener('keydown', resume)
  }
}
