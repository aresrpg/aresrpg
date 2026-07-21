// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// fight/project.js — projections of the committed fight state. The HUD and the board read ONLY these selectors;
// they NEVER read `entries`/`log`/`sim` directly and NEVER write. `state = fold(log)`; every value here is a pure
// projection of that state (FIGHT_REWRITE_DESIGN §3). No fight logic lives here — only reads.
//
// TWO LEGACY-SHAPED VIEWS ride here (REUSE-FIRST):
//   · `engine_view(s)` — the FightSlice shape (fighters Map, active_entity_id, placement, ready…) every HUD
//     component reads SYNCHRONOUSLY via `use_fight_view()` / `fight_view()` below. The game-core `state.fight`
//     MIRROR is DEAD — two read paths for one fact used to exist: the copy folded through
//     game.js's async pump and lagged ≥1 dispatch cycle, the AP-desync root): this is the ONE read surface.
//   · `board_view(s)`  — the legacy `dungeon` view shape (escrow/mobs/status/board geometry) DungeonBoard,
//     phase.js and the board adapter read.
// Both project the PRESENTED state (fold at the renderer's ack floor) so the eye never sees state ahead of the
// beats; terminal truth (winner/is_over) reads COMMITTED so fight-end logic never hangs on presentation.

import { tackle_contest, tackle_losses } from '@aresrpg/sim/fight_tackle'
import { tackle_seed, turn_seed } from '@aresrpg/sim/turn_seed'
import { rng_next, rng_seed } from '@aresrpg/sim/prng'

import { GRID_W, GRID_H, decode as decode_xy, encode as encode_xy, bfsReachable } from './los.js'
import { participant_entity_id, participant_character_id } from './fight_control.js'
import {
  claimed_budget_state,
  committed_state,
  display_state,
  PLAYER_TURN_FLOOR_MS,
  presented_state,
  fight_store,
} from './store.js'
import { STATUS_ACTIVE, STATUS_FAILED, STATUS_PLACEMENT, STATUS_ROOM_CLEARED, STATUS_WON } from './board_state.js'

export const DUNGEON_BOARD_ORIGIN = { x: 0, y: 0 }

const decode_cell = (encoded, width) =>
  encoded == null ? null : { x: Number(encoded) % width, y: Math.floor(Number(encoded) / width) }

/** Every fighter as the board wants it — encoded `cell` plus a decoded `cell_xy` (grid_width from the Fight board). */
export const fighters = (state, grid_width = 20) =>
  Object.keys(state.fighters ?? {})
    .sort()
    .map((key) => {
      const f = state.fighters[key]
      return { ...f, cell_xy: decode_cell(f.cell, grid_width) }
    })

export const fighter = (state, key) => state.fighters?.[key] ?? null

/** The fighter whose turn it is (null between turns / in placement / once the fight is decided). */
export const active_fighter = (state) => (state.active ? (state.fighters?.[state.active] ?? null) : null)

export const active_key = (state) => state.active ?? null

/** Is it MY turn — the gate the END-TURN button and the input layer read. */
export const is_my_turn = (state) => state.active != null && state.active === state.my_key

export const deadline_ms = (state) => state.turn_deadline_ms ?? null

/** An active turn whose current fold did not observe a positive chain deadline. The retained numeric clock is
 *  display-only in this state: auto-submit is fail-closed, and the app-global sync chip surfaces the starvation. */
export const deadline_starved = (state) =>
  state.active != null && state.phase === 'active' && (state.winner ?? -1) === -1 && state.turn_deadline_fresh !== true

export const winner = (state) => state.winner ?? -1

export const phase = (state) => state.phase ?? 'active'

export const is_over = (state) => (state.winner ?? -1) !== -1

/** Chain-only terminal status. Optimistic actions can paint `status`, but can never populate this fact. */
export const chain_terminal_status = (state) => {
  const terminal = state.settlement?.chain_terminal
  if (!terminal) return null
  if (terminal.phase === 'defeat') return STATUS_FAILED
  return terminal.last_room ? STATUS_WON : STATUS_ROOM_CLEARED
}

/**
 * CLIENT-KNOWABLE, RECEIPT-PROVEN fight-over — the dialog OPEN gate (shape ②, seat ruling 2026-07-19: the Victory
 * dialog mounts on client-knowable state, NEVER gated solely on the terminal settle read; a won fight showing
 * nothing is the dead-air class, rank-2 FAIL). Reads the COMMITTED fold (intents EXCLUDED — never optimistic: an
 * unconfirmed prediction must never open a victory card), so it flips the instant the KILLING RECEIPT folds every
 * enemy mob dead — the moment the fight is provably over on-chain (the chain runs victory_check in that same tx),
 * even while the settle terminal (chain_terminal) lags behind. VICTORY only, and only on the LAST room (a
 * non-terminal room clear is the RewardRecap's, not the terminal card's); DEFEAT stays on the chain-terminal path
 * (its wipe/abandon recap doors own it). The REWARDS stay receipt-gated — this opens the card PENDING; the settle
 * receipt (ResultOpened) fills xp/loot (a17c9fc: never fabricate reward content). @returns {0 | null} */
export const decided_outcome = (state) => {
  const c = committed_state(state)
  const mobs = Object.values(c.fighters ?? {}).filter((f) => f.is_mob)
  if (!mobs.length || mobs.some((f) => f.alive)) return null // no enemy provably wiped ⇒ undecided
  // SOUND victory ONLY: I am still standing. all-mobs-dead ∧ my-seat-alive ⟹ the chain CANNOT call it a defeat
  // (all_players_dead is false — turns.move resolves defeat FIRST on a mutual wipe), so this is an unambiguous win,
  // never a mutual-wipe false-positive. A DOWNED winner (party won, I died) defers to the chain terminal — the
  // rarer case the settle read owns; it is not the standing-winner dead-air the ruling targets.
  const me = state.my_key ? c.fighters?.[state.my_key] : null
  if (!me?.alive) return null
  const { run = null, rooms_total = 0 } = state.ctx ?? {}
  const last_room = !(run && Number(rooms_total) > 0 && Number(run.room ?? 1) < Number(rooms_total))
  return last_room ? 0 : null // a room clear with rooms remaining is NOT a terminal victory dialog
}

/** Victory/Defeat framing winner — the dialog OPEN gate (claim / the terminal effect read this). Chain-terminal
 *  truth (the settle read) wins when present; absent it, the CLIENT-KNOWABLE receipt-proven fight-over opens the
 *  dialog (shape ②) so a lagged settle never dead-airs a won fight. Never exposes an OPTIMISTIC terminal —
 *  `decided_outcome` reads the committed fold, and chain_terminal is settle-gated. @returns {0 | 1 | null} */
export const outcome_winner = (state) => {
  const status = chain_terminal_status(state)
  if (status === STATUS_WON) return 0
  if (status === STATUS_FAILED) return 1
  if (status === STATUS_ROOM_CLEARED) return null // non-terminal — the room-clear path owns it
  return decided_outcome(state)
}

/** One transaction request per chain confirmation; consumed delivery is visible only to the initial tx handoff. */
export const settlement_request = (state, { include_consumed = false } = {}) => {
  const terminal = state.settlement?.chain_terminal
  if (!terminal || (terminal.consumed && !include_consumed)) return null
  const attempt = state.settlement?.attempt
  if (attempt && !(attempt.verdict === 'transient' && attempt.signal !== terminal.signal)) return null
  return { ...terminal, status: chain_terminal_status(state) }
}

/** Presentation is still draining when unacked NON-LOCAL wave turns remain — the derived `presenting` flag
 *  (never a stored latch). My OWN local beats never gate me: only a mob/peer replay disarms input — the
 *  per-cast input disease must not come back through this door. */
export const presenting = (state) => (state.wave ?? []).some((t) => !t.is_local)

/** ANY wave still draining — LOCAL death/displacement legs included, unlike `presenting` (nonlocal-only, the
 *  input-arming lane). The TERMINAL collapse drain condition (register #42): a fight that ends on MY OWN kill
 *  must hold its victory/defeat card until that local killing queue (attack→hit→floater→despawn) presents, not
 *  only until a nonlocal wave clears. Never gates input — only the terminal hold reads it. */
export const draining = (state) => (state.wave ?? []).length > 0

/** MY OWN cast/weapon-strike sequence is presenting — a LOCAL wave turn still unacked that carries a 'cast' beat
 *  (while a spell's vfx/sequence plays, the MP zone stays hidden so it can't be misclicked into a move).
 *  Narrower than `draining` (ANY wave, including my own WALK beats — the D254
 *  cumulative-move chaining must keep working while a walk animates: hiding the zone mid-walk would block
 *  chaining a 2nd segment) and orthogonal to `presenting` (nonlocal-only, the general input-arming lane shared
 *  by END TURN / the raw click relay / hover — untouched, so rapid cast queueing during my own VFX stays fluid;
 *  the per-cast input disease must not come back through THAT door). The ONE derived fact both the MP-zone wash
 *  (move_wash, below) and the click affordance (DungeonBoard's `reachable`, off this same engine_view field)
 *  gate on — never a second UI-side flag. Beat-kind vocabulary: fight_render_events.js tags every Cast-derived
 *  beat 'cast' (predicted and receipt playback share one producer — present.js's own header doc), a Moved-
 *  derived beat 'move'/'arrival' — so this reads purely off data already on the wave, no new store field. */
export const cast_presenting = (state) =>
  (state.wave ?? []).some((t) => t.is_local && (t.beats ?? []).some((b) => b.kind === 'cast'))

/** Fighters whose KILLING damage beat still rides an UNACKED wave turn — presentation owns their liveness (the
 *  pacing law: the attack, its vfx, the hit, and the floating number all play out before a kill can disappear).
 *  #170 (5th recurrence): there is no separate 'death'-kind beat anymore — held on the 'damage' beat's `killed`
 *  flag instead (the presenter derives the actual death visual from the presented-state edge this hold produces,
 *  never from an event-shaped beat). The core folds hp→0 the instant a kill is known (chain parity — never
 *  delayed); these ids keep `engine_view.dead` FALSE so the adapter's rig reconcile + HUD hold the fighter through
 *  its sequenced attack → vfx → hit → floater → death, despawning exactly when the killing turn acks
 *  ('presented' = the drain, capped by the store's tick watchdog — never a timer). LOCAL kills are the live
 *  case (intents paint instantly, so the presented_state entry mask can't hold them); non-local kills are
 *  already entry-masked, so this is one uniform rule, not a second lane. Targeting stays truthful:
 *  board_view.alive and every committed projection are untouched (casting at a corpse must stay
 *  impossible — an aborted tx burns gas). */
const death_presenting_ids = (s) => {
  const ids = new Set()
  for (const t of s.wave ?? [])
    for (const b of t.beats ?? [])
      if (b.kind === 'damage' && b.payload?.killed && b.payload?.target_id) ids.add(b.payload.target_id)
  return ids
}

/** The reducer clock says this playable turn should submit; busy suppresses the level synchronously at the edge. */
export const commit_due = (state) => !!state.commit_due && !state.busy

/**
 * Milliseconds left on MY per-turn min-turn floor (0 once a human-natural 3s has elapsed, or when it isn't my
 * turn). The button greys out ONLY for this remainder — one floor per turn, NOT per cast.
 */
export const min_turn_left = (state, now = Date.now()) => {
  if (!is_my_turn(state) || state.turn_started_at == null) return 0
  return Math.max(0, state.turn_started_at + PLAYER_TURN_FLOOR_MS - now)
}

/** Can I commit / end my turn right now — my turn, fight live, and the min-turn floor elapsed. */
export const can_end_turn = (state, now = Date.now()) =>
  is_my_turn(state) && !is_over(state) && min_turn_left(state, now) === 0

// ── The legacy-shaped projections (the S2 flip surface) ─────────────────────────────────────────────────────

const seat_key = (seat) => `p${seat}`
const mob_key = (idx) => `m${idx}`
const positive_delta = (value, base) => {
  const delta = Number(value) - Number(base)
  return Number.isFinite(delta) ? Math.max(0, delta) : 0
}

/** MP from this seat's still-live prediction rows. Unlike a spell-template/cast-path sum this is keyed by the
 * core's per-cast intent batches, so M2b claim retirement removes exactly the confirmed cast and leaves unrelated
 * pending grants intact. @param {any[]} log @param {number} seat */
const drafted_mp_grant = (log, seat) =>
  (log ?? []).reduce(
    (sum, e) =>
      e.source === 'intent' &&
      e.kind === 'Granted' &&
      Number(e.point_kind) === 1 &&
      !e.target_is_mob &&
      Number(e.target_idx) === seat
        ? sum + (Number(e.granted) || 0)
        : sum,
    0
  )

/** A mob's authoritative HP: snapshot + peer/receipt tail, with this client's optimistic intents excluded. */
export const committed_mob_hp = (state, idx) => committed_state(state).fighters?.[mob_key(idx)]?.hp ?? null

/** Entity id of a thin-fold key (`p0` → the seat's character id, `m2` → `mob-2`), resolved through the view. */
export const entity_id_of_key = (view, key) => {
  if (!key || !view) return null
  if (key[0] === 'm') return `mob-${Number(key.slice(1))}`
  const row = view.escrow?.[Number(key.slice(1))]
  return row ? (participant_entity_id(row) ?? null) : null
}

/** The board terrain for the arena — canonical GRID, non-walkable = 1: obstacles ∪ holes ∪ OUT-OF-BOARD.
 *  Out-of-board = beyond the true grid dims OR outside the stored shape mask (a shaped board carves the
 *  canonical window — e.g. an octagon's corners). BOOT22 dead-click root: this projection used to leave
 *  out-of-shape cells 0 ("walkable"), so an arena consumer could aim at a cell the board never built —
 *  board_picking correctly nulls there (D75: void cells are never pickable), a silent dead click. One home
 *  for walkability truth: the arena gates on the SAME shape (dims + mask) the rendered board is built from. */
const board_cells = (view) => {
  // D771 (no invented dims): a dims-less view — the OPEN roam plane carries no BoardGeom by design — has NO
  // tactical arena; every canonical cell stays non-walkable (1) instead of fabricating a phantom full
  // GRID_W×GRID_H walkable board. A real fight view carries positive dims → identical clamping as before.
  const raw_w = Number(view.grid_width)
  const raw_h = Number(view.grid_height)
  const width = raw_w > 0 ? Math.min(raw_w, GRID_W) : 0
  const height = raw_h > 0 ? Math.min(raw_h, GRID_H) : 0
  const mask = view.shape_mask // canonical in-shape cell Set (board_state decode) — absent = full-rect board
  const cells = new Array(GRID_W * GRID_H).fill(1)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const idx = y * GRID_W + x
      if (!mask || mask.has(idx)) cells[idx] = 0
    }
  for (const idx of view.obstacles ?? []) if (idx >= 0 && idx < cells.length) cells[idx] = 1
  for (const idx of view.holes ?? []) if (idx >= 0 && idx < cells.length) cells[idx] = 1
  return cells
}

/** Fold-derived lifecycle status: the view's chain status advanced by any fresher folded events. */
const projected_status = (s) => {
  const view_status = s.view?.status ?? STATUS_ACTIVE
  const { run = null, rooms_total = 0 } = s.ctx ?? {}
  if (s.winner === 0) return run && rooms_total > 0 && (run.room ?? 1) < rooms_total ? STATUS_ROOM_CLEARED : STATUS_WON
  if (s.winner === 1) return STATUS_FAILED
  // A folded TurnStarted while the snapshot still says placement = the chain activated under us.
  if (view_status === STATUS_PLACEMENT && s.active != null) return STATUS_ACTIVE
  return view_status
}

/**
 * The legacy `dungeon` view — the adopted board snapshot with the presented fold overlaid on its rows.
 * DungeonBoard / phase.js / dungeon_dimension / the board adapter read exactly this shape (fight_view's
 * contract, preserved verbatim through the flip).
 */
export const board_view = (s) => {
  const { view } = s
  if (!view) return null
  const p = presented_state(s)
  const d = display_state(s) // DISPLAY cell only — holds an in-flight walk at its pre-move cell (SNAP-THEN-RUN)
  const c = committed_state(s)
  const budget = claimed_budget_state(s)
  const escrow = (view.escrow ?? []).map((row, seat) => {
    const cf = c.fighters?.[seat_key(seat)]
    const bf = budget.fighters?.[seat_key(seat)]
    const canonical_ap = cf?.ap ?? row.ap
    const canonical_mp = cf?.mp ?? row.mp
    const budget_ap = bf?.ap ?? canonical_ap
    const budget_mp = bf?.mp ?? canonical_mp
    // The seat's CHAIN-COMMITTED anchor (my drafted intents excluded): the pool DungeonBoard's draft math
    // subtracts its OWN cast_path/move_path ledger from. Accepted chain-silent point grants join ONLY the AP/MP
    // budget: their Cast/sibling claim is authoritative enough for legality, but they remain outside canonical
    // history. `pending_mp` is the exact per-intent remainder after M2b claim retirement; DungeonBoard uses it
    // instead of correlating an aggregate claimed delta against spell templates.
    // Cell/HP remain strictly canonical. Never use the presented values below — those already fold the draft's
    // ap_cost/mp_left intents, so budgeting against them counts every queued action TWICE (gate9 P1).
    const committed = {
      ap: budget_ap,
      mp: budget_mp,
      claimed_ap: positive_delta(budget_ap, canonical_ap),
      claimed_mp: positive_delta(budget_mp, canonical_mp),
      pending_mp: drafted_mp_grant(s.log, seat),
      cell: cf?.cell ?? row.cell,
      hp: cf?.hp ?? row.hp,
      alive: cf?.hp != null ? cf.alive : row.alive,
    }
    const f = p.fighters?.[seat_key(seat)]
    if (!f) return { ...row, committed }
    return {
      ...row,
      committed,
      // The rendered cell is the DISPLAY fold — my own walk holds at its pre-move cell until the walk beat
      // presents (never jumps ahead of the run); every other fact stays the effective/presented value.
      cell: d.fighters?.[seat_key(seat)]?.cell ?? f.cell ?? row.cell,
      hp: f.hp ?? row.hp,
      alive: f.hp != null ? f.alive : row.alive,
      ready: f.ready ?? row.ready,
      // TURN-START BUDGET: the fold's predicted begin_turn refill wins over the stale pre-refill snapshot; row.ap/mp
      // is the authoritative fallback (a post-refill read prunes the overlay → f.ap/mp go null → the snapshot shows).
      ap: f.ap ?? row.ap,
      mp: f.mp ?? row.mp,
    }
  })
  const mobs = (view.mobs ?? []).map((row, idx) => {
    const cf = c.fighters?.[mob_key(idx)]
    const committed = {
      cell: cf?.cell ?? row.cell,
      hp: cf?.hp ?? row.hp,
      alive: cf?.hp != null ? cf.alive : row.alive,
    }
    const f = p.fighters?.[mob_key(idx)]
    if (!f) return { ...row, committed }
    const cell = d.fighters?.[mob_key(idx)]?.cell ?? f.cell ?? row.cell // DISPLAY cell (walk-hold); rest presented
    return { ...row, committed, cell, hp: f.hp ?? row.hp, alive: f.hp != null ? f.alive : row.alive }
  })
  return {
    ...view,
    escrow,
    mobs,
    status: projected_status(s), // committed fold decides terminal truth (never hangs on presentation)
    chain_terminal: chain_terminal_status(s),
    // The dialog OPEN gate (shape ②): client-knowable, receipt-proven fight-over — the terminal effect fires
    // claim() off THIS the instant the killing receipt folds, so a lagged settle never dead-airs a won fight.
    decided_winner: decided_outcome(s),
    settlement_request: settlement_request(s),
    turn_deadline_ms: s.turn_deadline_ms ?? view.turn_deadline_ms,
  }
}

/**
 * The FightSlice shape (fighters Map, turn/placement machine, ready set) — projected from the PRESENTED
 * state. Every HUD consumer reads it SYNCHRONOUSLY via `use_fight_view()` / `fight_view()` (the memoized
 * doors below) — the async game-core mirror is dead. `roster` (my kiosk characters) resolves the local seat
 * names; its ONE home is the core's own ctx (`ctx.roster`, pumped by the fight edge module on sui_data), the
 * param remains as a pure-injection override for tests/board_fight_authority.
 */
export const engine_view = (s, { roster = s.ctx?.roster ?? [] } = {}) => {
  const { view } = s
  if (!view) return null
  const p = presented_state(s)
  const d = display_state(s) // DISPLAY cell only — an in-flight walk holds at its pre-move cell (SNAP-THEN-RUN)
  const c = committed_state(s)
  const death_hold = death_presenting_ids(s) // liveness-only mask: dead presents at the killing turn's ack
  // LEG P — while a peer/mob replay drains, the HP NUMBER must hold with the beat: the turn card only updates
  // once the vfx ends. `presented_health` = the paced presented fold during a wave, the settled committed value
  // when nothing presents. `health` stays the effective/predicted fold; the timeline card reads presented_health.
  const wave_presenting = presenting(s)
  // LEG Q — every active fighter status (was invisibility-only) as the effect-badge array: raw chain ints, one home
  // (the fold's per-fighter `statuses`); `invisible` stays derived from a kind-27 row. Badges read this via engine_view.
  const effects_of = (fighter) =>
    (fighter?.statuses ?? []).map((st, i) => ({
      id: `${st.kind}:${i}`,
      kind: st.kind,
      remaining_turns: st.remaining_turns,
      element: st.element,
      value: st.value,
      stat: st.stat,
      chance: st.chance,
    }))
  const ctx = s.ctx ?? {}
  const map = new Map()
  const ready = new Set()
  for (const [seat, row] of (view.escrow ?? []).entries()) {
    const entity_id = participant_entity_id(row)
    if (!entity_id) continue
    const f = p.fighters?.[seat_key(seat)] ?? {}
    const cf = c.fighters?.[seat_key(seat)] ?? {}
    const character_id = participant_character_id(row)
    const roster_name = roster.find((c) => c.id === character_id)?.name
    if (f.ready ?? row.ready) ready.add(entity_id)
    map.set(entity_id, {
      id: entity_id,
      owner: row.addr,
      character_id,
      name: row.name || roster_name || `${String(row.addr).slice(0, 6)}…${String(row.addr).slice(-4)}`,
      team: 0,
      // DISPLAY cell — my own walk holds at its pre-move cell until the walk beat presents (the rig follows
      // the run, never teleports to the target ahead of it); health/ap/mp stay the effective/presented fold.
      cell: decode_xy(d.fighters?.[seat_key(seat)]?.cell ?? f.cell ?? row.cell),
      health: f.hp ?? row.hp,
      presented_health: wave_presenting ? (f.hp ?? row.hp) : (cf.hp ?? row.hp),
      committed_health: cf.hp ?? row.hp,
      committed_alive: cf.hp != null ? cf.alive : row.alive,
      committed_dead: !(cf.hp != null ? cf.alive : row.alive),
      health_max: row.max_hp,
      effects: effects_of(f),
      // TURN-START BUDGET: the fold predicts the begin_turn refill so the budget paints the instant it's my turn
      // (the TurnStarted event omits ap/mp); the snapshot row.ap/mp reconciles the moment a post-refill read adopts.
      ap: f.ap ?? row.ap,
      ap_max: row.base_ap,
      mp: f.mp ?? row.mp,
      mp_max: row.base_mp,
      level: 1,
      is_player: true,
      dead:
        !death_hold.has(entity_id) &&
        ((s.busy && s.optimistic_dead?.[seat_key(seat)] != null) || (f.hp != null ? !f.alive : !row.alive)),
      class_id: row.classe || undefined,
      hue: 0, // was color_to_hue(0) ≡ 0 — a constant call; the game/data/color edge died with the promotion
      colors: null,
      invisible: !!f.invisible,
    })
  }
  ;(view.mobs ?? []).forEach((m, i) => {
    const f = p.fighters?.[mob_key(i)] ?? {}
    const cf = c.fighters?.[mob_key(i)] ?? {}
    map.set(`mob-${i}`, {
      id: `mob-${i}`,
      variant: m.template,
      name: view.mob_names?.[m.template] || 'Mob',
      team: 1,
      cell: decode_xy(d.fighters?.[mob_key(i)]?.cell ?? f.cell ?? m.cell), // DISPLAY cell (walk-hold)
      health: f.hp ?? m.hp,
      presented_health: wave_presenting ? (f.hp ?? m.hp) : (cf.hp ?? m.hp),
      committed_health: cf.hp ?? m.hp,
      committed_alive: cf.hp != null ? cf.alive : m.alive,
      committed_dead: !(cf.hp != null ? cf.alive : m.alive),
      health_max: m.max_hp,
      effects: effects_of(f),
      ap: m.ap ?? 0,
      ap_max: m.base_ap ?? 0,
      mp: m.mp ?? 0,
      mp_max: m.base_mp ?? 0,
      level: m.level || 1,
      is_player: false,
      dead:
        !death_hold.has(`mob-${i}`) &&
        ((s.busy && s.optimistic_dead?.[mob_key(i)] != null) || (f.hp != null ? !f.alive : !m.alive)),
      element: m.element,
      invisible: !!f.invisible,
    })
  })
  const status = projected_status(s)
  const placement = status === STATUS_PLACEMENT
  const address = ctx.address ?? null
  const controlled_entity_ids = (view.escrow ?? [])
    .filter((row) => address && String(row.addr) === String(address))
    .map(participant_entity_id)
    .filter(Boolean)
  const my_entity_id = entity_id_of_key(view, s.my_key) ?? ctx.my_entity_id ?? controlled_entity_ids[0] ?? null
  const active_entity_id = entity_id_of_key(view, p.active)
  // ④+⑦b THE LIVE trap projection (ruled 07-19) — the sim door reads THIS (state_from_view/evolve_flush_casts),
  // never trap_overlay. A durable `my_traps` cell is LIVE unless it's `gone` (a committed fighter detonated it —
  // permanent) OR currently under a living PRESENTED fighter (the optimistic spring — immediate + reversible if
  // the prediction rolls back). Encoded cells, deduped.
  const trap_occupied = new Set(
    Object.values(p.fighters ?? {})
      .filter((f) => f.alive && f.cell != null)
      .map((f) => f.cell)
  )
  const my_trap_cells = [
    ...new Set(
      (s.my_traps ?? [])
        .filter((t) => !t.gone)
        .flatMap((t) => t.cells ?? [])
        .filter((c) => !trap_occupied.has(c))
    ),
  ]
  // ① each LIVE trap cell → its detonation payload, so the sim door rebuilds the trap WITH damage (not payload:[]).
  // Same live-cell predicate as my_trap_cells (non-gone, not presented-occupied); first record wins a shared cell.
  // my_traps itself stays a flat encoded-cell list — the payload rides this parallel channel.
  const my_trap_payloads = {}
  for (const t of s.my_traps ?? []) {
    if (t.gone) continue
    for (const c of t.cells ?? []) {
      if (trap_occupied.has(c) || c in my_trap_payloads) continue
      my_trap_payloads[c] = t.payload ?? []
    }
  }
  // THE LIVE glyph zone projection — every non-gone glyph's full AoE, deduped (the render paints these as the
  // persistent orange ground zone). Unlike traps there is NO occupied-cell exclusion: a glyph is not sprung by a
  // fighter standing on it (check_glyphs persists), so the zone stays lit under whoever walks through it.
  const my_glyph_cells = [...new Set((s.my_glyphs ?? []).filter((g) => !g.gone).flatMap((g) => g.cells ?? []))]
  // PLACEMENT GHOSTS — peers' uncommitted picks (p2p cosmetic hint), gated to the placement phase itself: once
  // the fight leaves placement (projected_status flips to STATUS_ACTIVE — see `placement` above) this reads []
  // even a tick before the fold's own GC catches up, so "on fight start" never depends on GC timing.
  const placement_ghosts = placement
    ? Object.entries(s.placement_ghosts ?? {}).map(([character, g]) => ({ character, cell: g.cell }))
    : []
  return {
    fight_id: view.id,
    my_traps: my_trap_cells,
    my_trap_payloads,
    my_glyphs: my_glyph_cells,
    placement_ghosts,
    arena: { width: GRID_W, height: GRID_H, cells: board_cells(view) },
    origin: DUNGEON_BOARD_ORIGIN,
    fighters: map,
    turn_order: (view.turn_queue ?? [])
      .map((a) => (a.is_mob ? `mob-${a.idx}` : participant_entity_id(view.escrow?.[a.idx] ?? {})))
      .filter(Boolean),
    active_entity_id,
    // R4 — the PRESENTATION clock's actor: the head unacked non-local wave turn (a real entity id — 'mob-N'
    // or a character id). Null while nothing drains. The chain clock (active_entity_id) is untouched.
    presenting_entity_id: (s.wave ?? []).find((t) => !t.is_local)?.source_id ?? null,
    my_entity_id,
    controlled_entity_ids,
    active_controlled_character_id:
      active_entity_id && controlled_entity_ids.includes(active_entity_id) ? active_entity_id : null,
    spectator: false,
    hand: s.hand ?? [],
    draft_count: s.staged?.length ?? 0,
    deck_size: 0,
    discard_size: 0,
    ap_reserve: 0,
    turn_number: 0,
    // MY seat-turn counter (fold-derived, deadline-independent) — the cooldown gate's `t`: DungeonBoard/DeckCluster
    // read on_cooldown(last_cast_turn[spell], my_turn_no, cd) off this, and stamp last_cast_turn = my_turn_no at commit.
    my_turn_no: s.my_turn_no ?? 0,
    winner: s.winner ?? -1,
    placement,
    placement_deadline_ms: view.placement_deadline_ms ?? 0,
    turn_ms: view.turn_ms ?? 0,
    placement_cells: placement ? { 0: (view.start_cells ?? []).map(decode_xy), 1: [] } : { 0: [], 1: [] },
    turn_deadline_ms: s.turn_deadline_ms ?? view.turn_deadline_ms ?? 0,
    deadline_starved: deadline_starved(s),
    ready,
    armed_spell_id: s.armed_spell_id ?? null,
    hovered_spell_id: s.hovered_spell_id ?? null,
    summary: null,
    presenting: presenting(s),
    // MP-ZONE MISCLICK GUARD — projected so DungeonBoard's click gate (`reachable`) reads the SAME
    // fact move_wash suppresses on, never a second UI-side flag (see cast_presenting's doc above).
    cast_presenting: cast_presenting(s),
  }
}

// ── THE ONE SYNCHRONOUS READ SURFACE (S2 mirror kill) ─────────────────────────────────────────────────────
// Core state objects are immutable per `set` and `ctx.roster` lives INSIDE them, so ONE WeakMap key memoizes
// the whole projection: every consumer (React hook, adapter, dev probe, run store) shares one engine_view
// computation per core change — and reference-stable output keeps zustand selectors loop-free.

const VIEWS = new WeakMap()

/** Memoized engine_view of a core state — the selector consumers subscribe with. */
export const engine_view_of = (s) => {
  if (!VIEWS.has(s)) VIEWS.set(s, engine_view(s))
  return VIEWS.get(s)
}

/** The live fight view — SYNCHRONOUS core truth, never a lagging copy. The React binding
 *  (`use_fight_view`) lives in game/store.js beside use_game_state: the fight core stays react-free
 *  (depcruise fight-core-hermetic, a hard-zero ratchet). */
export const fight_view = () => engine_view_of(fight_store.getState())

// ── M3 RENDER-CONTRACT PROJECTIONS (D768/D769 clause 3: the renderer consumes {object, timing} and computes
//    NOTHING — every which-cells / may-I-input DECISION below moved here from the board adapter) ─────────────

/** END-TURN PRESS LAW + PRESENTATION GATE — ONE predicate for every turn-input surface:
 *  the my-turn wash, the raw cell click/hover relays, and FightControls' 3-state. Moved verbatim from
 *  world-shell/voxel_fight_folds (M3: the input-arming decision is core law; the folds file re-exports this).
 *  `busy` is the run store's tx single-flight flag — true from commit_turn's FIRST line (END TURN press or a
 *  background auto-commit) through the whole in-flight window, so the wash/picking disarm at PRESS; a refused
 *  commit clears it with my_turn still true and the surfaces honestly restore. `presenting` disarms while a
 *  mob/peer replay drains (chain truth ⋀ presentation done) — full rationale in the original fold's git history.
 *  @param {boolean} my_turn @param {boolean} busy @param {boolean} [presenting_now] */
export const turn_input_armed = (my_turn, busy, presenting_now = false) => my_turn && !busy && !presenting_now

/** The state-shaped arming door: my PLAYABLE turn (committed active = me, fight undecided), not busy, nothing
 *  presenting. `busy` stays an edge INPUT — the run store owns tx single-flight across MORE than turn commits
 *  (engage/place/settle), wider than the core's own commit-flight `s.busy`. */
export const input_armed = (s, { busy = false } = {}) =>
  turn_input_armed(is_my_turn(s) && !is_over(s), busy, presenting(s))

/** Encoded orthogonal neighbours of an encoded cell, row-safe (never wraps an edge column). */
const neighbors_of = (cell) => {
  const { x, y } = decode_xy(cell) ?? { x: 0, y: 0 }
  const out = []
  if (x > 0) out.push(encode_xy(x - 1, y))
  if (x < GRID_W - 1) out.push(encode_xy(x + 1, y))
  if (y > 0) out.push(encode_xy(x, y - 1))
  if (y < GRID_H - 1) out.push(encode_xy(x, y + 1))
  return out
}

/** Legacy first-kind classification retained for compatibility diagnostics. The #398 commit path no longer
 *  groups on this value: `commit_turn_ptb` executes the staged sequence exactly. */
export const draft_cast_first = (log) => {
  const first = (kind) =>
    Math.min(
      Infinity,
      ...(log ?? [])
        .filter((e) => e.source === 'intent' && (e.kind === kind || (kind === 'Cast' && e.kind === 'CastAnchor')))
        .map((e) => e.event_idx)
    )
  return first('Cast') <= first('Moved')
}

/** THE TACKLE ZONE SCAN (chain twin — tackle.move locker_agilities): the agilities of every living enemy
 *  orthogonally adjacent to ME at the eye's fold. Enemies of a seat = every living mob ∪ every living
 *  OTHER-team seat (PvP). Death exempts a tackler; invisibility does NOT (bodies stay physical — the chain
 *  rule, verbatim). Agility rides the view rows (board_state escrow/mob `agility`, the raw chain stats).
 *  #398: the NEXT move is appended after the entire current draft prefix, so both the runner and its enemies read
 *  the presented prefix. A preceding push/death has already resolved; a later action does not exist yet. */
const tackle_lockers = (s, me, my_team) => {
  const enemies = presented_state(s)
  const adjacent = new Set(neighbors_of(me.cell))
  const lockers = []
  for (const f of Object.values(enemies.fighters ?? {})) {
    if (f.key === s.my_key || !f.alive || f.cell == null || !adjacent.has(f.cell)) continue
    const idx = Number(String(f.key).slice(1))
    if (f.is_mob) lockers.push(Number(s.view.mobs?.[idx]?.agility ?? 0))
    else if (Number(s.view.escrow?.[idx]?.team ?? 0) !== my_team)
      lockers.push(Number(s.view.escrow?.[idx]?.agility ?? 0))
  }
  return lockers
}

/** The chain slot my NEXT move's tackle roll folds with (actions.move: `participant::casts_this_turn` at the
 *  move's execution). casts_this_turn resets every turn on-chain, so the base is the snapshot row UNLESS my
 *  own TurnStarted rides the post-view tail (fresh turn ⇒ 0); every Cast in the ordered tail for my seat counts on
 *  top. Receipt and intent casts both precede the NEXT appended move; weapon strikes are Casts in this log too. */
const my_next_move_slot = (s, seat, row) => {
  let base = Number(row.casts_this_turn ?? 0)
  let count = 0
  for (const e of s.log ?? []) {
    if (e.kind === 'TurnStarted' && !e.is_mob && Number(e.idx) === seat) {
      base = 0
      count = 0
    } else if (e.kind === 'Cast' && !e.caster_is_mob && Number(e.caster_idx) === seat) count++
  }
  return base + count
}

/** The presentation-truth blocked set for movement: board terrain (obstacles ∪ holes ∪ out-of-shape) plus every
 *  OTHER living presented body — the same truth the committed move charges, at the eye's fold. */
const wash_blocked = (view, p, my_key) => {
  const cells = board_cells(view)
  const blocked = new Set()
  for (let i = 0; i < cells.length; i++) if (cells[i]) blocked.add(i)
  for (const f of Object.values(p.fighters ?? {}))
    if (f.key !== my_key && f.alive && f.cell != null) blocked.add(f.cell)
  return blocked
}

/** ONE deterministic tackle roll — the chain twin of actions.move: spell_formula::tackle_seed(turn_seed, slot,
 *  live mp) → prng::rng_next → the move ESCAPES iff draw % den < num. Returns the pool forfeit fight_tackle
 *  strips on a FAILED escape (tackle_losses, golden-pinned), or null when the roll escapes. Pure; the SINGLE
 *  home for the roll+loss contest — move_wash folds it (retry, reads only mp_lost), next_move_tackle calls it
 *  once (reads both pools). No copy: the sim primitives compose here and nowhere else. */
const tackle_roll = (tseed, slot, mp, ap, num, den) => {
  const draw = rng_next(rng_seed(tackle_seed(tseed, slot, mp))).value
  if (draw % den < num) return null // this roll escapes — the move walks free
  return tackle_losses(ap, mp, num, den)
}

/**
 * THE MOVE WASH — the which-cells decision for the board's movement paint, in the core (M3; the adapter maps
 * encoded → {x,y} and calls set_cell_state, deciding nothing).
 *
 * TACKLE LAW: the light-red band shows ONLY while ACTUALLY tackled, covers ONLY "the MP
 * we can't spend or WILL loose by trying", respects max range (green ∪ red = the live-MP reach), and NEVER
 * triggers on plain MP spending. A PLAYER move's contest is DETERMINISTIC + PREVIEWABLE (actions.move:
 * tackle_seed(turn_seed, casts_this_turn, live mp) — the golden-pinned sim mirror), so "actually tackled" is
 * a FACT, not a probability: the wash PREVIEWS the exact roll chain — an escaping next roll paints NO red
 * (the move walks free, exactly as the chain will resolve it); a failing one folds the failure chain (each
 * denial strips ceil(mp·lost/den) ≥ 1 MP and reprices the next roll) to the exact MP the bites WILL eat.
 * A view without world_seed/spawn_id (legacy/partial read) can't derive the roll — it keeps the fraction
 * risk-band as the honest degraded paint.
 *
 * `targeting` is an edge input: an AFFORDABLE armed spell puts the board in cast mode (the blue ranges own it)
 * — its truth needs the frontend seed row (AP cost), unavailable core-side; the adapter passes the verdict of
 * its existing pure fold (wash_armed_spell). `busy` = the run store's single-flight flag (see input_armed).
 *
 * @param {any} s the fight store state
 * @param {{ busy?: boolean, targeting?: boolean }} [edge]
 * @returns {{ armed: boolean, tackled: boolean, reach: number[], tackle_lost: number[] }} encoded cell arrays:
 *   `reach` = green (what the first ESCAPING attempt still reaches), `tackle_lost` = light red (the remainder).
 */
export const move_wash = (s, { busy = false, targeting = false } = {}) => {
  // RULING 2026-07-19 (misclick-to-move guard): MY OWN cast/weapon-strike VFX disarms the wash too — see
  // cast_presenting's doc for why this is narrower than `draining` and orthogonal to `presenting`/`input_armed`.
  const armed = input_armed(s, { busy }) && !cast_presenting(s)
  if (!armed || targeting || !s.view) return { armed, tackled: false, reach: [], tackle_lost: [] }
  const p = presented_state(s)
  const me = p.fighters?.[s.my_key]
  const seat = Number(String(s.my_key ?? '').slice(1))
  const row = s.view.escrow?.[seat]
  if (!me || me.cell == null || !row) return { armed, tackled: false, reach: [], tackle_lost: [] }
  const blocked = wash_blocked(s.view, p, s.my_key)
  // The presented pool is the exact ordered prefix. Any drafted grant it contains ran before the NEXT move; any
  // earlier move cost/tackle forfeit is already subtracted. No first-kind regrouping is legal here.
  const mp = Math.max(0, Math.floor(me.mp ?? 0))
  const reach_full = bfsReachable(me.cell, mp, blocked)
  const lockers = tackle_lockers(s, me, Number(row.team ?? 0))
  if (!lockers.length) return { armed, tackled: false, reach: reach_full, tackle_lost: [] }
  // THE EXACT CONTEST (sim fight_tackle == spell_formula.move, golden-pinned): num/den prices the escape;
  // num == den (dodge ≥ 2·lock) escapes every roll — the certain-escape case falls out of the uniform rule.
  const { num, den } = tackle_contest(Number(row.agility ?? 0), lockers)
  const ap = Math.max(0, Math.floor(me.ap ?? 0))
  const free = { armed, tackled: false, reach: reach_full, tackle_lost: [] }
  const { world_seed, spawn_id } = s.view
  const deadline = s.turn_deadline_ms ?? s.view.turn_deadline_ms
  if (world_seed != null && spawn_id != null && deadline != null) {
    // EXACT PREVIEW (the chain twin, byte-for-byte): fold the deterministic failure chain via the shared roll —
    // moves never advance the slot; every denial strips ≥1 MP and reprices the next roll at the lower MP. Only
    // mp_lost bounds the reach (ap_lost is the EXECUTION's forfeit, not the paint's — so no ap thread here).
    const tseed = turn_seed({ world_seed, spawn_id, turn_deadline_ms: deadline, seat })
    const slot = my_next_move_slot(s, seat, row)
    let mp_now = mp
    let bitten = false
    while (mp_now > 0) {
      const bite = tackle_roll(tseed, slot, mp_now, ap, num, den)
      if (!bite) break // this attempt ESCAPES — the walk proceeds at mp_now
      bitten = true
      if (!(bite.mp_lost > 0)) break // unreachable while lost > 0 ∧ mp > 0 (ceil ≥ 1); belt against a stuck fold
      mp_now -= bite.mp_lost
    }
    if (!bitten) return free // the next move walks free — NO red (the "red then walked free" killer)
    const keep = new Set(bfsReachable(me.cell, mp_now, blocked))
    return {
      armed,
      tackled: true,
      reach: reach_full.filter((c) => keep.has(c)),
      tackle_lost: reach_full.filter((c) => !keep.has(c)),
    }
  }
  // DEGRADED (seed-less view): the fraction risk-band — one failed escape's bite as the at-risk remainder.
  const { mp_lost } = tackle_losses(ap, mp, num, den)
  if (!(mp_lost > 0)) return free
  const keep = new Set(bfsReachable(me.cell, Math.max(0, mp - mp_lost), blocked))
  return {
    armed,
    tackled: true,
    reach: reach_full.filter((c) => keep.has(c)),
    tackle_lost: reach_full.filter((c) => !keep.has(c)),
  }
}

/**
 * THE MOVE'S TACKLE — the deterministic forfeit MY next move's escape roll WILL take, or null when the move
 * walks free (no living enemy locks me, the roll escapes, I have no MP to spend, or a seed-less view can't
 * derive the roll — then the receipt rules). The chain twin of ONE actions.move roll, the SAME contest
 * move_wash previews, EXPOSED so the optimistic execution obeys the tackle law: tackles are
 * deterministic, so the walk is never allowed at all — a bitten move NEVER walks; the client predicts the
 * sim's exact resolution (apply_move failed-escape = cells_moved 0, both pools bitten). Shares `tackle_roll`.
 * @param {any} s the fight store state @returns {{ ap_lost: number, mp_lost: number } | null}
 */
export const next_move_tackle = (s) => {
  if (!s?.view || !s.my_key) return null
  const p = presented_state(s)
  const me = p.fighters?.[s.my_key]
  const seat = Number(String(s.my_key ?? '').slice(1))
  const row = s.view.escrow?.[seat]
  if (!me || me.cell == null || !row) return null
  const mp = Math.max(0, Math.floor(me.mp ?? 0))
  if (mp <= 0) return null // no MP ⇒ no move ⇒ no contest
  const lockers = tackle_lockers(s, me, Number(row.team ?? 0))
  if (!lockers.length) return null // not tackled ⇒ the move walks free
  const { world_seed, spawn_id } = s.view
  const deadline = s.turn_deadline_ms ?? s.view.turn_deadline_ms
  if (world_seed == null || spawn_id == null || deadline == null) return null // seed-less ⇒ the receipt rules
  const { num, den } = tackle_contest(Number(row.agility ?? 0), lockers)
  const ap = Math.max(0, Math.floor(me.ap ?? 0))
  const tseed = turn_seed({ world_seed, spawn_id, turn_deadline_ms: deadline, seat })
  const slot = my_next_move_slot(s, seat, row)
  return tackle_roll(tseed, slot, mp, ap, num, den)
}

/**
 * PLACEMENT CLICK LEGALITY — the pick-vs-deny decision for a placement-phase board click (M3: moved from the
 * adapter's cell_click; the adapter relays 'pick' → the local pick stash and renders 'deny' as pulse+sfx+nudge).
 * 'pick' = a FREE start cell of MY team (my own current cell re-picks); 'deny' = off-zone or taken; null = not
 * a placement fight / no seat (the relay does nothing).
 * @param {any} s the fight store state @param {{ x: number, y: number }} cell
 * @returns {'pick' | 'deny' | null}
 */
export const placement_click = (s, cell) => {
  const view = engine_view_of(s)
  if (!view || !view.placement || view.winner !== -1 || !cell) return null
  const me = view.my_entity_id ? view.fighters.get(view.my_entity_id) : null
  if (!me) return null
  const on_zone = (view.placement_cells?.[me.team] ?? []).some((c) => c.x === cell.x && c.y === cell.y)
  if (!on_zone) return 'deny'
  for (const f of view.fighters.values()) {
    if (f.dead || f.id === me.id || !f.cell) continue
    if (f.cell.x === cell.x && f.cell.y === cell.y) return 'deny'
  }
  return 'pick'
}
