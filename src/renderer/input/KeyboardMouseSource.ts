export interface KeyboardMouseSource {
  /**
   * `code` is a `KeyboardEvent.code` or `Mouse0`/`Mouse1`/`Mouse2`. Also true for a key
   * tapped and released since the last `endFrame()`, so quick taps are never missed.
   */
  isDown(code: string): boolean
  /** Call after reading input for the frame. */
  endFrame(): void
  /** Mouse movement since the last call, in pixels. */
  takeMouseDelta(out: { x: number; y: number }): { x: number; y: number }
  /** True if any key or mouse button was pressed since the last call. */
  takeActivity(): boolean
}

/**
 * Tracks held keys/buttons by physical key code, so the default WASD layout lands
 * on ZQSD on AZERTY keyboards without any remapping.
 */
export class BrowserKeyboardMouseSource implements KeyboardMouseSource {
  private readonly down = new Set<string>()
  private readonly tapped = new Set<string>()
  private dx = 0
  private dy = 0
  private activity = false
  private lockButtons = new Set<string>()

  constructor(element: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (isTextEntry(e.target)) return
      this.down.add(e.code)
      this.tapped.add(e.code)
      this.activity = true
    })
    window.addEventListener('keyup', (e) => this.down.delete(e.code))
    // Keys released while the window is unfocused never send keyup.
    window.addEventListener('blur', () => this.down.clear())

    element.addEventListener('mousedown', (e) => {
      const code = `Mouse${e.button}`
      this.down.add(code)
      this.tapped.add(code)
      this.activity = true
      if (this.lockButtons.has(code)) element.requestPointerLock()
    })
    window.addEventListener('mouseup', (e) => {
      const code = `Mouse${e.button}`
      this.down.delete(code)
      if (this.lockButtons.has(code) && document.pointerLockElement === element) document.exitPointerLock()
    })
    window.addEventListener('mousemove', (e) => {
      this.dx += e.movementX
      this.dy += e.movementY
    })
    element.addEventListener('contextmenu', (e) => e.preventDefault())
  }

  /** Mouse buttons that capture the pointer while held (free-look), so the cursor can't leave the window. */
  setPointerLockButtons(codes: string[]): void {
    this.lockButtons = new Set(codes.filter((c) => c.startsWith('Mouse')))
  }

  isDown(code: string): boolean {
    return this.down.has(code) || this.tapped.has(code)
  }

  endFrame(): void {
    this.tapped.clear()
  }

  takeMouseDelta(out: { x: number; y: number }) {
    out.x = this.dx
    out.y = this.dy
    this.dx = this.dy = 0
    return out
  }

  takeActivity(): boolean {
    const a = this.activity
    this.activity = false
    return a
  }
}

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT'
}
