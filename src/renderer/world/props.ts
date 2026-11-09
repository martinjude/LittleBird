import {
  BoxGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  RingGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
} from 'three'
import { createRandom } from '../core/random'
import type { StaticCollider } from './colliders'
import type { Site } from './valley'

const Y = new Vector3(0, 1, 0)

export interface Placed {
  object: Group
  colliders: StaticCollider[]
  /** Helipad centres (world), for spawning and future missions. */
  pads: Vector3[]
}

const decal = (color: number) =>
  new MeshStandardMaterial({ color, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })

/** Concrete helipad with a yellow ring and a white H, lying on the ground at y. */
export function helipad(x: number, y: number, z: number, radius = 9): Group {
  const g = new Group()
  g.position.set(x, y, z)
  const flat = (geometry: BufferGeometry, material: Material, lift: number) => {
    const m = new Mesh(geometry, material)
    m.rotation.x = -Math.PI / 2
    m.position.y = lift
    m.receiveShadow = true
    g.add(m)
    return m
  }
  flat(new CircleGeometry(radius, 48), decal(0x6f6f6a), 0.03)
  flat(new RingGeometry(radius - 0.8, radius - 0.3, 48), decal(0xd9b632), 0.05)
  const white = decal(0xf2f2ee)
  for (const [w, d, bx] of [[0.9, 6, -1.8], [0.9, 6, 1.8], [2.7, 0.9, 0]] as const) {
    const bar = flat(new BoxGeometry(w, d, 0.01), white, 0.05)
    bar.position.x = bx
  }
  return g
}

/**
 * FOB Eagle: three pads in a row, a hangar, tents and containers, a windsock and a
 * ring of HESCO barriers with a gap for the road.
 */
export function buildBase(site: Site, seed: number): Placed {
  const g = new Group()
  g.name = 'FOB Eagle'
  const colliders: StaticCollider[] = []
  const rand = createRandom(seed + 200)
  const { x: bx, y: by, z: bz } = site
  const pads = [-34, 0, 34].map((dx) => new Vector3(bx + dx, by, bz - 25))
  for (const p of pads) g.add(helipad(p.x, p.y, p.z))

  const solid = (w: number, h: number, d: number, color: number, x: number, z: number, yaw = 0, geometry?: BufferGeometry) => {
    const mesh = new Mesh(geometry ?? new BoxGeometry(w, h, d), new MeshStandardMaterial({ color, roughness: 0.85 }))
    mesh.position.set(bx + x, by + h / 2, bz + z)
    mesh.rotation.y = yaw
    mesh.castShadow = mesh.receiveShadow = true
    g.add(mesh)
    colliders.push({ shape: 'box', x: bx + x, y: by + h / 2, z: bz + z, hx: w / 2, hy: h / 2, hz: d / 2, yaw })
    return mesh
  }

  // Hangar with a darker roof.
  solid(26, 9, 18, 0x7d8178, 0, 38)
  const roof = new Mesh(new BoxGeometry(27, 0.6, 19), new MeshStandardMaterial({ color: 0x4b4f4a, roughness: 0.7 }))
  roof.position.set(bx, by + 9.3, bz + 38)
  roof.castShadow = true
  g.add(roof)

  // Tents (triangular prisms) and shipping containers.
  const tentGeometry = new CylinderGeometry(3, 3, 9, 3, 1).rotateZ(Math.PI / 2).rotateX(Math.PI / 6)
  for (const [x, z] of [[-55, 20], [-55, 34], [-55, 48]] as const) solid(9, 4, 6, 0x6b6a4e, x, z, 0, tentGeometry.clone().translate(0, -0.5, 0))
  for (const [x, z, yaw, color] of [[45, 30, 0.1, 0x7a4a2a], [45, 38, -0.05, 0x3d5a3a], [52, 48, 1.5, 0x8a7f5c]] as const) {
    solid(6.1, 2.6, 2.4, color, x, z, yaw)
  }

  // Windsock.
  const pole = new Mesh(new CylinderGeometry(0.06, 0.08, 6, 6), new MeshStandardMaterial({ color: 0xcccccc }))
  pole.position.set(bx + 60, by + 3, bz - 10)
  const sock = new Mesh(new ConeGeometry(0.5, 2.5, 10, 1, true), new MeshStandardMaterial({ color: 0xff6a00, side: DoubleSide }))
  sock.rotation.z = Math.PI / 2
  sock.position.set(bx + 61.3, by + 5.7, bz - 10)
  g.add(pole, sock)

  // HESCO ring, open to the east for the road.
  const hescoRadius = site.radius - 6
  const count = Math.floor((2 * Math.PI * hescoRadius) / 1.15)
  const matrices: Matrix4[] = []
  const q = new Quaternion()
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2
    if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < 0.12) continue // gap facing +X
    const x = bx + Math.cos(a) * hescoRadius
    const z = bz + Math.sin(a) * hescoRadius
    q.setFromAxisAngle(Y, -a)
    matrices.push(new Matrix4().compose(new Vector3(x, by + 0.7, z), q, new Vector3(1.1, 1.4 + rand() * 0.1, 1.1)))
    colliders.push({ shape: 'box', x, y: by + 0.7, z, hx: 0.55, hy: 0.7, hz: 0.55, yaw: -a })
  }
  const hesco = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ color: 0x9c8a63, roughness: 1 }), matrices.length)
  matrices.forEach((mat, i) => hesco.setMatrixAt(i, mat))
  hesco.castShadow = hesco.receiveShadow = true
  g.add(hesco)

  return { object: g, colliders, pads }
}

/** LZ marking: orange VS-17 panels laid out in a "T" pointing at the approach. */
export function buildLzMarker(site: Site): Placed {
  const g = new Group()
  g.name = site.name
  const panel = new MeshStandardMaterial({ color: new Color(1, 0.35, 0.05), roughness: 0.6, emissive: 0x401000 })
  for (const [x, z] of [[-2.5, -4], [0, -4], [2.5, -4], [0, -1.5], [0, 1]] as const) {
    const m = new Mesh(new BoxGeometry(2, 0.05, 0.7), panel)
    m.position.set(site.x + x, site.y + 0.05, site.z + z)
    if (x === 0 && z !== -4) m.rotation.y = Math.PI / 2
    m.receiveShadow = true
    g.add(m)
  }
  return { object: g, colliders: [], pads: [new Vector3(site.x, site.y, site.z)] }
}
