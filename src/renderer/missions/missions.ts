export interface MissionDef {
  id: string
  name: string
  briefing: string
  /** Site ids from the map (see world/valley.ts). */
  pickup: string
  drop: string
  troops: number
  /** Smoke colour marking the LZ. */
  smoke: 'green' | 'yellow' | 'purple' | 'red'
  /** Enemies are dug in around the LZ (the non-base end of the route). */
  hostiles?: boolean
}

/** The MVP mission set, flown in order. */
export const MISSIONS: MissionDef[] = [
  {
    id: 'insert-alpha',
    name: 'Valley Insertion',
    briefing: 'Pick up a four-man recon team at FOB Eagle and insert them at LZ Alpha, up the valley to the north. Look for green smoke.',
    pickup: 'base',
    drop: 'lz-alpha',
    troops: 4,
    smoke: 'green',
  },
  {
    id: 'ridge-bravo',
    name: 'Ridge Drop',
    briefing: 'An observation team needs to get onto the ridge east of the creek. LZ Bravo is a tight hilltop clearing. Watch your approach over the trees.',
    pickup: 'base',
    drop: 'lz-bravo',
    troops: 4,
    smoke: 'yellow',
  },
  {
    id: 'charlie-high',
    name: 'High Ground',
    briefing: 'Two snipers to LZ Charlie, a mountain pad at 500 m. You are carrying less, but the climb is long. Mind your torque and come in slowly.',
    pickup: 'base',
    drop: 'lz-charlie',
    troops: 2,
    smoke: 'purple',
  },
  {
    id: 'extract-delta',
    name: 'Extraction',
    briefing: 'A patrol is waiting at LZ Delta in the middle of the valley. Pick them up and bring them home to FOB Eagle.',
    pickup: 'lz-delta',
    drop: 'base',
    troops: 4,
    smoke: 'red',
  },
  {
    id: 'hot-lz',
    name: 'Hot LZ',
    briefing:
      'Insurgents with two DShK technicals have dug in around LZ Delta. Insert a four-man assault team. Suppress the LZ with guns and rockets on the way in, and keep your speed up: a hovering Little Bird is an easy target.',
    pickup: 'base',
    drop: 'lz-delta',
    troops: 4,
    smoke: 'red',
    hostiles: true,
  },
]

export const SMOKE_COLORS: Record<MissionDef['smoke'], number> = {
  green: 0x6fbf5a,
  yellow: 0xe8cf4a,
  purple: 0x9a6fc4,
  red: 0xd9584a,
}
