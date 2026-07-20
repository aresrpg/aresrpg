// TEAM READ DEMO (?team=1) — a CLEAN verification surface for the fight team-read features:
//   • every entity gets a TEAM-COLORED OUTLINE (inverted hull) — ally ice-blue, enemy red;
//   • every fighter's CELL gets a SQUARED, team-colored marker (entity-anchor: subtle fill + crisp
//     edge outline — replaces the earlier barely-visible round blob, 2026-07-11 revision);
//   • a move-reach + cast-target wash painted UNDER the markers proves they never wash the gameplay
//     washes out.
// Unlike board_demo (?board=1), the board is FLAT + in open SKY (flat:true, high origin) — no terrain grass
// occluding the entities — so the outline + rings read cleanly for a screenshot. This mirrors the REAL game
// path (every dungeon fight is a flat cave board, flat:true). Exposes window.__board / window.__engine.

import { create_engine } from '../src/engine.js'
import { create_tactical_board, TEAM_COLORS } from '../src/tactical/index.js'

const W = 8
const H = 7
// ally team 0 (ice-blue) on the south band, enemy team 1 (red) on the north band — facing each other.
const ALLIES = [
  { x: 2, y: 4 },
  { x: 3, y: 5 },
]
const ENEMIES = [
  { x: 5, y: 2 },
  { x: 4, y: 1 },
]

/**
 * Boots the team-read demo. @param {HTMLCanvasElement} canvas @param {HTMLDivElement} gate
 */
export async function boot_team_demo(canvas, gate) {
  gate.dataset.hidden = 'false'
  gate.textContent = 'Booting team-read board…'

  const engine = create_engine({ canvas, tier: 'high' })
  const w = /** @type {any} */ (window)
  w.__engine = engine
  engine.on('boot_error', (error) => {
    gate.dataset.hidden = 'false'
    gate.textContent = `Engine not ready: ${/** @type {Error} */ (error)?.message ?? error}`
  })
  engine.start()
  engine.set_time_of_day(0.32) // late-morning key light so the outlines read against the sky

  // A FLAT board floating in open sky (no terrain grounding → no grass to occlude the fighters). build()
  // awaits the engine boot internally, so no manual wait-for-ground is needed.
  const ORIGIN = { x: 40, y: 220, z: 40 }
  const board = create_tactical_board({ engine, canvas, default_origin: ORIGIN })
  w.__board = board

  engine.set_camera_position([ORIGIN.x + (W * 1.33) / 2, ORIGIN.y + 10, ORIGIN.z + (H * 1.33) / 2 + 12])
  engine.set_camera_orientation(Math.PI, -0.5)

  await board.build({
    grid_w: W,
    grid_h: H,
    obstacles: [{ x: 5, y: 4 }],
    holes: [],
    flat: true,
    anchor: { origin: ORIGIN },
  })
  gate.dataset.hidden = 'true'
  board.camera_lock()

  // fighters — every one carries a team-colored outline.
  ALLIES.forEach((c, i) =>
    board.entity_upsert({ id: `a${i}`, kind: 'player', cell: c, facing: 'north', outline: TEAM_COLORS.ally })
  )
  ENEMIES.forEach((c, i) =>
    board.entity_upsert({ id: `e${i}`, kind: 'mob', cell: c, facing: 'south', outline: TEAM_COLORS.enemy })
  )

  // gameplay washes UNDER the cell markers (prove they never wash each other out): a green move reach
  // around ally a0 (including its own cell), and a blue cast-target on enemy e0's cell.
  board.set_cell_state(
    [
      { x: 1, y: 4 },
      { x: 2, y: 4 },
      { x: 3, y: 4 },
      { x: 2, y: 3 },
      { x: 2, y: 5 },
    ],
    'mp_range'
  )
  board.set_cell_state(
    [
      { x: 5, y: 2 },
      { x: 5, y: 3 },
      { x: 6, y: 2 },
    ],
    'target'
  )

  // SQUARED CELL MARKERS — the "cell under a fighter" live marker (entity-anchor), team-colored via
  // TEAM_COLORS — replaced the old barely-visible round blob. Positioned
  // off each entity's just-placed render XZ (upsert sets it synchronously — no need to wait a tick).
  ALLIES.forEach((c, i) => {
    const id = `a${i}`
    const pos = board.render_position_of(id)
    if (pos) board.set_entity_anchor(id, pos, 0)
  })
  ENEMIES.forEach((c, i) => {
    const id = `e${i}`
    const pos = board.render_position_of(id)
    if (pos) board.set_entity_anchor(id, pos, 1)
  })

  // idle attack loop so the outline is visible mid-animation too (proves it deforms with the skeleton).
  // [victim-reaction] scripted damage/heal exchanges — the STRUCK entity recoils + tints at the impact frame:
  //   H — ally a0 swings at enemy e0; e0 flinches AWAY + red-flashes (the "got hit" read).
  //   K — a KILLING crit on e1: it plays its DEATH collapse + a red flash but never flinches (mid-death rule).
  //   G — a HEAL landing on ally a1: a soft green pulse, no recoil (demo uses a 'hit' beat to carry the float;
  //       live heals reuse this same green pulse via the float kind).
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyA') board.entity_beat('e0', { anim: 'attack' })
    if (e.code === 'KeyH') {
      board.entity_beat('a0', { anim: 'attack', face: ENEMIES[0] })
      board.entity_beat('e0', { anim: 'hit', face: ALLIES[0], float: { text: '-284', kind: 'damage' } })
    }
    if (e.code === 'KeyK')
      board.entity_beat('e1', { anim: 'death', face: ALLIES[0], float: { text: '-512', kind: 'crit' } })
    if (e.code === 'KeyG')
      board.entity_beat('a1', { anim: 'hit', face: ENEMIES[0], float: { text: '+180', kind: 'heal' } })
    if (e.code === 'Space')
      board.entity_move(
        'a0',
        [
          { x: 3, y: 4 },
          { x: 4, y: 4 },
        ],
        { cells_per_second: 3, gait: 'walk' }
      )
  })
}
