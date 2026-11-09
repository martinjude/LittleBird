# LittleBird — Project Plan

Helicopter piloting game built on **Electron + Three.js**. You fly an MH-6/AH-6 "Little Bird", moving troops between landing zones and giving light ground support.

---

## 1. MVP scope

**In the MVP**
- One helicopter: the Little Bird, with two loadouts on one airframe:
  - **Transport (MH-6):** troops sit on the outboard benches, 4–6 seats.
  - **Attack (AH-6):** 2× M134 miniguns and 2× rocket pods.
- One map, about 4×4 km: a home base, 3–5 landing zones and one hostile area.
- Cameras: cockpit (first person, free head-look) and chase (third person).
- Controls: keyboard (with optional mouse) and gamepad (XInput/DualSense through the Gamepad API).
- Game loop: pick up troops at A, fly to B, land in the LZ and unload. Score depends on time, how smoothly you land and how much damage you take.
- Combat: enemy infantry and technicals near some LZs. You suppress them with guns and rockets. Enemies fire small arms and the helicopter takes damage.
- High-quality audio: a layered rotor/turbine sound that reacts to flight state, a separate cockpit and outside mix, and positional weapon sounds with distance falloff.
- Menus: main menu, mission select, pause, settings (key bindings, sensitivity, audio volumes, graphics).

**Not in the MVP (later)**
- Multiplayer, VR or TrackIR, more aircraft, a campaign, weather, night or NVG, sling loads, AI wingmen, full autorotation and failure simulation.

---

## 2. Tech stack

| Concern | Choice | Why |
|---|---|---|
| Shell | **Electron 45** (stable) | Replaced the `46.0.0-alpha.7` that was installed. |
| Build | **electron-vite** + **TypeScript** | One Vite config covers main, preload and renderer. Vite gives hot reload in the renderer. |
| Rendering | **three.js** `WebGLRenderer` | Works with every Sketchfab GLB and with the `postprocessing` library. WebGPU can be evaluated after the MVP. |
| Physics | **Rapier** (`@dimforge/rapier3d-compat`) | Handles rigid bodies, terrain heightfield colliders, raycasts for weapons and ground effect, and character controllers for troops. |
| Flight model | **Custom code** (our own) | Computes forces and torques each physics step and applies them to the Rapier body. |
| Audio | **Web Audio API**, through our own `AudioEngine` | Needs per-layer gain, pitch and filter automation, HRTF panning, convolution reverb and voice pooling. |
| UI / HUD | HTML/CSS overlay | Quick to build and easy to restyle. The HUD text is plain DOM layered over the canvas. |
| Debug | `lil-gui`, `stats-gl`, Rapier debug lines | Lets us tune flight parameters while the game runs. |
| Assets | glTF/GLB → `gltf-transform` (meshopt + KTX2) | Smaller files and faster loading. |
| Tests | **Vitest** | Unit tests for the flight model math, input mapping and mission state machine. |
| Packaging | **electron-builder** | Produces the Windows installer or portable build. |

---

## 3. Architecture

### 3.1 Electron process layout
- **Main:** creates the window (fullscreen or borderless option), sets `backgroundThrottling: false`, and reads/writes `settings.json` and save files in `app.getPath('userData')`.
- **Preload:** exposes a small typed API through `contextBridge`: `settings.load/save`, `saves.*` and `app.quit`.
- **Renderer:** the whole game. It runs with `contextIsolation: true` and `nodeIntegration: false`.

### 3.2 Game loop
- **Fixed-timestep simulation** at 120 Hz. This covers the flight model, physics, weapons and AI.
- **Variable-rate rendering**, with transforms interpolated between the last two simulation states.
- Each frame runs in this order: input poll → sim steps → camera → audio params → render → HUD.

### 3.3 Code organisation
We use a small set of systems over plain entities. There is no full ECS framework for now. If the entity count grows, we can add `miniplex`.

```
src/
  main/                 Electron main process
  preload/              contextBridge API
  renderer/
    core/               Game loop, clock, events, asset loader, settings
    input/              Devices (keyboard, mouse, gamepad), action map, bindings
    flight/             Helicopter flight model (pure TS, unit-tested)
    physics/            Rapier world wrapper, colliders, raycasts
    vehicles/           Helicopter entity: model, rotors, damage, loadout
    weapons/            Minigun, rockets, projectiles, hit detection
    ai/                 Enemy infantry/technicals, simple state machines
    troops/             Passenger boarding/unboarding, seat slots
    missions/           Mission definitions, LZ triggers, objectives, scoring
    world/              Terrain, vegetation (instanced), buildings, sky, lighting
    camera/             Cockpit cam, chase cam, transitions
    audio/              AudioEngine, heli sound rig, weapon sounds, mixer
    fx/                 Rotor wash dust, muzzle flash, tracers, explosions
    ui/                 HUD, menus, settings screens
    debug/              lil-gui panels, stats, physics debug draw
  shared/               Types shared by main/preload/renderer (IPC API, settings)
public/                 Runtime (optimised) assets served to the renderer
  models/  textures/  audio/  maps/
assets/source/          Source masters: Blender files, raw GLBs, WAVs (git-ignored)
tools/                  asset optimisation scripts (gltf-transform)
```

---

## 4. Helicopter flight model

The target is **"authentic-arcade"**. Flight should feel like a helicopter (torque, translational lift, ground effect), but stability assists make it playable on a controller.

**Pilot inputs** (each normalised to −1…1 or 0…1)

| Input | Effect |
|---|---|
| Collective | Main rotor thrust |
| Cyclic pitch/roll | Tilts the thrust vector, creating pitch and roll moments |
| Pedals | Changes tail rotor thrust, creating a yaw moment |

**Forces and moments applied each simulation step**
1. **Main rotor thrust** along the rotor mast. It scales with collective and air density, and changes with:
   - **Ground effect:** more lift within about one rotor diameter of the ground. A downward raycast measures the height.
   - **Effective translational lift:** extra lift at roughly 12–25 kt of airspeed.
   - **Vortex ring state** (optional, can be toggled): lift is lost during a fast vertical descent at low airspeed.
2. **Main rotor torque reaction:** a yaw moment that grows with collective. The tail rotor has to counter it.
3. **Tail rotor:** produces a yaw moment from the pedals, and a small sideways force (translating tendency).
4. **Cyclic moments:** produce pitch and roll rates, with damping.
5. **Weathervaning:** the tail fin aligns the nose with the airflow when moving forward.
6. **Drag:** parasitic drag on the body, split by axis (front, side and top each get a coefficient).
7. **Gravity, and the Rapier contacts** for skids and ground.

**Assist modes** (selectable in settings)
- **Novice:** attitude hold, auto-trim, automatic torque compensation and an altitude hold helper.
- **Standard:** rate damping plus automatic torque compensation.
- **Realistic:** no assists, apart from a light stability augmentation system (SAS).

**Implementation notes**
- All tuning values live in one data file, `flight/littlebird.params.ts`, so they can be edited live in lil-gui.
- The flight model stays pure functions in, forces out. That keeps it unit-testable and lets other helicopters reuse it later.
- **Landing detection:** all skids are touching, vertical speed is below a limit, and the ground slope is under about 10°. "Smooth landing" scoring uses the same check.


**As built (M2):**
- `flight/FlightModel.ts` contains pure functions and is unit-tested. Rotor, tail rotor, fin and stabiliser are applied as point forces, so side effects such as tail-rotor drift and roll come from the geometry. The flight control system (`flight/Fcs.ts`) sits between the stick and the rotor.
- The assist modes as built:
  - **Novice:** the stick sets the attitude angle, and centring it levels the helicopter.
  - **Standard:** the stick sets a rotation rate. Attitude and heading are held when the stick is centred, inside a soft envelope of about 26° pitch and 46° bank. Above about 20 kt, heading hold hands over to turn coordination.
  - **Realistic:** the stick drives the rotor directly, with light stability augmentation. The pedals have to counter torque manually.
- The debug panel shows live tuning values and telemetry, plus wind and a physics wireframe. **Copy params as JSON** exports tuned values to paste back into `littlebird.params.ts`.
- Cameras: chase (follows heading, spring-damped), cockpit (eye point, free head-look) and a dev orbit camera.
- Not done yet: engine start-up and rotor RPM droop, damage or crashes, and dynamic rollover.

---

## 5. Input

**Action map layer**
- Game code reads named actions such as `collective` (axis), `cyclicPitch` (axis), `firePrimary` (button) and `toggleCamera` (button). It never reads device keys directly.
- Bindings are stored in a JSON profile and can be changed from the settings menu.
- Per-axis settings: deadzone, response curve (expo), sensitivity and invert.
- On keyboard, a digital key ramps an axis smoothly toward its target instead of jumping. For example, holding W raises the collective at a set rate.

**Default bindings**

| Action | Gamepad | Keyboard / mouse |
|---|---|---|
| Collective | Left stick Y | W / S |
| Pedals (yaw) | Left stick X | A / D |
| Cyclic | Right stick | Arrow keys, or mouse (optional mouse-flight mode) |
| Head-look (cockpit) | Hold LB + right stick | Hold right mouse button + mouse |
| Fire guns | RT | Space / left mouse button |
| Fire rockets | LT | F |
| Switch camera | View/Back | C |
| Board / unload troops | A (while landed) | E |
| Pause | Start | Esc |

Gamepads use the Gamepad API's standard mapping. We also need to handle hot-plugging (controllers connected or disconnected mid-game) and show controller-specific button glyphs (Xbox or PlayStation).

**As built (M1):**
- Keys are bound by *physical position* (`KeyboardEvent.code`). The default WASD layout therefore lands on ZQSD on AZERTY keyboards. On-screen hints show the user's real key labels, using the Keyboard Layout API.
- The collective is a lever that stays where you leave it. The gamepad stick has two modes: `rate`, the default, where the stick moves the lever; and `absolute`, where the stick position is the lever position.
- Holding LB for gamepad free-look freezes the cyclic at its last value, so the helicopter doesn't follow the camera.
- A key that goes down and up within one frame is still seen for one frame, so quick taps aren't lost.
- Bindings and tuning are saved in the settings (`src/shared/bindings.ts`, `controls` in `src/shared/settings.ts`). The rebinding UI comes in M8.

---

## 6. Cameras
- **Cockpit:** attached to an eye-point empty in the model.
  - Free look is clamped to realistic angles.
  - Subtle rotor vibration shake, which increases with the throttle.
  - Field of view adjustable in settings.
  - Instruments use simple gauge meshes or render targets: airspeed, altimeter, torque and heading.
- **Chase:** a spring-damped follow camera behind and above the helicopter, which lags slightly on yaw. It collides with terrain so it never clips underground. An orbit mode is included.
- **Switching:** a short blend between the two. Switching also crossfades the audio between the cockpit and outside mixes (see §8).

---

## 7. Assets pipeline (Sketchfab + Blender)

**Conventions** (agreed once so every asset fits)
- Units are **meters** and Y is up. glTF faces the model's front along +Z; the loader converts this once on import.
- The helicopter model needs these named nodes:
  - `Rotor_Main` and `Rotor_Tail`. Their pivots must sit on the rotation axis.
  - `Rotor_Main_Blur`, an optional disc mesh shown at high RPM.
  - `Eye_Pilot`: the cockpit camera position.
  - `Seat_01` … `Seat_06`: troop seat positions.
  - `Muzzle_L` / `Muzzle_R` and `Rocket_L` / `Rocket_R`: weapon firing points.
  - `Skid_FL`, `Skid_FR`, `Skid_RL`, `Skid_RR`: contact points for landing checks.
  - `COL_*`: simple collision proxy meshes. These are hidden at runtime and turned into Rapier colliders.
- **Polygon budget:** about 30–60k triangles for the helicopter at the highest level of detail (LOD0), with LODs for distant views.
- **PBR textures:** 2K for the helicopter and 1K for props. Compress them to KTX2.

**Workflow**
1. **Download** the asset from Sketchfab as glTF. **Record the license** in `CREDITS.md`, since CC-BY requires attribution. Avoid "Editorial" or NoAI-restricted licenses for shipped content.
2. **Clean up in Blender:** apply transforms, set the scale, fix pivots, add the named empties, and build `COL_*` proxies. Split animated parts (rotors, doors, gun barrels) into separate nodes.
3. **Export a GLB** to `assets/source/`.
4. **Optimise:** run `npm run assets` (`tools/optimize.ts`, using gltf-transform: dedup, prune, meshopt, KTX2) and write the result to `assets/models/`.
5. **Load at runtime** with `GLTFLoader`, plus `MeshoptDecoder` and `KTX2Loader`.

The Blender MCP connection is available in this environment, so I can help with checking scenes, naming nodes and exporting directly from Blender.

**Helicopter model: "Helicopters MH-6 Little Bird" by mario low poly**, CC BY 4.0 (credit in `CREDITS.md`)
Link: [sketchfab.com/…/69cb05db3fc3483cb729734262abf28e](https://sketchfab.com/3d-models/helicopters-mh-6-little-bird-69cb05db3fc3483cb729734262abf28e)

**As built (M3):**
- The model is about 27k triangles. It includes the cockpit interior (seats, MFDs, cyclic), gun pods and an ammo loader. The rotors are separate nodes with clean pivots, so no Blender work was needed.
- `assets/littlebird.model.json` is a prep config that the pipeline applies on build:
  - flattens Sketchfab's wrapper nodes
  - renames `Object_15` to `Rotor_Main` and `Object_13` to `Rotor_Tail`
  - shifts the origin so the skids sit at y=0 under the mast
  - adds the `Eye_Pilot` marker
- `npm run model:littlebird` rebuilds `public/models/littlebird.glb` (0.5 MB, Meshopt-compressed, WebP textures). `npm run model -- inspect <file>` checks any model against the conventions.
- At runtime, `GltfHeliModel` adds a cyclic tilt group above the main rotor and a blur disc sized from the blades. It fades a cloned blade material, because `dedup` merges materials. It also hides `COL_*` collision proxies.
- If the GLB is missing, the game falls back to `PlaceholderHeliModel`.
- Still to do: live instruments (the MFDs are static), named seat/muzzle/skid markers (add them to the prep config when M6/M7 need them), and LODs.

**Asset list for the MVP**
- Little Bird: exterior, cockpit interior, MH-6 benches, AH-6 weapon pods.
- Soldier: one rigged model with idle, run, sit and crouch-fire animations (Mixamo works well for the rigging and animations).
- Enemy technical: a pickup truck with a mounted gun. Also some crates and sandbags.
- Base: helipads, hangar, H-barriers. LZ props: smoke grenade, flag, marker panels.
- Terrain: a heightmap made in Blender or Gaea, plus ground textures, trees and rocks (drawn with instancing).

---

## 8. Audio (high-quality focus)

### 8.1 Engine
- **`AudioEngine`** runs on Web Audio and contains:
  - A master bus with sub-buses: `vehicle`, `weapons`, `world`, `ui` and `voice`. Each has its own volume control.
  - A light `DynamicsCompressor`/limiter on the master bus, so firefights don't clip.
  - A `PannerNode` with HRTF on each 3D source. The listener follows the active camera.
  - A **voice pool** with priorities and a cap of about 48 simultaneous voices. When the pool is full, the quietest or lowest-priority sound is dropped.
  - **Distance-based sound delay** for far events such as distant explosions (speed of sound, about 343 m/s). This adds a lot of realism.
  - **Convolution reverb** per environment, for example open valley versus base or hangar.

### 8.2 Helicopter sound rig
A real helicopter's rotor speed barely changes, because it is governed. What you actually hear change is **blade loading**, so the rig is built around that. Each layer is a seamless loop crossfaded and modulated by flight-model values:

| Layer | Driven by |
|---|---|
| Turbine whine (high) | Engine N1/torque: pitch and gain |
| Rotor "thump" (low) | Rotor RPM: very small pitch change. Gain goes up with collective/load. |
| Blade slap (BVI) | Strongest when descending under load or in hard turns |
| Transmission / gearbox | Constant inside the cockpit, quiet outside |
| Tail rotor buzz | Pedal input and yaw rate |
| Wind / airflow | Airspeed: gain and high-pass filter |
| Startup / shutdown | Sequenced one-shots crossfaded into the loops |

**Cockpit and outside mixes**
- **Cockpit:** low-pass filtered, with more transmission and the turbine and wind out of the doors. A headset-filtered radio sits on top.
- **Outside:** full spectrum, with Doppler (computed manually from relative velocity, because Web Audio has no Doppler) and distance-based low-pass filtering.

**As built (M4):**
- `audio/AudioEngine.ts` sets up the audio graph:
  - vehicle, weapons, world and UI buses feeding a master bus and a limiter
  - a shared outdoor convolution reverb
  - an HRTF listener that follows the camera and tracks its velocity
  - a 48-voice one-shot pool that steals the lowest-priority, oldest voice, with an optional speed-of-sound delay
- `audio/HeliSoundRig.ts` has six looping layers: rotor, slap, turbine, gearbox, tail and wind.
  - Each layer is shaped by rpm, torque, load, vertical speed, airspeed, tail-rotor use and vortex ring state.
  - Each layer splits into an exterior mix (air absorption, then panner, then reverb, with manual Doppler) and an interior mix (airframe low-pass plus a headset shelf). The two cross-fade when the camera switches.
- **Stand-in sounds:** every layer is generated in code by `audio/synth.ts`, so the game has sound with no assets. Dropping `public/audio/heli/<rotor|slap|turbine|gearbox|tail|wind>.ogg` replaces a layer automatically. The debug panel's Audio folder shows which layers are recordings, and has volumes and per-layer trims.
- Still to do: engine start-up and shutdown sequences (needs rotor RPM simulation), a WAV-to-Opus encode script (needs ffmpeg), and mixing against real recordings.

### 8.3 Weapons
- **Minigun (M134):** fires 2,000–4,000 rounds per minute, which is too fast to play one sample per shot. It uses **spin-up → sustained loop → spin-down/tail** segments, with separate close and distant loops crossfaded by camera distance. Brass and link rattle sounds play in the cockpit.
- **Rockets:** an ignition whoosh, a moving positional "flyby" source attached to each projectile, and an impact explosion with close, mid and far layers plus a delayed echo tail.
- **Enemy small arms:** one-shots with 3–5 variations each, randomised pitch (about ±3%), and distance layers (close crack versus far pop). A supersonic **crack** plays when bullets pass close to the listener.
- **Impacts:** different sounds per surface (dirt, metal, wood). Bullets hitting the helicopter make a distinct metallic ping, which tells the player they're under fire.

### 8.4 Sources and format
- Libraries: the Sonniss GDC bundles (free and royalty-free), BOOM Library and Pro Sound Effects (paid, high quality), and Freesound (check each license). Record any attribution in `CREDITS.md`.
- Keep the 48 kHz WAV masters in `assets/audio/source/`. Ship **Opus/OGG** files, encoded by an `npm run audio` script.
- Edit the loops for seamless zero-crossing loop points before export.

---

## 9. Gameplay systems

**Troops**
- Troops are NPC agents. They move along nav waypoints to the helicopter, play a boarding animation, and snap to `Seat_*` nodes.
- They only board when the helicopter is landed and stable inside the pickup zone.
- Unloading runs the reverse sequence. Troops then run to a rally point.

**Missions**
- Missions are data-driven JSON: pickup LZ, drop LZ, number of troops, an optional time limit, and enemy spawn groups.
- Each mission is a state machine: `Briefing → Pickup → InTransit → Drop → (Defend/Support) → RTB → Debrief`.

**HUD**
- Waypoint marker and distance, with LZ smoke as an in-world marker.
- Troops aboard, ammo, damage and torque warnings.
- Altitude above ground (AGL) and airspeed.


**As built (M6):**
- `missions/missions.ts` has 4 missions, flown in order:

  | # | Mission | Route | Troops | Smoke |
  |---|---|---|---|---|
  | 1 | Valley Insertion | FOB → LZ Alpha | 4 | green |
  | 2 | Ridge Drop | FOB → LZ Bravo | 4 | yellow |
  | 3 | High Ground | FOB → LZ Charlie | 2 | purple |
  | 4 | Extraction | LZ Delta → FOB | 4 | red |

  The debug panel can jump straight to any mission.
- `MissionRunner` is a pure, tested state machine: briefing → pickup → boarding → transit → unloading → RTB → complete, or failed. Boarding and unloading pause whenever you're not settled inside the zone.
- `LandingMonitor` runs at 120 Hz:
  - It grades each touchdown by the peak descent rate in the 0.3 s before contact: smooth below 0.6 m/s (100 points), firm below 1.5 (70), hard below 3 (30), very hard above that (0).
  - It treats these as crashes: 7 m/s or more, contact at an extreme attitude, or rolling over.
  - "Landed" means skids down and still for 0.8 s.
- Scoring: the landing grade, +25 for landing within 15 m of an LZ's panels, +50 per troop delivered, and a time bonus against par (the route at 70 kt plus 90 s). Only landings after a flight count.
- Troops (`troops/`): stand-in soldiers built from primitives, posed in code (idle, run, sit, kneel).
  - They run to their bench seat, ride along parented to the aircraft, then climb off one at a time and fan out to a rally point.
  - Each adds 100 kg to the flight model, so 4 troops take the aircraft from 1,000 kg to 1,400 kg.
  - MH-6 benches are added to the model, 2 seats a side.
- Smoke (`fx/Smoke.ts`): a single Points draw call. It pops within 2 km of the LZ, drifts with the wind, and rotor downwash flattens it and spreads it outward.
- HUD: mission panel (objective, troop dots, timer), waypoint marker clamped to the screen edge, toasts with UI chimes, and briefing/debrief/failed cards. Reset (R/Y) restarts the mission.
- Not done yet: a rigged and animated soldier model, troop collision and pathing around obstacles, radio voice-overs, and a mission-select menu (M8).

**Combat**
- Weapons use hitscan raycasts, with tracers drawn as instanced quads. Rockets are simulated projectiles with a small dispersion.
- Enemy AI has the states Idle → Alert → Engage (fire at the helicopter if it's within range and line of sight) → Flee/Die.
- Damage is tracked per component: engine, tail rotor, main rotor, fuel and crew. Losing the tail rotor causes uncontrolled spin, which is a strong gameplay moment and cheap to make.

**FX**
- Rotor wash: dust and grass particles below the helicopter, scaled by height and collective.
- Muzzle flashes, tracers, impact puffs, and explosion sprites with light flashes.

**Scoring**
- Based on mission time, landing smoothness (vertical speed at touchdown), troops delivered safely, and damage taken.

---

## 10. Milestones

Each milestone ends with something you can play or test.

| # | Milestone | Done when |
|---|---|---|
| **M0** ✅ | **Scaffold** | electron-vite + TS + three run. The window shows a lit test scene. The fixed-timestep loop, lil-gui and stats are wired in. `git init`. |
| **M1** ✅ | **Input layer** | Keyboard and gamepad are mapped to actions, with deadzones and curves. A debug overlay shows live axis values. Hot-plugging works. |
| **M2** ✅ | **Flight model v1** | A placeholder box helicopter flies over a flat test map with physics. All forces from §4 work and parameters can be tuned live. The chase camera works. |
| **M3** ✅ | **Little Bird asset** | The first real GLB goes through the pipeline. Rotors spin and the rotor blur disc fades in. The cockpit camera, instruments and skid contacts work. |
| **M4** ✅ | **Audio v1** | The full helicopter sound rig from §8.2 works, with cockpit/outside mixes, Doppler and the voice pool. |
| **M5** ✅ | **Terrain & map** | The 4×4 km heightmap terrain is in, with Rapier heightfield collision, instanced vegetation, the base, LZs, sky and shadows. |
| **M6** ✅ | **Transport loop** | Troops board and unload. The mission state machine runs, and the HUD shows waypoints and smoke. Landing scoring works. **First playable MVP loop.** |
| **M7** | **Combat** | Miniguns and rockets work with their FX and audio. Enemy AI and the damage model are in. Includes one "insert under fire" mission. |
| **M8** | **MVP polish** | Menus, rebinding UI, settings persistence, loading screen, performance pass (LODs, culling, KTX2) and an electron-builder package. |

Performance target: **60 fps at 1080p on a mid-range GPU**, for example GTX 1660 or RX 6600 class.


**M5 as built: Valley map** (temperate mountains, procedural, seed 7)
- `world/valley.ts` generates a 4096 m × 4096 m heightmap (513², 8 m spacing) in about 260 ms:
  - a meandering creek on a rolling valley floor
  - ridged mountains on both flanks, up to about 850 m, with snow above about 560 m
  - a rim that closes the valley at the map edge
- Sites are flattened into the terrain:

  | Site | Altitude | Terrain |
  |---|---|---|
  | FOB Eagle | 44 m | valley floor, south |
  | LZ Alpha | 43 m | valley floor, north |
  | LZ Bravo | 152 m | hill shoulder |
  | LZ Charlie | 504 m | mountain |
  | LZ Delta | 46 m | valley floor, centre (for the later hostile area) |
- Terrain mesh:
  - vertex colours for grass, creek dirt, rock on slopes, snow and pad gravel, multiplied by a tiling detail texture
  - a skirt around the border, plus a low-poly "distant mountains" ring out to 16 km
- Physics: a Rapier heightfield for the playable square, checked against the visual mesh with raycasts. A coarse heightfield covers the distant ring, so you can't fly through it.
- About 17k instanced trees (conifers higher up, broadleaf in the valley), each with a cylinder collider, plus 2.5k boulders without colliders.
- FOB Eagle: three pads, a hangar, tents, containers, a windsock and a HESCO ring with a road gap. LZs are marked with orange VS-17 panels.
- Cascaded shadow maps (3 cascades, 2.5 km). The HUD shows a "LEAVING AREA" warning near the map edge.
- Performance: about 100 fps on the dev machine, with about 9M triangles per frame. Trees are drawn in the main pass and in each of the three shadow cascades, so tree LODs or impostors and per-cascade culling are M8 work.
- Not done yet: water in the creek, roads, grass and ground clutter, and a hand-made map in Blender or Gaea.

---

## 11. Risks & mitigations

| Risk | Mitigation |
|---|---|
| The flight model feels bad on keyboard | Assist modes, ramped digital axes, and an optional mouse-flight mode. Playtest early (M2). |
| Sketchfab assets are inconsistent (scale, pivots, licenses, heavy polygon counts) | Use the strict node naming and conventions checklist from §7, run every asset through the optimisation script, and keep the credits file up to date. |
| Audio loops sound repetitive or phasey | Use long loops (10–30 s), crossfade by parameters rather than hard-switching, and add small random modulation. |
| Large terrain causes depth-buffer z-fighting (flickering where surfaces overlap) | Tune the near/far planes per camera. Turn on `logarithmicDepthBuffer` if needed. |

---

## 12. Open decisions

Each has a recommended default.
1. **Realism level:** authentic-arcade with assist modes (recommended), versus hardcore sim.
2. **Language:** TypeScript (recommended) versus plain JS.
3. ~~**Map setting/biome:**~~ Decided in M5: temperate mountain valley.
4. **Weapon control on the AH-6:** pilot-fired fixed weapons (true to the AH-6, recommended), versus adding AI door gunners on the MH-6 later.
