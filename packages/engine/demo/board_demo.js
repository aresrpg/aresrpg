// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ENG-16 Phase B — TACTICAL BOARD DEMO HARNESS (?board=1).
//
// Boots the engine, then mounts a test tactical fightboard over the flat cave-floor pose and drives it
// through the full acceptance surface for pixel/interaction verification:
//   • a 12×10 mask with HOLES + OBSTACLES (a non-rectangular playable shape, D75) + 2 dummy entities;
//   • a log overlay printing raw cell_click/cell_hover/entity_hover events (with cell coords) and beat
//     IMPACT timestamps (proving impact ≠ end-of-clip — the W4 keystone);
//   • highlight channels painted in distinct colors (placement/range/path/target washes);
//   • the locked-iso camera engaged (polar ~50°, azimuth-draggable, dolly ∝ span).
// It exposes window.__board (+ window.__engine) so the bench spec can drive it under automation
// (pointer lock / real pointer input is fiddly headless, so the spec calls the handle directly).
//
// This is a DEMO surface only — the real dapp mounts create_tactical_board itself via the adapter.
// 2026-07-04.

import { create_engine } from '../src/engine.js'
import { create_tactical_board, TEAM_COLORS } from '../src/tactical/index.js'
import { ground_surface_y } from '../src/player/spawn.js'

/** The demo board mask: 12×10, row-major (index = x + y*12). 0 floor / 1 obstacle / 2 hole. A ragged
 *  shape with a hole cluster mid-board, a couple of obstacle pillars, and a notched corner — nothing a
 *  rectangle assumption would survive (D75). */
const DEMO_W = 12
const DEMO_H = 10
function build_demo_mask() {
  const m = new Uint8Array(DEMO_W * DEMO_H) // all floor
  const set = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ v) => {
    if (x >= 0 && y >= 0 && x < DEMO_W && y < DEMO_H) m[x + y * DEMO_W] = v
  }
  // hole cluster (a pit the players must path around) — a 2×2 gap + a diagonal tail
  set(5, 4, 2)
  set(6, 4, 2)
  set(5, 5, 2)
  set(6, 5, 2)
  set(7, 5, 2)
  set(4, 5, 2)
  // obstacle pillars (raised blocking blocks)
  set(2, 2, 1)
  set(2, 3, 1)
  set(9, 6, 1)
  set(9, 7, 1)
  set(3, 8, 1)
  // notch the top-right corner into void (holes) so the frame is not a rectangle
  set(11, 0, 2)
  set(11, 1, 2)
  set(10, 0, 2)
  return m
}

// [capture] ?board=1&variant=N — a CLEAN substrate capture of a REAL on-chain board shape
// (dumped verbatim from the frontend's generateGrid twin, byte-identical to board.move): 0 = an ELLIPSE
// (organic), 1 = a BLOB (organic), 2 = a PERFECT RECTANGLE (the "still super square" case — evidence the
// square read is on-chain, not presentation). '.' floor · '#' obstacle · 'O' hole · ' ' void (off-shape →
// rendered as nothing so the organic silhouette reads). Used only by the presentation proof captures.
const CAPTURE_BOARDS = [
  // ELLIPSE seed 2024 — 14x11, obs=6 holes=4
  {
    w: 14,
    h: 11,
    rows: [
      '    ......    ',
      '  ..........  ',
      ' .....#...... ',
      '........O.....',
      '...#.O......O.',
      '.O........#...',
      '........#.....',
      '......#.......',
      ' ..#......... ',
      '  ..........  ',
      '    ......    ',
    ],
  },
  // BLOB seed 90210 — 12x13, obs=6 holes=4
  {
    w: 12,
    h: 13,
    rows: [
      '  ..........',
      ' ...O.......',
      '............',
      '............',
      '............',
      '............',
      '.#.#..O.....',
      '........#...',
      '............',
      '.#....O.....',
      '....#...O...',
      ' .....#.....',
      '  ..........',
    ],
  },
  // RECT seed 42 — 16x10, obs=4 holes=2 (a literal bounding rectangle — the on-chain "super square" read)
  {
    w: 16,
    h: 10,
    rows: [
      '................',
      '................',
      '................',
      '....#...........',
      '................',
      '.....#........#.',
      '................',
      '.............O..',
      '......#....O....',
      '................',
    ],
  },
]

/** Parse an ASCII CAPTURE_BOARDS entry into the build() cell lists (obstacles/holes/voids). */
function parse_ascii_board(/** @type {{w:number,h:number,rows:string[]}} */ b) {
  const obstacles = /** @type {{x:number,y:number}[]} */ ([])
  const holes = /** @type {{x:number,y:number}[]} */ ([])
  const voids = /** @type {{x:number,y:number}[]} */ ([])
  for (let y = 0; y < b.h; y += 1) {
    const row = b.rows[y] ?? ''
    for (let x = 0; x < b.w; x += 1) {
      const ch = row[x] ?? ' '
      if (ch === '#') obstacles.push({ x, y })
      else if (ch === 'O') holes.push({ x, y })
      else if (ch === ' ') voids.push({ x, y })
    }
  }
  return { w: b.w, h: b.h, obstacles, holes, voids }
}

/** obstacle / hole cell lists derived from the mask (build() takes them as Cell[] per the v1.1 contract). */
function mask_to_lists(/** @type {Uint8Array} */ m) {
  /** @type {{x:number,y:number}[]} */
  const obstacles = []
  /** @type {{x:number,y:number}[]} */
  const holes = []
  for (let y = 0; y < DEMO_H; y += 1)
    for (let x = 0; x < DEMO_W; x += 1) {
      const v = m[x + y * DEMO_W]
      if (v === 1) obstacles.push({ x, y })
      else if (v === 2) holes.push({ x, y })
    }
  return { obstacles, holes }
}

/**
 * Boots the board demo. Returns nothing — wires everything onto the page + window.
 * @param {HTMLCanvasElement} canvas
 * @param {HTMLDivElement} gate
 */
export async function boot_board_demo(canvas, gate) {
  gate.dataset.hidden = 'false'
  gate.textContent = 'Booting tactical board…'

  const engine = create_engine({ canvas, tier: 'high' })
  const w = /** @type {any} */ (window)
  w.__engine = engine
  engine.on('boot_error', (error) => {
    gate.dataset.hidden = 'false'
    gate.textContent = `Engine not ready: ${/** @type {Error} */ (error)?.message ?? error}`
  })
  engine.start()
  engine.set_time_of_day(0.28)

  // D167-B — GROUND THE BOARD ON REAL TERRAIN IN A FORESTED SPOT (the acceptance surface): the board no
  // longer floats in open sky. We pick a wooded site near spawn (the schematic forests live around here),
  // fly the camera over it so the streaming ring resolves the ground + trees, wait for residency, read
  // the surface height, then mount — the board seats itself ON the land per cell (subtle stepped relief)
  // and the feathered occlusion dissolves any canopy standing between the iso camera and the arena.
  // Site (220,220): a lightly-wooded gentle rise (probed: ~⅓ canopy, ground spread ~4 blocks) — enough
  // trees standing between the iso camera and the arena to prove the feathered dissolve, gaps enough that
  // the camera isn't walled into a solid canopy, and a subtle slope so the board's terrain-following
  // stepped floor is readable. The real game path mounts on the cave floor (D142); this is a demo site.
  const SITE_X = 220
  const SITE_Z = 220
  const board = create_tactical_board({ engine, canvas, default_origin: { x: SITE_X, y: 200, z: SITE_Z } })
  w.__board = board

  // [capture] ?variant=N — mount ONE real on-chain board shape (voids carve the organic
  // outline) on a clean open-sky flat pose, no entities/highlights/log, then lock the iso cam and stop. The
  // presentation proof screenshots this: dark-void holes, half-height blocks, the true silhouette per shape.
  const VARIANT = new URLSearchParams(location.search).get('variant')
  if (VARIANT !== null) {
    const b = parse_ascii_board(CAPTURE_BOARDS[Number(VARIANT)] ?? CAPTURE_BOARDS[0])
    const origin = { x: SITE_X, y: 220, z: SITE_Z }
    engine.set_camera_position([SITE_X + b.w, origin.y + 10, SITE_Z + b.h + 12])
    engine.set_camera_orientation(Math.PI, -0.5)
    await board.build({
      grid_w: b.w,
      grid_h: b.h,
      obstacles: b.obstacles,
      holes: b.holes,
      voids: b.voids,
      flat: true,
      anchor: { origin },
    })
    gate.dataset.hidden = 'true'
    board.camera_lock()
    w.__capture_ready = true
    return
  }
  // ?board=1&flat=1 — a CLEAN open-sky pose (no terrain grounding, no grass crowding the shot) for
  // verifying the substrate itself (dark-shaft holes + real obstacle props). Mirrors the flat cave-fight
  // path; the default (grounded) still seats the board ON real land at the wooded site.
  const FLAT = new URLSearchParams(location.search).has('flat')

  const log = mount_log_overlay()

  // raw event wiring → log overlay (the engine reports WHAT; the demo just prints it).
  board.on('cell_click', (cell) => log(`click  ${fmt_cell(cell)}`))
  board.on('cell_hover', (cell) => log(`hover  ${fmt_cell(cell)}`, true))
  board.on('entity_hover', (id) => log(`entity ${id ?? '—'}`, true))

  const board_cx = SITE_X + (DEMO_W * 2) / 2
  const board_cz = SITE_Z + (DEMO_H * 2) / 2
  let ORIGIN
  if (FLAT) {
    // Open-sky flat board — no streaming, no grounding; just aim the fly cam at a high origin and mount.
    ORIGIN = { x: SITE_X, y: 220, z: SITE_Z }
    engine.set_camera_position([board_cx, ORIGIN.y + 10, board_cz + 12])
    engine.set_camera_orientation(Math.PI, -0.5)
  } else {
    // Point the fly camera at the site so the ring streams terrain+trees there, then WAIT for the ground
    // under the board footprint to become resident (sample_block returns non-air) before mounting — the
    // grounding samples the real land at build() time, so it must be streamed first.
    engine.set_camera_position([board_cx, 175, board_cz + 40])
    engine.set_camera_orientation(Math.PI, -0.5)
    gate.textContent = 'Streaming the fight site…'
    const surface_y = await wait_for_ground(engine, Math.floor(board_cx), Math.floor(board_cz), gate)
    ORIGIN = { x: SITE_X, y: surface_y, z: SITE_Z }
  }

  const mask = build_demo_mask()
  const { obstacles, holes } = mask_to_lists(mask)

  // BUILD (async — await the mount before painting, per the contract). anchor.origin re-seats the board;
  // grounded ⇒ build_board_geometry samples per-cell ground for the relief; flat ⇒ open-sky flat board.
  await board.build({ grid_w: DEMO_W, grid_h: DEMO_H, obstacles, holes, flat: FLAT, anchor: { origin: ORIGIN } })
  gate.dataset.hidden = 'true'

  // lock the iso camera onto the board CENTROID (the rig defaults to it).
  board.camera_lock()

  // Two TEAMS, two fighters each — every entity gets a TEAM-COLORED OUTLINE (every entity should
  // have an outline in fights) and its cell an inner glowing team-seat ring. ally = ice-blue, enemy = red.
  board.entity_upsert({ id: 'p1', kind: 'player', cell: { x: 1, y: 1 }, facing: 'south', outline: TEAM_COLORS.ally })
  board.entity_upsert({ id: 'p2', kind: 'player', cell: { x: 2, y: 1 }, facing: 'south', outline: TEAM_COLORS.ally })
  board.entity_upsert({ id: 'm1', kind: 'mob', cell: { x: 10, y: 8 }, facing: 'north', outline: TEAM_COLORS.enemy })
  board.entity_upsert({ id: 'm2', kind: 'mob', cell: { x: 9, y: 8 }, facing: 'north', outline: TEAM_COLORS.enemy })
  // TEAM SEAT GLOW — the inner ring under each fighter's cell, painted OVER the range/target washes below to
  // prove the HOLLOW ring never washes them out (the fill still reads through the transparent middle).
  board.set_cell_state(
    [
      { x: 1, y: 1 },
      { x: 2, y: 1 },
    ],
    'ally_seat'
  )
  board.set_cell_state(
    [
      { x: 10, y: 8 },
      { x: 9, y: 8 },
    ],
    'enemy_seat'
  )

  // D150 — showcase ALL FOUR owner highlight classes SIMULTANEOUSLY on distinct cell groups, one design
  // language (inner gradient + rounded corners), so the palette + shape read for verification:
  //   • MOVEMENT (dark blue): the move reach around p1 (range) + a lighter mp_range band.
  //   • TARGETABLE (dark blue): a ring of cells we could target.
  //   • LOS_BLOCKED (light blue): a few cells where line-of-sight is required and the cell is non-targetable.
  //   • AOE (red): a cross footprint under a SIMULATED spell-cursor hover (see the moving hover loop below).
  // Plus the supporting house channels: ally/enemy spawns, committed path, selection diamond.
  board.highlight('range', ring_cells({ x: 1, y: 1 }, 2, mask), true) // dark-blue move reach around p1
  board.highlight(
    'mp_range',
    ring_cells({ x: 1, y: 1 }, 3, mask).filter((c) => !(Math.abs(c.x - 1) <= 2 && Math.abs(c.y - 1) <= 2)),
    true
  ) // outer MP band (lighter blue)
  board.highlight(
    'start_a',
    [
      { x: 1, y: 1 },
      { x: 0, y: 1 },
      { x: 1, y: 0 },
    ],
    true
  ) // ally spawn — blue
  board.highlight(
    'start_b',
    [
      { x: 10, y: 8 },
      { x: 10, y: 9 },
      { x: 11, y: 8 },
    ],
    true
  ) // enemy spawn — orange
  // TARGETABLE ring (dark blue) — cells the spell can reach around a focus point.
  board.highlight('target', ring_ring({ x: 8, y: 2 }, 2, mask), true)
  // LOS_BLOCKED (light blue) — cells behind the obstacle pillars where LoS is required but the cell is
  // non-targetable (line of sight is broken by the raised blocks at (2,2)/(2,3) & (9,6)/(9,7)).
  board.highlight(
    'los_blocked',
    [
      { x: 1, y: 2 },
      { x: 1, y: 3 },
      { x: 0, y: 2 },
      { x: 8, y: 7 },
      { x: 8, y: 6 },
      { x: 10, y: 6 },
    ],
    true
  )
  board.highlight(
    'path',
    [
      { x: 1, y: 2 },
      { x: 1, y: 3 },
      { x: 2, y: 4 },
      { x: 3, y: 4 },
    ],
    true
  ) // blue path
  board.highlight('selection', [{ x: 1, y: 1 }], true) // white/blue diamond under the acting entity

  // AoE HOVER (red): a moving spell-cursor zone. A cross (+) footprint follows a hovered center that
  // sweeps across the board, re-painting the 'aoe' channel each hop (proving the zone tracks the cursor).
  start_aoe_hover(board, mask)

  log('board mounted — 12×10, holes+obstacles, 2 entities')
  log('press SPACE: p1 walks a 6-waypoint path')
  log('press A: m1 plays ATTACK (watch IMPACT vs end)')

  // Interactions: SPACE = walk, A = attack beat (logs impact-vs-end timing).
  window.addEventListener('keydown', async (e) => {
    if (e.code === 'Space') {
      e.preventDefault()
      const path = [
        { x: 2, y: 1 },
        { x: 3, y: 1 },
        { x: 4, y: 2 },
        { x: 4, y: 3 },
        { x: 4, y: 4 },
        { x: 3, y: 4 },
      ]
      board.highlight('path', path, true)
      log(`p1 walk start (6 waypoints @ 4 cells/s)`)
      const t0 = performance.now()
      await board.entity_move('p1', path, { cells_per_second: 4 })
      log(`p1 walk landed (+${((performance.now() - t0) / 1000).toFixed(2)}s)`)
    }
    if (e.code === 'KeyA') {
      const t0 = performance.now()
      log('m1 ATTACK start (clip ~1.97s; impact at ~0.45)')
      const done = board.entity_beat('m1', { anim: 'attack', float: { text: '-142', kind: 'damage' } })
      done.then(() =>
        log(`m1 ATTACK impact resolved (+${((performance.now() - t0) / 1000).toFixed(3)}s ≪ clip end 1.97s)`)
      )
    }
    if (e.code === 'KeyH') {
      // demo the LOUDNESS path: an unmapped beat anim → console.error + midpoint resolve.
      const t0 = performance.now()
      board
        .entity_beat('m1', { anim: 'nonexistent_anim' })
        .then(() =>
          log(
            `m1 unmapped-beat resolved at MIDPOINT (+${((performance.now() - t0) / 1000).toFixed(3)}s) — see console.error`
          )
        )
    }
  })
}

/** Cells within Chebyshev radius r of `c` that are walkable in the mask (a crude move-range demo). */
function ring_cells(/** @type {{x:number,y:number}} */ c, /** @type {number} */ r, /** @type {Uint8Array} */ mask) {
  /** @type {{x:number,y:number}[]} */
  const out = []
  for (let y = c.y - r; y <= c.y + r; y += 1)
    for (let x = c.x - r; x <= c.x + r; x += 1) {
      if (x < 0 || y < 0 || x >= DEMO_W || y >= DEMO_H) continue
      if (mask[x + y * DEMO_W] !== 0) continue // only floor
      out.push({ x, y })
    }
  return out
}

/** The hollow RING (Chebyshev shell at exactly radius r) of walkable cells around `c` — a targetable
 *  outline, distinct from the filled ring_cells disc. @param {{x:number,y:number}} c @param {number} r
 *  @param {Uint8Array} mask @returns {{x:number,y:number}[]} */
function ring_ring(c, r, mask) {
  /** @type {{x:number,y:number}[]} */
  const out = []
  for (let y = c.y - r; y <= c.y + r; y += 1)
    for (let x = c.x - r; x <= c.x + r; x += 1) {
      if (Math.max(Math.abs(x - c.x), Math.abs(y - c.y)) !== r) continue // shell only
      if (x < 0 || y < 0 || x >= DEMO_W || y >= DEMO_H) continue
      if (mask[x + y * DEMO_W] !== 0) continue
      out.push({ x, y })
    }
  return out
}

/** A plus/cross AoE footprint (center + 4 orthogonal neighbours) clipped to walkable cells. @param
 *  {{x:number,y:number}} c @param {Uint8Array} mask @returns {{x:number,y:number}[]} */
function aoe_cross(c, mask) {
  const cells = [c, { x: c.x - 1, y: c.y }, { x: c.x + 1, y: c.y }, { x: c.x, y: c.y - 1 }, { x: c.x, y: c.y + 1 }]
  return cells.filter((p) => p.x >= 0 && p.y >= 0 && p.x < DEMO_W && p.y < DEMO_H && mask[p.x + p.y * DEMO_W] === 0)
}

/** Drives the RED AoE hover zone: a cross footprint that hops across a sweep of walkable centers every
 *  ~700 ms, re-painting the 'aoe' channel so the zone visibly TRACKS a simulated spell cursor (the D150
 *  bench video subject). Exposed on window.__aoe_hover so the bench can pin/step it. @param {any} board
 *  @param {Uint8Array} mask */
function start_aoe_hover(board, mask) {
  // a hand-picked sweep of open cells the cross can sit on without falling in the pit.
  const sweep = [
    { x: 3, y: 6 },
    { x: 3, y: 7 },
    { x: 4, y: 7 },
    { x: 6, y: 8 },
    { x: 7, y: 7 },
    { x: 8, y: 6 },
    { x: 8, y: 5 },
  ]
  let i = 0
  const paint = (/** @type {number} */ idx) => {
    const c = sweep[((idx % sweep.length) + sweep.length) % sweep.length]
    board.set_cell_state(aoe_cross(c, mask), 'aoe') // set_cell_state REPLACES the channel each hop
    return c
  }
  paint(0)
  const timer = setInterval(() => paint(++i), 700)
  const hover = {
    step: () => paint(++i),
    goto: (/** @type {number} */ n) => paint((i = n)),
    stop: () => clearInterval(timer),
  }
  const win = /** @type {any} */ (window)
  win.__aoe_hover = hover
}

/** D167-B — poll the streaming ring until the GROUND surface at (x,z) is FULLY resident + stable, then
 *  return its top-face world Y (feet plane). The column streams progressively: a naive top-down scan can
 *  briefly latch a deep underground pocket before the surface chunk arrives (measured: origin_y=32 while
 *  the real surface was 127). Guard against that by (1) requiring the UPPER column to be resident (air at
 *  a high sentinel proves the surface layer streamed, not just a deep cave) and (2) requiring the surface
 *  read to REPEAT identically across a few frames before trusting it. Falls back to SEA_LEVEL+2 on
 *  timeout. @param {import('../src/engine.js').EngineApi} engine @param {number} x @param {number} z
 *  @param {HTMLDivElement} gate @returns {Promise<number>} */
async function wait_for_ground(engine, x, z, gate) {
  const DEADLINE = 30000
  const HIGH_SENTINEL = 190 // well above any terrain near spawn — air here ⇒ the top column is resident
  const t0 = performance.now()
  const block_at = (/** @type {number} */ bx, /** @type {number} */ by, /** @type {number} */ bz) =>
    engine.sample_block(bx, by, bz)
  let last = null
  let stable = 0
  while (performance.now() - t0 < DEADLINE) {
    // the upper column must be air (surface chunk streamed) AND a solid must exist somewhere below it,
    // so the top-down scan lands on the real surface, not a not-yet-covered deep pocket.
    const top_air = block_at(x, HIGH_SENTINEL, z) === 0
    const surf = top_air ? ground_surface_y(block_at, x, z) : null
    if (surf !== null) {
      if (surf === last) stable += 1
      else {
        last = surf
        stable = 0
      }
      if (stable >= 3) return surf + 1 // top face — the board floor sits here
    }
    gate.textContent = `Streaming the fight site… ${((performance.now() - t0) / 1000).toFixed(0)}s`
    await new Promise((r) => requestAnimationFrame(r))
  }
  return last !== null ? last + 1 : 130 // best stable read, else SEA_LEVEL(128)+2 — never hang
}

const fmt_cell = (/** @type {{x:number,y:number}|null} */ c) => (c ? `(${c.x}, ${c.y})` : 'null')

/** A small gothic-terminal log overlay (top-left), returns a log(text, is_hover?) fn. Hover lines
 *  replace the previous hover line (no spam); event/beat lines append + scroll. */
function mount_log_overlay() {
  const el = document.createElement('div')
  el.style.cssText = [
    'position:fixed',
    'top:12px',
    'left:12px',
    'z-index:50',
    'max-width:44ch',
    'max-height:60vh',
    'overflow:hidden',
    'font:11px/1.5 "JetBrains Mono", ui-monospace, monospace',
    'color:#c8963c',
    'background:rgba(10,10,15,0.72)',
    'border:1px solid #1e1e2e',
    'padding:8px 10px',
    'letter-spacing:0.06em',
    'text-transform:uppercase',
    'white-space:pre',
  ].join(';')
  document.body.appendChild(el)
  /** @type {string[]} */
  const lines = []
  let hover_line = ''
  const render = () => {
    el.textContent = [...lines.slice(-14), hover_line].filter(Boolean).join('\n')
  }
  return (/** @type {string} */ text, /** @type {boolean} */ is_hover = false) => {
    if (is_hover) hover_line = `· ${text}`
    else lines.push(`› ${text}`)
    render()
  }
}
