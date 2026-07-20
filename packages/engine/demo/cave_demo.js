// D141 — CAVE ROOM DEMO HARNESS (?cave=1). 2026-07-04.
//
// Boots the engine into an ISOLATED, generated cave dungeon room (no outdoor world streaming) and drops
// the player inside in WALK mode. This is the acceptance surface for the cave-room generator:
//   • ?cave=1            → walk the generated room (spawn inside, mouse-look + arrows/WASD);
//   • ?cave=1&board=1    → ALSO mount the tactical fightboard at the room's board_anchor (the MVP fight
//                          scene — the money shot: a real board on the real cave floor under god-rays);
//   • ?seed=N            → reseed the room (deterministic; same seed ⇒ identical room);
//   • time-of-day is pinned to 0.45 (sun near-vertical) so the ceiling-hole god-ray shafts read.
//
// The engine boots with synthetic_chunks:0 → the streaming ring is NULL (no outdoor terrain fights the
// room) but the renderer + atmosphere (froxel god rays) are live. The cave scene uploads its standalone
// chunk set straight into the terrain pool and feeds the froxel voxel-sun its records. Walk collision is
// wired to the ROOM's own sample_block (engine.sample_block is air with the ring off).
//
// Exposes window.__cave / window.__engine / window.__board for the bench spec to drive under automation.

import { create_engine } from '../src/engine.js'
import { create_cave_room } from '../src/scene/cave_scene.js'
import { create_tactical_board } from '../src/tactical/index.js'

import { create_walk_mode } from './walk_mode.js'

/** Sun phase with the sun near-vertical (sky_node: peak at 0.375; 0.45 is high + slightly past noon so
 *  shafts fall steeply through ceiling holes). See the froxel study — enclosure fog is tod-independent,
 *  so beams survive midday provided the occupancy volume is populated (the cave scene does that). */
const CAVE_TOD = 0.45

/**
 * Boots the cave demo. Wires everything onto the page + window. Returns nothing.
 * @param {HTMLCanvasElement} canvas
 * @param {HTMLDivElement} gate
 * @param {URLSearchParams} params
 */
export async function boot_cave_demo(canvas, gate, params) {
  gate.dataset.hidden = 'false'
  gate.textContent = 'Generating cave room…'

  const with_board = params.get('board') === '1'
  const seed = params.get('seed') ? Number(params.get('seed')) : undefined

  // synthetic_chunks:0 → ring_manager stays null (no outdoor streaming) but the renderer + froxel
  // atmosphere still boot. The cave is the ONLY geometry in the scene.
  const engine = create_engine({ canvas, tier: 'high', synthetic_chunks: 0 })
  // [D213] the overworld HEIGHT FOG saturates pale-blue at cave depth (the room sits under the fog
  // base) and washed the interior — an enclosed scene pushes the fog range out of reach; the cave's
  // mood comes from the dark light BFS + the sun shafts, not aerial haze. (cto's cave_session mirrors
  // this line.)
  engine.set_fog_scale?.(0) // [D213-B] the height fog is range-immune — the master gate is the only true kill
  const w = /** @type {any} */ (window)
  w.__engine = engine
  engine.on('boot_error', (error) => {
    gate.dataset.hidden = 'false'
    gate.textContent = `Engine not ready: ${/** @type {Error} */ (error)?.message ?? error}`
  })
  engine.start()
  engine.set_time_of_day(CAVE_TOD)

  // Generate + mount the room (async — waits for the renderer to boot, then meshes/uploads/wires).
  const cave = create_cave_room({ seed })
  w.__cave = cave
  await cave.mount(engine)
  gate.dataset.hidden = 'true'

  if (with_board) {
    // ?cave=1&board=1 — mount the tactical board on the room's flat central floor. This is the MVP
    // fight scene. The board's origin (cell (0,0) min corner, y = floor) IS the room's board_anchor.
    const [ax, ay, az] = cave.board_anchor
    const board = create_tactical_board({ engine, canvas, default_origin: { x: ax, y: ay, z: az } })
    w.__board = board
    // [D231 — grids must never render as a plain square with no holes or obstacles; shape is
    // deterministically derived from the move module] the demo now exercises the full spec the dapp feeds from its
    // deterministic grid: an IRREGULAR shape (corner voids), holes, obstacles — never a bare square.
    const grid_w = 14
    const grid_h = 16
    const voids = []
    for (let x = 0; x < grid_w; x += 1) {
      for (let y = 0; y < grid_h; y += 1) {
        // chamfer the four corners into an octagon-ish arena (Manhattan cut, depth 4)
        const d = Math.min(x + y, grid_w - 1 - x + y, x + (grid_h - 1 - y), grid_w - 1 - x + (grid_h - 1 - y))
        if (d < 4) voids.push({ x, y })
      }
    }
    const obstacles = [
      { x: 5, y: 6 },
      { x: 8, y: 9 },
      { x: 6, y: 11 },
      { x: 9, y: 5 },
    ]
    const holes = [
      { x: 4, y: 9 },
      { x: 10, y: 7 },
    ]
    await board.build({ grid_w, grid_h, voids, obstacles, holes, flat: true }) // [D238] cave boards never follow terrain
    // Two placeholder entities so the fight scene reads (a player + a mob) on opposite ends.
    board.entity_upsert({ id: 'p1', kind: 'player', cell: { x: 4, y: 4 }, facing: 'north' })
    board.entity_upsert({ id: 'm1', kind: 'mob', cell: { x: grid_w - 5, y: grid_h - 5 }, facing: 'south' })
    // [D241 palette gate] mp_range = LIGHT GREEN (MP reach), path = DARK GREEN (steered route),
    // target = DARK BLUE, los_blocked = LIGHT BLUE, aoe = RED — all five distinct hues in one frame.
    board.highlight('mp_range', ring_cells({ x: 4, y: 4 }, 3, grid_w, grid_h), true)
    board.highlight(
      'path',
      [
        { x: 4, y: 5 },
        { x: 4, y: 6 },
        { x: 5, y: 6 },
        { x: 5, y: 7 },
      ],
      true
    )
    board.highlight('target', [{ x: grid_w - 5, y: grid_h - 5 }], true)
    board.highlight('los_blocked', [{ x: grid_w - 6, y: grid_h - 6 }], true)
    board.highlight(
      'aoe',
      [
        { x: 8, y: 8 },
        { x: 9, y: 8 },
        { x: 8, y: 9 },
      ],
      true
    )
    // DO NOT camera_lock(): the board's locked-iso rig dollies ~30 m back at 50° polar, which flies the
    // camera OUT through the 27 m-tall cave roof (it would frame open sky, not the board in the room). And
    // a HEAD-ON pose (behind the board, straight down its short axis) looks THROUGH the glow-mushroom
    // clusters the generator seeds in the strip just past the board region — they occlude the frame
    // (ENG-17: verified in bench — a mushroom cap filled centre-frame, the board hidden behind it).
    // Instead frame a fixed CORNER-ISO pose INSIDE the cave: elevated at the board's +X/+Z corner, angled
    // down the board diagonal toward its centre (~classic 2:1 iso). It stays under the low roof, clears the
    // décor line-of-sight, and reads as the ref1 "board-in-world" fight shot — walls + glow surrounding a
    // tactical grid with the acting entity + selection diamond on it. (The real dapp gives the board its
    // own scene sized for the iso rig; here the point is the board sitting on the real cave floor.)
    const cs = 1.33 // [D231] DEFAULT_CELL_SIZE (−33%) — the pose math scales with it
    const bcx = ax + (grid_w * cs) / 2 // board centre X
    const bcz = az + (grid_h * cs) / 2 // board centre Z
    const corner = 9 // metres past the +X/+Z board corner (clear of the smaller footprint + décor)
    const px = ax + grid_w * cs + corner
    const pz = az + grid_h * cs + corner
    engine.set_camera_position([px, ay + 10, pz])
    // engine yaw 0 = −Z, forward = (−sin yaw, −cos yaw) (camera_rig.js); face camera→board-centre.
    engine.set_camera_orientation(Math.atan2(px - bcx, pz - bcz), -0.42)
    engine.set_camera_fov(66)
    return
  }

  // Walk mode: spawn the player INSIDE the room, collision wired to the room's own sample_block.
  const [sx, sy, sz] = cave.player_spawn
  const walk = create_walk_mode({
    engine,
    canvas,
    spawn_xz_y: [sx, sy, sz], // the generator's guaranteed-clear stand, used VERBATIM
    sample_block: cave.sample_block,
    exact_spawn: true, // [D213] enclosed room: never sky-scan (the scan lands on the ROOF)
  })
  w.__walk_mode = walk
  walk.enable()

  // Drive walk mode + face the player toward the room centre so the interior fills the view on load.
  let last = performance.now()
  const loop = (/** @type {number} */ now) => {
    const dt = Math.min(0.1, (now - last) / 1000)
    last = now
    walk.tick(dt)
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)

  mount_hint_overlay(with_board)
}

/** Cells within Chebyshev radius r of `c`, in-bounds — a crude move-range wash for the board demo. */
function ring_cells(
  /** @type {{x:number,y:number}} */ c,
  /** @type {number} */ r,
  /** @type {number} */ w,
  /** @type {number} */ h
) {
  /** @type {{x:number,y:number}[]} */
  const out = []
  for (let y = c.y - r; y <= c.y + r; y += 1)
    for (let x = c.x - r; x <= c.x + r; x += 1) if (x >= 0 && y >= 0 && x < w && y < h) out.push({ x, y })
  return out
}

/** A small gothic-terminal hint overlay (top-left) for the walk demo. */
function mount_hint_overlay(/** @type {boolean} */ _with_board) {
  const el = document.createElement('div')
  el.style.cssText = [
    'position:fixed',
    'top:12px',
    'left:12px',
    'z-index:50',
    'max-width:44ch',
    'font:11px/1.5 "JetBrains Mono", ui-monospace, monospace',
    'color:#c8963c',
    'background:rgba(10,10,15,0.72)',
    'border:1px solid #1e1e2e',
    'padding:8px 10px',
    'letter-spacing:0.06em',
    'text-transform:uppercase',
    'white-space:pre',
  ].join(';')
  el.textContent = [
    '› CAVE DUNGEON ROOM',
    '› WASD / arrows to walk · mouse-drag to look',
    '› glow mushrooms · ceiling shafts · lava ravine',
    '› ?cave=1&board=1 for the fight scene',
  ].join('\n')
  document.body.appendChild(el)
}
