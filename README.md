# LittleBird

A helicopter piloting game built with Electron and three.js. Fly the MH-6/AH-6 Little Bird: move troops between landing zones and give light ground support. You can play in a cockpit view or a third-person view, with a keyboard or a gamepad.

> Early development. See [PLAN.md](PLAN.md) for the roadmap. Milestones **M0 (scaffold)**, **M1 (input)**, **M2 (flight model)**, **M3 (Little Bird model)**, **M4 (helicopter audio)** and **M5 (valley map)** are done.

## Getting started

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
| `npm run dist` | Packages a Windows build into `release/` |
| `npm run model:littlebird` | Rebuilds `public/models/littlebird.glb` from the Sketchfab download in `assets/source/littlebird/` |

In-game: <kbd>C</kbd> switches chase/cockpit view, <kbd>R</kbd> resets on the pad, <kbd>F3</kbd> toggles the debug panel (assist mode, flight tuning, wind), <kbd>F11</kbd> toggles fullscreen and <kbd>F12</kbd> opens DevTools (dev builds only).

## Credits

See [CREDITS.md](CREDITS.md).
