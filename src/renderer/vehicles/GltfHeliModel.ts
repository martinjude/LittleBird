import {
  Box3,
  CircleGeometry,
  DoubleSide,
  Group,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  Vector3,
  type Material,
  type Object3D,
} from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import type { HeliModel } from './HeliModel'

const TAU = Math.PI * 2
const TAIL_ROTOR_RATIO = 6

/**
 * A helicopter GLB that follows the PLAN.md §7 conventions: meters, +Y up, nose +Z,
 * origin at the skid bottoms, rotors in `Rotor_Main` / `Rotor_Tail` with pivots on
 * their axes, optional `Eye_Pilot`. `COL_*` collision proxies are hidden.
 */
export class GltfHeliModel implements HeliModel {
  readonly object = new Group()
  readonly eye: Vector3 | null

  private readonly mainRotor: Object3D | null
  private readonly tailRotor: Object3D | null
  /** Inserted above the main rotor so cyclic tilt and spin don't fight over one rotation. */
  private readonly rotorTilt = new Group()
  private readonly disc: Mesh<CircleGeometry, MeshStandardMaterial> | null = null
  private readonly bladeMaterials: Material[] = []
  private cockpitView = false

  static async load(url: string): Promise<GltfHeliModel> {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
    const gltf = await loader.loadAsync(url)
    return new GltfHeliModel(gltf.scene)
  }

  constructor(scene: Object3D) {
    this.object.name = 'LittleBird'
    this.object.add(scene)

    scene.traverse((o) => {
      if (o.name.startsWith('COL_')) o.visible = false
      if ((o as Mesh).isMesh) o.castShadow = o.receiveShadow = true
    })

    this.mainRotor = scene.getObjectByName('Rotor_Main') ?? null
    this.tailRotor = scene.getObjectByName('Rotor_Tail') ?? null
    const eye = scene.getObjectByName('Eye_Pilot')
    this.eye = eye ? eye.getWorldPosition(new Vector3()) : null
    if (!this.mainRotor) console.warn('Helicopter model has no "Rotor_Main" node; main rotor will not spin.')
    if (!this.tailRotor) console.warn('Helicopter model has no "Rotor_Tail" node; tail rotor will not spin.')

    if (this.mainRotor?.parent) {
      // Re-parent: parent → rotorTilt (at the rotor's position) → Rotor_Main.
      const parent = this.mainRotor.parent
      this.rotorTilt.position.copy(this.mainRotor.position)
      this.rotorTilt.quaternion.copy(this.mainRotor.quaternion)
      parent.add(this.rotorTilt)
      this.mainRotor.position.set(0, 0, 0)
      this.mainRotor.quaternion.identity()
      this.rotorTilt.add(this.mainRotor)

      // The pipeline's dedup may share the blade material with the fuselage, so fade a private copy.
      this.mainRotor.traverse((o) => {
        const mesh = o as Mesh
        if (!mesh.isMesh) return
        const copies = [mesh.material].flat().map((m) => {
          const copy = m.clone()
          copy.transparent = true
          this.bladeMaterials.push(copy)
          return copy
        })
        mesh.material = Array.isArray(mesh.material) ? copies : copies[0]
      })

      // Blur disc sized from the blades' horizontal extent.
      const size = new Box3().setFromObject(this.mainRotor).getSize(new Vector3())
      const radius = Math.max(size.x, size.z) / 2
      if (radius > 0.5) {
        this.disc = new Mesh(
          new CircleGeometry(radius, 48),
          new MeshStandardMaterial({ color: 0x222222, transparent: true, opacity: 0, depthWrite: false, side: DoubleSide }),
        )
        this.disc.rotation.x = -Math.PI / 2
        this.rotorTilt.add(this.disc)
      }
    }
  }

  animate(dt: number, rotorRpm: number, tilt: { pitch: number; roll: number }): void {
    const omega = (rotorRpm * TAU) / 60
    if (this.mainRotor) this.mainRotor.rotation.y = (this.mainRotor.rotation.y + omega * dt) % TAU
    if (this.tailRotor) this.tailRotor.rotation.x = (this.tailRotor.rotation.x + omega * TAIL_ROTOR_RATIO * dt) % TAU
    this.rotorTilt.rotation.set(tilt.pitch, 0, tilt.roll)

    const blur = MathUtils.smoothstep(rotorRpm, 80, 300)
    for (const m of this.bladeMaterials) m.opacity = 1 - 0.85 * blur
    if (this.disc) this.disc.material.opacity = 0.22 * blur
    if (this.mainRotor) this.mainRotor.visible = !(this.cockpitView && blur > 0.5)
    if (this.disc) this.disc.visible = !(this.cockpitView && blur > 0.5)
  }

  setCockpitView(enabled: boolean): void {
    this.cockpitView = enabled
  }
}
