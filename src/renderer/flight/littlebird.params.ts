/**
 * Little Bird flight tuning. Units are SI (kg, m, N, N·m, rad, s).
 * Body axes follow the model convention: +X left, +Y up, +Z nose, origin at the skid bottoms.
 *
 * Numbers are loosely based on the MD 500 / MH-6M (empty ~720 kg, MTOW ~1,400 kg,
 * 8.3 m rotor, ~150 kt max) and then tuned for feel. Everything here is live-editable
 * from the debug panel.
 */
export interface FlightParams {
  mass: number
  centerOfMass: [number, number, number]
  /** Principal moments of inertia about body X (pitch), Y (yaw), Z (roll). */
  inertia: [number, number, number]
  airDensity: number

  rotor: {
    radius: number
    hub: [number, number, number]
    /** Thrust at full collective, out of ground effect, hovering. */
    maxThrust: number
    /** Fraction of thrust lost per m/s of climb through the disc (gained when descending). */
    climbLoss: number
    /** Extra lift once airspeed passes effective translational lift. */
    etlGain: number
    etlStart: number
    etlFull: number
    /** Upper bound on the in-ground-effect thrust multiplier. */
    groundEffectMax: number
    /** Disc tilt at full cyclic. */
    discTiltMax: number
    /** Built-in left mast tilt that offsets the tail rotor's sideways push in a hover. */
    mastRoll: number
    rpm: number
  }

  /** Hub moment at full cyclic (stick pitch, stick roll). */
  cyclicAuthority: [number, number]
  /** Aerodynamic/rotor damping per rad/s about body X, Y, Z. */
  rateDamping: [number, number, number]
  /** Nose-up moment per m/s of forward speed (rotor flapping back). */
  speedStability: number

  torque: {
    /** Main-rotor torque reaction (N·m) per N of thrust. */
    reactionPerThrust: number
  }

  tailRotor: {
    position: [number, number, number]
    /** Yaw moment at full pedal deflection. */
    maxMoment: number
    /** Pedal position that trims torque in a hover (manual anti-torque only). */
    pedalNeutral: number
  }

  /** Drag area (Cd·A, m²) of the fuselage along body X (side), Y (top), Z (front). */
  dragArea: [number, number, number]
  fin: { position: [number, number, number]; area: number }
  stabilizer: { position: [number, number, number]; area: number }

  vortexRing: { enabled: boolean; maxLoss: number }
}

export const LITTLE_BIRD: FlightParams = {
  mass: 1000,
  centerOfMass: [0, 1.3, 0.1],
  inertia: [1700, 2300, 900],
  airDensity: 1.225,

  rotor: {
    radius: 4.15,
    hub: [0, 3.0, 0],
    maxThrust: 16700,
    climbLoss: 0.035,
    etlGain: 0.12,
    etlStart: 6,
    etlFull: 12,
    groundEffectMax: 1.2,
    discTiltMax: 0.12,
    mastRoll: 0.04,
    rpm: 470,
  },

  cyclicAuthority: [4800, 4000],
  rateDamping: [3600, 3000, 2500],
  speedStability: 35,

  torque: { reactionPerThrust: 0.22 },

  tailRotor: {
    position: [0.29, 1.84, -5.62],
    maxMoment: 7000,
    pedalNeutral: 0.34,
  },

  dragArea: [4.5, 8, 1.2],
  fin: { position: [0, 2.0, -5.85], area: 1.0 },
  stabilizer: { position: [0, 1.55, -5.3], area: 0.6 },

  vortexRing: { enabled: true, maxLoss: 0.35 },
}
