import { createRandom } from '../core/random'

/**
 * Procedural stand-ins for the helicopter loops, used until real recordings are
 * dropped into public/audio/heli/. Every generator returns a buffer that loops
 * without a click:
 *  - tonal parts use frequencies nudged so a whole number of cycles fits the loop;
 *  - noise parts are cross-faded from the loop's tail into its head.
 */

const TAU = Math.PI * 2

export interface LoopSpec {
  sampleRate: number
  seconds: number
  seed?: number
}

/** Nudges `hz` so exactly a whole number of cycles fits in `samples`. */
export function fitFrequency(hz: number, samples: number, sampleRate: number): number {
  const cycles = Math.max(1, Math.round((hz * samples) / sampleRate))
  return (cycles * sampleRate) / samples
}

/** Main-rotor "whop": a smooth pulse per blade passage carrying low-passed noise and a low tone. */
export function rotorThump(spec: LoopSpec, bladePassHz: number): Float32Array {
  const { n, sr, rand } = setup(spec)
  const f = fitFrequency(bladePassHz, n, sr)
  const noise = lowpass(whiteNoise(n + fadeLength(sr), rand), 350 / sr)
  const out = new Float32Array(noise.length)
  for (let i = 0; i < out.length; i++) {
    const phase = (f * i) / sr
    const pulse = ((1 - Math.cos(TAU * phase)) / 2) ** 8
    out[i] = pulse * (0.9 * noise[i] * 6 + 0.55 * Math.sin(TAU * phase * 2)) + 0.12 * Math.sin(TAU * phase)
  }
  return normalize(seamless(out, n))
}

/** Blade slap (blade-vortex interaction): a sharp crack per blade passage. Faded in under load. */
export function bladeSlap(spec: LoopSpec, bladePassHz: number): Float32Array {
  const { n, sr, rand } = setup(spec)
  const f = fitFrequency(bladePassHz, n, sr)
  const noise = highpass(whiteNoise(n + fadeLength(sr), rand), 900 / sr)
  const out = new Float32Array(noise.length)
  for (let i = 0; i < out.length; i++) {
    const phase = (f * i) / sr
    const pulse = ((1 - Math.cos(TAU * phase)) / 2) ** 40
    out[i] = pulse * (noise[i] * 1.2 + 0.4 * Math.sin(TAU * phase * 9))
  }
  return normalize(seamless(out, n))
}

/** Turboshaft whine: inharmonic high partials plus a band of hiss. */
export function turbineWhine(spec: LoopSpec): Float32Array {
  const partials: [number, number][] = [
    [1420, 1],
    [2840, 0.4],
    [4310, 0.22],
    [7050, 0.1],
  ]
  return tonal(spec, partials, (noise, sr) => bandpass(noise, 2400 / sr, 4800 / sr), 0.18)
}

/** Main gearbox whine with a low mechanical rumble; mostly heard in the cockpit. */
export function gearbox(spec: LoopSpec): Float32Array {
  const partials: [number, number][] = [
    [612, 1],
    [1224, 0.45],
    [1836, 0.25],
    [96, 0.35],
  ]
  return tonal(spec, partials, (noise, sr) => lowpass(noise, 180 / sr), 0.5)
}

/** Tail rotor: a buzzy sawtooth at the tail blade-pass rate with some breathy noise. */
export function tailRotorBuzz(spec: LoopSpec, bladePassHz: number): Float32Array {
  const { n, sr, rand } = setup(spec)
  const f = fitFrequency(bladePassHz, n, sr)
  const noise = bandpass(whiteNoise(n + fadeLength(sr), rand), 300 / sr, 1200 / sr)
  const out = new Float32Array(noise.length)
  for (let i = 0; i < out.length; i++) {
    const phase = (f * i) / sr
    let saw = 0
    for (let k = 1; k <= 14; k++) saw += Math.sin(TAU * phase * k) / k
    const pulse = 0.6 + 0.4 * ((1 - Math.cos(TAU * phase)) / 2) ** 2
    out[i] = pulse * (0.5 * saw + noise[i] * 3)
  }
  return normalize(seamless(out, n))
}

/** Airflow: soft broadband noise. */
export function wind(spec: LoopSpec): Float32Array {
  const { n, sr, rand } = setup(spec)
  const noise = highpass(lowpass(whiteNoise(n + fadeLength(sr), rand), 1500 / sr), 60 / sr)
  return normalize(seamless(noise, n))
}

// --- helpers ---------------------------------------------------------------

function setup(spec: LoopSpec) {
  return { n: Math.round(spec.seconds * spec.sampleRate), sr: spec.sampleRate, rand: createRandom(spec.seed ?? 1) }
}

function fadeLength(sampleRate: number): number {
  return Math.round(sampleRate * 0.05)
}

function tonal(
  spec: LoopSpec,
  partials: [number, number][],
  shapeNoise: (noise: Float32Array, sr: number) => Float32Array,
  noiseLevel: number,
): Float32Array {
  const { n, sr, rand } = setup(spec)
  const noise = shapeNoise(whiteNoise(n + fadeLength(sr), rand), sr)
  const noiseScale = noiseLevel / Math.max(peak(noise), 1e-6)
  const fitted = partials.map(([hz, amp]) => [fitFrequency(hz, n, sr), amp, rand() * TAU])
  const out = new Float32Array(noise.length)
  for (let i = 0; i < out.length; i++) {
    let v = noise[i] * noiseScale
    for (const [hz, amp, phase] of fitted) v += amp * Math.sin((TAU * hz * i) / sr + phase)
    out[i] = v
  }
  return normalize(seamless(out, n))
}

function whiteNoise(n: number, rand: () => number): Float32Array {
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = rand() * 2 - 1
  return out
}

/** One-pole low-pass; `fc` is the cutoff as a fraction of the sample rate. */
export function lowpass(x: Float32Array, fc: number): Float32Array {
  const a = 1 - Math.exp(-TAU * fc)
  const out = new Float32Array(x.length)
  let y = 0
  for (let i = 0; i < x.length; i++) out[i] = y += a * (x[i] - y)
  return out
}

export function highpass(x: Float32Array, fc: number): Float32Array {
  const low = lowpass(x, fc)
  const out = new Float32Array(x.length)
  for (let i = 0; i < x.length; i++) out[i] = x[i] - low[i]
  return out
}

function bandpass(x: Float32Array, lo: number, hi: number): Float32Array {
  return lowpass(highpass(x, lo), hi)
}

/**
 * Turns a buffer of `n + fade` samples into a seamless `n`-sample loop by cross-fading
 * the extra tail into the head (equal-power). Periodic content must have whole cycles in `n`.
 */
export function seamless(x: Float32Array, n: number): Float32Array {
  const fade = x.length - n
  const out = x.slice(0, n)
  for (let i = 0; i < fade; i++) {
    const t = i / fade
    out[i] = x[n + i] * Math.cos((t * Math.PI) / 2) + x[i] * Math.sin((t * Math.PI) / 2)
  }
  return out
}

function peak(x: Float32Array): number {
  let p = 0
  for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i]))
  return p
}

function normalize(x: Float32Array, target = 0.9): Float32Array {
  const scale = target / Math.max(peak(x), 1e-6)
  for (let i = 0; i < x.length; i++) x[i] *= scale
  return x
}
