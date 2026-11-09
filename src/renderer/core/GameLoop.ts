export interface LoopHandlers {
  /** Called once per frame before any simulation steps (also while paused): poll input here. */
  input?(dt: number): void
  /** Advances the simulation by exactly `dt` seconds (always `GameLoop.fixedDt`). */
  fixedUpdate(dt: number): void
  /**
   * Called once per rendered frame.
   * @param dt    Real seconds since the previous frame (clamped).
   * @param alpha 0..1, how far real time has progressed between the last two simulation states.
   */
  frame(dt: number, alpha: number): void
}

/**
 * Fixed-timestep simulation with variable-rate rendering
 * (https://gafferongames.com/post/fix_your_timestep/).
 */
export class GameLoop {
  readonly fixedDt: number
  timeScale = 1
  paused = false
  /** Frame times above this (e.g. after a breakpoint or window drag) are clamped. */
  maxFrameDt = 0.25
  /** Upper bound on simulation steps per frame, so a slow frame can't snowball. */
  maxSubSteps = 10

  private accumulator = 0
  private lastTime: number | null = null
  private rafId = 0

  constructor(
    private readonly handlers: LoopHandlers,
    hz = 120,
  ) {
    this.fixedDt = 1 / hz
  }

  get running(): boolean {
    return this.rafId !== 0
  }

  start(): void {
    if (this.running) return
    this.lastTime = null
    const tick = (now: number) => {
      this.rafId = requestAnimationFrame(tick)
      const dt = this.lastTime === null ? 0 : (now - this.lastTime) / 1000
      this.lastTime = now
      this.advance(dt)
    }
    this.rafId = requestAnimationFrame(tick)
  }

  stop(): void {
    cancelAnimationFrame(this.rafId)
    this.rafId = 0
  }

  /** Runs exactly one simulation step; for single-stepping while paused. */
  step(): void {
    this.handlers.fixedUpdate(this.fixedDt)
  }

  /** Advances by `realDt` seconds of wall time. Returns the number of simulation steps run. */
  advance(realDt: number): number {
    const dt = Math.min(Math.max(realDt, 0), this.maxFrameDt)
    let steps = 0

    this.handlers.input?.(dt)

    if (!this.paused) {
      this.accumulator += dt * this.timeScale
      // Small epsilon so e.g. exactly 1/60 s still yields two 1/120 s steps despite float error.
      while (this.accumulator + 1e-9 >= this.fixedDt && steps < this.maxSubSteps) {
        this.handlers.fixedUpdate(this.fixedDt)
        this.accumulator -= this.fixedDt
        steps++
      }
      // Hit the cap: drop the backlog rather than trying to catch up next frame.
      if (this.accumulator >= this.fixedDt) this.accumulator %= this.fixedDt
      if (this.accumulator < 0) this.accumulator = 0
    }

    this.handlers.frame(dt, this.accumulator / this.fixedDt)
    return steps
  }
}
