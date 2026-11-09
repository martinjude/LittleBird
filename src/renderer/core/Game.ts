import { ACESFilmicToneMapping, MathUtils, PCFShadowMap, PerspectiveCamera, Vector3, WebGLRenderer, type Material, type Mesh } from 'three'
import { CameraRig, type CameraMode } from '../camera/CameraRig'
import { Debug } from '../debug/Debug'
import { attitudeOf } from '../flight/Fcs'
import { LITTLE_BIRD } from '../flight/littlebird.params'
import { BrowserGamepadSource } from '../input/GamepadSource'
import { InputSystem } from '../input/InputSystem'
import { BrowserKeyboardMouseSource } from '../input/KeyboardMouseSource'
import type { KeyboardLayout } from '../input/labels'
import { Physics, type Rapier } from '../physics/Physics'
import { FlightHud } from '../ui/FlightHud'
import { Hud } from '../ui/Hud'
import { InputOverlay } from '../ui/InputOverlay'
import { Helicopter } from '../vehicles/Helicopter'
import { TestScene } from '../world/TestScene'
import { GameLoop } from './GameLoop'
import type { SettingsStore } from './SettingsStore'

const SIM_HZ = 120
const SPAWN = new Vector3(0, 0.05, 0)
const SPAWN_HEADING = 0

export class Game {
  readonly renderer: WebGLRenderer
  readonly camera: PerspectiveCamera
  readonly world: TestScene
  readonly physics: Physics
  readonly heli: Helicopter
  readonly loop: GameLoop
  readonly input: InputSystem
  readonly cameras: CameraRig
  /** World wind velocity (m/s), set from the debug panel. */
  readonly wind = new Vector3()
  readonly windSetting = { speed: 0, fromDeg: 270 }

  private readonly debug: Debug
  private readonly hud: Hud
  private readonly flightHud: FlightHud
  private readonly inputOverlay: InputOverlay
  private readonly attitude = { pitch: 0, roll: 0, heading: 0 }

  constructor(
    private readonly host: HTMLElement,
    hudRoot: HTMLElement,
    private readonly settings: SettingsStore,
    keyboardLayout: KeyboardLayout,
    rapier: Rapier,
  ) {
    const gfx = settings.value.graphics

    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    this.renderer.toneMapping = ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 0.6
    this.renderer.shadowMap.enabled = gfx.shadows
    this.renderer.shadowMap.type = PCFShadowMap
    host.appendChild(this.renderer.domElement)

    this.camera = new PerspectiveCamera(gfx.fov, 1, 0.2, 20000)
    this.world = new TestScene(this.renderer)
    this.physics = new Physics(rapier, 1 / SIM_HZ)
    this.world.createColliders(this.physics)
    this.world.scene.add(this.physics.debugLines)

    this.heli = new Helicopter(this.physics, structuredClone(LITTLE_BIRD))
    this.heli.respawn(SPAWN, SPAWN_HEADING)
    this.world.scene.add(this.heli.object)

    this.cameras = new CameraRig(this.camera, this.renderer.domElement)

    const { controls, bindings } = settings.value
    const keyboardMouse = new BrowserKeyboardMouseSource(this.renderer.domElement)
    keyboardMouse.setPointerLockButtons(bindings.keyboard.buttons.freeLook)
    this.input = new InputSystem(keyboardMouse, new BrowserGamepadSource(), controls, bindings)
    this.hud = new Hud(hudRoot, bindings, keyboardLayout)
    this.flightHud = new FlightHud(hudRoot)
    this.inputOverlay = new InputOverlay(hudRoot)

    this.loop = new GameLoop(
      {
        input: (dt) => this.pollInput(dt),
        fixedUpdate: () => this.fixedUpdate(),
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

  respawn(): void {
    this.heli.respawn(SPAWN, SPAWN_HEADING)
    this.input.setCollective(0)
  }

  private pollInput(dt: number): void {
    this.input.update(dt)
    const b = this.input.state.buttons
    if (b.pause.pressed) this.loop.paused = !this.loop.paused
    if (b.reset.pressed) this.respawn()
    if (b.toggleCamera.pressed) this.cameras.toggleView()
  }

  private fixedUpdate(): void {
    const s = this.input.state
    this.heli.beforeStep(s, this.settings.value.controls.assist, this.wind)
    this.physics.step()
    this.heli.afterStep()
  }

  private frame(dt: number, alpha: number): void {
    const simDt = this.loop.paused ? 0 : dt * this.loop.timeScale
    this.heli.render(alpha, simDt)

    const s = this.input.state
    this.heli.model.setCockpitView(this.cameras.mode === 'cockpit')
    this.cameras.update(dt, this.heli.object, { yaw: s.lookYaw, pitch: s.lookPitch, active: s.buttons.freeLook.down })

    this.world.followSun(this.heli.object.position)
    this.physics.updateDebug()
    this.renderer.render(this.world.scene, this.camera)

    this.hud.update(s)
    this.updateFlightHud()
    this.inputOverlay.update(s)
    this.debug.update()
  }

  private updateFlightHud(): void {
    const h = this.heli
    const t = h.result.telemetry
    attitudeOf(h.state.quaternion, this.attitude)
    const landed = h.agl < 0.15 && h.state.velocity.length() < 0.5
    const warnings: string[] = []
    if (this.loop.paused) warnings.push('PAUSED')
    if (t.vortexRing > 0.3) warnings.push('VORTEX RING')
    if (t.tailSaturation > 1) warnings.push('TAIL ROTOR LIMIT')
    if (Math.abs(this.attitude.roll) > 1.0 || Math.abs(this.attitude.pitch) > 0.9) warnings.push('ATTITUDE')

    this.flightHud.update({
      airspeed: t.airspeed,
      agl: h.agl,
      verticalSpeed: h.verticalSpeed,
      heading: this.attitude.heading,
      collective: this.input.state.collective,
      // Rough engine torque: power ~ thrust^1.5, scaled so full collective at rest reads 100%.
      torque: (t.thrust / h.params.rotor.maxThrust) ** 1.5,
      assist: this.settings.value.controls.assist,
      camera: this.cameras.mode,
      inGroundEffect: t.groundEffect > 1.02,
      landed,
      warnings,
    })
  }

  private updateWind(): void {
    const { speed, fromDeg } = this.windSetting
    const a = MathUtils.degToRad(fromDeg)
    // Meteorological convention: the direction the wind blows *from* (0 = north = -Z).
    this.wind.set(-Math.sin(a), 0, Math.cos(a)).multiplyScalar(speed)
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
    const ctl = this.settings.value.controls
    const saveSettings = () => this.settings.changed()
    const p = this.heli.params
    const t = this.heli.result.telemetry

    const sim = gui.addFolder('Simulation')
    sim.add(this.loop, 'paused').listen()
    sim.add(this.loop, 'timeScale', 0, 2, 0.05)
    sim.add({ step: () => this.loop.step() }, 'step').name('step (while paused)')
    sim.add({ respawn: () => this.respawn() }, 'respawn')
    sim.add(this.physics, 'debugEnabled').name('physics wireframe')

    const flight = gui.addFolder('Flight')
    flight.add(ctl, 'assist', ['novice', 'standard', 'realistic']).onFinishChange(saveSettings)
    flight
      .add({ camera: this.cameras.mode }, 'camera', ['chase', 'cockpit', 'orbit'])
      .onChange((m: CameraMode) => this.cameras.setMode(m))
    flight.add(p.vortexRing, 'enabled').name('vortex ring state')
    flight.add(this.windSetting, 'speed', 0, 25, 0.5).name('wind (m/s)').onChange(() => this.updateWind())
    flight.add(this.windSetting, 'fromDeg', 0, 360, 5).name('wind from (°)').onChange(() => this.updateWind())

    const live = flight.addFolder('Telemetry')
    const readout = { thrustKn: 0, hoverCollective: 0 }
    live.add(readout, 'thrustKn').name('thrust (kN)').disable().listen()
    live.add(readout, 'hoverCollective').name('hover coll. (OGE)').disable().listen()
    live.add(t, 'groundEffect').name('ground effect').disable().listen()
    live.add(t, 'etl').name('transl. lift').disable().listen()
    live.add(t, 'inflow').disable().listen()
    live.add(t, 'vortexRing').name('vortex ring').disable().listen()
    live.add(t, 'tailSaturation').name('tail rotor use').disable().listen()
    setInterval(() => {
      readout.thrustKn = Math.round(t.thrust / 10) / 100
      readout.hoverCollective = Math.round(((p.mass * 9.81) / p.rotor.maxThrust) * 1000) / 1000
    }, 200)

    const tune = flight.addFolder('Tuning (Little Bird)')
    tune.add(p, 'mass', 600, 1500, 10).name('mass (kg)').onChange(() => this.heli.applyMassProperties())
    tune.add(p.rotor, 'maxThrust', 8000, 30000, 100).name('max thrust (N)')
    tune.add(p.rotor, 'climbLoss', 0, 0.1, 0.005).name('climb inflow loss')
    tune.add(p.rotor, 'etlGain', 0, 0.4, 0.01).name('ETL gain')
    tune.add(p.rotor, 'groundEffectMax', 1, 1.5, 0.01).name('ground effect max')
    tune.add(p.rotor, 'discTiltMax', 0, 0.3, 0.01).name('disc tilt max')
    tune.add(p.cyclicAuthority, 0, 0, 15000, 100).name('pitch authority')
    tune.add(p.cyclicAuthority, 1, 0, 15000, 100).name('roll authority')
    tune.add(p.rateDamping, 0, 0, 10000, 100).name('pitch damping')
    tune.add(p.rateDamping, 2, 0, 10000, 100).name('roll damping')
    tune.add(p.rateDamping, 1, 0, 10000, 100).name('yaw damping')
    tune.add(p, 'speedStability', 0, 200, 1).name('speed stability')
    tune.add(p.torque, 'reactionPerThrust', 0, 0.6, 0.01).name('torque / thrust')
    tune.add(p.tailRotor, 'maxMoment', 1000, 15000, 100).name('tail authority')
    tune.add(p.tailRotor, 'pedalNeutral', 0, 1, 0.01).name('pedal neutral')
    tune.add(p.dragArea, 2, 0.2, 5, 0.05).name('drag front (m²)')
    tune.add(p.dragArea, 0, 0.5, 10, 0.1).name('drag side (m²)')
    tune.add(p.dragArea, 1, 0.5, 15, 0.1).name('drag top (m²)')
    tune.add(p.fin, 'area', 0, 3, 0.05).name('fin area')
    tune.add(p.stabilizer, 'area', 0, 3, 0.05).name('stabiliser area')
    tune
      .add({ copy: () => navigator.clipboard.writeText(JSON.stringify(p, null, 2)) }, 'copy')
      .name('copy params as JSON')
    tune.close()

    const fcs = this.heli.fcs.tuning
    const assist = flight.addFolder('Assist tuning')
    assist.add(fcs.maxRate, 0, 0.2, 3, 0.05).name('max pitch rate')
    assist.add(fcs.maxRate, 1, 0.2, 3, 0.05).name('max roll rate')
    assist.add(fcs.maxRate, 2, 0.2, 3, 0.05).name('max yaw rate')
    assist.add(fcs.attitudeLimit, 0, 0.1, 1.5, 0.05).name('std pitch limit')
    assist.add(fcs.attitudeLimit, 1, 0.1, 1.5, 0.05).name('std bank limit')
    assist.add(fcs.maxAttitude, 0, 0.1, 1, 0.05).name('novice max pitch')
    assist.add(fcs.maxAttitude, 1, 0.1, 1, 0.05).name('novice max bank')
    assist.add(fcs, 'rateGain', 0, 5, 0.1).name('rate gain')
    assist.add(fcs, 'holdGain', 0, 8, 0.1).name('hold gain')
    assist.add(fcs, 'sasGain', 0, 2, 0.05).name('realistic SAS')
    assist.add(fcs.coordinationSpeed, 0, 0, 40, 1).name('turn coord. from (m/s)')
    assist.add(fcs.coordinationSpeed, 1, 1, 60, 1).name('turn coord. full (m/s)')
    assist.close()

    const chase = gui.addFolder('Chase camera')
    chase.add(this.cameras.chase, 'distance', 5, 40, 0.5)
    chase.add(this.cameras.chase, 'height', 0, 15, 0.1)
    chase.add(this.cameras.chase, 'yawStiffness', 0.5, 15, 0.1).name('yaw follow')
    chase.add(this.cameras.chase, 'stiffness', 1, 40, 0.5).name('position follow')
    chase.close()

    const input = gui.addFolder('Controls')
    input.add(ctl, 'gamepadCollective', ['rate', 'absolute']).name('pad collective').onFinishChange(saveSettings)
    input.add(ctl, 'collectiveRate', 0.1, 2, 0.05).name('collective rate').onFinishChange(saveSettings)
    input.add(ctl, 'stickDeadzone', 0, 0.4, 0.01).name('stick deadzone').onFinishChange(saveSettings)
    input
      .add(ctl.axes.cyclicPitch, 'expo', 0, 1, 0.05)
      .name('cyclic expo')
      .onChange((v: number) => {
        ctl.axes.cyclicRoll.expo = v
      })
      .onFinishChange(saveSettings)
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
    render.close()

    const info = { drawCalls: 0, triangles: 0 }
    const infoFolder = gui.addFolder('Renderer info')
    infoFolder.add(info, 'drawCalls').disable().listen()
    infoFolder.add(info, 'triangles').disable().listen()
    infoFolder.close()
    setInterval(() => {
      info.drawCalls = this.renderer.info.render.calls
      info.triangles = this.renderer.info.render.triangles
    }, 500)
  }
}
