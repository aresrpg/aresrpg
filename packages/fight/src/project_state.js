// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// fight/project_state.js — small, pure selectors over fight state.

import { GRID_W } from './los.js'
import { STATUS_FAILED, STATUS_ROOM_CLEARED, STATUS_WON } from './board_state.js'
import { committed_truth, min_turn_ready_at } from './store.js'

export { committed_truth, submit_wait_ms } from './store.js'

export const DUNGEON_BOARD_ORIGIN = { x: 0, y: 0 }

const decode_cell = (encoded, width) =>
  encoded == null ? null : { x: Number(encoded) % width, y: Math.floor(Number(encoded) / width) }

/** Every fighter as the board wants it — encoded `cell` plus a decoded `cell_xy` (grid_width from the Fight board). */
export const fighters = (state, grid_width = GRID_W) =>
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

/** Is it MY turn on the CHAIN's clock — committed seat only. Whether it is yet PLAYABLE is `turn_playable`. */
export const is_my_turn = (state) => {
  const { active } = committed_truth(state)
  return active != null && active === state.my_key
}

/** THE TURN-HANDOVER GATE (#1808) — my turn is genuinely mine: chain seat, no replay draining, and the chain's
 *  own mob-resolution budget spent. Folded once by `recompute` (fold.js `turn_is_playable`) and read here; every
 *  turn surface — input arming, the END TURN control, the "your turn" cue — mounts on THIS, never on the raw
 *  chain seat. Handing the turn over earlier is what made a granted turn retractable. */
export const turn_playable = (state) => state.turn_playable === true

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
  const c = committed_truth(state)
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

/** The reducer clock says this playable turn should submit; busy suppresses the level synchronously at the edge. */
export const commit_due = (state) => !!state.commit_due && !state.busy

/**
 * Milliseconds left on MY per-turn min-turn floor (0 once a human-natural 3s has elapsed, or when it isn't my
 * turn). The button greys out ONLY for this remainder — one floor per turn, NOT per cast.
 */
export const min_turn_left = (state, now = Date.now()) => {
  const ready_at = min_turn_ready_at(state)
  return ready_at == null ? 0 : Math.max(0, ready_at - now)
}

/** Can I commit / end my turn right now — my turn, fight live, and the min-turn floor elapsed. */
export const can_end_turn = (state, now = Date.now()) =>
  is_my_turn(state) && !is_over(state) && min_turn_left(state, now) === 0
