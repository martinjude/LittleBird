import { MathUtils, Vector3 } from 'three'

/**
 * Square heightmap centred on the world origin. `heights[iz * resolution + ix]` is the
 * height at x = -size/2 + ix·spacing, z = -size/2 + iz·spacing.
 */
export class Heightmap {
  readonly spacing: number
  readonly half: number

  constructor(
    readonly size: number,
    readonly resolution: number,
    readonly heights: Float32Array,
  ) {
    this.spacing = size / (resolution - 1)
    this.half = size / 2
  }

  static sample(size: number, resolution: number, fn: (x: number, z: number) => number): Heightmap {
    const heights = new Float32Array(resolution * resolution)
    const spacing = size / (resolution - 1)
    for (let iz = 0; iz < resolution; iz++) {
      for (let ix = 0; ix < resolution; ix++) heights[iz * resolution + ix] = fn(-size / 2 + ix * spacing, -size / 2 + iz * spacing)
    }
    return new Heightmap(size, resolution, heights)
  }

  at(ix: number, iz: number): number {
    const r = this.resolution
    return this.heights[MathUtils.clamp(iz, 0, r - 1) * r + MathUtils.clamp(ix, 0, r - 1)]
  }

  /** Bilinear height at world (x, z); clamped to the edge outside the map. */
  heightAt(x: number, z: number): number {
    const fx = MathUtils.clamp((x + this.half) / this.spacing, 0, this.resolution - 1)
    const fz = MathUtils.clamp((z + this.half) / this.spacing, 0, this.resolution - 1)
    const ix = Math.min(Math.floor(fx), this.resolution - 2)
    const iz = Math.min(Math.floor(fz), this.resolution - 2)
    const tx = fx - ix
    const tz = fz - iz
    const h00 = this.at(ix, iz)
    const h10 = this.at(ix + 1, iz)
    const h01 = this.at(ix, iz + 1)
    const h11 = this.at(ix + 1, iz + 1)
    return MathUtils.lerp(MathUtils.lerp(h00, h10, tx), MathUtils.lerp(h01, h11, tx), tz)
  }

  /** Surface normal from central differences at grid point (ix, iz). */
  normalAtGrid(ix: number, iz: number, out = new Vector3()): Vector3 {
    const dx = this.at(ix + 1, iz) - this.at(ix - 1, iz)
    const dz = this.at(ix, iz + 1) - this.at(ix, iz - 1)
    return out.set(-dx, 2 * this.spacing, -dz).normalize()
  }

  /** Slope angle (radians) at world (x, z). */
  slopeAt(x: number, z: number): number {
    const e = this.spacing
    const dx = this.heightAt(x + e, z) - this.heightAt(x - e, z)
    const dz = this.heightAt(x, z + e) - this.heightAt(x, z - e)
    return Math.atan(Math.hypot(dx, dz) / (2 * e))
  }

  contains(x: number, z: number): boolean {
    return Math.abs(x) <= this.half && Math.abs(z) <= this.half
  }
}
