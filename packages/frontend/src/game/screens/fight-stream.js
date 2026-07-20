// board #49 (FIGHT — STREAM-PREVIEW clause): in a multi-peer dungeon fight the ACTIVE player's client
// STREAMS its turn actions (the drafted move / cast targets — PRE-commit) live over the p2p lobby room; RECEIVERS
// SIM-VERIFY each against THEIR OWN chain-derived Dungeon (AP/MP budget, range, LOS, legality — the SAME gates
// DungeonBoard's draft uses, mirroring dungeon_turn.move) and, if legal, RENDER it as a PREVIEW via the exact
// same `packet/fight*` events the koshi-2d renderer already plays; an illegal/impossible stream is DROPPED (the
// cheater-drop rule). On `commit_turn` landing, RECONCILE is automatic: dungeon_store's poll re-syncs every
// fighter to chain truth (`action/fight/sync` overwrites) and replays the CONFIRMED deltas — a matching preview
// is confirmed, a divergent one snaps to chain. Preview packets carry `preview: true`; confirmed ones (from
// dungeon_store.emit_fight_deltas) do not.
//
// CHAIN-AUTHORSHIP LAW (untouched): the stream is PREVIEW, NEVER authorship — p2p renders, the chain authors. NO
// fight action takes on-chain effect from a peer message; the ONLY fight txs remain commit_turn/pass_turn. A
// preview only nudges the LOCAL fight slice for the render, and the very next poll overwrites it with chain truth.
//
// LoC law: this is a SEPARATE module — it does NOT grow fight-overlay.js / fight.js / dungeon_store.js, which it
// hooks with a single idempotent `init_fight_stream()` call from the dungeon bridge.
//
// PLACEMENT GHOSTS — a THIRD stream kind (`'placement'`): picks aren't committed pre-start, so teammates
// should SEE where others intend to stand. Unlike move/cast this is COSMETIC ONLY, never a trust surface (no
// sim-verify, no legality gate — a lying ghost can't do anything) and folds straight into the fight core's own
// `placement_ghost` input (fold.js owns the GC: a chain-committed Placed supersedes it, GHOST_STALE_MS expires
// it); project.js/engine_view.placement_ghosts is the ONE render source, no second path here.

import { context } from '../store.js'
import { fight_view, fight_store, STATUS_PLACEMENT } from '@aresrpg/fight'
import { use_dungeon } from '../../world-shell/dungeon_store.js'
import { broadcast_fight_stream } from '../../p2p/lobby-room.js'
import { game_log } from '../../core/log.js'
import { GRID_W, GRID_H, encode, lineOfSight } from '@aresrpg/fight'
import { steered_path } from './fight-pathfinding.js'
import { use_dungeon_turn } from './dungeon-turn.js'

const STATUS_ACTIVE = 1
// Cast gate — mirrors DungeonBoard.jsx EXACTLY (dungeon_turn.move's apply_cast), so a receiver's verdict on a
// previewed cast == what commit_turn would actually allow on-chain.
const CAST_AP_COST = 4
const CAST_RANGE_MIN = 1
const CAST_RANGE_MAX = 4
// Per-turn refill budget (dungeon_turn.move player_ap_max/player_mp_max). The active seat's escrow ap/mp is a
// STALE pre-refill leftover until it commits (#14), so verify a previewed move/cast against the REFILLED max —
// else a legal preview (which commit_turn WOULD allow, since commit refills first) is wrongly cheater-dropped.
const PLAYER_AP_MAX = 6
const PLAYER_MP_MAX = 5

/** encoded cell (y*GRID_W+x) → {x,y} — inverse of fight-los `encode`. */
const decode = c => ({ x: c % GRID_W, y: (c / GRID_W) | 0 })
/** Manhattan distance between two ENCODED cells (matches DungeonBoard's own). */
const manhattan = (a, b) =>
  Math.abs((a % GRID_W) - (b % GRID_W)) + Math.abs(((a / GRID_W) | 0) - ((b / GRID_W) | 0))

/** The character id whose turn it is, or null if a mob's / not active. */
function active_character_id(dungeon) {
  if (dungeon.status !== STATUS_ACTIVE) return null
  const actor = dungeon.turn_queue[dungeon.turn_ptr]
  if (!actor || actor.is_mob) return null
  const seat = dungeon.escrow?.find((participant) => Number(participant.seat) === Number(actor.idx))
  return seat?.character ?? seat?.character_id ?? null
}

let installed = false

/**
 * Idempotent one-time install of BOTH sides of the stream. Called from dungeon_store's engine bridge on the first
 * sync — the listeners live for the app lifetime and no-op whenever there is no active dungeon fight for me.
 */
export function init_fight_stream() {
  if (installed) return
  installed = true
  context.events.on('packet/fightStream', on_peer_stream)
  // SENDER: the active player streams a draft pick the instant it changes (DungeonBoard writes move/cast targets
  // into use_dungeon_turn). Only fires when it's genuinely MY turn — guarded in stream_pick.
  use_dungeon_turn.subscribe((s, prev) => {
    if (s.move_target !== prev.move_target) stream_pick('move', s.move_target)
    if (s.cast_target !== prev.cast_target) stream_pick('cast', s.cast_target)
    // PLACEMENT GHOSTS (picks aren't committed pre-start — teammates should SEE where others intend to
    // stand"): the SAME stream, a THIRD kind — the click handler (voxel_fight_adapter.js) already writes every
    // local pick into this exact field via set_placement_pick.
    if (s.placement_pick !== prev.placement_pick) stream_pick('placement', s.placement_pick)
  })
}

/** Broadcast one drafted pick to peers — move/cast: only when it's genuinely MY turn in an ACTIVE dungeon;
 *  placement: every seat streams its own pick independently (no "active player" during placement). */
function stream_pick(kind, target) {
  if (target == null) return // a cleared/toggled-off pick — nothing to preview
  const dungeon = use_dungeon.getState().dungeon
  const fight = fight_view() // synchronous core view (S2 mirror kill)
  if (!dungeon || !fight) return
  const me = fight.my_entity_id
  if (!me || !dungeon.escrow.some((p) => (p.character ?? p.character_id) === me)) return
  if (kind === 'placement') {
    if (dungeon.status !== STATUS_PLACEMENT) return
    broadcast_fight_stream({ dungeon_id: dungeon.id, address: me, kind, target })
    return
  }
  if (dungeon.status !== STATUS_ACTIVE || fight.active_entity_id !== me) return // only the ACTIVE player streams its own turn
  broadcast_fight_stream({ dungeon_id: dungeon.id, address: me, kind, target })
}

/** Receive a peer's streamed pick. move/cast: SIM-VERIFY vs my chain state, render as a preview or DROP.
 *  placement: no sim-verify needed (cosmetic-only hint, never a trust surface — fold.js/store.js own the GC +
 *  own-seat exclusion) — fold it straight into the core as a `placement_ghost` input; project.js/the adapter
 *  paint it from there (ONE home, no second render path). */
function on_peer_stream({ dungeon_id, address, kind, target }) {
  const dungeon = use_dungeon.getState().dungeon
  if (!dungeon || dungeon.id !== dungeon_id) return
  const fight = fight_view() // synchronous core view (S2 mirror kill)
  if (!fight || address === fight.my_entity_id) return // ignore my own echo / render only OTHER peers

  if (kind === 'placement') {
    if (dungeon.status !== STATUS_PLACEMENT) return
    if (typeof target !== 'number') return
    if (!dungeon.escrow.some((p) => (p.character ?? p.character_id) === address)) return
    fight_store.getState().input({ type: 'placement_ghost', fight_id: dungeon_id, character: address, cell: target })
    return
  }

  if (dungeon.status !== STATUS_ACTIVE) return
  // The streamer must be the ACTUAL active seat on MY chain-derived state — a peer cannot preview another's turn.
  if (active_character_id(dungeon) !== address) return
  const seat = dungeon.escrow.find((p) => (p.character ?? p.character_id) === address)
  if (!seat || !seat.alive) return
  if (typeof target !== 'number') return

  if (kind === 'move') verify_and_render_move(dungeon, address, seat, target)
  else if (kind === 'cast') verify_and_render_cast(dungeon, address, seat, target)
}

/**
 * SIM-VERIFY a previewed MOVE (AP/MP budget + obstacle/occupied-aware reachability, the SAME steered BFS
 * DungeonBoard drafts with) then render the walk. Out of MP / blocked / no route → DROP.
 */
function verify_and_render_move(dungeon, address, seat, to_cell) {
  const obstacles = dungeon.obstacles ?? []
  const blocked = new Set()
  for (const p of dungeon.escrow) if (p.alive && p.cell !== seat.cell) blocked.add(p.cell)
  for (const m of dungeon.mobs) if (m.alive && m.cell !== seat.cell) blocked.add(m.cell)
  const obstacle_set = new Set(obstacles)
  const walk = ({ x, y }) =>
    x >= 0 && y >= 0 && x < GRID_W && y < GRID_H && !obstacle_set.has(encode(x, y)) && !blocked.has(encode(x, y))
  // the active seat drafts against its REFILLED turn budget (its escrow mp is the stale pre-refill leftover, #14)
  const path = steered_path(decode(seat.cell), decode(to_cell), PLAYER_MP_MAX, walk)
  if (!path.length) return // ILLEGAL (out of MP / blocked / same cell) — cheater-drop
  // S2 FLIP: the packet bus is dead (one reducer). Peer live-preview returns at S4 as a receipt relay through
  // the core's p2p input (FIGHT_REWRITE_DESIGN §4 S4); until then the sim-verify above remains the contract.
  game_log('fight-stream', 'peer move preview verified (render returns at S4 via the core p2p lane)', { path })
}

/**
 * SIM-VERIFY a previewed CAST (AP cost, living-mob target, Manhattan range + LOS from the caster's chain cell —
 * mirrors DungeonBoard.castable) then render the cast VFX with NO damage numbers (the chain authors real damage
 * on commit). Not enough AP / not a living mob / out of range / no LOS → DROP.
 */
function verify_and_render_cast(dungeon, address, seat, target_cell) {
  if (PLAYER_AP_MAX < CAST_AP_COST) return // active seat drafts against its REFILLED ap, not the stale leftover (#14)
  const mob = dungeon.mobs.find(m => m.cell === target_cell && m.alive)
  if (!mob) return
  const d = manhattan(seat.cell, target_cell)
  if (d < CAST_RANGE_MIN || d > CAST_RANGE_MAX) return
  // D284 twin of los_obstacles: sight clears through obstacles ∪ living bodies (players + mobs); endpoints (the
  // caster seat + the target) are self-excluded by losBlocks, so a body ON the target stays hittable.
  const los = [...(dungeon.obstacles ?? [])]
  for (const p of dungeon.escrow ?? []) if (p.alive) los.push(p.cell)
  for (const m of dungeon.mobs ?? []) if (m.alive) los.push(m.cell)
  if (!lineOfSight(seat.cell, target_cell, los)) return
  // S2 FLIP: dead bus — peer cast preview returns at S4 via the core p2p lane (see verify_and_render_move).
  game_log('fight-stream', 'peer cast preview verified (render returns at S4 via the core p2p lane)', {
    target_cell,
  })
}
