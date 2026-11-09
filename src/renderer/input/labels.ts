import type { PadType } from './GamepadSource'

/** Experimental Keyboard API (Chromium): maps physical codes to the user's layout, e.g. KeyW → "z" on AZERTY. */
interface KeyboardLayoutApi {
  getLayoutMap(): Promise<Map<string, string>>
}

export type KeyboardLayout = Map<string, string> | null

export async function loadKeyboardLayout(): Promise<KeyboardLayout> {
  const keyboard = (navigator as Navigator & { keyboard?: KeyboardLayoutApi }).keyboard
  try {
    return (await keyboard?.getLayoutMap()) ?? null
  } catch {
    return null
  }
}

const KEY_NAMES: Record<string, string> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Space: 'Space',
  Escape: 'Esc',
  Enter: 'Enter',
  Tab: 'Tab',
  ShiftLeft: 'Shift',
  ShiftRight: 'R-Shift',
  ControlLeft: 'Ctrl',
  ControlRight: 'R-Ctrl',
  AltLeft: 'Alt',
  Mouse0: 'LMB',
  Mouse1: 'MMB',
  Mouse2: 'RMB',
}

/** Display label for a `KeyboardEvent.code` (or `MouseN`), using the user's keyboard layout when known. */
export function keyLabel(code: string, layout: KeyboardLayout): string {
  if (KEY_NAMES[code]) return KEY_NAMES[code]
  const mapped = layout?.get(code)
  if (mapped) return mapped.toUpperCase()
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`
  return code
}

const XBOX_BUTTONS = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'LS', 'RS', 'D-pad ↑', 'D-pad ↓', 'D-pad ←', 'D-pad →', 'Guide']
const PS_BUTTONS = ['✕', '○', '□', '△', 'L1', 'R1', 'L2', 'R2', 'Create', 'Options', 'L3', 'R3', 'D-pad ↑', 'D-pad ↓', 'D-pad ←', 'D-pad →', 'PS']

export function padButtonLabel(index: number, type: PadType): string {
  return (type === 'playstation' ? PS_BUTTONS : XBOX_BUTTONS)[index] ?? `Button ${index}`
}

export function padStickLabel(axis: number): string {
  return ['Left stick ↔', 'Left stick ↕', 'Right stick ↔', 'Right stick ↕'][axis] ?? `Axis ${axis}`
}
