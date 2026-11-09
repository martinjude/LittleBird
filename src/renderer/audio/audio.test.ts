import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { airAbsorptionCutoff, dopplerFactor, soundDelay } from './acoustics'
import { bladeSlap, fitFrequency, gearbox, rotorThump, tailRotorBuzz, turbineWhine, wind } from './synth'
import { pickVoiceToSteal } from './VoicePool'

const SR = 48000
const spec = { sampleRate: SR, seconds: 1 }

describe('synth loops', () => {
  const loops = {
    rotorThump: rotorThump(spec, 47),
    bladeSlap: bladeSlap(spec, 47),
    turbineWhine: turbineWhine(spec),
    gearbox: gearbox(spec),
    tailRotorBuzz: tailRotorBuzz(spec, 94),
    wind: wind(spec),
  }

  it.each(Object.entries(loops))('%s has the requested length, sane levels and no NaNs', (_, x) => {
    expect(x.length).toBe(SR)
    let peak = 0
    for (const v of x) {
      expect(Number.isFinite(v)).toBe(true)
      peak = Math.max(peak, Math.abs(v))
    }
    expect(peak).toBeCloseTo(0.9, 2)
  })

  it.each(Object.entries(loops))('%s wraps around without a click', (_, x) => {
    // The jump across the loop point should look like any other sample-to-sample step.
    let maxStep = 0
    for (let i = 1; i < x.length; i++) maxStep = Math.max(maxStep, Math.abs(x[i] - x[i - 1]))
    expect(Math.abs(x[0] - x[x.length - 1])).toBeLessThanOrEqual(maxStep * 1.05)
  })

  it('fits whole cycles into the loop', () => {
    const f = fitFrequency(47, SR, SR)
    expect((f * SR) / SR).toBeCloseTo(Math.round(f))
    expect(fitFrequency(46.7, 96000, SR) * 2).toBeCloseTo(Math.round(46.7 * 2))
  })
})

describe('acoustics', () => {
  const still = new Vector3()

  it('raises pitch for an approaching source and lowers it for a receding one', () => {
    const listener = new Vector3(0, 0, 0)
    const source = new Vector3(100, 0, 0)
    expect(dopplerFactor(source, new Vector3(-50, 0, 0), listener, still)).toBeGreaterThan(1.1)
    expect(dopplerFactor(source, new Vector3(50, 0, 0), listener, still)).toBeLessThan(0.9)
    expect(dopplerFactor(source, new Vector3(0, 0, 50), listener, still)).toBeCloseTo(1)
  })

  it('has no Doppler when listener and source move together', () => {
    const v = new Vector3(40, 0, 0)
    expect(dopplerFactor(new Vector3(10, 0, 0), v, new Vector3(0, 0, 0), v)).toBeCloseTo(1, 1)
  })

  it('muffles distant sound and delays it by the speed of sound', () => {
    expect(airAbsorptionCutoff(10)).toBe(20000)
    expect(airAbsorptionCutoff(3000)).toBeLessThan(2000)
    expect(soundDelay(343)).toBeCloseTo(1)
  })
})

describe('pickVoiceToSteal', () => {
  it('steals the lowest-priority, oldest voice', () => {
    const voices = [
      { priority: 2, startTime: 1 },
      { priority: 1, startTime: 5 },
      { priority: 1, startTime: 3 },
    ]
    expect(pickVoiceToSteal(voices, 2)).toBe(2)
  })

  it('refuses when everything playing is more important', () => {
    expect(pickVoiceToSteal([{ priority: 5, startTime: 0 }], 1)).toBe(-1)
  })
})
