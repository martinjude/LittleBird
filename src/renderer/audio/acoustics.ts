import { MathUtils, Vector3 } from 'three'

export const SPEED_OF_SOUND = 343

const dir = new Vector3()

/**
 * Doppler pitch factor for a moving source and listener (Web Audio has none built in).
 * > 1 when they approach each other, < 1 when they separate. Clamped to a sane range.
 */
export function dopplerFactor(sourcePos: Vector3, sourceVel: Vector3, listenerPos: Vector3, listenerVel: Vector3): number {
  dir.subVectors(listenerPos, sourcePos)
  const distance = dir.length()
  if (distance < 1e-3) return 1
  dir.divideScalar(distance)
  const sourceToward = sourceVel.dot(dir) // + = source moving toward the listener
  const listenerToward = -listenerVel.dot(dir) // + = listener moving toward the source
  const c = SPEED_OF_SOUND
  return MathUtils.clamp((c + listenerToward) / Math.max(c - sourceToward, 1), 0.5, 2)
}

/** Low-pass cutoff (Hz) approximating high-frequency air absorption over distance. */
export function airAbsorptionCutoff(distance: number): number {
  return MathUtils.lerp(20000, 1800, MathUtils.smoothstep(distance, 40, 2000))
}

/** Seconds for sound to travel `distance` meters. */
export function soundDelay(distance: number): number {
  return Math.max(0, distance) / SPEED_OF_SOUND
}
