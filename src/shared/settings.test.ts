import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, mergeSettings } from './settings'

describe('mergeSettings', () => {
  it('returns defaults for nothing saved', () => {
    expect(mergeSettings(null)).toEqual(DEFAULT_SETTINGS)
  })

  it('keeps valid saved values, ignores wrong types and unknown keys', () => {
    const s = mergeSettings({ graphics: { fov: 85, shadows: 'yes', bogus: 1 }, audio: { master: 0.3 } })
    expect(s.graphics.fov).toBe(85)
    expect(s.graphics.shadows).toBe(true)
    expect(s.audio.master).toBe(0.3)
    expect('bogus' in s.graphics).toBe(false)
  })

  it('fills in settings added after the save was written', () => {
    const s = mergeSettings({ graphics: { fov: 60 } })
    expect(s.graphics.treeDistance).toBe(DEFAULT_SETTINGS.graphics.treeDistance)
  })

  it('keeps open maps like best scores', () => {
    const s = mergeSettings({ progress: { best: { 'hot-lz': 1200 }, current: 3 } })
    expect(s.progress.best).toEqual({ 'hot-lz': 1200 })
    expect(s.progress.current).toBe(3)
  })

  it('keeps rebinding arrays', () => {
    const s = mergeSettings({ bindings: { keyboard: { buttons: { fireGuns: ['KeyG'] } } } })
    expect(s.bindings.keyboard.buttons.fireGuns).toEqual(['KeyG'])
    expect(s.bindings.keyboard.buttons.pause).toEqual(DEFAULT_SETTINGS.bindings.keyboard.buttons.pause)
  })
})
