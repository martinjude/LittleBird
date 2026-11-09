import { Group, Vector3, type Object3D } from 'three'
import type { TroopControl } from '../missions/MissionRunner'
import type { Site } from '../world/valley'
import { buildSoldier, poseSoldier, type SoldierRig } from './soldierModel'

type TroopState = 'waiting' | 'boarding' | 'seated' | 'exiting' | 'rally'

interface Troop {
  rig: SoldierRig
  state: TroopState
  seat: number
  position: Vector3
  heading: number
  target: Vector3
  runPhase: number
  exitDelay: number
}

const RUN_SPEED = 3.4
/** How far from the bench a troop climbs on/off (m, sideways). */
const DOOR_OFFSET = 1.4
const RALLY_DISTANCE = 22
const EXIT_INTERVAL = 0.6
/** Body mass + kit per troop (kg), added to the helicopter while aboard. */
export const TROOP_MASS = 100

/**
 * Infantry passengers: they wait at the pickup site, run to their bench seat when boarding
 * is allowed, ride along (parented to the helicopter), then climb off one by one and
 * run clear to a rally point.
 */
export class TroopSquad implements TroopControl {
  readonly root = new Group()
  boardingAllowed = false
  unloadAllowed = false

  private troops: Troop[] = []
  private readonly tmp = new Vector3()
  private readonly side = new Vector3()
  private readonly forward = new Vector3()

  /**
   * @param seats seat positions in helicopter body space (+X = left side)
   * @param onCreate called with each new soldier (e.g. to set up shadows)
   */
  constructor(
    private readonly heightAt: (x: number, z: number) => number,
    readonly seats: Vector3[],
    private readonly onCreate: (object: Object3D) => void = () => {},
  ) {
    this.root.name = 'Troops'
  }

  get aboard(): number {
    return this.troops.filter((t) => t.state === 'seated').length
  }

  get delivered(): number {
    return this.troops.filter((t) => t.state === 'rally').length
  }

  get count(): number {
    return this.troops.length
  }

  spawn(site: Site, count: number): void {
    this.clear()
    // Waiting spot: beside the middle pad at the base, off to one side at an LZ.
    const ox = site.x + (site.kind === 'base' ? 16 : 14)
    const oz = site.z + (site.kind === 'base' ? -14 : 9)
    for (let i = 0; i < Math.min(count, this.seats.length); i++) {
      const rig = buildSoldier()
      const position = new Vector3(ox + i * 1.4, 0, oz + (i % 2) * 0.8)
      position.y = this.heightAt(position.x, position.z)
      this.troops.push({ rig, state: 'waiting', seat: -1, position, heading: -Math.PI / 2, target: new Vector3(), runPhase: i, exitDelay: 0 })
      this.root.add(rig.root)
      this.onCreate(rig.root)
    }
  }

  clear(): void {
    for (const t of this.troops) t.rig.root.removeFromParent()
    this.troops = []
  }

  update(dt: number, heli: Object3D): void {
    heli.updateMatrixWorld()
    this.side.set(1, 0, 0).applyQuaternion(heli.quaternion).setY(0).normalize()
    this.forward.set(0, 0, 1).applyQuaternion(heli.quaternion).setY(0).normalize()
    let exitIndex = 0

    for (const t of this.troops) {
      switch (t.state) {
        case 'waiting':
          if (this.boardingAllowed) {
            t.seat = this.freeSeat()
            if (t.seat >= 0) t.state = 'boarding'
          }
          this.face(t, heli.position)
          poseSoldier(t.rig, this.boardingAllowed ? 'idle' : 'kneel')
          break

        case 'boarding': {
          const seat = this.seats[t.seat]
          const door = this.tmp.copy(seat).setX(seat.x + Math.sign(seat.x) * DOOR_OFFSET)
          heli.localToWorld(door)
          if (!this.boardingAllowed) {
            poseSoldier(t.rig, 'kneel')
            break
          }
          if (this.moveTo(t, door, dt)) this.sit(t, heli)
          break
        }

        case 'seated':
          poseSoldier(t.rig, 'sit')
          if (this.unloadAllowed) {
            t.exitDelay = exitIndex++ * EXIT_INTERVAL
            t.state = 'exiting'
            this.climbOff(t, heli)
          }
          break

        case 'exiting':
          if ((t.exitDelay -= dt) > 0) {
            poseSoldier(t.rig, 'idle')
            break
          }
          if (this.moveTo(t, t.target, dt)) {
            t.state = 'rally'
            // Face away from the aircraft, covering outward.
            this.face(t, this.tmp.copy(t.position).multiplyScalar(2).sub(heli.position))
          }
          break

        case 'rally':
          poseSoldier(t.rig, 'kneel')
          break
      }
      if (t.state !== 'seated') {
        t.rig.root.position.copy(t.position)
        t.rig.root.rotation.set(0, t.heading, 0)
      }
    }
  }

  private freeSeat(): number {
    for (let i = 0; i < this.seats.length; i++) if (!this.troops.some((t) => t.seat === i && t.state !== 'waiting')) return i
    return -1
  }

  /** Runs toward `target` on the terrain; returns true on arrival. */
  private moveTo(t: Troop, target: Vector3, dt: number): boolean {
    const dx = target.x - t.position.x
    const dz = target.z - t.position.z
    const dist = Math.hypot(dx, dz)
    if (dist < 0.4) return true
    const step = Math.min(dist, RUN_SPEED * dt)
    t.position.x += (dx / dist) * step
    t.position.z += (dz / dist) * step
    t.position.y = this.heightAt(t.position.x, t.position.z)
    t.heading = Math.atan2(dx, dz)
    t.runPhase += dt * 11
    poseSoldier(t.rig, 'run', t.runPhase)
    return false
  }

  private face(t: Troop, point: Vector3): void {
    t.heading = Math.atan2(point.x - t.position.x, point.z - t.position.z)
  }

  private sit(t: Troop, heli: Object3D): void {
    const seat = this.seats[t.seat]
    heli.add(t.rig.root)
    t.rig.root.position.copy(seat)
    // Sit sideways, facing out over the skids (+X is the left side).
    t.rig.root.rotation.set(0, seat.x > 0 ? Math.PI / 2 : -Math.PI / 2, 0)
    t.state = 'seated'
    poseSoldier(t.rig, 'sit')
  }

  private climbOff(t: Troop, heli: Object3D): void {
    const seat = this.seats[t.seat]
    const sideSign = Math.sign(seat.x)
    const door = this.tmp.copy(seat).setX(seat.x + sideSign * DOOR_OFFSET)
    heli.localToWorld(door)
    t.position.set(door.x, this.heightAt(door.x, door.z), door.z)
    this.root.add(t.rig.root)
    // Fan out to the same side as the seat, spread fore and aft.
    t.target
      .copy(t.position)
      .addScaledVector(this.side, sideSign * RALLY_DISTANCE)
      .addScaledVector(this.forward, (t.seat % 3) * 3 - 3)
  }
}
