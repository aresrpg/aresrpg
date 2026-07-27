// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// fight/fight_render_prims.js — the PURE render primitives behind the two beat producers (split out of
// fight_render_events.js to keep each file ≤600 LoC). Reference gait/timing constants, grid<->cell geometry,
// the cardinal path walker, trap-diff, the beat writer, and beat durations. Nothing here decodes an event or
// touches state — every function is a plain transform. The producers import these; the public timing constants
// are re-exported from fight_render_events.js so existing consumers keep their import path.

import { find_path_4dir } from '@aresrpg/sim/pathfind'

// The retro-1.29 reference gait arrays — vendored verbatim from the reference client's sprite mover (both
// reference emulators carry the same arrays): px/ms by facing octant, the straight octants (0, 4) the
// faster lane, board-adjacent steps riding the diagonal octants. One board step spans √(26.5² + 13.5²)
// ≈ 29.74 px of screen (half-cell metrics), so cadence = step ÷ gait. Fight movement switches walk → run
// on paths PAST run_path_cells (the reference client's fight threshold for characters); a displacement
// slides flat at slide_px_ms regardless of gait, with the walk anim frozen — the freeze itself is the
// render adapter's behavior, never this stream's (§7b E6/E7).
export const REFERENCE_GAITS = Object.freeze({
  walk_px_ms: Object.freeze([0.07, 0.06, 0.06, 0.06, 0.07, 0.06, 0.06, 0.06]),
  run_px_ms: Object.freeze([0.17, 0.15, 0.15, 0.15, 0.17, 0.15, 0.15, 0.15]),
  slide_px_ms: 0.25,
  step_px: 29.74,
  run_path_cells: 3,
})

const diagonal_cell_ms = (px_per_ms) => Math.round(REFERENCE_GAITS.step_px / px_per_ms)

// Presentation time is expressed in milliseconds. These are renderer-neutral queue beats: adapters bind the
// prebuilt payload to their render closure, while this module owns only semantic order and timing.
export const FIGHT_RENDER_TIMINGS = Object.freeze({
  walk_cell: diagonal_cell_ms(REFERENCE_GAITS.walk_px_ms[1]), // 496 — paths of run_path_cells or fewer
  run_cell: diagonal_cell_ms(REFERENCE_GAITS.run_px_ms[1]), // 198 — paths past run_path_cells (§7b E6)
  cast: 1400,
  displacement_cell: diagonal_cell_ms(REFERENCE_GAITS.slide_px_ms), // 119 — the flat reference slide (§7b E7)
  // TELEPORT ARRIVAL — the teleport sequences after the vfx, with its own vfx at the target too: a short
  // gated beat AFTER the instant blink, so a landing cue always has time to read.
  teleport_arrival: 600,
  trap: 280,
  damage: 350,
  // The retro-1.29 reference death hold: the client blocks the die anim exactly 1500ms and the server
  // holds 1500ms before the next turn — one flat number, both legs (§7b E5).
  death: 1500,
  instant: 0,
})

// The Displaced mechanics code for a TELEPORT (spell_effect PUSH 12 / PULL 13 / TELEPORT 14). Chain-stable and
// identical to the sim's spell-effect kind, so it doubles as "this cast teleports the caster". A teleport renders
// INSTANT (blink); push/pull slide cardinally. ONE in-package home for the constant (predicted + receipt + fold).
export const DISPLACE_TELEPORT = 14

export const CAST_BEAT_MS = FIGHT_RENDER_TIMINGS.cast
export const DISPLACEMENT_CELL_MS = FIGHT_RENDER_TIMINGS.displacement_cell
export const TELEPORT_ARRIVAL_MS = FIGHT_RENDER_TIMINGS.teleport_arrival
export const TRAP_BEAT_MS = FIGHT_RENDER_TIMINGS.trap
export const DAMAGE_BEAT_MS = FIGHT_RENDER_TIMINGS.damage
export const DEATH_BEAT_MS = FIGHT_RENDER_TIMINGS.death

/** Per-cell move cadence from the reference gait arrays: the run gait on paths strictly past the
 *  reference fight threshold, the walk gait at or under it (§7b E6). */
export const move_cell_ms = (path_cells) =>
  path_cells > REFERENCE_GAITS.run_path_cells ? FIGHT_RENDER_TIMINGS.run_cell : FIGHT_RENDER_TIMINGS.walk_cell

export const same_cell = (a, b) => !!a && !!b && a.x === b.x && a.y === b.y
export const cell_key = (cell) => `${cell.x},${cell.y}`

export const decoded_cell = (encoded, width) => ({
  x: Number(encoded) % width,
  y: Math.floor(Number(encoded) / width),
})

export const encoded_cell = (cell, width) => cell.y * width + cell.x

export const entity_cell = (state, entity_id) =>
  [...(state?.team0 ?? []), ...(state?.team1 ?? [])].find((entity) => entity.id === entity_id)?.cell ?? null

// Displacement is cardinal. Keeping a deterministic fallback for malformed diagonal data makes receipt playback
// total without inventing renderer state: x is exhausted first, then y.
export const path_between = (from, to) => {
  if (!from || !to || same_cell(from, to)) return []
  const path = []
  let cell = { ...from }
  while (cell.x !== to.x) {
    cell = { x: cell.x + Math.sign(to.x - cell.x), y: cell.y }
    path.push(cell)
  }
  while (cell.y !== to.y) {
    cell = { x: cell.x, y: cell.y + Math.sign(to.y - cell.y) }
    path.push(cell)
  }
  return path
}

// BFS budget for render-side path reconstruction: comfortably above the canonical combat_grid cell count
// (GRID_CELLS = 380, combat_grid.js) so the search always has room for any legal route, however winding.
const RECONSTRUCT_BUDGET = 400

/** Render-side TERRAIN walkability from the board's static obstacle facts (board_state.js decode shape) —
 *  obstacles ∪ holes ∪ out-of-shape ∪ out-of-bounds, encoded at `width` stride. Live occupancy is supplied
 *  separately to `reconstructed_path`, matching the two inputs the sim unions into Move's frozen wall mask.
 *  Returns null when the caller supplied no board dims (legacy/synthetic ctx) so callers fall back to the unaware line.
 */
export const terrain_walkable_at = ({ obstacles, holes, shape_mask, board_width, board_height, width }) => {
  if (!board_width || !board_height) return null
  const blocked = new Set([...(obstacles ?? []), ...(holes ?? [])])
  return (cell) => {
    if (cell.x < 0 || cell.y < 0 || cell.x >= board_width || cell.y >= board_height) return false
    const idx = encoded_cell(cell, width)
    if (blocked.has(idx)) return false
    return !shape_mask || shape_mask.has(idx)
  }
}

/** The rendered walk for a Moved/MobMoved beat when the producer supplied no real path: an obstacle/hole/shape
 *  -aware shortest route — REUSES the sim's own `find_path_4dir` (ONE pathfinding home; the chain event carries
 *  only the landed cell, so this reconstructs the canonical Move route with the sim's pinned left/right/up/down
 *  tie-break). Falls back to the old cardinal straight line when board facts are absent
 *  (from/to unknown, or a legacy caller with no board data) — every existing caller renders exactly as before.
 *  `find_path_4dir` returns start..goal INCLUSIVE; sliced to origin-EXCLUSIVE to match path_between's contract. */
export const reconstructed_path = (from, to, board = {}) => {
  const is_walkable = terrain_walkable_at(board)
  if (!is_walkable || !from || !to) return path_between(from, to)
  const occupied = new Set((board.occupied_cells ?? []).map(cell_key))
  const bfs = find_path_4dir(from, to, RECONSTRUCT_BUDGET, is_walkable, (cell) => occupied.has(cell_key(cell)))
  return bfs ? bfs.slice(1) : path_between(from, to)
}

export const trap_covers = (trap, cell) => (trap?.cells ?? []).some((candidate) => same_cell(candidate, cell))

// ╔════════════ [ WAS A TRAP ARMED HERE, WHEN THAT ROW RAN? — the ONE home (#1248) ] ════════════════════════ ]
//
// #1219's sequencing rule shipped twice — once in the fold, once in the renderer — and the copies disagreed on
// the very case it exists for: the fold took the LAST `Cast` on an anchor as "the placement" and compared
// inclusively, the renderer took the FIRST and compared strictly. Two casts on one anchor with a walk between
// them therefore split the twins, and the renderer flashed the #1219 phantom detonation again.
//
// THE RULE COMES FROM THE CHAIN, not from either copy. `cast.move:1534` (`ECellAlreadyTrapped`, the 1.29
// no-stack ban) allows at most ONE live trap per anchor at any instant, so along an ordered row stream an anchor
// strictly ALTERNATES: Cast (arm) → entry (detonate + consume) → Cast (re-arm) → … Both consumers ask the same
// question of that stream — "was a trap armed on this anchor when this row ran?" — and the answer is "SOME cast
// on this anchor precedes this row". Never the first specifically, never the last overall: taking the last
// overall is what let a placement made AFTER a crossing retroactively protect the trap that crossing consumed.
//
// POSITIONS ARE ORDINALS in the caller's own ordered stream — the receipt's decoded rows for the renderer, the
// `(version, event_idx)`-sorted authoritative tail for the fold. Both are already in receipt order, so ordering
// is an integer compare and the boundary is ONE shared `<` rather than a `<` on one side and a `>=` on the other.

/** Index every anchor's placement ordinals from an ordered row stream. `anchor_of` returns the placed anchor
 *  cell for a row, or null/undefined when the row places nothing. */
export const placements_by_anchor = (rows, anchor_of) => {
  const by_anchor = new Map()
  ;(rows ?? []).forEach((row, at) => {
    const anchor = anchor_of(row)
    if (anchor == null) return
    const key = Number(anchor)
    const seen = by_anchor.get(key)
    if (seen) seen.push(at)
    else by_anchor.set(key, [at])
  })
  return by_anchor
}

/** Was a trap armed on `anchor` when the row at ordinal `at` ran? An anchor with NO placement in this window was
 *  placed before it, so it counts as armed — the permissive default both homes already had, and the one that
 *  errs toward "the trap stays" rather than inventing an ordering the window cannot see. */
export const armed_at = (placements, anchor, at) => {
  const ordinals = placements.get(Number(anchor))
  if (!ordinals) return true
  return ordinals.some((placed) => placed < at)
}

export const traps_removed = (before, after) => {
  const live_ids = new Set((after?.traps ?? []).map((trap) => trap.id))
  return (before?.traps ?? []).filter((trap) => !live_ids.has(trap.id))
}

export const traps_added = (before, after) => {
  const old_ids = new Set((before?.traps ?? []).map((trap) => trap.id))
  return (after?.traps ?? []).filter((trap) => !old_ids.has(trap.id))
}

export const create_writer = (start_at = 0) => {
  let at = start_at
  const events = []
  return {
    append(kind, duration, payload, source_turn) {
      const spec = { kind, at, duration, payload, source_turn }
      events.push(spec)
      at += duration
      return spec
    },
    events: () => events,
    duration: () => at - start_at,
  }
}

export const displacement_duration = (path) => Math.max(1, path.length) * DISPLACEMENT_CELL_MS
export const move_duration = (path) => Math.max(1, path.length) * move_cell_ms(path.length)

// MP spent on a move = the cells actually stepped. Both beat producers' move paths are origin-EXCLUSIVE
// (path_between drops the start cell; the sim's fight_moved.path excludes it too), and fight movement is
// cardinal at 1 MP/cell — so the step count IS the MP cost. The ONE home both lanes derive the green
// MP-spent floater from, keeping the predicted + receipt move beats twin-identical (chain Moved carries no cost).
export const move_mp_spent = (path) => (Array.isArray(path) ? path.length : 0)
