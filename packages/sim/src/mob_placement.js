// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// MOB PLACEMENT — the collision-free deterministic mirror of the chain's per-group mob seating. PURE (seed +
// board geometry only; no time / IO / stored roll). Mirrors `aresrpg_foundation::mob_ai::seeded_spawn_cell`
// (mob_ai.move) + the spawn loop in `aresrpg_fight::fight::create_inner` (fight.move) — the SAME pattern
// board_gen.js is to board.move and packages/frontend/src/game/spawn_compose.js is to mob::spawn_seeded.
//
// THE BUG THIS ENCODES THE FIX FOR: entering a fight could spawn two mobs on the same
// cell. On-chain, `create_inner` computes `all_starts = start_cells_a ∪ start_cells_b` ONCE, then loops
// `mob::spawn_seeded(…, &all_starts, …)` per mob threading only the prng STATE — it never feeds a spawned mob's
// cell back into the exclusion set (fight.move:280-289). `seeded_spawn_cell` excludes obstacles/holes/starts but
// NOTHING already taken by a sibling mob, so two mobs whose draws resolve to the same open cell collide. The
// client is a faithful renderer of that chain truth (fight_bridge.js reads `m.cell` verbatim; spawn_compose.js
// deliberately does NOT derive the cell), so there is no honest client-only cure — the fix is chain-side.
//
// THE FIX (wave-2b, one line in fight.move's loop): ACCUMULATE each placed cell into the exclusion set — i.e.
// `all_starts.push_back(mob::cell(&m));` after each `spawn_seeded`, so the next mob's `seeded_spawn_cell` sees
// prior mobs as occupied. `place_mob_cells` below IS that corrected loop; `seeded_spawn_cell` is the unchanged
// per-mob draw it calls. Determinism is preserved (still a pure fold over group_seed) — so if world-fight mob
// placement is ever client-predicted, this mirror stays in parity with the fixed chain.

import { rng_seed, rng_int } from './prng.js'
import { grid_cells, mask_get } from './combat_grid.js'

const MASK32 = 0xffff_ffffn // prng.move rng_seed keeps only the low 32 bits of the u64 group_seed

/**
 * Draw ONE spawn cell: a Random on-mask cell that is not an obstacle, hole, or in `excluded`. Exact mirror of
 * mob_ai.move `seeded_spawn_cell` — one prng draw picks the probe offset, then a forward linear scan over the
 * on-mask pool returns the first free cell. The chain's `loop {}` is unbounded (it assumes a free cell exists);
 * this bounds the scan at the pool length — EQUIVALENT whenever a free cell exists (the modulo cycles the whole
 * pool within `len` steps) and safely returns `null` when the pool is fully excluded, never hanging.
 * @param {bigint[]} mask shape_mask (one bit per cell, combat_grid words)
 * @param {number[]} obstacles @param {number[]} holes @param {number[]} excluded start cells ∪ already-placed mobs
 * @param {number} state prng state (threaded)
 * @returns {{ cell: number | null, state: number }} the picked cell (null if none free) + the advanced state
 */
export function seeded_spawn_cell(mask, obstacles, holes, excluded, state) {
  const pool = []
  const n = grid_cells()
  for (let c = 0; c < n; c++) if (mask_get(mask, c)) pool.push(c)
  const len = pool.length
  if (len === 0) return { cell: null, state }
  const drawn = rng_int(state, len)
  const idx0 = drawn.value
  for (let j = 0; j < len; j++) {
    const cell = pool[(idx0 + j) % len]
    if (
      !obstacles.includes(cell) &&
      !holes.includes(cell) &&
      !excluded.includes(cell)
    )
      return { cell, state: drawn.state }
  }
  return { cell: null, state: drawn.state } // whole pool excluded — cannot seat (defensive; chain would hang)
}

/**
 * Seat `count` mobs on the board with NO two on the same cell — the corrected `create_inner` spawn loop. Seeds
 * the prng from `group_seed` (chain parity), then for each mob draws a free cell via `seeded_spawn_cell` with the
 * exclusion set = start cells ∪ EVERY cell already placed this group. The one-line delta vs the current chain is
 * `excluded.push(cell)` — collision-freedom by construction, deterministic given the seed.
 *
 * PLACEMENT-ONLY mirror: the real chain threads a level roll + an archimob roll BEFORE each cell draw inside
 * `mob::spawn_seeded` (spawn_compose.js owns that stream), so these cell VALUES are not byte-identical to chain —
 * the DISTINCTNESS guarantee this proves is a property of the reject-and-probe + accumulating occupancy and holds
 * for any prng sub-stream. Byte-exact parity additionally requires interleaving those two draws per mob.
 *
 * @param {{ mask: bigint[], obstacles?: number[], holes?: number[], starts?: number[],
 *   group_seed: string|number|bigint, count: number }} p
 * @returns {number[]} up to `count` DISTINCT cells (fewer only if the board has fewer free cells than `count`)
 */
export function place_mob_cells({
  mask,
  obstacles = [],
  holes = [],
  starts = [],
  group_seed,
  count,
}) {
  let state = rng_seed(Number(BigInt(group_seed ?? 0) & MASK32))
  const excluded = [...starts] // grows with each placed cell — THE fix (the chain's `all_starts` never grew)
  const cells = []
  const n = Math.max(0, Number(count) || 0)
  for (let i = 0; i < n; i++) {
    const { cell, state: st } = seeded_spawn_cell(
      mask,
      obstacles,
      holes,
      excluded,
      state,
    )
    state = st
    if (cell === null) break // no free cell left (count exceeded the board's open capacity)
    excluded.push(cell)
    cells.push(cell)
  }
  return cells
}
