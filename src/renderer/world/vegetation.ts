import {
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  IcosahedronGeometry,
  InstancedMesh,
  MathUtils,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { createRandom } from '../core/random'
import type { StaticCollider } from './colliders'
import { createPerlin, fbm } from './noise'
import type { ValleyMap } from './valley'

const { smoothstep } = MathUtils

const CANDIDATE_SPACING = 11
const MAX_TREES = 18000
const MAX_ROCKS = 2500
/** Instances are grouped into square chunks so the renderer can cull and distance-limit them. */
const CHUNK_SIZE = 512

/** One chunk's instanced meshes (one per species that has instances in it). */
export interface VegetationChunk {
  center: Vector3
  /** Horizontal half-diagonal, for distance tests from the chunk edge. */
  radius: number
  meshes: InstancedMesh[]
}

export interface Vegetation {
  chunks: VegetationChunk[]
  colliders: StaticCollider[]
}

/** Paints a geometry one flat colour via a vertex colour attribute (so parts can be merged). */
function tinted(geometry: BufferGeometry, color: Color): BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry
  const n = g.getAttribute('position').count
  const colors = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) colors.set([color.r, color.g, color.b], i * 3)
  g.setAttribute('color', new Float32BufferAttribute(colors, 3))
  return g
}

/** Unit-height conifer: trunk plus two stacked cones. */
function coniferGeometry(): BufferGeometry {
  const trunk = new Color(0.32, 0.22, 0.14)
  const needles = new Color(1, 1, 1) // tinted per instance
  return mergeGeometries([
    tinted(new CylinderGeometry(0.035, 0.05, 0.3, 5).translate(0, 0.15, 0), trunk),
    tinted(new ConeGeometry(0.3, 0.6, 7).translate(0, 0.45, 0), needles),
    tinted(new ConeGeometry(0.21, 0.5, 7).translate(0, 0.75, 0), needles),
  ])
}

/** Unit-height broadleaf: trunk plus a lumpy crown. */
function broadleafGeometry(): BufferGeometry {
  const trunk = new Color(0.3, 0.22, 0.15)
  const leaves = new Color(1, 1, 1)
  return mergeGeometries([
    tinted(new CylinderGeometry(0.04, 0.06, 0.45, 5).translate(0, 0.225, 0), trunk),
    tinted(new IcosahedronGeometry(0.38, 1).scale(1, 0.85, 1).translate(0, 0.66, 0), leaves),
  ])
}

/**
 * Scatters forests (clustered by noise; conifers higher up, broadleaf in the valley) and
 * boulders on slopes, keeping clear of the creek, steep faces and landing sites.
 */
export function scatterVegetation(map: ValleyMap, seed: number): Vegetation {
  const hm = map.heightmap
  const rand = createRandom(seed + 100)
  const forest = createPerlin(seed + 101)
  const colliders: StaticCollider[] = []

  const conifers: Matrix4[] = []
  const broadleaves: Matrix4[] = []
  const coniferColors: Color[] = []
  const broadleafColors: Color[] = []
  const m = new Matrix4()
  const q = new Quaternion()
  const up = new Vector3(0, 1, 0)

  const clearOfSites = (x: number, z: number, margin: number) =>
    map.sites.every((s) => Math.hypot(x - s.x, z - s.z) > s.radius + margin + (s.kind === 'base' ? 25 : 0))

  for (let z = -hm.half + 20; z < hm.half - 20; z += CANDIDATE_SPACING) {
    for (let x = -hm.half + 20; x < hm.half - 20; x += CANDIDATE_SPACING) {
      if (conifers.length + broadleaves.length >= MAX_TREES) break
      const px = x + (rand() - 0.5) * CANDIDATE_SPACING
      const pz = z + (rand() - 0.5) * CANDIDATE_SPACING
      const h = hm.heightAt(px, pz)
      const slope = hm.slopeAt(px, pz)
      const density =
        smoothstep(fbm(forest, px / 420, pz / 420, 4), -0.12, 0.3) *
        (1 - smoothstep(slope, 0.5, 0.8)) *
        (1 - smoothstep(h, 430, 540)) *
        smoothstep(Math.abs(px - map.creekX(pz)), 18, 45)
      if (rand() > density * 0.85 || !clearOfSites(px, pz, 25)) continue

      const conifer = rand() < smoothstep(h, 40, 200) * 0.8 + 0.2
      const height = conifer ? 11 + rand() * 13 : 8 + rand() * 7
      const width = height * (conifer ? 0.85 + rand() * 0.3 : 0.9 + rand() * 0.35)
      q.setFromAxisAngle(up, rand() * Math.PI * 2)
      // Sink a little so trunks on slopes don't float.
      m.compose(new Vector3(px, h - 0.4, pz), q, new Vector3(width, height, width))
      if (conifer) {
        conifers.push(m.clone())
        coniferColors.push(new Color().setHSL(0.27 + rand() * 0.06, 0.4, 0.13 + rand() * 0.07))
      } else {
        broadleaves.push(m.clone())
        broadleafColors.push(new Color().setHSL(0.2 + rand() * 0.08, 0.42, 0.2 + rand() * 0.08))
      }
      // Rotor strikes should feel the crown, not just the trunk.
      colliders.push({ shape: 'cylinder', x: px, y: h + height / 2, z: pz, halfHeight: height / 2, radius: width * 0.22 })
    }
  }

  const rocks: Matrix4[] = []
  const rockColors: Color[] = []
  for (let i = 0; i < MAX_ROCKS * 6 && rocks.length < MAX_ROCKS; i++) {
    const px = (rand() * 2 - 1) * (hm.half - 30)
    const pz = (rand() * 2 - 1) * (hm.half - 30)
    const slope = hm.slopeAt(px, pz)
    if (rand() > smoothstep(slope, 0.3, 0.7) || !clearOfSites(px, pz, 10)) continue
    const s = 0.8 + rand() ** 2 * 4
    q.setFromAxisAngle(new Vector3(rand(), rand(), rand()).normalize(), rand() * Math.PI)
    m.compose(new Vector3(px, hm.heightAt(px, pz) - s * 0.3, pz), q, new Vector3(s * (0.8 + rand() * 0.6), s * (0.5 + rand() * 0.4), s))
    rocks.push(m.clone())
    rockColors.push(new Color().setHSL(0.08, 0.06, 0.28 + rand() * 0.14))
  }

  // Bucket every species by chunk; geometry and material are shared across chunks.
  const chunkCount = Math.ceil(hm.size / CHUNK_SIZE)
  const chunks: VegetationChunk[] = []
  for (let cz = 0; cz < chunkCount; cz++) {
    for (let cx = 0; cx < chunkCount; cx++) {
      const center = new Vector3(-hm.half + (cx + 0.5) * CHUNK_SIZE, 0, -hm.half + (cz + 0.5) * CHUNK_SIZE)
      center.y = hm.heightAt(center.x, center.z)
      chunks.push({ center, radius: CHUNK_SIZE * Math.SQRT1_2, meshes: [] })
    }
  }
  const chunkOf = (m: Matrix4) => {
    const x = m.elements[12]
    const z = m.elements[14]
    const cx = MathUtils.clamp(Math.floor((x + hm.half) / CHUNK_SIZE), 0, chunkCount - 1)
    const cz = MathUtils.clamp(Math.floor((z + hm.half) / CHUNK_SIZE), 0, chunkCount - 1)
    return cz * chunkCount + cx
  }
  const species = (geometry: BufferGeometry, matrices: Matrix4[], colors: Color[], name: string, vertexColors: boolean) => {
    const material = new MeshStandardMaterial({ vertexColors, roughness: 0.9 })
    const buckets = chunks.map(() => [] as number[])
    matrices.forEach((m, i) => buckets[chunkOf(m)].push(i))
    buckets.forEach((indices, c) => {
      if (!indices.length) return
      const mesh = new InstancedMesh(geometry, material, indices.length)
      indices.forEach((src, i) => {
        mesh.setMatrixAt(i, matrices[src])
        mesh.setColorAt(i, colors[src])
      })
      mesh.castShadow = mesh.receiveShadow = true
      mesh.computeBoundingSphere()
      mesh.name = `${name} ${c}`
      chunks[c].meshes.push(mesh)
    })
  }
  species(coniferGeometry(), conifers, coniferColors, 'Conifers', true)
  species(broadleafGeometry(), broadleaves, broadleafColors, 'Broadleaves', true)
  species(new IcosahedronGeometry(1, 0), rocks, rockColors, 'Rocks', false)

  return { chunks: chunks.filter((c) => c.meshes.length), colliders }
}
