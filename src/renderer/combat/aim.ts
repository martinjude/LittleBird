import { Vector3 } from 'three'

/**
 * Where to aim to hit a target moving at constant velocity with a round of the given
 * speed (ignoring drop). Iterates the time of flight a few times, which converges fast
 * for targets much slower than the round.
 */
export function leadPoint(shooter: Vector3, target: Vector3, targetVelocity: Vector3, roundSpeed: number, out = new Vector3()): Vector3 {
  out.copy(target)
  for (let i = 0; i < 4; i++) {
    const t = out.distanceTo(shooter) / roundSpeed
    out.copy(target).addScaledVector(targetVelocity, t)
  }
  return out
}

/**
 * Angular spread (radians, 1σ-ish) of an enemy gunner's aim: worse with range and with a
 * fast-moving or manoeuvring target, better for a skilled crew-served weapon.
 */
export function aimSpread(distance: number, targetSpeed: number, skill: number): number {
  const base = 0.012 / skill
  const range = 1 + distance / 600
  const motion = 1 + targetSpeed / 25
  return base * range * motion
}
