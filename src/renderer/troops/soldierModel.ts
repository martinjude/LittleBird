import { BoxGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry, type BufferGeometry, type Material } from 'three'

/**
 * Primitive soldier (~1.8 m, facing +Z, feet at y=0) with jointed limbs for code-driven
 * poses. A stand-in until a rigged character with animations replaces it.
 */
export interface SoldierRig {
  root: Group
  legL: Group
  legR: Group
  armL: Group
  armR: Group
  body: Group
}

export type SoldierPose = 'idle' | 'run' | 'sit' | 'kneel'

const HIP_HEIGHT = 0.95
export interface SoldierPalette {
  uniform: number
  gear: number
}

export const FRIENDLY: SoldierPalette = { uniform: 0x8a7f5c, gear: 0x55593a }
export const HOSTILE: SoldierPalette = { uniform: 0x4e4a40, gear: 0x2f2b26 }

const skin = new MeshStandardMaterial({ color: 0xc69c7a, roughness: 0.8 })
const dark = new MeshStandardMaterial({ color: 0x252525, roughness: 0.6, metalness: 0.3 })
const paletteMaterials = new Map<SoldierPalette, { uniform: MeshStandardMaterial; gear: MeshStandardMaterial }>()

function materialsFor(palette: SoldierPalette) {
  let m = paletteMaterials.get(palette)
  if (!m) {
    m = {
      uniform: new MeshStandardMaterial({ color: palette.uniform, roughness: 0.95 }),
      gear: new MeshStandardMaterial({ color: palette.gear, roughness: 0.9 }),
    }
    paletteMaterials.set(palette, m)
  }
  return { ...m, skin, dark }
}

export function buildSoldier(palette: SoldierPalette = FRIENDLY): SoldierRig {
  const materials = materialsFor(palette)
  const root = new Group()
  root.name = 'Soldier'
  const body = new Group()
  root.add(body)

  const part = (parent: Group, geometry: BufferGeometry, material: Material, x: number, y: number, z: number) => {
    const m = new Mesh(geometry, material)
    m.position.set(x, y, z)
    m.castShadow = true
    parent.add(m)
    return m
  }

  const limb = (x: number, y: number, length: number, width: number, material: Material) => {
    const pivot = new Group()
    pivot.position.set(x, y, 0)
    part(pivot, new BoxGeometry(width, length, width * 1.1), material, 0, -length / 2, 0)
    body.add(pivot)
    return pivot
  }

  const legL = limb(0.1, HIP_HEIGHT, 0.92, 0.16, materials.uniform)
  const legR = limb(-0.1, HIP_HEIGHT, 0.92, 0.16, materials.uniform)
  part(body, new BoxGeometry(0.4, 0.56, 0.24), materials.uniform, 0, 1.24, 0) // torso
  part(body, new BoxGeometry(0.44, 0.4, 0.3), materials.gear, 0, 1.28, 0.01) // plate carrier
  part(body, new BoxGeometry(0.32, 0.42, 0.18), materials.gear, 0, 1.3, -0.22) // pack
  part(body, new SphereGeometry(0.11, 10, 8), materials.skin, 0, 1.64, 0.01) // head
  part(body, new SphereGeometry(0.135, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), materials.gear, 0, 1.67, 0) // helmet
  const armL = limb(0.27, 1.48, 0.56, 0.1, materials.uniform)
  const armR = limb(-0.27, 1.48, 0.56, 0.1, materials.uniform)
  const rifle = part(armR, new BoxGeometry(0.05, 0.08, 0.8), materials.dark, 0.08, -0.5, 0.25)
  rifle.rotation.x = 0.2

  return { root, legL, legR, armL, armR, body }
}

/** Sets the limb angles for a pose. `phase` drives the run cycle (radians). */
export function poseSoldier(rig: SoldierRig, pose: SoldierPose, phase = 0): void {
  const { legL, legR, armL, armR, body } = rig
  body.position.set(0, 0, 0)
  body.rotation.set(0, 0, 0)
  armL.rotation.set(-0.5, 0, 0.1)
  armR.rotation.set(-0.7, 0, -0.1)
  switch (pose) {
    case 'idle':
      legL.rotation.set(0, 0, 0.04)
      legR.rotation.set(0, 0, -0.04)
      break
    case 'run': {
      const s = Math.sin(phase)
      legL.rotation.set(0.7 * s, 0, 0)
      legR.rotation.set(-0.7 * s, 0, 0)
      armL.rotation.set(-0.5 - 0.4 * s, 0, 0.1)
      body.rotation.x = 0.15
      body.position.y = Math.abs(Math.cos(phase)) * 0.06
      break
    }
    case 'sit':
      // Hips on the bench, legs angled forward and down.
      body.position.y = -0.82
      legL.rotation.set(-1.15, 0, 0.05)
      legR.rotation.set(-1.15, 0, -0.05)
      break
    case 'kneel':
      body.position.y = -0.42
      legL.rotation.set(-1.45, 0, 0)
      legR.rotation.set(0.35, 0, 0)
      body.rotation.x = 0.1
      break
  }
}
