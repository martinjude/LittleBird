import { createRandom } from '../core/random'
import { fitFrequency, highpass, lowpass } from './synth'

/**
 * Procedural stand-ins for weapon and impact sounds. Each is replaced automatically by
 * public/audio/sfx/<name>.ogg when that file exists (see CombatSounds).
 */

const TAU = Math.PI * 2

function noise(n: number, seed: number): Float32Array {
  const rand = createRandom(seed)
  return Float32Array.from({ length: n }, () => rand() * 2 - 1)
}

function normalize(x: Float32Array, target = 0.9): Float32Array {
  let p = 0
  for (const v of x) p = Math.max(p, Math.abs(v))
  const s = target / Math.max(p, 1e-6)
  for (let i = 0; i < x.length; i++) x[i] *= s
  return x
}

/** Twin M134 at ~4,000 rounds/min combined: a ripping buzz of individual cracks. Loops seamlessly. */
export function minigunLoop(sr: number): Float32Array {
  const n = sr
  const f = fitFrequency(66, n, sr)
  const hiss = highpass(noise(n, 1), 1200 / sr)
  const body = lowpass(noise(n, 2), 900 / sr)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const phase = ((f * i) / sr) % 1
    const crack = Math.exp(-phase * 18)
    out[i] = crack * (0.8 * hiss[i] + 1.4 * body[i]) + 0.25 * Math.sin(TAU * f * (i / sr)) * crack
  }
  return normalize(out)
}

/** Electric motor whine of the spinning barrels. Loops seamlessly. */
export function minigunSpin(sr: number): Float32Array {
  const n = sr
  const out = new Float32Array(n)
  const f1 = fitFrequency(740, n, sr)
  const f2 = fitFrequency(1480, n, sr)
  for (let i = 0; i < n; i++) out[i] = Math.sin((TAU * f1 * i) / sr) + 0.4 * Math.sin((TAU * f2 * i) / sr)
  return normalize(out, 0.5)
}

export function rocketLaunch(sr: number): Float32Array {
  const n = Math.round(sr * 1.6)
  const x = noise(n, 3)
  const out = new Float32Array(n)
  let lp = 0
  for (let i = 0; i < n; i++) {
    const t = i / sr
    // Ignition pop, then a hissing roar that recedes as the rocket leaves.
    const env = Math.min(1, t * 60) * Math.exp(-t * 1.6)
    const a = 0.05 + 0.5 * Math.exp(-t * 3)
    lp += a * (x[i] - lp)
    out[i] = env * (lp * 2 + (t < 0.02 ? x[i] : 0))
  }
  return normalize(out)
}

export function explosion(sr: number): Float32Array {
  const n = Math.round(sr * 3)
  const x = noise(n, 4)
  const rumble = lowpass(lowpass(noise(n, 5), 120 / sr), 200 / sr)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / sr
    const crack = t < 0.03 ? x[i] * (1 - t / 0.03) : 0
    const boom = Math.sin(TAU * 42 * t * (1 - t * 0.15)) * Math.exp(-t * 4)
    out[i] = crack * 0.8 + boom * 0.9 + rumble[i] * 14 * Math.exp(-t * 1.3) * Math.min(1, t * 40)
  }
  return normalize(out)
}

/** AK-type rifle shot: supersonic crack plus muzzle report and a short tail. */
export function rifleShot(sr: number, heavy = false): Float32Array {
  const n = Math.round(sr * (heavy ? 0.7 : 0.45))
  const x = noise(n, heavy ? 6 : 7)
  const body = lowpass(noise(n, 8), (heavy ? 500 : 900) / sr)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / sr
    const crack = t < 0.004 ? x[i] : 0
    out[i] = crack + body[i] * 9 * Math.exp(-t * (heavy ? 9 : 14)) * Math.min(1, t * 400)
  }
  return normalize(out)
}

/** Round hitting the airframe: a sharp click and a metallic ring. */
export function metalHit(sr: number): Float32Array {
  const n = Math.round(sr * 0.35)
  const x = noise(n, 9)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / sr
    const ring = (Math.sin(TAU * 2650 * t) + 0.6 * Math.sin(TAU * 4130 * t) + 0.3 * Math.sin(TAU * 6020 * t)) * Math.exp(-t * 16)
    out[i] = (t < 0.003 ? x[i] : 0) + ring * 0.6
  }
  return normalize(out)
}

/** Supersonic snap of a round passing close by. */
export function bulletCrack(sr: number): Float32Array {
  const n = Math.round(sr * 0.06)
  const x = highpass(noise(n, 10), 2000 / sr)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = x[i] * Math.exp(-(i / sr) * 180)
  return normalize(out)
}

/** Round hitting dirt: a dull thud. */
export function dirtHit(sr: number): Float32Array {
  const n = Math.round(sr * 0.12)
  const x = lowpass(noise(n, 11), 600 / sr)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = x[i] * Math.exp(-(i / sr) * 40)
  return normalize(out)
}
