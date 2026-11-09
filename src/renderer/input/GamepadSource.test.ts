import { describe, expect, it } from 'vitest'
import { detectPadType } from './GamepadSource'

describe('detectPadType', () => {
  it.each([
    ['Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)', 'xbox'],
    ['Xbox 360 Controller (XInput STANDARD GAMEPAD)', 'xbox'],
    ['DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)', 'playstation'],
    ['Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)', 'playstation'],
    ['8BitDo Pro 2 (Vendor: 2dc8 Product: 6006)', 'generic'],
  ])('%s → %s', (id, type) => {
    expect(detectPadType(id)).toBe(type)
  })
})
