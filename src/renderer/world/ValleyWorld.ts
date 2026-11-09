import {
  Fog,
  MathUtils,
  PMREMGenerator,
  Quaternion,
  Scene,
  Vector3,
  type Camera,
  type Material,
  type Mesh,
  type Object3D,
  type WebGLRenderer,
} from 'three'
import { CSM } from 'three/addons/csm/CSM.js'
import { Sky } from 'three/addons/objects/Sky.js'
import type { Physics } from '../physics/Physics'
import type { StaticCollider } from './colliders'
import { buildBase, buildLzMarker } from './props'
import { buildDistantRing, buildTerrain, createGroundMaterial } from './terrainMesh'
import { generateValley, type Site, type ValleyMap } from './valley'
import { scatterVegetation } from './vegetation'

const SEED = 7
const HAZE_COLOR = 0xbfd0df
/** Low-res collider for the mountains beyond the playable square (so you can't fly into them). */
const RING_COLLIDER_EXTENT = 16384
const RING_COLLIDER_SEGMENTS = 128

/**
 * The M5 map: a 4×4 km temperate mountain valley with FOB Eagle, four landing zones,
 * forests, boulders and distant mountains, lit by a cascaded-shadow sun.
 */
export class ValleyWorld {
  readonly scene = new Scene()
  readonly map: ValleyMap
  readonly csm: CSM
  readonly base: Site
  readonly landingZones: Site[]
  /** Where the player starts: the middle pad at FOB Eagle, facing up the valley (north). */
  readonly spawn: { position: Vector3; heading: number }

  private readonly colliders: StaticCollider[] = []
  private readonly sunDirection = new Vector3()

  constructor(renderer: WebGLRenderer, camera: Camera) {
    const elevation = 36
    const azimuth = 150
    this.sunDirection.setFromSphericalCoords(1, MathUtils.degToRad(90 - elevation), MathUtils.degToRad(azimuth))

    this.map = generateValley(SEED)
    this.base = this.map.sites.find((s) => s.kind === 'base')!
    this.landingZones = this.map.sites.filter((s) => s.kind === 'lz')

    this.scene.fog = new Fog(HAZE_COLOR, 2500, 11000)
    this.addSky(renderer)

    this.csm = new CSM({
      camera,
      parent: this.scene,
      cascades: 3,
      maxFar: 2500,
      mode: 'practical',
      shadowMapSize: 2048,
      lightDirection: this.sunDirection.clone().negate(),
      lightIntensity: 3.5,
      // Room for mountains outside the view frustum to still cast into it.
      lightMargin: 400,
    })
    this.csm.fade = true
    for (const light of this.csm.lights) {
      light.color.set(0xfff1e0)
      light.shadow.bias = -0.0002
      light.shadow.normalBias = 0.04
    }

    const ground = createGroundMaterial(renderer)
    this.scene.add(buildTerrain(this.map, ground, SEED), buildDistantRing(this.map, ground, SEED))

    const vegetation = scatterVegetation(this.map, SEED)
    this.scene.add(...vegetation.meshes)
    this.colliders.push(...vegetation.colliders)

    const base = buildBase(this.base, SEED)
    this.scene.add(base.object)
    this.colliders.push(...base.colliders)
    for (const lz of this.landingZones) this.scene.add(buildLzMarker(lz).object)

    this.spawn = { position: base.pads[1].clone().setY(base.pads[1].y + 0.1), heading: 0 }
    this.registerMaterials(this.scene)
  }

  heightAt(x: number, z: number): number {
    return this.map.heightmap.heightAt(x, z)
  }

  /** Cascaded shadows need every lit material patched once; call for objects added later. */
  registerMaterials(root: Object3D): void {
    root.traverse((o) => {
      const material = (o as Mesh).material as Material | Material[] | undefined
      if (material) for (const m of [material].flat()) this.csm.setupMaterial(m)
    })
  }

  /** Call every frame after the camera has moved. */
  update(): void {
    this.csm.update()
  }

  /** Call when the camera's projection changes (resize, FOV, near plane). */
  updateFrustums(): void {
    this.csm.updateFrustums()
  }

  createColliders(physics: Physics): void {
    const { R, world } = physics
    const body = world.createRigidBody(R.RigidBodyDesc.fixed())

    // Playable terrain. Rapier wants column-major heights with rows along Z and columns along X.
    const hm = this.map.heightmap
    const r = hm.resolution
    const heights = new Float32Array(r * r)
    for (let ix = 0; ix < r; ix++) for (let iz = 0; iz < r; iz++) heights[ix * r + iz] = hm.heights[iz * r + ix]
    world.createCollider(R.ColliderDesc.heightfield(r - 1, r - 1, heights, { x: hm.size, y: 1, z: hm.size }).setFriction(0.9), body)

    // Distant mountains: coarse heightfield, dropped far below inside the playable square so it never interferes there.
    const n = RING_COLLIDER_SEGMENTS + 1
    const step = RING_COLLIDER_EXTENT / RING_COLLIDER_SEGMENTS
    const ring = new Float32Array(n * n)
    for (let ix = 0; ix < n; ix++) {
      for (let iz = 0; iz < n; iz++) {
        const x = -RING_COLLIDER_EXTENT / 2 + ix * step
        const z = -RING_COLLIDER_EXTENT / 2 + iz * step
        const inside = Math.abs(x) < hm.half && Math.abs(z) < hm.half
        ring[ix * n + iz] = inside ? -500 : this.map.rawHeight(x, z)
      }
    }
    world.createCollider(
      R.ColliderDesc.heightfield(n - 1, n - 1, ring, { x: RING_COLLIDER_EXTENT, y: 1, z: RING_COLLIDER_EXTENT }),
      body,
    )

    const q = new Quaternion()
    const up = new Vector3(0, 1, 0)
    for (const c of this.colliders) {
      const desc =
        c.shape === 'box'
          ? R.ColliderDesc.cuboid(c.hx, c.hy, c.hz).setRotation(q.setFromAxisAngle(up, c.yaw))
          : R.ColliderDesc.cylinder(c.halfHeight, c.radius)
      world.createCollider(desc.setTranslation(c.x, c.y, c.z), body)
    }
  }

  private addSky(renderer: WebGLRenderer): void {
    const sky = new Sky()
    sky.scale.setScalar(15000)
    const u = sky.material.uniforms
    u['turbidity'].value = 5
    u['rayleigh'].value = 1.6
    u['mieCoefficient'].value = 0.004
    u['mieDirectionalG'].value = 0.8
    u['sunPosition'].value.copy(this.sunDirection)
    this.scene.add(sky)

    // Bake the sky into an environment map so PBR materials pick up matching ambient light.
    const pmrem = new PMREMGenerator(renderer)
    const envScene = new Scene()
    envScene.add(sky.clone())
    this.scene.environment = pmrem.fromScene(envScene).texture
    this.scene.environmentIntensity = 0.14
    pmrem.dispose()
  }
}
