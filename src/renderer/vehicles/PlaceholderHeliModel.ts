import {
  BoxGeometry,
  CircleGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  MathUtils,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  SphereGeometry,
  type Material,
} from 'three'

const TAU = Math.PI * 2
const MAIN_ROTOR_RADIUS = 4.15
const MAIN_ROTOR_BLADES = 6
const TAIL_ROTOR_RATIO = 6

/**
 * Primitive stand-in for the Little Bird until the real GLB arrives (M3). Visual only:
 * the Helicopter entity drives its transform, rotor spin and disc tilt.
 * Follows the model conventions from PLAN.md §7: meters, +Y up, nose along +Z,
 * origin at the bottom of the skids.
 */
export class PlaceholderHeliModel {
  readonly object = new Group()

  /** Tilts with the cyclic; the spinning rotor hangs off it. */
  private readonly rotorTilt = new Group()
  private readonly mainRotor = new Group()
  private readonly tailRotor = new Group()
  private readonly bladeMaterial: MeshStandardMaterial
  private readonly discMaterial: MeshStandardMaterial
  /** From inside, a spinning rotor is all but invisible; drawing the blur disc there just blocks the view. */
  private cockpitView = false

  constructor() {
    this.object.name = 'PlaceholderHeli'
    this.bladeMaterial = new MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6, transparent: true })
    this.discMaterial = new MeshStandardMaterial({
      color: 0x222222,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: DoubleSide,
    })
    this.build()
  }

  /**
   * @param dt simulation-scaled seconds since the last frame (0 while paused)
   * @param tilt disc tilt in radians (forward = +pitch, right = +roll)
   */
  animate(dt: number, rotorRpm: number, tilt: { pitch: number; roll: number }): void {
    const omega = (rotorRpm * TAU) / 60
    // Counter-clockwise seen from above, like US-built helicopters.
    this.mainRotor.rotation.y = (this.mainRotor.rotation.y + omega * dt) % TAU
    this.tailRotor.rotation.x = (this.tailRotor.rotation.x + omega * TAIL_ROTOR_RATIO * dt) % TAU
    this.rotorTilt.rotation.set(tilt.pitch, 0, tilt.roll)

    // Individual blades strobe at real RPM, so fade them into a disc as the rotor spins up.
    const blur = MathUtils.smoothstep(rotorRpm, 80, 300)
    this.bladeMaterial.opacity = 1 - 0.85 * blur
    this.discMaterial.opacity = 0.22 * blur
    this.mainRotor.visible = !(this.cockpitView && blur > 0.5)
  }

  setCockpitView(enabled: boolean): void {
    this.cockpitView = enabled
  }

  private build(): void {
    const paint = new MeshStandardMaterial({ color: 0x1e211d, roughness: 0.55, metalness: 0.3 })
    const metal = new MeshStandardMaterial({ color: 0x3a3c3a, roughness: 0.4, metalness: 0.8 })
    const glass = new MeshPhysicalMaterial({
      color: 0x8fa6b3,
      roughness: 0.05,
      metalness: 0,
      transparent: true,
      opacity: 0.45,
      envMapIntensity: 1.5,
    })

    const add = (mesh: Mesh, parent: Group = this.object) => {
      mesh.castShadow = true
      mesh.receiveShadow = true
      parent.add(mesh)
      return mesh
    }
    const mesh = (geometry: ConstructorParameters<typeof Mesh>[0], material: Material) => new Mesh(geometry, material)

    // "Killer egg" fuselage with a glazed nose.
    const body = add(mesh(new SphereGeometry(1, 32, 20), paint))
    body.scale.set(1.05, 1.0, 1.55)
    body.position.set(0, 1.35, 0)
    const canopy = add(mesh(new SphereGeometry(1, 32, 20, 0, TAU, 0, Math.PI / 2.2), glass))
    canopy.scale.set(1.0, 0.95, 1.2)
    canopy.rotation.x = Math.PI / 2.6
    canopy.position.set(0, 1.45, 0.45)
    canopy.castShadow = false

    // Tail boom, fins, stabiliser.
    const boom = add(mesh(new CylinderGeometry(0.11, 0.22, 4.4, 12), paint))
    boom.rotation.x = Math.PI / 2
    boom.position.set(0, 1.65, -3.4)
    const fin = add(mesh(new BoxGeometry(0.06, 1.1, 0.55), paint))
    fin.position.set(0, 2.05, -5.45)
    fin.rotation.x = -0.35
    const stab = add(mesh(new BoxGeometry(1.4, 0.05, 0.35), paint))
    stab.position.set(0, 1.6, -5.1)

    // Skids with struts.
    for (const x of [-0.95, 0.95]) {
      const skid = add(mesh(new CylinderGeometry(0.05, 0.05, 3.0, 8), metal))
      skid.rotation.x = Math.PI / 2
      skid.position.set(x, 0.05, 0.1)
      for (const z of [-0.6, 0.8]) {
        const strut = add(mesh(new CylinderGeometry(0.04, 0.04, 0.9, 6), metal))
        strut.position.set(x * 0.8, 0.45, z)
        strut.rotation.z = x > 0 ? 0.35 : -0.35
      }
    }

    // Mast + main rotor.
    const mast = add(mesh(new CylinderGeometry(0.08, 0.1, 0.45, 10), metal))
    mast.position.set(0, 2.45, 0)
    this.rotorTilt.position.set(0, 2.7, 0)
    this.object.add(this.rotorTilt)
    this.mainRotor.name = 'Rotor_Main'
    this.rotorTilt.add(this.mainRotor)
    add(mesh(new CylinderGeometry(0.18, 0.18, 0.12, 12), metal), this.mainRotor)
    const bladeGeo = new BoxGeometry(0.2, 0.035, MAIN_ROTOR_RADIUS).translate(0, 0, MAIN_ROTOR_RADIUS / 2)
    for (let i = 0; i < MAIN_ROTOR_BLADES; i++) {
      const blade = add(mesh(bladeGeo, this.bladeMaterial), this.mainRotor)
      blade.rotation.y = (i / MAIN_ROTOR_BLADES) * TAU
    }
    const disc = new Mesh(new CircleGeometry(MAIN_ROTOR_RADIUS, 48), this.discMaterial)
    disc.rotation.x = -Math.PI / 2
    this.mainRotor.add(disc)

    // Tail rotor on the left side of the boom.
    this.tailRotor.name = 'Rotor_Tail'
    this.tailRotor.position.set(0.12, 2.15, -5.55)
    this.object.add(this.tailRotor)
    const tailBlade = new BoxGeometry(0.03, 1.5, 0.12)
    add(mesh(tailBlade, this.bladeMaterial), this.tailRotor)
    add(mesh(tailBlade, this.bladeMaterial), this.tailRotor).rotation.x = Math.PI / 2
  }
}
