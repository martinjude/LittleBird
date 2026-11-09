export type LandingGrade = 'smooth' | 'firm' | 'hard' | 'very hard'

export interface Touchdown {
  /** Descent rate at contact (m/s, positive = down). */
  verticalSpeed: number
  /** Horizontal speed at contact (m/s). */
  groundSpeed: number
  grade: LandingGrade
  points: number
}

export interface LandingSample {
  /** Skids within a few cm of the ground. */
  onGround: boolean
  /** m/s, + = climbing */
  verticalSpeed: number
  groundSpeed: number
  /** Radians (nose-down +, right-wing-down +). */
  pitch: number
  roll: number
}

export const CRASH_DESCENT = 7
const SETTLE_TIME = 0.8
const SETTLE_SPEED = 0.8
/** Look back this far for the peak descent rate before contact (physics zeroes it at impact). */
const HISTORY = 0.3

export function gradeTouchdown(verticalSpeed: number): { grade: LandingGrade; points: number } {
  if (verticalSpeed < 0.6) return { grade: 'smooth', points: 100 }
  if (verticalSpeed < 1.5) return { grade: 'firm', points: 70 }
  if (verticalSpeed < 3) return { grade: 'hard', points: 30 }
  return { grade: 'very hard', points: 0 }
}

/**
 * Watches the skids: grades each touchdown, reports when the aircraft has settled on the
 * ground, and flags crashes (slamming in, or contact at extreme attitude / rolling over).
 */
export class LandingMonitor {
  /** True once on the ground and nearly still for a moment. */
  settled = false
  crashed: string | null = null
  lastTouchdown: Touchdown | null = null

  private wasOnGround = true
  private groundTime = 0
  private history: { t: number; descent: number }[] = []
  private time = 0

  reset(onGround = true): void {
    this.settled = onGround
    this.crashed = null
    this.lastTouchdown = null
    this.wasOnGround = onGround
    this.groundTime = onGround ? SETTLE_TIME : 0
    this.history = []
  }

  /** @returns the touchdown that happened this step, if any. */
  update(dt: number, s: LandingSample): Touchdown | null {
    this.time += dt
    let touchdown: Touchdown | null = null

    if (!s.onGround) {
      this.history.push({ t: this.time, descent: -s.verticalSpeed })
      while (this.history.length && this.time - this.history[0].t > HISTORY) this.history.shift()
    }

    if (s.onGround && !this.wasOnGround) {
      const descent = Math.max(-s.verticalSpeed, ...this.history.map((h) => h.descent), 0)
      touchdown = { verticalSpeed: descent, groundSpeed: s.groundSpeed, ...gradeTouchdown(descent) }
      this.lastTouchdown = touchdown
      this.history = []
      if (descent >= CRASH_DESCENT) this.crashed = `Hit the ground at ${descent.toFixed(1)} m/s`
      else if (Math.abs(s.roll) > 0.6 || Math.abs(s.pitch) > 0.6) this.crashed = 'Touched down at an extreme attitude'
    }
    if (s.onGround && Math.abs(s.roll) > 1.2) this.crashed = 'Rolled over'

    this.groundTime = s.onGround && s.groundSpeed < SETTLE_SPEED && Math.abs(s.verticalSpeed) < SETTLE_SPEED ? this.groundTime + dt : 0
    this.settled = this.groundTime >= SETTLE_TIME
    this.wasOnGround = s.onGround
    return touchdown
  }
}
