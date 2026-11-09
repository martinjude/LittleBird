import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  Vector3,
  type WebGLRenderer,
} from 'three'
import { createRandom } from '../core/random'
import { createPerlin, fbm } from './noise'
import type { ValleyMap } from './valley'

const { smoothstep } = MathUtils

/** Detail texture repeats every this many meters. */
const DETAIL_TILE = 6
/** Depth of the skirt hiding cracks between the detailed terrain and the distant ring. */
const SKIRT_DEPTH = 40

const PALETTE = {
  grassA: new Color().setRGB(0.25, 0.34, 0.14, SRGBColorSpace),
  grassB: new Color().setRGB(0.36, 0.4, 0.18, SRGBColorSpace),
  dirt: new Color().setRGB(0.38, 0.32, 0.22, SRGBColorSpace),
  rock: new Color().setRGB(0.4, 0.38, 0.35, SRGBColorSpace),
  snow: new Color().setRGB(0.9, 0.92, 0.95, SRGBColorSpace),
  gravel: new Color().setRGB(0.48, 0.46, 0.41, SRGBColorSpace),
}

/**
 * Colours the ground by what it is: grass on gentle slopes (two shades, by noise),
 * dirt along the creek, rock on steep faces, snow high up, gravel on landing sites.
 */
function createColorizer(map: ValleyMap, seed: number) {
  const noise = createPerlin(seed + 10)
  const c = new Color()
  return (x: number, z: number, height: number, slope: number, out: Color) => {
    const n = fbm(noise, x / 260, z / 260, 3) * 0.5 + 0.5
    out.copy(PALETTE.grassA).lerp(PALETTE.grassB, smoothstep(n, 0.3, 0.7))
    const creek = 1 - smoothstep(Math.abs(x - map.creekX(z)), 12, 55)
    out.lerp(PALETTE.dirt, creek * 0.85)
    out.lerp(c.copy(PALETTE.rock), smoothstep(slope, 0.45, 0.75))
    out.lerp(PALETTE.snow, smoothstep(height, 560, 700) * (1 - smoothstep(slope, 0.85, 1.1)))
    for (const site of map.sites) {
      const d = Math.hypot(x - site.x, z - site.z)
      if (d < site.radius + 15) out.lerp(PALETTE.gravel, 1 - smoothstep(d, site.radius * 0.85, site.radius + 15))
    }
    return out
  }
}

/** Detailed playable terrain (one mesh), with a skirt around its border. */
export function buildTerrain(map: ValleyMap, material: MeshStandardMaterial, seed: number): Mesh {
  const hm = map.heightmap
  const r = hm.resolution
  const vertexCount = r * r + 4 * r // grid + skirt
  const positions = new Float32Array(vertexCount * 3)
  const normals = new Float32Array(vertexCount * 3)
  const colors = new Float32Array(vertexCount * 3)
  const uvs = new Float32Array(vertexCount * 2)
  const colorize = createColorizer(map, seed)
  const n = new Vector3()
  const c = new Color()

  const put = (i: number, x: number, y: number, z: number, normal: Vector3, color: Color) => {
    positions.set([x, y, z], i * 3)
    normals.set([normal.x, normal.y, normal.z], i * 3)
    colors.set([color.r, color.g, color.b], i * 3)
    uvs.set([x / DETAIL_TILE, z / DETAIL_TILE], i * 2)
  }

  for (let iz = 0; iz < r; iz++) {
    for (let ix = 0; ix < r; ix++) {
      const x = -hm.half + ix * hm.spacing
      const z = -hm.half + iz * hm.spacing
      const y = hm.at(ix, iz)
      hm.normalAtGrid(ix, iz, n)
      put(iz * r + ix, x, y, z, n, colorize(x, z, y, Math.acos(n.y), c))
    }
  }

  const indices: number[] = []
  for (let iz = 0; iz < r - 1; iz++) {
    for (let ix = 0; ix < r - 1; ix++) {
      const a = iz * r + ix
      const b = a + 1
      const d = a + r
      const e = d + 1
      indices.push(a, d, b, b, d, e)
    }
  }

  // Skirt: duplicate each border vertex SKIRT_DEPTH lower and stitch a wall between them.
  const border: number[] = []
  for (let i = 0; i < r; i++) border.push(i) // north edge, west → east
  for (let i = 1; i < r; i++) border.push(i * r + r - 1) // east edge
  for (let i = r - 2; i >= 0; i--) border.push((r - 1) * r + i) // south edge
  for (let i = r - 2; i > 0; i--) border.push(i * r) // west edge
  let next = r * r
  const skirtStart = next
  for (const top of border) {
    n.set(normals[top * 3], normals[top * 3 + 1], normals[top * 3 + 2])
    c.setRGB(colors[top * 3], colors[top * 3 + 1], colors[top * 3 + 2])
    put(next++, positions[top * 3], positions[top * 3 + 1] - SKIRT_DEPTH, positions[top * 3 + 2], n, c)
  }
  for (let i = 0; i < border.length; i++) {
    const j = (i + 1) % border.length
    const t0 = border[i]
    const t1 = border[j]
    const b0 = skirtStart + i
    const b1 = skirtStart + j
    indices.push(t0, t1, b0, t1, b1, b0)
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions.subarray(0, next * 3), 3))
  geometry.setAttribute('normal', new BufferAttribute(normals.subarray(0, next * 3), 3))
  geometry.setAttribute('color', new BufferAttribute(colors.subarray(0, next * 3), 3))
  geometry.setAttribute('uv', new BufferAttribute(uvs.subarray(0, next * 2), 2))
  geometry.setIndex(indices)
  geometry.computeBoundingSphere()

  const mesh = new Mesh(geometry, material)
  mesh.name = 'Terrain'
  mesh.receiveShadow = true
  mesh.castShadow = true
  return mesh
}

/**
 * Low-detail mountains around the playable square, out to `extent`, so the world
 * doesn't end at a cliff. Its grid lines up with the square's border; quads inside it are skipped.
 */
export function buildDistantRing(map: ValleyMap, material: MeshStandardMaterial, seed: number, extent = 16384, segments = 128) {
  const step = extent / segments
  const half = extent / 2
  const inner = map.heightmap.half
  const verts = segments + 1
  const positions = new Float32Array(verts * verts * 3)
  const colors = new Float32Array(verts * verts * 3)
  const uvs = new Float32Array(verts * verts * 2)
  const colorize = createColorizer(map, seed)
  const c = new Color()
  for (let iz = 0; iz < verts; iz++) {
    for (let ix = 0; ix < verts; ix++) {
      const x = -half + ix * step
      const z = -half + iz * step
      const onInner = Math.abs(x) <= inner && Math.abs(z) <= inner
      const y = onInner ? map.heightmap.heightAt(x, z) : map.rawHeight(x, z)
      const slope = Math.atan(Math.abs(map.rawHeight(x + step, z) - map.rawHeight(x - step, z)) / (2 * step))
      colorize(x, z, y, slope * 1.6, c)
      const i = iz * verts + ix
      positions.set([x, y, z], i * 3)
      colors.set([c.r, c.g, c.b], i * 3)
      uvs.set([x / DETAIL_TILE, z / DETAIL_TILE], i * 2)
    }
  }
  const indices: number[] = []
  for (let iz = 0; iz < segments; iz++) {
    for (let ix = 0; ix < segments; ix++) {
      const cx = -half + (ix + 0.5) * step
      const cz = -half + (iz + 0.5) * step
      if (Math.abs(cx) < inner && Math.abs(cz) < inner) continue
      const a = iz * verts + ix
      indices.push(a, a + verts, a + 1, a + 1, a + verts, a + verts + 1)
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('color', new BufferAttribute(colors, 3))
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  const mesh = new Mesh(geometry, material)
  mesh.name = 'DistantMountains'
  mesh.receiveShadow = true
  return mesh
}

/** Shared ground material: vertex colours × a tiling grey detail texture. */
export function createGroundMaterial(renderer: WebGLRenderer): MeshStandardMaterial {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  const rand = createRandom(21)
  const img = ctx.createImageData(size, size)
  // Tileable noise: random grids blurred with wrap-around, at two scales, plus fine grain.
  const blurred = (radius: number) => {
    const src = Float32Array.from({ length: size * size }, rand)
    const out = new Float32Array(size * size)
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let sum = 0
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) sum += src[((y + dy + size) % size) * size + ((x + dx + size) % size)]
        }
        out[y * size + x] = sum
      }
    }
    // Averaging flattens the contrast; stretch back to 0..1.
    let lo = Infinity
    let hi = -Infinity
    for (const v of out) {
      lo = Math.min(lo, v)
      hi = Math.max(hi, v)
    }
    return out.map((v) => (v - lo) / (hi - lo))
  }
  const coarse = blurred(6)
  const medium = blurred(2)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x
      const value = 0.66 + 0.2 * coarse[i] + 0.1 * medium[i] + 0.06 * rand()
      const k = (y * size + x) * 4
      img.data[k] = img.data[k + 1] = img.data[k + 2] = Math.min(255, value * 255)
      img.data[k + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  const texture = new CanvasTexture(canvas)
  texture.wrapS = texture.wrapT = RepeatWrapping
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy()
  return new MeshStandardMaterial({ vertexColors: true, map: texture, roughness: 0.95, metalness: 0 })
}
