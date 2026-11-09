/** A static collision shape recorded while placing scenery; turned into Rapier colliders later. */
export type StaticCollider =
  | { shape: 'box'; x: number; y: number; z: number; hx: number; hy: number; hz: number; yaw: number }
  | { shape: 'cylinder'; x: number; y: number; z: number; halfHeight: number; radius: number }
