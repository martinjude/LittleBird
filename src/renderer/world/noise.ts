import { createRandom } from '../core/random'

/** Seeded 2D Perlin gradient noise, roughly in -1..1. */
export function createPerlin(seed: number): (x: number, y: number) => number {
  const rand = createRandom(seed)
  const perm = new Uint8Array(512)
  const p = Array.from({ length: 256 }, (_, i) => i)
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[p[i], p[j]] = [p[j], p[i]]
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255]

  const grad = (h: number, x: number, y: number) => {
    switch (h & 7) {
      case 0: return x + y
      case 1: return -x + y
      case 2: return x - y
      case 3: return -x - y
      case 4: return x
      case 5: return -x
      case 6: return y
      default: return -y
    }
  }
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10)

  return (x, y) => {
    const xi = Math.floor(x)
    const yi = Math.floor(y)
    const xf = x - xi
    const yf = y - yi
    const X = xi & 255
    const Y = yi & 255
    const u = fade(xf)
    const v = fade(yf)
    const aa = perm[perm[X] + Y]
    const ab = perm[perm[X] + Y + 1]
    const ba = perm[perm[X + 1] + Y]
    const bb = perm[perm[X + 1] + Y + 1]
    const x1 = grad(aa, xf, yf) + u * (grad(ba, xf - 1, yf) - grad(aa, xf, yf))
    const x2 = grad(ab, xf, yf - 1) + u * (grad(bb, xf - 1, yf - 1) - grad(ab, xf, yf - 1))
    return x1 + v * (x2 - x1)
  }
}

/** Fractal sum of `octaves` noise layers, normalised to roughly -1..1. */
export function fbm(noise: (x: number, y: number) => number, x: number, y: number, octaves: number, lacunarity = 2, gain = 0.5) {
  let sum = 0
  let amp = 1
  let norm = 0
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(x, y)
    norm += amp
    x *= lacunarity
    y *= lacunarity
    amp *= gain
  }
  return sum / norm
}

/** Ridged multifractal (sharp crests), roughly 0..1. Good for mountain ranges. */
export function ridged(noise: (x: number, y: number) => number, x: number, y: number, octaves: number) {
  let sum = 0
  let amp = 0.5
  let weight = 1
  let norm = 0
  for (let i = 0; i < octaves; i++) {
    let n = 1 - Math.abs(noise(x, y))
    n *= n * weight
    weight = Math.min(1, n * 2)
    sum += n * amp
    norm += amp
    x *= 2
    y *= 2
    amp *= 0.5
  }
  return sum / norm
}
