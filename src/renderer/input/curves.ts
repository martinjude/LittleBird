export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

export function moveTowards(current: number, target: number, maxDelta: number): number {
  const d = target - current
  return Math.abs(d) <= maxDelta ? target : current + Math.sign(d) * maxDelta
}

/**
 * Radial deadzone for a stick pair, rescaled so output still reaches 1 at full
 * deflection. Radial (rather than per-axis) avoids the "snap to cross" feel on the cyclic.
 */
export function radialDeadzone(x: number, y: number, deadzone: number, out: { x: number; y: number }) {
  const mag = Math.hypot(x, y)
  if (mag <= deadzone) {
    out.x = 0
    out.y = 0
  } else {
    const scaled = Math.min(1, (mag - deadzone) / (1 - deadzone))
    out.x = (x / mag) * scaled
    out.y = (y / mag) * scaled
  }
  return out
}

/** Blend between linear (k = 0) and cubic (k = 1) response, keeping the sign. */
export function expo(v: number, k: number): number {
  const a = Math.abs(v)
  return Math.sign(v) * ((1 - k) * a + k * a * a * a)
}
