import {
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  ConeGeometry,
  DirectionalLight,
  Fog,
  InstancedMesh,
  MathUtils,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  PMREMGenerator,
  Quaternion,
  RepeatWrapping,
  RingGeometry,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three'
import { Sky } from 'three/addons/objects/Sky.js'
import { createRandom } from '../core/random'
import type { Physics } from '../physics/Physics'

const GROUND_SIZE = 8000
/** World-space size of one ground texture tile, in meters. */
const GROUND_TILE = 20
const HAZE_COLOR = 0xc3d2e0

interface Obstacle {
  shape: 'box' | 'cone'
  /** Centre of the base, on the ground. */
  position: Vector3
  yaw: number
  /** Box: width/height/depth. Cone: base diameter/height/base diameter. */
  size: Vector3
}

/**
 * M0 placeholder world: sky + image-based lighting, a gridded ground plane for
 * speed/altitude cues, a helipad and instanced props for depth reference.
 * Replaced by real terrain in M5.
 */
export class TestScene {
  readonly scene = new Scene()
  readonly sun = new DirectionalLight(0xfff1e0, 3.5)
  private readonly sunDirection = new Vector3()
  private readonly obstacles: Obstacle[] = []

  constructor(renderer: WebGLRenderer) {
    const elevation = 38
    const azimuth = 145
    this.sunDirection.setFromSphericalCoords(1, MathUtils.degToRad(90 - elevation), MathUtils.degToRad(azimuth))

    this.scene.fog = new Fog(HAZE_COLOR, 1500, 9000)
    this.addSky(renderer)
    this.addSun()
    this.addGround(renderer)
    this.addHelipad()
    this.addProps()
  }

  /** Static colliders matching the visible ground and props. */
  createColliders(physics: Physics): void {
    const { R, world } = physics
    const groundBody = world.createRigidBody(R.RigidBodyDesc.fixed())
    world.createCollider(
      R.ColliderDesc.cuboid(GROUND_SIZE / 2, 1, GROUND_SIZE / 2).setTranslation(0, -1, 0).setFriction(0.9),
      groundBody,
    )
    for (const o of this.obstacles) {
      const half = o.size.y / 2
      const desc =
        o.shape === 'box' ? R.ColliderDesc.cuboid(o.size.x / 2, half, o.size.z / 2) : R.ColliderDesc.cone(half, o.size.x / 2)
      const rot = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), o.yaw)
      desc.setTranslation(o.position.x, o.position.y + half, o.position.z).setRotation(rot)
      world.createCollider(desc, groundBody)
    }
  }

  /** Keeps the shadow frustum centred on the area of interest (usually the player). */
  followSun(focus: Vector3): void {
    this.sun.target.position.copy(focus)
    this.sun.position.copy(focus).addScaledVector(this.sunDirection, 200)
  }

  private addSky(renderer: WebGLRenderer): void {
    const sky = new Sky()
    sky.scale.setScalar(10000)
    const u = sky.material.uniforms
    u['turbidity'].value = 6
    u['rayleigh'].value = 1.4
    u['mieCoefficient'].value = 0.004
    u['mieDirectionalG'].value = 0.8
    u['sunPosition'].value.copy(this.sunDirection)
    this.scene.add(sky)

    // Bake the sky into an environment map so PBR materials pick up matching ambient light.
    const pmrem = new PMREMGenerator(renderer)
    const envScene = new Scene()
    envScene.add(sky.clone())
    this.scene.environment = pmrem.fromScene(envScene).texture
    this.scene.environmentIntensity = 0.12
    pmrem.dispose()
  }

  private addSun(): void {
    const s = this.sun.shadow
    this.sun.castShadow = true
    s.mapSize.set(2048, 2048)
    s.camera.left = s.camera.bottom = -100
    s.camera.right = s.camera.top = 100
    s.camera.near = 1
    s.camera.far = 400
    s.bias = -0.0004
    s.normalBias = 0.02
    this.scene.add(this.sun, this.sun.target)
    this.followSun(new Vector3())
  }

  private addGround(renderer: WebGLRenderer): void {
    const texture = makeGroundTexture()
    texture.repeat.set(GROUND_SIZE / GROUND_TILE, GROUND_SIZE / GROUND_TILE)
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy()

    const ground = new Mesh(
      new PlaneGeometry(GROUND_SIZE, GROUND_SIZE),
      new MeshStandardMaterial({ map: texture, roughness: 1, metalness: 0 }),
    )
    ground.rotation.x = -Math.PI / 2
    ground.receiveShadow = true
    ground.name = 'Ground'
    this.scene.add(ground)
  }

  private addHelipad(): void {
    const decal = (color: number) =>
      new MeshStandardMaterial({ color, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })

    const pad = new Mesh(new CircleGeometry(9, 48), decal(0x6f6f6a))
    pad.rotation.x = -Math.PI / 2
    pad.position.y = 0.01
    pad.receiveShadow = true

    const ring = new Mesh(new RingGeometry(8.2, 8.7, 48), decal(0xd9b632))
    ring.rotation.x = -Math.PI / 2
    ring.position.y = 0.02

    const white = decal(0xf2f2ee)
    const bar = (w: number, d: number, x: number) => {
      const m = new Mesh(new BoxGeometry(w, 0.01, d), white)
      m.position.set(x, 0.02, 0)
      return m
    }
    pad.name = 'Helipad'
    this.scene.add(pad, ring, bar(0.9, 6, -1.8), bar(0.9, 6, 1.8), bar(2.7, 0.9, 0))
  }

  private addProps(): void {
    const rand = createRandom(1337)
    const m = new Matrix4()
    const pos = new Vector3()
    const scale = new Vector3()
    const rot = new Quaternion()
    const up = new Vector3(0, 1, 0)
    const color = new Color()

    const scatter = (minR: number, maxR: number) => {
      const a = rand() * Math.PI * 2
      const r = Math.sqrt(MathUtils.lerp(minR * minR, maxR * maxR, rand()))
      return pos.set(Math.cos(a) * r, 0, Math.sin(a) * r)
    }

    // Blocks: buildings/rocks stand-ins for judging height and distance.
    const blockCount = 300
    const blocks = new InstancedMesh(
      new BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
      new MeshStandardMaterial({ roughness: 0.85 }),
      blockCount,
    )
    for (let i = 0; i < blockCount; i++) {
      scatter(60, 1800)
      scale.set(4 + rand() * 18, 3 + rand() ** 2 * 55, 4 + rand() * 18)
      const yaw = rand() * Math.PI
      rot.setFromAxisAngle(up, yaw)
      blocks.setMatrixAt(i, m.compose(pos, rot, scale))
      this.obstacles.push({ shape: 'box', position: pos.clone(), yaw, size: scale.clone() })
      blocks.setColorAt(i, color.setHSL(0.08 + rand() * 0.06, 0.15, 0.35 + rand() * 0.25))
    }
    blocks.castShadow = blocks.receiveShadow = true
    blocks.name = 'Blocks'

    // Trees: dense low clutter is what really sells speed near the ground.
    const treeCount = 3000
    const trees = new InstancedMesh(
      new ConeGeometry(1, 1, 7).translate(0, 0.5, 0),
      new MeshStandardMaterial({ roughness: 1 }),
      treeCount,
    )
    for (let i = 0; i < treeCount; i++) {
      scatter(30, 2500)
      const h = 6 + rand() * 10
      const r = h * (0.22 + rand() * 0.12)
      scale.set(r, h, r)
      trees.setMatrixAt(i, m.compose(pos, rot.identity(), scale))
      this.obstacles.push({ shape: 'cone', position: pos.clone(), yaw: 0, size: new Vector3(r * 2, h, r * 2) })
      trees.setColorAt(i, color.setHSL(0.25 + rand() * 0.08, 0.35, 0.16 + rand() * 0.1))
    }
    trees.castShadow = trees.receiveShadow = true
    trees.name = 'Trees'

    this.scene.add(blocks, trees)
  }
}

function makeGroundTexture(): CanvasTexture {
  const size = 512
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  const rand = createRandom(7)

  ctx.fillStyle = '#5b6a41'
  ctx.fillRect(0, 0, size, size)

  // Speckle noise so the ground doesn't look like flat plastic up close.
  for (let i = 0; i < 6000; i++) {
    const l = 30 + rand() * 25
    ctx.fillStyle = `hsl(${75 + rand() * 20} 25% ${l}%)`
    const s = 1 + rand() * 3
    ctx.fillRect(rand() * size, rand() * size, s, s)
  }

  // One tile is GROUND_TILE meters: faint 5 m lines plus a stronger tile border.
  const px = size / GROUND_TILE
  ctx.strokeStyle = 'rgb(0 0 0 / 0.10)'
  ctx.lineWidth = 2
  for (let m = 5; m < GROUND_TILE; m += 5) {
    ctx.beginPath()
    ctx.moveTo(m * px, 0)
    ctx.lineTo(m * px, size)
    ctx.moveTo(0, m * px)
    ctx.lineTo(size, m * px)
    ctx.stroke()
  }
  ctx.strokeStyle = 'rgb(0 0 0 / 0.22)'
  ctx.lineWidth = 4
  ctx.strokeRect(0, 0, size, size)

  const texture = new CanvasTexture(canvas)
  texture.wrapS = texture.wrapT = RepeatWrapping
  texture.colorSpace = SRGBColorSpace
  return texture
}
