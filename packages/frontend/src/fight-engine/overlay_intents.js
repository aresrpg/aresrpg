// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// FIGHT ENGINE · overlay_intents — the RENDERER-NEUTRAL semantics of the tactical overlay (the voxel-MVP
// keystone). fight-overlay.js (a Three.js god-file) used to MIX "which cells are castable / reachable / a
// placement start" (the SEMANTICS) with "stamp a mesh there" (the RENDER). This module owns the SEMANTICS as
// pure functions returning CELL SETS + intents — ZERO three.js — so a second renderer (the voxel board) can
// paint the SAME truth, and the math is unit-testable in isolation (no scene, no GPU).
//
// CONTRACT: every export is a pure `(inputs) -> cell-set | intent`. Cells are ENCODED (fight-los `encode`,
// y*GRID_W+x) so a Set is O(1) membership and the wash/gate/contract compare cell-for-cell. fight-los.js stays
// the shared MATH home (BFS reach/path + integer shadowcast LOS); this module IMPORTS it and the @aresrpg/sim
// targeting math, and COMPOSES them into the overlay's intents. It never renders — the caller (fight-overlay,
// CONSUMER #1) reads WHAT to paint here and keeps only HOW.
//
// THE TWO RANGE REGIMES (both must agree with what the server/contract accepts, cell-for-cell):
//   • DUNGEON (on-chain co-op): reach = `bfsReachable` over `dungeon_blocked_cells`; cast = Manhattan-range +
//     integer `lineOfSight` — the EXACT twin of dungeon_turn.move / DungeonBoard.jsx's reachable/castable gates.
//   • WORLD (legacy WS fight): reach = @aresrpg/sim `get_reachable_cells`; cast = `get_targetable_cells` — the sim's
//     own range/linear/LOS/free-cell gate. The caller injects walkability/occupancy predicates.

import { cell_key } from '@aresrpg/sim/cell'
import { manhattan } from '@aresrpg/sim/combat_grid'
import { get_reachable_cells } from '@aresrpg/sim/pathfind'
import { get_targetable_cells } from '@aresrpg/sim/spell_targeting'
import { encode, decode, GRID_W, GRID_H, bfsReachable, bfsPath, lineOfSight } from '@aresrpg/fight/los'
import { range_bonus_of } from '@aresrpg/fight/statuses'

// ── DEATH / TRAP BEAT TIMING (resolution pacing, owner L/N) — the constants that time the SEEN death + the
//    trap→blast→damage cadence. Renderer-neutral (seconds), so both boards linger a killed body the same beat. ──
// D139: cast timing semantics — moved here from the deleted fight-cast-vfx.js (three.js renderer corpse).
// The DRIVER (DungeonBoard auto-commit cue) and any renderer read the SAME beat clock from this one home.
export const ANTICIPATION_S = 0.2
export const CAST_TRAVEL_S = 1.2
export const DEATH_BEAT_S = 0.7 // a killed body lingers this long after its impact, then poofs (a SEEN death)
export const TRAP_BEAT_S = 0.28 // a trap's trigger burst leads its damage floats by this beat (trap → blast → dmg)

/**
 * @typedef {{ x: number, y: number }} Cell         arena-LOCAL cell (the coord space the overlay paints in)
 * @typedef {Set<number>} CellSet                    a Set of ENCODED cells (fight-los `encode`)
 * @typedef {'placement' | 'placement_locked' | 'ghost' | 'hover_movement' | 'movement' |
 *   'movement_blocked' | 'movement_path' | 'in_range' | 'los_blocked' | 'target'} CellPaint
 */

/**
 * Bottom-to-top priority for mutually-exclusive BASE paints. Glyphs and traps intentionally do not appear:
 * they are the only overlays sanctioned to sit over the resolved base cell.
 * @type {readonly CellPaint[]}
 */
export const CELL_PAINT_PRIORITY = Object.freeze([
  'placement',
  'placement_locked',
  'ghost',
  'hover_movement',
  'movement',
  'movement_blocked',
  'movement_path',
  'in_range',
  'los_blocked',
  'target',
])

/**
 * Resolve mutually-exclusive base-paint semantics into renderer-neutral per-cell facts.
 * Applying candidates from low to high and overwriting a Map makes overlap structurally unrepresentable:
 * every encoded cell occurs exactly once and carries only its highest-priority semantic state.
 * @param {Partial<Record<CellPaint, Iterable<number>>>} candidates encoded candidates per semantic paint
 * @returns {{ cell: number, paint: CellPaint }[]}
 */
export function resolve_cell_paints(candidates) {
  /** @type {Map<number, CellPaint>} */
  const resolved = new Map()
  for (const paint of CELL_PAINT_PRIORITY) for (const cell of candidates[paint] ?? []) resolved.set(cell, paint)
  return [...resolved].map(([cell, paint]) => ({ cell, paint })).sort((a, b) => a.cell - b.cell)
}

// ── D126b / move range: the movement-REACHABLE set of a subject (the active local mover on their turn, OR any
//    fighter/mob hovered — its MP reach) ─────────────────────────────────────────────────────────────────────

/**
 * The set of cells `subject` can walk to within its MP — the green move-range wash + the mob-hover MP range
 * (D126b). Excludes the subject's own cell (you don't "move" onto your own tile). ENCODED cells.
 *
 * DUNGEON: `bfsReachable(subject.cell, subject.mp, dungeon_blocked_cells(dungeon, subject_id))` — the on-chain
 *   twin, so the wash == DungeonBoard's `reachable` == the MP commit_turn charges. `blocked` is precomputed by
 *   the caller (it owns the dungeon glue + the mover's id for the self-exclusion).
 * WORLD: `get_reachable_cells(subject.cell, subject.mp, terrain, occupancy)` — the sim reach.
 *
 * @param {{ cell: Cell, mp: number }} subject
 * @param {{
 *   mode: 'dungeon' | 'world',
 *   blocked?: Set<number> | number[],                 // dungeon: the mover's blocked-cell set (walls ∪ bodies)
 *   is_walkable?: (c: Cell) => boolean,               // world: terrain walkability
 *   is_occupied?: (c: Cell) => boolean,               // world: an alive fighter blocks the cell (self excluded)
 * }} ctx
 * @returns {CellSet}
 */
export function move_reachable_set(subject, ctx) {
  const out = new Set()
  if (!subject || subject.mp == null || subject.mp <= 0) return out
  const start = encode(subject.cell.x, subject.cell.y)
  if (ctx.mode === 'dungeon') {
    for (const c of bfsReachable(start, subject.mp, ctx.blocked ?? new Set())) out.add(c)
    return out
  }
  // world: the sim reach (cost 0 = the start cell) → drop the start, encode the rest.
  const terrain = (c) => !!ctx.is_walkable?.(c)
  const occupied = (c) => cell_key(c.x, c.y) !== cell_key(subject.cell.x, subject.cell.y) && !!ctx.is_occupied?.(c)
  for (const { cell } of get_reachable_cells(subject.cell, subject.mp, terrain, occupied)) {
    if (cell.x === subject.cell.x && cell.y === subject.cell.y) continue
    out.add(encode(cell.x, cell.y))
  }
  return out
}

// TACKLE-RANGE STATIC SPLIT (`move_range_split`) DELETED 2026-07-18 (M3 render rung): its base-budget diff
// triggered on plain MP spending — the exact bug: "it shows when I spent all my
// MP by moving which is wrong". The which-cells decision now lives in the CORE (@aresrpg/fight
// project.move_wash — tackle-zone gated, the chain contest's own fraction), where the render contract puts it.

/**
 * #933 — one dungeon move verdict for click execution and preview. The existing blocker-aware BFS supplies the
 * start-exclusive highlighted path; its length is exactly the MP the contract charges. Invalid, self, blocked,
 * or over-budget targets return null so the input edge stays a silent non-event.
 *
 * @param {{ cell: Cell }} subject
 * @param {Cell} target
 * @param {{ blocked: Set<number> | number[], mp: number }} ctx
 * @returns {{ path: number[], mp_cost: number, mp_left: number } | null}
 */
export function move_plan_dungeon(subject, target, ctx) {
  const start = encode(subject.cell.x, subject.cell.y)
  const goal = encode(target.x, target.y)
  if (start === goal) return null
  const budget = Math.max(0, Number(ctx.mp) || 0)
  const path = bfsPath(start, goal, ctx.blocked, budget)
  if (!path.length || path.at(-1) !== goal) return null
  const mp_cost = path.length
  return { path, mp_cost, mp_left: Math.max(0, budget - mp_cost) }
}

/**
 * The concrete walk PATH `subject` takes to `target` (the dark-green preview), ENCODED, EXCLUDING the start.
 * `[]` when no legal move plan exists. DUNGEON only — the world path uses the consumer's `steered_path`.
 *
 * @param {{ cell: Cell }} subject
 * @param {Cell} target
 * @param {{ blocked: Set<number> | number[], mp: number }} ctx
 * @returns {number[]} encoded path cells (start-exclusive)
 */
export function move_path_dungeon(subject, target, ctx) {
  return move_plan_dungeon(subject, target, ctx)?.path ?? []
}

/** Is `cell` on the arena board (inside the 10×10 index window)? The hover-refusal / cast-range clip guard. */
export function on_board(cell) {
  return cell.x >= 0 && cell.x < GRID_W && cell.y >= 0 && cell.y < GRID_H
}

// ── D113 / cast range: the CASTABLE cell set of an armed spell ────────────────────────────────────────────────

/**
 * D113 DUNGEON cast-range WASH — every board cell within the seed range [rmin,rmax] (Manhattan, the contract
 * metric) that clears integer line-of-sight from the caster. MIRRORS DungeonBoard.jsx's `castable` gate
 * (manhattan ∈ [min,max] ∧ lineOfSight) but over the WHOLE room rect (not just mob cells) so the player SEES the
 * spell's footprint, not only the cells that happen to hold a mob. rmax 0 (a self-buff) → just the caster's cell.
 *
 * @param {[number, number] | null | undefined} range   the seed [rmin, rmax]
 * @param {{ cell: Cell }} caster
 * @param {{ width: number, height: number, shape_mask?: Set<number> | number[] }} grid  the room shape (dungeon_grid_of)
 * @param {number[]} obstacles                           LOS-blocking cells — the los_obstacles twin set: static
 *   obstacles ∪ living-body cells (players + mobs). Endpoints self-excluded by losBlocks (caster/target inert).
 * @param {{ los?: boolean, linear?: boolean, free_cell?: boolean, modifiable_range?: boolean,
 *   trap_cells?: Iterable<number> }} [flags]  the
 *   seed row's legality flags (spell_target twin, P1 self-cast root): `los:false` = the spell ignores
 *   line-of-sight (sl_line_of_sight off — every in-range cell is aimable); `linear:true` = line-launch, caster &
 *   target must share a row or column (sl_line_launch); `free_cell:true` = traps/glyphs/teleport must land on a
 *   FREE, NON-BLOCKED cell — every cell in `obstacles` (the blocker union: static obstacles ∪ living bodies) is
 *   dropped from the set, so a trap can never target a mob or a wall ("I should not be able to target a
 *   mob with a trap"; the spell_target::can_cast_at + sim can_target twins). `trap_cells` = ENCODED cells the
 *   caster's OWN live traps anchor (engine_view.my_traps) — the caller passes it ONLY for a trap-PLACING spell
 *   (seed_cast_flags_of `places_trap`), and every such cell is dropped: the chain aborts a trap on a trapped
 *   cell (1.29 no-stack, cast::ECellAlreadyTrapped), so the wash/gate must grey it. Enemy invisible traps are
 *   unknowable client-side — those surface as the honest chain-abort toast instead. `occupant_cells` (#1741) =
 *   the VISIBLE-occupancy set (`@aresrpg/fight/occupancy` visible_occupant_cells) a zero-area single-target DAMAGE
 *   spell must aim INTO — free_cell's rule inverted, same mechanism: every cell OUTSIDE it is dropped, so an
 *   empty-cell whiff can no longer be drafted (the 1.29 reference client refuses it; invisible-hunting stays the
 *   AoE/trap game). `null`/absent ⇒ no occupancy requirement, which is every other spell's behavior unchanged.
 *   Defaults preserve the pre-flag behavior.
 * @returns {CellSet}
 */
// Complexity retained (#2069): this is one exhaustive range-rule fold over shared geometry; splitting flags into helpers would duplicate precedence and traversal state.
export function cast_range_set_dungeon(range, caster, grid, obstacles, flags = {}) {
  const {
    los = true,
    linear = false,
    free_cell = false,
    modifiable_range = false,
    trap_cells = null,
    occupant_cells = null,
  } = flags
  // free_cell: the blocker set the target may NOT be (obstacles ∪ bodies — the caller passes exactly that).
  const blocked = free_cell ? new Set(obstacles ?? []) : null
  // 1.29 no-stack: cells anchoring MY live traps are not legal trap targets (chain parity — see JSDoc above).
  const trapped = trap_cells ? (trap_cells instanceof Set ? trap_cells : new Set(trap_cells)) : null
  // #1741: the VISIBLE occupants a single-target damage spell must aim into (null ⇒ any cell, as before).
  const occupants = occupant_cells ? (occupant_cells instanceof Set ? occupant_cells : new Set(occupant_cells)) : null
  const out = new Set()
  if (!caster || !grid) return out
  const [rmin, authored_rmax] = range ?? [0, 0]
  const rmax = authored_rmax + (modifiable_range ? range_bonus_of(caster) : 0)
  const from = encode(caster.cell.x, caster.cell.y)
  // D75-stride: the wash paints ONLY the room's real floor — the stored shape mask when the grid carries one
  // (dungeon_grid_of always emits one: stored on train-4, a rect twin on legacy), never the enclosing rect, so
  // a varied board's rim/void is never washed as castable ground.
  const mask =
    grid.shape_mask instanceof Set ? grid.shape_mask : grid.shape_mask?.length ? new Set(grid.shape_mask) : null
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const enc = encode(x, y)
      if (mask && !mask.has(enc)) continue // off-shape (void/rim) — not a board cell
      // free_cell (traps/glyphs/teleport): never a blocked/occupied cell — a mob body or a wall is not a
      // legal trap cell (the chain rejects it; the wash/hover/click must agree so the player can't target it).
      if (blocked && blocked.has(enc)) continue
      // trap-placing spell: never a cell already anchoring MY live trap (1.29 no-stack — the chain aborts it).
      if (trapped && trapped.has(enc)) continue
      // #1741 — SINGLE-TARGET DAMAGE NEEDS A VICTIM: a cell holding no VISIBLE occupant is not aimable, the exact
      // inverse of the free_cell drop two lines up. Invisible occupants are absent from this set by construction
      // (visible_occupant_cells), so a hidden body's cell withholds identically to an empty one — no leak.
      if (occupants && !occupants.has(enc)) continue
      const d = manhattan({ x, y }, caster.cell)
      if (d < rmin || d > rmax) continue
      // line-launch (spell_target twin): only orthogonally aligned cells are aimable.
      if (linear && x !== caster.cell.x && y !== caster.cell.y) continue
      // LOS mirrors `castable`: the caster's own cell is always visible to itself (d === 0). A no-LOS
      // spell (seed line_of_sight:false) skips the sight check entirely — chain does the same.
      if (los && d > 0 && !lineOfSight(from, enc, obstacles ?? [])) continue
      out.add(enc)
    }
  }
  return out
}

/**
 * D241 — every on-shape board cell within the seed's Manhattan range [rmin,rmax], WITHOUT the LOS filter.
 * The complement (this set minus cast_range_set_dungeon) = the in-range cells LOS blocks → the 'los_blocked'
 * (light-blue) wash the canon paints under a grabbed spell. Same loop as cast_range_set_dungeon minus
 * the lineOfSight check, so the two sets are guaranteed consistent (one home for the range/mask metric).
 * @param {[number, number] | null | undefined} range the seed [rmin, rmax]
 * @param {{ cell: Cell }} caster
 * @param {{ width: number, height: number, shape_mask?: Set<number> | number[] }} grid
 * @param {{ modifiable_range?: boolean }} [flags]
 * @returns {CellSet}
 */
export function manhattan_range_cells(range, caster, grid, flags = {}) {
  const out = new Set()
  if (!caster || !grid) return out
  const [rmin, authored_rmax] = range ?? [0, 0]
  const rmax = authored_rmax + (flags.modifiable_range ? range_bonus_of(caster) : 0)
  const mask =
    grid.shape_mask instanceof Set ? grid.shape_mask : grid.shape_mask?.length ? new Set(grid.shape_mask) : null
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      if (mask && !mask.has(encode(x, y))) continue
      const d = manhattan({ x, y }, caster.cell)
      if (d < rmin || d > rmax) continue
      out.add(encode(x, y))
    }
  }
  return out
}

/**
 * WORLD cast-range set — the sim's full targeting gate (range + linear + LOS + free-cell) resolved to the
 * castable cells. The caller injects `blocks_los` (non-walkable terrain) + `is_occupied`. ENCODED cells.
 *
 * @param {import('@aresrpg/sim').SpellLevel} level        the spell level (world spells carry one; dungeon seeds don't)
 * @param {{ cell: Cell }} caster
 * @param {{ blocks_los: (c: Cell) => boolean, is_occupied: (c: Cell) => boolean }} ctx
 * @returns {CellSet}
 */
export function cast_range_set_world(level, caster, ctx) {
  const out = new Set()
  if (!level || !caster) return out
  for (const c of get_targetable_cells(level, caster.cell, ctx, range_bonus_of(caster))) out.add(encode(c.x, c.y))
  return out
}

// ── D112 / placement: the start-cell set + its PHASE GATE ─────────────────────────────────────────────────────

/**
 * D112 placement PHASE GATE — should the start-cell wash paint at all? For a DUNGEON fight it gates on the PHASE
 * MACHINE (not the raw `fight.placement` flag, which stays stale-TRUE after the chain goes ACTIVE until the next
 * poll — the bug: blue start cells LINGERED over the live board). For a WORLD fight (no dungeon / no chain phase)
 * it keeps the raw slice flag. `is_placement_phase` is the caller's already-derived verdict (phase.is_placement
 * ∘ derive_phase) so this module never re-reads the store.
 *
 * @param {{ placement?: boolean, winner?: number }} fight
 * @param {{ in_dungeon: boolean, has_my_seat: boolean, is_placement_phase: boolean }} ctx
 * @returns {boolean} true ⇒ paint the placement wash this frame
 */
export function placement_active(fight, ctx) {
  if (ctx.in_dungeon && ctx.has_my_seat) return ctx.is_placement_phase
  // world fight / seatless observer: the raw slice flag (legacy WS path, unchanged), never over a won board.
  return !!fight.placement && fight.winner === -1
}

/**
 * The placement start cells for each team, as declared by the fight slice (`placement_cells` — the D83 centre
 * cluster the contract accepts). Renderer-neutral passthrough that NAMES the intent: the caller tints team 0/1
 * differently and rings the FREE ones. Returned per-team as ENCODED cell arrays.
 *
 * @param {{ placement_cells?: Record<0|1, Cell[]> }} fight
 * @returns {{ 0: number[], 1: number[] }}
 */
export function placement_cells_by_team(fight) {
  const of = (team) => (fight.placement_cells?.[team] ?? []).map((c) => encode(c.x, c.y))
  return { 0: of(0), 1: of(1) }
}

/**
 * THE STRIPS, SPLIT BY CLICK TRUTH (#1866). A declared band is not an affordance: `project.placement_click`
 * denies a start cell another seat already holds, and denies EVERY cell of the other team's band — yet the board
 * used to light my whole band clickable-blue and the other band through the `target` channel (a SECOND blue).
 * Two strips, one paint grammar, and half the cells refused the click they advertised.
 *
 * `accepts_click` is the pick door itself (one derivation — the caller passes `placement_click`, never a copy of
 * its rules), so `pickable` is exactly the set a click would take. Everything else in my band is `locked` — the
 * neutral unavailable grammar. The other seats' band joins `locked` only when a seat actually STANDS on it: mobs
 * never use those cells (they hold their own mid-board spawns), so in a solo group fight that strip has no
 * reader at all and paints nothing. Pure; ENCODED cells in and out.
 *
 * @param {{ my_band?: number[], other_band?: number[], accepts_click?: (cell: number) => boolean,
 *   occupied?: Iterable<number> }} input
 * @returns {{ pickable: number[], locked: number[] }}
 */
export function placement_strips({ my_band = [], other_band = [], accepts_click = () => false, occupied = [] }) {
  const pickable = my_band.filter(accepts_click)
  const locked = my_band.filter((cell) => !pickable.includes(cell))
  const taken = new Set(occupied)
  if (other_band.some((cell) => taken.has(cell))) for (const cell of other_band) locked.push(cell)
  return { pickable, locked }
}

// ── W4 / impact-beat ordering: the pending_impacts SEQUENCING CONTRACT ─────────────────────────────────────────
// The impact TIMELINE's queue semantics (NOT the mesh work): a cast schedules its flash/shake/damage-float/flinch
// to fire when the projectile ARRIVES (delay = ANTICIPATION_S [+ CAST_TRAVEL_S]); a trap leads its damage by
// TRAP_BEAT_S; a death beat lingers DEATH_BEAT_S. `drain(edt)` counts every pending beat down on the SAME scaled
// edt the projectile travels on (so they stay locked under hit-stop / slow-mo) and fires each as its clock hits
// 0. D131 (newest-action-preempts): `fast_forward()` drains the WHOLE queue INSTANTLY in FIFO order — the current
// animation completes at once (HP-beats still RELEASE in order, just faster) so a freshly-arrived live action
// never queue-lags behind stale playback. Pure: `fire` is the caller's render closure; the queue only orders time.

/**
 * A FIFO impact-beat queue. `schedule(delay, fire)` enqueues a beat; `drain(edt)` advances all beats by `edt`
 * seconds and fires the due ones (in insertion order among the due); `fast_forward()` fires ALL remaining beats
 * now, oldest-first (D131 preempt); `size` / `clear` for lifecycle. The caller keeps HOW (the closures render);
 * this owns WHEN (the ordering + timing contract).
 * @returns {{
 *   schedule: (delay: number, fire: () => void) => void,
 *   drain: (edt: number) => void,
 *   fast_forward: () => void,
 *   clear: () => void,
 *   size: () => number,
 * }}
 */
export function create_impact_queue() {
  /** @type {{ t: number, fire: () => void }[]} */
  let pending = []
  return {
    schedule(delay, fire) {
      pending = [...pending, { t: delay, fire }]
    },
    drain(edt) {
      // Count each beat down; fire + remove the due ones. Iterate a snapshot-safe reverse splice, but preserve
      // FIFO firing order among same-frame-due beats (oldest scheduled fires first) — matched by the two-pass:
      // decrement all, then fire the due ones front-to-back.
      pending = pending.map((p) => ({ ...p, t: p.t - edt }))
      for (let i = 0; i < pending.length;) {
        if (pending[i].t <= 0) {
          const p = pending[i]
          pending = [...pending.slice(0, i), ...pending.slice(i + 1)]
          p.fire()
        } else i++
      }
    },
    fast_forward() {
      // D131: the current animation COMPLETES INSTANTLY — fire every held beat now, oldest-first, so the
      // HP-beat law holds (release order preserved) but with zero remaining lag before the new action plays.
      while (pending.length) {
        const [p, ...rest] = pending
        pending = rest
        p.fire()
      }
    },
    clear() {
      pending = []
    },
    size() {
      return pending.length
    },
  }
}

// ── D19 / MOB-TURN PACING: the serial pace queue (renderer-neutral timing) ─────────────────────────────────────
// The bug: on a solo commit the chain auto-resolves EVERY mob in the same tx, and the client replays them
// as a synchronous burst of replay events — so all mob swings fire in one frame (an "instant blur-through",
// no readable beat). This queue is the fix's timing HALF: a SERIAL async runner that plays one task at a time and
// holds each for a MINIMUM wall-duration (MOB_TURN_MIN_MS) so each mob's action reads as its own beat. It NEVER
// touches player actions (the caller only routes MOB playback through it — no artificial delay on my own turn).
// Pure: `sleep` is injectable (tests advance a fake clock); the queue owns WHEN, the caller's task owns HOW (it
// awaits the real entity_move/entity_beat animation). If a task's own animation already exceeds the floor, the
// floor adds nothing — the ≥3s is a MINIMUM, never a fixed pad.

/** A mob turn must READ at least this long (D19: "≥3s, its own beat, not an instant blur-through"). A mob
 *  whose real move+cast animation already runs longer keeps its natural length; a fast/empty beat is floored here. */
export const MOB_TURN_MIN_MS = 3000

// ── [terminal-hold 2026-07-13] the presentation pipeline's OWN ceilings, one home (this module already owns the
// pacing constants both sides read — the adapter imports them for playback, fight_bridge for the terminal gate).
/** A cast's serialized chain (swing → delivery arc → victim reaction → death) resolves the paced slot; a wedged
 *  delivery VFX must never hang it — the adapter's per-cast hard ceiling (was adapter-local; moved here so the
 *  terminal hold cap below derives from the SAME number instead of duplicating it). */
export const CAST_SAFETY_MS = 4000
/** The adapter's per-slot force-drain ceiling for a paced mob beat (> the ≥3s floor; re-armed per buffer/settle). */
export const MOB_WAVE_CAP_MS = MOB_TURN_MIN_MS + 1500
/** The terminal fight-end hold's HARD CEILING — the fight-end surface (card + teardown + settle) may wait for the
 *  killing action's FULL presentation chain ("the death sequence must play normally, BEFORE you
 *  start removing the board at all") up to this long, never past it. DERIVED from the pipeline's own layered
 *  watchdogs (never a guessed constant): one paced slot's force-drain ceiling + one cast chain's own safety
 *  ceiling + the death-poof linger + scheduling slack. The EVENT signal (holds + presenting + live chains) does
 *  the real timing; this only backstops a wedge the inner watchdogs somehow missed. */
export const TERMINAL_HOLD_CAP_MS = MOB_WAVE_CAP_MS + CAST_SAFETY_MS + Math.round(DEATH_BEAT_S * 1000) + 800

/**
 * A SERIAL, min-duration pace queue. `run(task)` chains `task` after every previously-queued task (they never
 * overlap) and guarantees the slot occupies at least `min_ms` wall-time before the next starts. `size` reports the
 * outstanding tasks (incl. the running one); `clear` forgets the pending tail (a torn-down fight drops its backlog —
 * the in-flight task still settles, but nothing queued behind it runs). `sleep`/`now` are injectable so a unit test
 * drives the floor on a fake clock without real timers.
 * @param {{ min_ms?: number, sleep?: (ms: number) => Promise<void>, now?: () => number }} [opts]
 * @returns {{ run: (task: () => (void | Promise<void>)) => Promise<void>, size: () => number, clear: () => void }}
 */
export function create_pace_queue({
  min_ms = MOB_TURN_MIN_MS,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = () => Date.now(),
} = {}) {
  /** The tail of the serial chain — each run() links after it. Starts resolved (nothing queued). */
  let tail = Promise.resolve()
  /** Outstanding tasks (queued + the one running), so a caller can tell the cascade is still playing. */
  let outstanding = 0
  /** The slots that have NOT started executing yet (each carries a `cancelled` flag). clear() marks them all
   *  cancelled so their bodies skip; a slot removes itself the instant it starts (so an IN-FLIGHT slot is never
   *  cancelled — it settles). This is the precise "drop the backlog, keep the running one" teardown semantics. */
  let pending = /** @type {object[]} */ ([])
  const cancelled = new Set()
  return {
    run(task) {
      outstanding++
      const slot = {}
      pending = [...pending, slot]
      const started = tail.then(async () => {
        // this slot is now the RUNNING one — leave the pending set (so a clear() from here on can't cancel it).
        pending = pending.filter((candidate) => candidate !== slot)
        if (cancelled.delete(slot)) return // clear() dropped this backlog slot before it ran — skip the body.
        const t0 = now()
        try {
          await task()
        } finally {
          // FLOOR the slot to min_ms so the beat reads (D19). A task that already ran longer adds nothing.
          const elapsed = now() - t0
          if (elapsed < min_ms) await sleep(min_ms - elapsed)
        }
      })
      // the NEXT run() links after THIS slot's floor completes; swallow rejection so one failed task can't wedge
      // the chain (the caller's task already logs its own failure — the queue only orders time).
      tail = started.catch(() => {})
      return started.finally(() => {
        outstanding--
      })
    },
    size() {
      return outstanding
    },
    clear() {
      // cancel every NOT-yet-started slot (the running one already left `pending`, so it finishes untouched).
      for (const slot of pending) cancelled.add(slot)
      pending = []
    },
  }
}

// Re-export the decode/on-board helpers the consumer already imports from fight-los via this module's surface,
// so a future renderer can depend on overlay_intents ALONE for the intent layer. (fight-los stays the math home.)
export { encode, decode, GRID_W, GRID_H }
