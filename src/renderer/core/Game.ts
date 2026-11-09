import {
  ACESFilmicToneMapping,
  MathUtils,
  PCFShadowMap,
  PerspectiveCamera,
  Spherical,
  Vector3,
  WebGLRenderer,
  type Material,
  type Mesh,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { Debug } from '../debug/Debug'
import { BrowserGamepadSource } from '../input/GamepadSource'
import { InputSystem } from '../input/InputSystem'
import { BrowserKeyboardMouseSource } from '../input/KeyboardMouseSource'
import type { KeyboardLayout } from '../input/labels'
import { Hud } from '../ui/Hud'
import { InputOverlay } from '../ui/InputOverlay'
import { PlaceholderHeli } from '../vehicles/PlaceholderHeli'
import { TestScene } from '../world/TestScene'
import { GameLoop } from './GameLoop'
import type { SettingsStore } from './SettingsStore'

const SIM_HZ = 120

export class Game {
  readonly renderer: WebGLRenderer
  readonly camera: PerspectiveCamera
  readonly world: TestScene
  readonly heli: PlaceholderHeli
  readonly loop: GameLoop
  readonly input: InputSystem

  private readonly controls: OrbitControls
  private readonly debug: Debug
  private readonly hud: Hud
  private readonly inputOverlay: InputOverlay
  private readonly lookOffset = new Vector3(0, 1.5, 0)
  private readonly tmp = new Vector3()
  private readonly orbit = new Spherical()

  constructor(
    private readonly host: HTMLElement,
    hudRoot: HTMLElement,
    private readonly settings: SettingsStore,
    keyboardLayout: KeyboardLayout,
  ) {
    const gfx = settings.value.graphics

    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    this.renderer.toneMapping = ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 0.6
    this.renderer.shadowMap.enabled = gfx.shadows
    this.renderer.shadowMap.type = PCFShadowMap
    host.appendChild(this.renderer.domElement)

    this.camera = new PerspectiveCamera(gfx.fov, 1, 0.1, 20000)
    this.world = new TestScene(this.renderer)
    this.heli = new PlaceholderHeli()
    this.world.scene.add(this.heli.object)

    // Dev camera until the chase/cockpit cameras land in M2/M3.
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.enablePan = false
    this.controls.minDistance = 4
    this.controls.maxDistance = 400
    this.controls.target.copy(this.heli.object.position).add(this.lookOffset)
    this.camera.position.copy(this.controls.target).add(new Vector3(-14, 5, -14))

    const { controls, bindings } = settings.value
    const keyboardMouse = new BrowserKeyboardMouseSource(this.renderer.domElement)
    keyboardMouse.setPointerLockButtons(bindings.keyboard.buttons.freeLook)
    this.input = new InputSystem(keyboardMouse, new BrowserGamepadSource(), controls, bindings)
    this.hud = new Hud(hudRoot, bindings, keyboardLayout)
    this.inputOverlay = new InputOverlay(hudRoot)

    this.loop = new GameLoop(
      {
        input: (dt) => this.pollInput(dt),
        fixedUpdate: (dt) => this.fixedUpdate(dt),
        frame: (dt, alpha) => this.frame(dt, alpha),
      },
      SIM_HZ,
    )

    new ResizeObserver(() => this.resize()).observe(host)
    this.resize()

    this.debug = new Debug(this.renderer)
    this.buildDebugUi()
  }

  start(): void {
    this.loop.start()
  }

  toggleDebug(): void {
    this.debug.toggle()
  }

  private pollInput(dt: number): void {
    this.input.update(dt)
    if (this.input.state.buttons.pause.pressed) this.loop.paused = !this.loop.paused
  }

  private fixedUpdate(dt: number): void {
    this.heli.fixedUpdate(dt)
  }

  private frame(dt: number, alpha: number): void {
    const simDt = this.loop.paused ? 0 : dt * this.loop.timeScale
    this.heli.render(alpha, simDt)

    // Carry the orbit camera along with the helicopter, keeping the user's chosen angle.
    const focus = this.tmp.copy(this.heli.object.position).add(this.lookOffset)
    this.camera.position.add(focus.clone().sub(this.controls.target))
    this.controls.target.copy(focus)
    this.applyFreeLook()
    this.controls.update(dt)

    this.world.followSun(this.heli.object.position)
    this.renderer.render(this.world.scene, this.camera)
    this.hud.update(this.input.state)
    this.inputOverlay.update(this.input.state)
    this.debug.update()
  }

  /** Free-look input orbits the dev camera for now; in M2/M3 it turns the pilot's head instead. */
  private applyFreeLook(): void {
    const { lookYaw, lookPitch } = this.input.state
    if (lookYaw === 0 && lookPitch === 0) return
    const offset = this.tmp.subVectors(this.camera.position, this.controls.target)
    this.orbit.setFromVector3(offset)
    this.orbit.theta -= lookYaw
    this.orbit.phi = MathUtils.clamp(this.orbit.phi + lookPitch, 0.05, Math.PI - 0.05)
    this.camera.position.copy(this.controls.target).add(offset.setFromSpherical(this.orbit))
  }

  private resize(): void {
    const width = this.host.clientWidth
    const height = this.host.clientHeight
    if (width === 0 || height === 0) return
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.settings.value.graphics.pixelRatioCap))
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
  }

  private buildDebugUi(): void {
    const gui = this.debug.gui
    const gfx = this.settings.value.graphics
    const saveSettings = () => this.settings.changed()

    const sim = gui.addFolder('Simulation')
    sim.add(this.loop, 'paused').listen()
    sim.add(this.loop, 'timeScale', 0, 2, 0.05)
    sim.add({ step: () => this.loop.step() }, 'step').name('step (while paused)')
    sim.add({ rate: `${SIM_HZ} Hz` }, 'rate').name('fixed rate').disable()

    const demo = gui.addFolder('Placeholder flight')
    demo.add(this.heli.params, 'radius', 40, 600, 1)
    demo.add(this.heli.params, 'altitude', 2, 300, 1)
    demo.add(this.heli.params, 'speed', 0, 70, 0.5).name('speed (m/s)')
    demo.add(this.heli.params, 'rotorRpm', 0, 600, 1)

    const ctl = this.settings.value.controls
    const input = gui.addFolder('Controls')
    input.add(ctl, 'gamepadCollective', ['rate', 'absolute']).name('pad collective').onFinishChange(saveSettings)
    input.add(ctl, 'collectiveRate', 0.1, 2, 0.05).name('collective rate').onFinishChange(saveSettings)
    input.add(ctl, 'stickDeadzone', 0, 0.4, 0.01).name('stick deadzone').onFinishChange(saveSettings)
    input.add(ctl.axes.cyclicPitch, 'expo', 0, 1, 0.05).name('cyclic expo').onChange((v: number) => {
      ctl.axes.cyclicRoll.expo = v
    }).onFinishChange(saveSettings)
    input.add(ctl.axes.pedals, 'expo', 0, 1, 0.05).name('pedals expo').onFinishChange(saveSettings)
    input.add(ctl, 'keyRampUp', 0.5, 10, 0.1).name('key ramp up').onFinishChange(saveSettings)
    input.add(ctl, 'keyRampDown', 0.5, 10, 0.1).name('key ramp down').onFinishChange(saveSettings)
    input.add(ctl, 'mouseSensitivity', 0.0005, 0.01, 0.0005).name('mouse look').onFinishChange(saveSettings)
    input.add(ctl, 'invertLookY').name('invert look Y').onFinishChange(saveSettings)
    input.close()

    const render = gui.addFolder('Rendering')
    render.add(this.renderer, 'toneMappingExposure', 0.2, 3, 0.01).name('exposure')
    render
      .add(gfx, 'fov', 40, 100, 1)
      .onChange(() => {
        this.camera.fov = gfx.fov
        this.camera.updateProjectionMatrix()
      })
      .onFinishChange(saveSettings)
    render
      .add(gfx, 'pixelRatioCap', 0.5, 2, 0.25)
      .name('pixel ratio cap')
      .onChange(() => this.resize())
      .onFinishChange(saveSettings)
    render
      .add(gfx, 'shadows')
      .onChange(() => {
        this.renderer.shadowMap.enabled = gfx.shadows
        // Materials compile shadow support into their shaders, so they need a rebuild.
        this.world.scene.traverse((o) => {
          const material = (o as Mesh).material as Material | Material[] | undefined
          for (const m of [material ?? []].flat()) m.needsUpdate = true
        })
        saveSettings()
      })

    const info = { drawCalls: 0, triangles: 0 }
    const infoFolder = gui.addFolder('Renderer info')
    infoFolder.add(info, 'drawCalls').disable().listen()
    infoFolder.add(info, 'triangles').disable().listen()
    setInterval(() => {
      info.drawCalls = this.renderer.info.render.calls
      info.triangles = this.renderer.info.render.triangles
    }, 500)
  }
}
