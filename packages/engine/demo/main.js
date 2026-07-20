// Demo page entry (§7 — "this page IS the acceptance surface per milestone"). Boots the engine
// against the frozen facade (`src/engine.js`), drives a pointer-lock fly camera, and wires the
// lil-gui control panel (seed reload / tier override / time-of-day) + the HUD overlay.
//
// WS1 has landed: `create_engine()` only throws on genuinely invalid ARGUMENTS (missing canvas,
// unknown tier name) — pre-milestone/optional feature stubs (e.g. `set_time_of_day`) no-op +
// console.warn instead of throwing (§3.1 contract). The gate banner below still exists for two
// real failure modes: (1) a bad *argument* thrown synchronously from `create_engine`/`start`, and
// (2) a real async boot failure (no WebGPU adapter, device lost, shader compile error) surfaced
// via the `'boot_error'` event — see the `engine.on('boot_error', …)` subscription below.
//
// `?synthetic_chunks=N` (bench-only, §7/§8): passes through to `create_engine({ synthetic_chunks })`
// to load N ring/grid-laid-out test chunks instead of the default 7×7 island — drives
// bench/synthetic-2000.spec.js.

import GUI from 'lil-gui'

import { create_engine, world_config_for_biome, WORLD_NAMES } from '../src/engine.js'
import { TIER_ORDER } from '../src/core/quality/tiers.js'
import { CHUNK_SIZE, LOAD_RADIUS_CHUNKS, MASTER_SEED } from '../src/config/world_config.js'

import { mount_hud } from './hud.js'
import { create_walk_mode } from './walk_mode.js'
import { boot_board_demo } from './board_demo.js'
import { boot_team_demo } from './team_demo.js'
import { boot_cave_demo } from './cave_demo.js'
import { boot_gather_demo } from './gather_demo.js'
import { install_boot_trace } from './boot_trace.js'

// [D170 P0 hardening, 2026-07-05 — repeated HMR swaps mid-session produced a frozen dark frame with
// no visible error] A stateful GPU engine must NEVER hot-swap its module graph: stale closures + a dead rAF
// leave a frozen dark frame with orphaned input subscriptions (the wedged-session class). The vite
// pattern for stateful roots: ANY hot update below this entry invalidates to a FULL RELOAD — a clean
// boot every time a dev/worker save lands, never a half-swapped engine.
if (import.meta.hot) {
  import.meta.hot.accept(() => import.meta.hot?.invalidate())
}

const MOVE_SPEED = 24 // m/s, fly camera (§3.4: 1 block = 1 m)
const MOVE_SPEED_FAST = 96 // shift = boost
const LOOK_SENSITIVITY = 0.0024

const params = new URLSearchParams(location.search)

// ENG-16 (?board=1): the TACTICAL FIGHTBOARD demo — an isolated harness that mounts a test board over
// the flat cave-floor pose (12×10 mask w/ holes+obstacles, 2 entities, event log). It owns the camera
// via the locked-iso rig, so we short-circuit the whole fly/walk demo below and never wire that input.
// D141 (?cave=1): the CAVE DUNGEON ROOM demo — an isolated generated cave room, walk mode inside. It
// owns the page (its own engine, ring OFF). ?cave=1&board=1 ALSO mounts the tactical board on the cave
// floor (the MVP fight scene). Checked FIRST so ?cave=1&board=1 routes here, not to the plain board demo.
if (params.get('cave') === '1') {
  const cave_canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('canvas'))
  const cave_gate = /** @type {HTMLDivElement} */ (document.getElementById('gate'))
  boot_cave_demo(cave_canvas, cave_gate, params).catch((error) => {
    cave_gate.dataset.hidden = 'false'
    cave_gate.textContent = `Cave demo failed: ${/** @type {Error} */ (error)?.message ?? error}`
    console.error('[cave demo]', error)
  })
} else if (params.get('board') === '1') {
  const board_canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('canvas'))
  const board_gate = /** @type {HTMLDivElement} */ (document.getElementById('gate'))
  boot_board_demo(board_canvas, board_gate).catch((error) => {
    board_gate.dataset.hidden = 'false'
    board_gate.textContent = `Board demo failed: ${/** @type {Error} */ (error)?.message ?? error}`
    console.error('[board demo]', error)
  })
} else if (params.get('team') === '1') {
  // team-read verification surface (flat open-sky board, team outlines + seat rings) — team_demo.js.
  const team_canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('canvas'))
  const team_gate = /** @type {HTMLDivElement} */ (document.getElementById('gate'))
  boot_team_demo(team_canvas, team_gate).catch((error) => {
    team_gate.dataset.hidden = 'false'
    team_gate.textContent = `Team demo failed: ${/** @type {Error} */ (error)?.message ?? error}`
    console.error('[team demo]', error)
  })
} else if (params.get('gather') === '1') {
  // Gather-node visual rework acceptance surface — procedural wheat/herb/ore props seated on real grass.
  const gather_canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('canvas'))
  const gather_gate = /** @type {HTMLDivElement} */ (document.getElementById('gate'))
  boot_gather_demo(gather_canvas, gather_gate, params).catch((error) => {
    gather_gate.dataset.hidden = 'false'
    gather_gate.textContent = `Gather demo failed: ${/** @type {Error} */ (error)?.message ?? error}`
    console.error('[gather demo]', error)
  })
}

const synthetic_chunks_param = params.get('synthetic_chunks')
// `?load_radius=N` (bench-only, D33): overrides the canonical LOAD_RADIUS_CHUNKS so the r5/6/7/8
// view-distance A/B sweep (bench/d33_radius.spec.js) can compare radii without re-editing source.
const load_radius_param = params.get('load_radius')
// [D210 — no 'fixed' map: ONE world model, streaming around the player + border bounds].
// The old `?world_mode=fixed` param is accepted-and-ignored (rigs still pass it). The border zone is
// centred on the demo's default overview XZ (70,70) so the existing poses frame it.
const ZONE_ORIGIN = /** @type {[number, number]} */ ([70, 70])
// ENG-20 `?force_webgl=1`: force the minimal WebGL fallback (a colored heightmap of basic blocks, no
// TSL/post/atmosphere) even on a WebGPU machine, for testing the fallback path. Auto-detection (no
// navigator.gpu → webgl) applies regardless. The dapp does NOT set this — it relies on auto-detection.
const force_webgl = params.get('force_webgl') === '1'
// FIVE-WORLDS (?biome=rainforest|everest|everglades|paradise|riviera): resolve the named world recipe and
// boot the engine against it, so the LOD proof set (and any biome QA) can frame each world's real surface/
// palette. Read-only resolve via world_config_for_biome (unknown/empty ⇒ the DEFAULT world, warns). The
// demo `seed` box still works: the recipe's seed is overridden with state.seed at boot (below).
const biome_param = params.get('biome')

const state = {
  seed: params.get('seed') || MASTER_SEED,
  tier: /** @type {import('../src/core/quality/tiers.js').TierName | 'auto'} */ (params.get('tier') || 'auto'),
  // FIVE-WORLDS: 'default' = create_engine's DEFAULT world; any WORLD_NAMES value selects that recipe.
  biome: biome_param && WORLD_NAMES.includes(biome_param) ? biome_param : 'default',
  time_of_day: 0.25,
  // Default pose: oblique overview above the REAL streamed world (world_gen surface ≈ y 128-140
  // near spawn). The previous [70,55,70] pose predated world_gen and sat ~80 blocks UNDERGROUND
  // (fresh loads framed void until the player flew up — a recurring "I see nothing" report).
  position: /** @type {[number, number, number]} */ ([70, 175, 70]),
  yaw: Math.PI / 4,
  pitch: -0.5,
}

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('canvas'))
const gate = /** @type {HTMLDivElement} */ (document.getElementById('gate'))

/** @type {import('../src/engine.js').EngineApi | null} */
let engine = null
/** @type {{ dispose: () => void } | null} */
let hud = null
/** @type {import('./walk_mode.js').WalkMode | null} */
let walk_mode = null
/** @type {import('lil-gui').Controller | null} lil-gui controller for the 'time of day' slider — held
 *  so drive_camera can force its display to resync when tod changes via a route OTHER than the slider
 *  itself (see the STALE GUI fix below). */
let tod_controller = null
/** Camera mode: 'fly' (pointer-lock free camera, the default) or 'walk' (ENG-8 character controller).
 *  Toggled with the G key. The two never run at once — walk mode owns the camera when active. */
let mode = /** @type {'fly' | 'walk'} */ ('fly')

/** ?board=1 and ?cave=1 each own the whole page (their own engine); the fly/walk demo below is skipped
 *  so two engines never share the canvas. */
const BOARD_MODE = params.get('board') === '1'
const CAVE_MODE = params.get('cave') === '1'
const TEAM_MODE = params.get('team') === '1'
const GATHER_MODE = params.get('gather') === '1'
const OWNS_PAGE = BOARD_MODE || CAVE_MODE || TEAM_MODE || GATHER_MODE

if (!OWNS_PAGE) boot_engine()

/** (Re)creates the engine for the current `state.seed`/`state.tier` and starts it. */
function boot_engine() {
  hud?.dispose()
  walk_mode?.dispose()
  walk_mode = null
  mode = 'fly'
  engine?.dispose()

  gate.dataset.hidden = 'false'
  gate.textContent = `Booting engine (seed="${state.seed}")…`

  try {
    engine = create_engine({
      canvas,
      seed: state.seed,
      tier: state.tier === 'auto' ? undefined : state.tier,
      ...(synthetic_chunks_param ? { synthetic_chunks: Number(synthetic_chunks_param) } : {}),
      ...(load_radius_param ? { load_radius: Number(load_radius_param) } : {}),
      // FIVE-WORLDS ?biome=: boot the named world recipe (its seed replaced by the demo seed box's value so
      // reseeding still works). 'default' + no A-B toggle ⇒ omitted → create_engine uses its DEFAULT world
      // (unchanged path). A-B CAPTURE TOGGLES: `?regions=0` disables the S-25 region layer (identity before/
      // after); `?flatsmooth=0` disables the GEN_VERSION-12 crag flat-smooth (the granular "before" plains).
      ...(() => {
        const regions_off = params.get('regions') === '0'
        const flat_off = params.get('flatsmooth') === '0'
        if (state.biome === 'default' && !regions_off && !flat_off) return {}
        const wc = { ...world_config_for_biome(state.biome === 'default' ? null : state.biome), seed: state.seed }
        if (regions_off && wc.regions) wc.regions = { ...wc.regions, enabled: false }
        if (flat_off && wc.crag) wc.crag = { ...wc.crag, flat_hi: 0 }
        return { world_config: wc }
      })(),
      zone_origin: ZONE_ORIGIN, // [D210] border box config (the only thing 'zone' means now)
      // ENG-20: force_webgl passes through to the fallback fork; zone_origin also seeds the fallback's
      // static field centre in STREAMING mode (harmless under WebGPU streaming, where it's ignored) so
      // ?force_webgl=1 lays its heightmap around the demo's spawn XZ, not the origin.
      ...(force_webgl ? { force_webgl, zone_origin: ZONE_ORIGIN } : {}),
    })
    // [D210] boot timeline: log each `load_progress` phase transition (focus_ready = walkable; done =
    // the full streaming ring resident) — the same events the dapp's loading screen consumes.
    {
      const boot_t0 = performance.now()
      let last_phase = ''
      engine.on('load_progress', (payload) => {
        const p = /** @type {{ phase: string, loaded: number, total: number }} */ (payload)
        if (p.phase === last_phase && p.phase !== 'done') return
        last_phase = p.phase
        console.log(`[boot] +${(performance.now() - boot_t0).toFixed(0)}ms phase=${p.phase} ${p.loaded}/${p.total}`)
        if (p.phase === 'done') gate.dataset.hidden = 'true'
      })
    }
    engine.on('boot_error', (error) => {
      // Real async init failure (no WebGPU adapter, device lost, shader compile error, …) —
      // §10.1 capability gate. The engine may otherwise be rendering fine behind this banner
      // for milestone-gated stubs (those no-op+warn, they never reach this path).
      gate.dataset.hidden = 'false'
      gate.textContent = `Engine not ready: ${/** @type {Error} */ (error)?.message ?? error}`
      console.warn('[demo] boot_error:', error)
    })
    engine.start()
    // FIRST-LOAD trace (Agent Standard #1) — `?boot_trace=1` captures the first ~15 s of boot to
    // console + window.__boot_trace (default off, shippable). Steers the compile-storm widening.
    if (params.get('boot_trace') === '1') install_boot_trace(engine)
    // [S-27 — the demo must not render world borders] The mana-barrier wall (D210 fixed-mode
    // border) auto-arms on boot from zone_origin. Tear it down for the free-fly demo — clear_zone_bounds()
    // sets border_auto_armed so the boot-frame auto-arm (engine.js) never fires and no wall/clamp draws.
    // zone_origin stays wired (the fallback field centre + config plumbing still read it) — only the visual
    // border goes. Idempotent + safe pre-init (the barrier isn't built yet; this just latches the flag).
    engine.clear_zone_bounds()
    // NOTE: do NOT set camera pose here — `start()` kicks off async init and the fly camera does
    // not exist until it resolves, so a synchronous set right after start() is a silent no-op
    // (that was the "every pose renders the same origin horizon" bug). The drive_camera rAF loop
    // below pushes `state` (the single source of truth) onto the engine every frame, so the initial
    // pose applies the instant the camera exists and stays authoritative thereafter.
    engine.set_time_of_day(state.time_of_day)
    // DEBUG export (coordinator-approved): pointer lock is blocked under browser automation, so
    // the bench/culling pose probes drive the engine api directly through this handle.
    Object.assign(window, { __engine: engine })
    gate.dataset.hidden = 'true'
    const effective_radius = load_radius_param ? Number(load_radius_param) : LOAD_RADIUS_CHUNKS
    // ENG-8 walk mode (character controller) — created per boot since it holds the engine reference.
    // Spawn XZ = the demo's default overview XZ (70,70); scan down from a high y to land on the surface.
    walk_mode = create_walk_mode({ engine, canvas, spawn_xz_y: [70, 200, 70] })
    hud = mount_hud(engine, {
      view_distance_m: effective_radius * CHUNK_SIZE,
      get_walk_state: () => walk_mode?.get_state() ?? null,
      get_mode: () => mode,
    })
  } catch (error) {
    // Genuinely invalid arguments only (missing canvas, unknown tier name) — create_engine()
    // throws synchronously for those per §3.1; everything async goes through 'boot_error' above.
    gate.dataset.hidden = 'false'
    gate.textContent = `Engine not ready: ${/** @type {Error} */ (error).message}`
    console.warn('[demo] create_engine failed (invalid arguments):', error)
  }
}

// ---- Fly camera: WASD + pointer-lock mouse-look -----------------------------------------

const keys = new Set()
window.addEventListener('keydown', (e) => keys.add(e.code))
window.addEventListener('keyup', (e) => keys.delete(e.code))

// ENG-8: G toggles fly ↔ walk. Walk mode owns the camera (character controller + shoulder cam) while
// active; fly mode is the pointer-lock free camera. Entering walk exits any fly pointer-lock so the
// two input schemes never fight; leaving walk restores the fly pose from wherever the camera ended.
window.addEventListener('keydown', (e) => {
  if (e.code !== 'KeyG' || !walk_mode) return
  if (mode === 'fly') {
    if (document.pointerLockElement === canvas) document.exitPointerLock()
    mode = 'walk'
    walk_mode.enable()
  } else {
    mode = 'fly'
    walk_mode.disable()
    // resync the fly camera's stored pose to where walk mode left the camera (no jump on toggle)
    const stats = engine?.get_stats()
    if (stats) {
      state.position = [...stats.camera_position]
      ;[state.yaw, state.pitch] = stats.camera_yaw_pitch
    }
  }
})

canvas.addEventListener('click', () => {
  // Fly mode only: click to grab pointer-lock for mouse-look. Walk mode uses hold-LEFT-drag (its own
  // pointer-lock scheme), so a click there must NOT lock — it would swallow the walk rotate gesture.
  if (mode === 'fly' && document.pointerLockElement !== canvas) canvas.requestPointerLock()
})

window.addEventListener('mousemove', (e) => {
  if (mode !== 'fly') return // walk mode owns the mouse via its own pointer-lock rig
  if (document.pointerLockElement !== canvas) return
  state.yaw -= e.movementX * LOOK_SENSITIVITY
  state.pitch -= e.movementY * LOOK_SENSITIVITY
  const half_pi = Math.PI / 2 - 0.01
  state.pitch = Math.max(-half_pi, Math.min(half_pi, state.pitch))
  engine?.set_camera_orientation(state.yaw, state.pitch)
})

let last_frame_time = performance.now()
// [D185 rig lever] ?nocam=1 — the demo drives NOTHING (replicates a consumer that forgets the camera),
// so the engine's boot self-rescue is testable end-to-end. Never used outside the verify rig.
const nocam = new URLSearchParams(location.search).has('nocam')
if (!nocam)
  requestAnimationFrame(function drive_camera(now) {
    const dt = Math.min(0.1, (now - last_frame_time) / 1000)
    last_frame_time = now

    // ENG-8 walk mode owns the camera: the controller + shoulder rig push position/orientation/fov.
    if (engine && mode === 'walk' && walk_mode) {
      walk_mode.tick(dt)
      requestAnimationFrame(drive_camera)
      return
    }

    if (engine) {
      // ENGINE → STATE (the reverse of the push below): 'time of day' is a lil-gui field bound to
      // `state.time_of_day`, but tod can also change via a DIRECT engine call (devtools console, a
      // capture/automation script, `window.__engine.set_time_of_day(...)`) that never touches `state` —
      // the slider then goes stale, showing a value the world no longer matches. Pull the engine's live
      // value back every frame (the same get_stats() poll hud.js already runs) and force the controller
      // to redraw on a mismatch — cheap (one field read), a no-op while the slider itself is the only
      // driver (push then read-back agree, so updateDisplay() is skipped).
      const stats = engine.get_stats()
      if (typeof stats?.time_of_day === 'number' && stats.time_of_day !== state.time_of_day) {
        state.time_of_day = stats.time_of_day
        tod_controller?.updateDisplay()
      }

      if (keys.size > 0) {
        const speed = (keys.has('ShiftLeft') || keys.has('ShiftRight') ? MOVE_SPEED_FAST : MOVE_SPEED) * dt
        const forward = [Math.sin(state.yaw) * -1, 0, Math.cos(state.yaw) * -1]
        const right = [Math.cos(state.yaw), 0, -Math.sin(state.yaw)]

        const move = [0, 0, 0]
        if (keys.has('KeyW')) axpy(move, speed, forward)
        if (keys.has('KeyS')) axpy(move, -speed, forward)
        if (keys.has('KeyD')) axpy(move, speed, right)
        if (keys.has('KeyA')) axpy(move, -speed, right)
        if (keys.has('Space')) move[1] += speed
        if (keys.has('ControlLeft')) move[1] -= speed

        if (move[0] || move[1] || move[2]) {
          state.position = [state.position[0] + move[0], state.position[1] + move[1], state.position[2] + move[2]]
        }
      }

      // Push `state` (single source of truth) every frame — idempotent, 5 floats. This is what makes
      // the INITIAL pose apply the moment the async-created fly camera exists (see boot_engine note),
      // and keeps state authoritative across WASD moves + mouse-look without a separate "ready" hook.
      engine.set_camera_position(state.position)
      engine.set_camera_orientation(state.yaw, state.pitch)
    }

    requestAnimationFrame(drive_camera)
  })

/**
 * `out += scalar * vec` (in place, 3-component). Local helper — no vector-math dep per house
 * law (minimal deps).
 * @param {number[]} out
 * @param {number} scalar
 * @param {number[]} vec
 */
function axpy(out, scalar, vec) {
  out[0] += scalar * vec[0]
  out[1] += scalar * vec[1]
  out[2] += scalar * vec[2]
}

// ---- lil-gui control panel: seed / tier / time-of-day ------------------------------------
// Skipped when a full-page demo (?board=1 / ?cave=1) owns the page — no world seed/tier/tod panel there.

if (!OWNS_PAGE) {
  const gui = new GUI({ title: 'AresRPG Engine — Demo' })

  gui
    .add(state, 'seed')
    .name('seed')
    .onFinishChange(() => {
      const url = new URL(location.href)
      url.searchParams.set('seed', state.seed)
      history.replaceState(null, '', url)
      boot_engine()
    })

  gui
    .add(state, 'biome', ['default', ...WORLD_NAMES])
    .name('biome (world)')
    .onChange((value) => {
      const url = new URL(location.href)
      if (value === 'default') url.searchParams.delete('biome')
      else url.searchParams.set('biome', value)
      history.replaceState(null, '', url)
      boot_engine() // fresh engine → fresh far streamer → boot-burst refills the new world's shell fast
    })

  gui
    .add(state, 'tier', ['auto', ...TIER_ORDER])
    .name('tier override')
    .onChange((value) => {
      const url = new URL(location.href)
      url.searchParams.set('tier', value)
      history.replaceState(null, '', url)
      if (!engine) return
      try {
        // @ts-expect-error — set_tier(undefined) re-enables auto-governor per engine.js JSDoc.
        engine.set_tier(value === 'auto' ? undefined : value)
      } catch (error) {
        console.warn('[demo] set_tier failed:', error)
      }
    })

  tod_controller = gui
    .add(state, 'time_of_day', 0, 1, 0.001)
    .name('time of day')
    .onChange((value) => {
      // set_time_of_day is a no-op until M3 WS5 lands (engine.js warns to console itself).
      engine?.set_time_of_day(value)
    })

  gui.add({ reload: boot_engine }, 'reload').name('reload world')
}

// NOTE: the demo does NOT handle resize and MUST NEVER mutate canvas.width/height — doing so
// resizes only the WebGPU swapchain while three's depth texture stays stale, desyncing the
// color and depth attachments → invalid render pass → black screen (the live bug this fixed).
// The renderer is the single owner of resize: it attaches a ResizeObserver on the canvas and
// routes every setSize (boot, resize, device-loss reinit) through one call site with a capped
// dpr of 2. See src/core/renderer.js `apply_size`.
