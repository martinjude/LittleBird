# LittleBird

A helicopter game built with Electron and three.js. You fly the MH-6/AH-6 Little Bird through a mountain valley: you carry troops between landing zones and fight your way into hot LZs with miniguns and rockets. You can fly from the cockpit or from a chase camera, using a keyboard or a gamepad.

> **MVP complete (v0.1.0).** All milestones M0–M8 in [PLAN.md](PLAN.md) are done. See the plan for what was built and what comes next.

## Features

- **Flight model:** physics-based (Rapier), with ground effect, extra lift once moving, thrust loss when climbing, vortex ring state, torque, a tail rotor, and a fin and stabiliser. There are three assist modes: Novice, Standard and Realistic.
- **Five missions** in a 4×4 km procedurally generated mountain valley:
  - Insertions, a ridge drop and a 500 m mountain pad.
  - An extraction.
  - "Hot LZ", against infantry and DShK technicals.
- **Troops** board and get off the outboard benches, and their weight changes how the helicopter flies.
- **Combat:**
  - Twin miniguns and Hydra rockets.
  - Enemies that check line of sight and lead their shots.
  - A damage model for the engine, tail rotor and main rotor, including rotor strikes.
- **Layered helicopter audio** that responds to flight state, with separate cockpit and outside mixes and Doppler. Weapon sounds are positional and delayed by distance. All sounds are stand-ins generated in code; real recordings dropped in replace them (see below).
- **Menus:** missions with best scores, graphics, audio and input settings, and full keyboard, mouse and gamepad rebinding.

## Playing

Download or build the Windows release (`npm run dist`), then run `LittleBird Setup 0.1.0.exe`, or the portable `LittleBird 0.1.0.exe`.

| Action | Keyboard / mouse (QWERTY positions) | Gamepad |
|---|---|---|
| Collective up / down | W / S | Left stick ↕ |
| Pedals | A / D | Left stick ↔ |
| Cyclic | Arrow keys | Right stick |
| Free look | Hold right mouse button | Hold LB + right stick |
| Guns / rockets | Space or left mouse button / F | RT / LT |
| Interact (start, next) | E | A |
| Camera (chase ↔ cockpit) | C | View |
| Reset to base | R | Y |
| Menu / pause | Esc | Menu |

Keys are bound by physical position, so on AZERTY keyboards W/A/S/D become Z/Q/S/D. The on-screen hints always show your real keys. Everything can be rebound in **Menu → Controls**.

## Development

Requires Node.js 22.12+.

```bash
npm install
npm run dev
```

| Script | What it does |
|---|---|
| `npm run dev` | Starts the app with hot reload |
| `npm run build` | Builds a production bundle into `out/` |
| `npm run typecheck` | Type-checks main, preload and renderer |
| `npm test` | Runs the unit tests (Vitest) |
| `npm run dist` | Packages the Windows installer and portable exe into `release/` |
| `npm run model:littlebird` | Rebuilds `public/models/littlebird.glb` from the Sketchfab download in `assets/source/littlebird/` |
| `npm run model -- inspect <file>` | Checks any helicopter model against the naming conventions |

Dev builds:
- <kbd>F3</kbd> opens the debug panel: flight tuning, telemetry, wind, assist tuning, audio layers, a physics wireframe and a mission picker.
- <kbd>F12</kbd> opens DevTools.
- <kbd>F11</kbd> toggles fullscreen in every build.

### Using real recordings

Drop OGG files into these folders and they replace the stand-in sounds automatically:
- `public/audio/heli/`: `rotor`, `slap`, `turbine`, `gearbox`, `tail`, `wind` (seamless loops)
- `public/audio/sfx/`: `minigun`, `minigun-spin` (loops), `rocket`, `explosion`, `rifle`, `dshk`, `metalHit`, `crack`, `dirt`

## Credits

See [CREDITS.md](CREDITS.md).
