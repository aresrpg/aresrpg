// FIGHT ENGINE · W4 — THE PHASE MACHINE (D73 pillar 5).
//
// The night's stuck-screen / ghost-board / phantom-card class is one root: mount decisions were smeared across
// dungeon_store's `spawned_placement`/`hud_mounted` globals, DungeonBoard's per-`status` branches, and an
// abandon-path `abandoned_active_fight` guard — each an independent read of "what should be on screen", each
// able to disagree with the others (a board with no fight slice, a placement screen while the chain is ACTIVE,
// a DEFEAT card after an out-of-fight leave). This module is the SINGLE authority: it folds a dungeon read + the
// engine fight slice + my seat into ONE derived phase, and each phase DECLARES the data it needs. A phase whose
// preconditions are unmet HOLDS at the last legal phase (loudly naming what's missing) instead of mounting a
// half-initialised screen — so "board without a fight", "placement without a hand", "terminal without ever
// having fought" become UNREPRESENTABLE, not merely unlikely.
//
// THE MACHINE:  ROAM → PLACEMENT → ACTIVE → TERMINAL(victory|defeat) → EXIT
//   ROAM       in a dungeon session but not on a live tactical board (waiting room / cleared room / no fight).
//   PLACEMENT  chain status PLACEMENT + a board grid + MY seat + a spawned fight slice keyed to me.
//   ACTIVE     chain status ACTIVE + my entity ∈ fighters + turn data (turn_order + an active entity).
//   TERMINAL   chain status WON/FAILED — but ONLY if I was ACTIVE-seated THIS session (D81 generalised: an
//              out-of-fight leave, a never-joined browse, a spectate-from-the-plane NEVER reaches a result card).
//   EXIT       the declared teardown edge → lobby: TERMINAL.continue, an abandon, a claim, a burn. EXIT owns the
//              teardown contract (drop the fight slice + fight_mode + the dungeon), so no board can survive it.
//
// PURITY: `derive_phase` is a pure `(dungeon, fight, my_seat) → { phase, unmet }`. The ONE piece of session
// memory the D81 rule needs — "have I been ACTIVE-seated in THIS dungeon" — is an explicit, caller-owned latch
// (mark_active_seat / session_reset), NOT a hidden module global that leaks across dungeons. Components are
// read-only subscribers: they call derive_phase (or the mount predicates) and render; they never write.

// ── Chain status codes (dungeon.move) — the SAME integers dungeon_store / DungeonBoard mirror. ──
import { game_log } from '../core/log.js'

import { is_ending } from './fight_end_machine.js'

export const STATUS_OPEN = 0
export const STATUS_ACTIVE = 1
export const STATUS_ROOM_CLEARED = 2
export const STATUS_WON = 3
export const STATUS_FAILED = 4
export const STATUS_PLACEMENT = 5

// ── The phases. String constants (never bare literals at call sites) so a typo is a ReferenceError, not a
//    silently-false comparison. ──
export const PHASE = /** @type {const} */ ({
  ROAM: 'ROAM',
  PLACEMENT: 'PLACEMENT',
  ACTIVE: 'ACTIVE',
  TERMINAL: 'TERMINAL',
  EXIT: 'EXIT',
})

/** @typedef {'ROAM'|'PLACEMENT'|'ACTIVE'|'TERMINAL'|'EXIT'} Phase */
/** @typedef {'victory'|'defeat'} Outcome */
/**
 * @typedef {Object} PhaseResult
 * @property {Phase} phase           the derived phase
 * @property {string[]} unmet        the named preconditions of the DESIRED phase that were NOT satisfied (empty
 *                                   when the phase is fully met). A non-empty `unmet` means the machine HELD at a
 *                                   lower phase rather than mount a half-init screen — the names say why.
 * @property {Outcome|null} outcome  'victory' | 'defeat' when phase === TERMINAL, else null.
 * @property {Phase} desired         the phase the chain status ALONE would put us in (ignoring preconditions) —
 *                                   so callers/logs can see "wanted ACTIVE, held at PLACEMENT, unmet=[…]".
 */

// ── SESSION LATCH (D81 generalisation) ────────────────────────────────────────────────────────────────────
// The ONLY cross-call state, and it is deliberately tiny + explicit: the dungeon id in which THIS client has
// reached an ACTIVE turn while seated. A result card is a receipt for a fight you FOUGHT; leaving from the
// plane / placement / a browse never fought, so it must never see TERMINAL. Keyed by dungeon id so a fresh
// dungeon starts with a clean slate even if `session_reset` was missed (defence in depth, mirrors chain_frame's
// per-id keying). The caller (dungeon_store) marks it the instant it observes an ACTIVE phase with my seat, and
// resets it on every session teardown.
let active_seat_dungeon = /** @type {string | null} */ (null)

// W2 ("+XP shows, card doesn't" — the refresh leg): the module cell alone DIES with the page, so a
// reload between the chain flipping WON and the card resolving orphaned the win forever (terminal_unmet →
// 'never_active_seated_this_session' → EXIT; the silent boot-rescue then ate the receipt). The latch now
// also PERSISTS per tab in sessionStorage (survives a refresh, dies with the tab, never leaks cross-tab):
// mark writes both, had reads through, session_reset clears both. Storage failures (private mode) degrade
// to the in-memory cell — never a throw.
const ACTIVE_SEAT_STORAGE_KEY = 'ares:active_seat_dungeon'

/**
 * Latch "I reached an ACTIVE, seated turn in THIS dungeon". Idempotent. Called by the store the moment
 * derive_phase returns ACTIVE for the live dungeon (see dungeon_store.refresh). @param {string} dungeon_id
 */
export function mark_active_seat(dungeon_id) {
  if (!dungeon_id) return
  active_seat_dungeon = dungeon_id
  try {
    sessionStorage.setItem(ACTIVE_SEAT_STORAGE_KEY, dungeon_id)
  } catch {
    /* storage unavailable — the in-memory latch still holds for this page life */
  }
}

/** True iff `dungeon_id` is the one we latched an ACTIVE seat in — module cell first, then the per-tab
 * persisted copy (a reload's fresh module cell reads through). @param {string|null|undefined} dungeon_id */
export function had_active_seat(dungeon_id) {
  if (!dungeon_id) return false
  if (active_seat_dungeon === dungeon_id) return true
  try {
    return sessionStorage.getItem(ACTIVE_SEAT_STORAGE_KEY) === dungeon_id
  } catch {
    return false
  }
}

/** Clear the latch on session teardown (abandon / claim / burn / reset). Call from EXIT's teardown. */
export function session_reset() {
  active_seat_dungeon = null
  try {
    sessionStorage.removeItem(ACTIVE_SEAT_STORAGE_KEY)
  } catch {
    /* storage unavailable — nothing persisted to clear */
  }
}

/** Test-only visibility of the latch. @returns {string | null} */
export function _active_seat() {
  return active_seat_dungeon
}

// ── Precondition predicates (each names itself so `unmet` reads like a checklist) ───────────────────────────
// Every predicate is a pure read of the (dungeon, fight, my_seat) triple. `my_seat` is the caller's already-
// resolved "this is MY participant" — the selected controlled character's escrow row (the caller resolves it
// once; the machine never re-derives identity, single source of truth).

/** My entity id as the fight slice keys it (character id; address fallback supports legacy fixtures). */
function my_entity_id(fight, my_seat) {
  return my_seat?.character ?? my_seat?.character_id ?? fight?.my_entity_id ?? null
}

/**
 * PLACEMENT preconditions — the data the board GENUINELY needs to let me place my fighter: the board geometry
 * (arena + the team-0 spawn zone), MY seat (escrowed AND keyed into the fight slice). These are exactly the
 * fields whose ABSENCE produced the night's half-init boards. The cosmetic spell hand is intentionally NOT a
 * mount precondition: it is seeded by DungeonBoard itself (the class PRIMARY), which mounts on PLACEMENT — so
 * gating PLACEMENT on the hand would DEADLOCK (the board that seeds the hand would never mount). The deck simply
 * fills a frame after the board appears; the placement pick/READY never depend on it.
 */
function placement_unmet(dungeon, fight, my_seat) {
  const unmet = []
  if (!dungeon) unmet.push('no_dungeon')
  if (!fight) unmet.push('no_fight_slice')
  // the board geometry: a fresh room spawns the fight slice with its arena cells + the team-0 placement zone.
  if (fight && !fight.arena) unmet.push('no_board_grid')
  if (fight && (!fight.placement_cells || (fight.placement_cells[0]?.length ?? 0) === 0))
    unmet.push('no_placement_cells')
  // MY seat must exist on-chain (escrowed) AND be keyed into the fight slice, else the board can't place me.
  const id = my_entity_id(fight, my_seat)
  if (!my_seat) unmet.push('no_my_seat')
  if (fight && (!id || !fight.fighters?.has(id))) unmet.push('my_entity_missing_from_fighters')
  return unmet
}

/** ACTIVE preconditions — my entity ∈ fighters + real turn data (an order and a resolved active entity). */
function active_unmet(dungeon, fight, my_seat) {
  const unmet = []
  if (!dungeon) unmet.push('no_dungeon')
  if (!fight) unmet.push('no_fight_slice')
  const id = my_entity_id(fight, my_seat)
  if (fight && (!id || !fight.fighters?.has(id))) unmet.push('my_entity_missing_from_fighters')
  if (fight && (fight.turn_order?.length ?? 0) === 0) unmet.push('no_turn_order')
  if (fight && !fight.active_entity_id) unmet.push('no_active_entity')
  return unmet
}

/**
 * TERMINAL preconditions — the D81 generalisation. A WON/FAILED chain status is a result card ONLY when this
 * client actually fought it: it must have reached an ACTIVE, seated turn THIS session (the latch), AND still be
 * a seat in the escrow (a card is my receipt — a never-joined observer of someone else's win gets nothing).
 * Unmet ⇒ the machine routes to EXIT (leave clean, no card), never holds a board.
 */
function terminal_unmet(dungeon, fight, my_seat) {
  const unmet = []
  if (!dungeon) unmet.push('no_dungeon')
  if (!had_active_seat(dungeon?.id)) unmet.push('never_active_seated_this_session')
  if (!my_seat) unmet.push('not_escrowed')
  return unmet
}

// ── THE DERIVATION ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * The single source of "what phase are we in". Pure. Folds the chain status into a DESIRED phase, then checks
 * that phase's declared preconditions: met ⇒ that phase; unmet ⇒ HOLD at the safe lower phase (ROAM for
 * placement/active half-inits; EXIT for an unearned terminal), with the unmet names attached for the loud log.
 *
 * @param {any|null} dungeon    the freshly-read Dungeon (use_dungeon.dungeon), or null when out of session.
 * @param {any|null} fight      the engine fight slice (use_game_state.fight), or null when no board is spawned.
 * @param {any|null} my_seat    MY escrow participant row (addr === my wallet), or null if I hold no seat.
 * @returns {PhaseResult}
 */
export function derive_phase(dungeon, fight, my_seat) {
  // No dungeon at all ⇒ ROAM (the lobby/overworld). Never a board, never a card — the base state.
  if (!dungeon) return { phase: PHASE.ROAM, unmet: [], outcome: null, desired: PHASE.ROAM }

  // ── MONOTONIC RECONCILIATION (D89 / D77, coordinator steers 1+2 — the phase-precondition divergence class) ──
  // There are TWO status surfaces and EITHER can lag the other:
  //   • steer 1 (BACKWARD lag): the chain read `dungeon.status` sat STALE at OPEN while the fight SLICE was fully
  //     in placement (a stopped poll / a store-created session shape / a resume off a lagging read). Trusting the
  //     chain alone → ROAM, stranding the board.
  //   • steer 2 (FORWARD lag): place_at landed SUCCESS, the chain read is ACTIVE (status=1, seat ready, deadline),
  //     but the SLICE's `placement` flag stayed stale-TRUE (the sync_engine respawn-flip never fired). Trusting the
  //     slice flag alone → PLACEMENT forever, the READY still rendering over a live fight (the D77 recurrence).
  // The fix that kills BOTH: the phase is the FURTHEST-ALONG of the two surfaces (ROAM < PLACEMENT < ACTIVE <
  // TERMINAL). The chain read carries FORWARD progress (a fight that STARTED / ENDED is authoritative — status
  // ACTIVE beats a stale placement flag); the slice carries progress the chain hasn't caught up to yet (a spawned
  // placement slice beats a stale OPEN read). `fight.placement`/`winner` become DERIVED INPUTS to this max, never
  // a second source of truth the board reads directly. Ranked UP FRONT so a genuine TERMINAL read can outrank the
  // fight-end park below (a terminal board must survive to its card — see the keystone note).
  const { status } = dungeon
  const slice_here = !!fight && fight.fight_id === dungeon.id // the slice belongs to THIS dungeon

  // rank each surface on the progression ladder, then take the max — the most-advanced wins.
  const chain_rank = rank_of_status(status)
  const slice_rank = slice_here ? rank_of_slice(fight) : RANK.NONE
  const rank = Math.max(chain_rank, slice_rank)

  // ── D153 KEYSTONE (C6 — the fight-end machine outranks the roam/placement/active surfaces) — but ONLY for a
  // NON-TERMINAL cycle. While a room-cleared victory is parked awaiting the player's advance, FORCE ROAM so a
  // respawned next-room slice can't flicker a ghost board (the "auto-started the next room" / 30s zombie board);
  // every board-mount consumer (React HUD, voxel adapter, DungeonBoard) inherits the park via this one authority.
  // A genuine TERMINAL read (rank TERMINAL — chain WON/FAILED, or a slice that already resolved a winner) is
  // EXEMPT: its FROZEN board must survive to the death-beat-gated result card. THE BUG THIS EXEMPTION KILLS
  // ("if I'm killed during the turn I never see the mob play, the fight is just
  // removed"): claim() fires note_victory(dungeon.id, room, 'terminal') SYNCHRONOUSLY (→ is_ending TRUE) and only
  // calls fight_end_reset() LATER, inside the death-beat-gated present(). In that gap the adapter's
  // use_dungeon.subscribe(reconcile) re-derives this phase — is_ending forced ROAM → board_lifecycle_decision
  // returned 'teardown' → the frozen board was destroyed UNGATED, racing ahead of the killing wave + the defeat
  // card. The park's ROAM force was only ever the between-rooms concern; a terminal defeat is not that.
  if (rank !== RANK.TERMINAL && is_ending(dungeon.id)) {
    return { phase: PHASE.ROAM, unmet: ['fight_end_parked'], outcome: null, desired: PHASE.ROAM }
  }

  // Divergence (the two surfaces disagreeing) is logged LOUDLY — after the park check so a parked room's respawn
  // churn stays quiet (a park is an expected disagreement, not a diagnosable writer bug).
  if (slice_here && chain_rank !== slice_rank)
    warn_divergence(
      `chain=${label_of_rank(chain_rank)}(status ${status}) vs slice=${label_of_rank(slice_rank)} → take ${label_of_rank(rank)}`,
      dungeon,
      fight
    )

  // TERMINAL — the run ended (either surface). Only a fighter who FOUGHT sees a card (D81 latch); else EXIT.
  if (rank === RANK.TERMINAL) {
    const outcome = status === STATUS_WON || fight?.winner === 0 ? 'victory' : 'defeat'
    const unmet = terminal_unmet(dungeon, fight, my_seat)
    if (unmet.length === 0) return { phase: PHASE.TERMINAL, unmet: [], outcome, desired: PHASE.TERMINAL }
    warn_unmet(PHASE.TERMINAL, PHASE.EXIT, unmet, dungeon)
    return { phase: PHASE.EXIT, unmet, outcome: null, desired: PHASE.TERMINAL }
  }

  // ACTIVE — a live turn-based fight (chain ACTIVE OR a started, unresolved slice). Checked BEFORE placement so a
  // chain-ACTIVE read overrides a stale placement slice flag (steer 2: the READY must yield to the live board).
  if (rank === RANK.ACTIVE) {
    const unmet = active_unmet(dungeon, fight, my_seat)
    if (unmet.length === 0) return { phase: PHASE.ACTIVE, unmet: [], outcome: null, desired: PHASE.ACTIVE }
    // The board isn't coherent yet (the fighters/turn_order haven't re-synced) — HOLD at ROAM (no half-init board)
    // until the next poll folds them. Loud (the D77 dead-screen symptom is exactly this hold, resolved by the poll).
    warn_unmet(PHASE.ACTIVE, PHASE.ROAM, unmet, dungeon)
    return { phase: PHASE.ROAM, unmet, outcome: null, desired: PHASE.ACTIVE }
  }

  // PLACEMENT — the "position your team" window (chain PLACEMENT OR a spawned placement slice ahead of a stale read).
  if (rank === RANK.PLACEMENT) {
    const unmet = placement_unmet(dungeon, fight, my_seat)
    if (unmet.length === 0) return { phase: PHASE.PLACEMENT, unmet: [], outcome: null, desired: PHASE.PLACEMENT }
    warn_unmet(PHASE.PLACEMENT, PHASE.ROAM, unmet, dungeon)
    return { phase: PHASE.ROAM, unmet, outcome: null, desired: PHASE.PLACEMENT }
  }

  // OPEN (waiting room) / ROOM_CLEARED (between rooms) / anything else ⇒ ROAM: in the dungeon plane, free to
  // move, NO tactical board. (ROOM_CLEARED tears the board down in the store; the machine agrees it's ROAM.)
  return { phase: PHASE.ROAM, unmet: [], outcome: null, desired: PHASE.ROAM }
}

// ── PROGRESSION LADDER — the monotonic reconciliation's ordering. A dungeon session only ever moves FORWARD
//    through these; the machine picks the furthest-along of the chain read and the fight slice. ──
const RANK = /** @type {const} */ ({ NONE: 0, ROAM: 1, PLACEMENT: 2, ACTIVE: 3, TERMINAL: 4 })

/** The chain `dungeon.status` → its progression rank. OPEN/ROOM_CLEARED are the plane (ROAM). */
function rank_of_status(status) {
  if (status === STATUS_WON || status === STATUS_FAILED) return RANK.TERMINAL
  if (status === STATUS_ACTIVE) return RANK.ACTIVE
  if (status === STATUS_PLACEMENT) return RANK.PLACEMENT
  return RANK.ROAM // OPEN / ROOM_CLEARED / unknown
}

/** The fight slice's own flags → its progression rank (winner ⇒ terminal; !placement ⇒ active; placement ⇒ …). */
function rank_of_slice(fight) {
  if (typeof fight.winner === 'number' && fight.winner !== -1) return RANK.TERMINAL
  if (fight.placement === true) return RANK.PLACEMENT
  if (fight.placement === false) return RANK.ACTIVE // a started, unresolved slice
  return RANK.NONE // an indeterminate slice (no placement flag) — defer to the chain
}

/** Rank → a short label for the divergence log. */
function label_of_rank(rank) {
  return rank === RANK.TERMINAL
    ? 'TERMINAL'
    : rank === RANK.ACTIVE
      ? 'ACTIVE'
      : rank === RANK.PLACEMENT
        ? 'PLACEMENT'
        : 'ROAM'
}

// ── MOUNT DECISIONS (the machine owns them) ─────────────────────────────────────────────────────────────────
// Thin, named predicates over derive_phase so components read intent, not raw fields. A component that used to
// branch on `dungeon.status === X` / `hud_mounted` / `fight_mode` now asks the machine.

/**
 * Mount the tactical board chrome host (DungeonBoard + timeline + tooltip + deck)? PLACEMENT, ACTIVE, or an
 * EARNED TERMINAL. TERMINAL keeps the FROZEN board behind the result card (the card is a sibling that stands on
 * its own slice) AND hosts DungeonBoard's terminal auto-claim effect — the interactive chrome (END TURN /
 * placement READY) is separately gated on is_active / is_placement, so nothing clickable renders in TERMINAL.
 * EXIT and ROAM mount NO board — THIS is what makes the ghost board unrepresentable: an out-of-fight leave / an
 * unearned terminal / a post-continue teardown all resolve to EXIT|ROAM here, never to a mounted board.
 */
export function should_mount_board(result) {
  return result.phase === PHASE.PLACEMENT || result.phase === PHASE.ACTIVE || result.phase === PHASE.TERMINAL
}

/** Mount the PLACEMENT chrome (spawn-zone rings + READY)? PLACEMENT only. */
export function is_placement(result) {
  return result.phase === PHASE.PLACEMENT
}

/** Mount the live turn chrome (END TURN / draft input / auto-commit)? ACTIVE only. */
export function is_active(result) {
  return result.phase === PHASE.ACTIVE
}

/** Show a result card (Victory / Defeat)? TERMINAL only — and derive_phase already gated on "fought it". */
export function should_show_result(result) {
  return result.phase === PHASE.TERMINAL
}

/** The result-card outcome, or null. */
export function result_outcome(result) {
  return result.phase === PHASE.TERMINAL ? result.outcome : null
}

/** True during EXIT — the teardown edge. The caller runs its declared teardown; NO board/card mounts here. */
export function is_exit(result) {
  return result.phase === PHASE.EXIT
}

// ── Loud gate (loud-pipeline law: never a silent hold on a phase we WANTED) ─────────────────────────────────
// One warn per (desired,unmet-signature) burst is enough — the ~4s poll re-derives, so without de-dup a genuine
// multi-tick hold would spam. Keyed on the exact signature so a NEW unmet reason always logs.
let _last_warn = ''
// [p0-fight-init] one-shot probe: the machine HELD at ROAM while the chain/slice says a fight is live
// (desired ACTIVE or PLACEMENT). On the live-transition path this hold is what tells the adapter to tear a
// just-built board down (churn-hold branch of the first-fight input-dead bug). Fires once per page; remove with the fix.
let _p0_hold_logged = false
function warn_unmet(desired, held, unmet, dungeon) {
  if (!_p0_hold_logged && held === PHASE.ROAM && (desired === PHASE.ACTIVE || desired === PHASE.PLACEMENT)) {
    _p0_hold_logged = true
    game_log(
      'p0-fight-init',
      `phase HELD at ROAM while a fight is live (wanted ${desired}; unmet: ${unmet.join(', ')}) — churn-hold probe`
    )
  }
  const sig = `${dungeon?.id ?? '?'}|${desired}->${held}|${unmet.join(',')}`
  if (sig === _last_warn) return
  _last_warn = sig
  game_log('phase', `HELD at ${held} (wanted ${desired}) — unmet: ${unmet.join(', ')}`, {
    dungeon: dungeon?.id ? String(dungeon.id).slice(0, 10) : null,
    status: dungeon?.status,
  })
}

/** Test-only: reset the warn de-dup so a test can assert consecutive holds each log. */
export function _reset_warn_dedup() {
  _last_warn = ''
  _last_div = ''
}

// D89 DIVERGENCE LOG (coordinator steer): the two status surfaces disagree — the machine PICKED the presence-
// truth, but the disagreement itself is a signal (a stopped poll / a stale-read writer). Name it loudly so the
// root (the diverging WRITER of `dungeon`) is diagnosable, not buried. De-duped per signature (the poll re-derives).
let _last_div = ''
function warn_divergence(what, dungeon, fight) {
  const sig = `${dungeon?.id ?? '?'}|${what}`
  if (sig === _last_div) return
  _last_div = sig
  game_log('phase', `STATUS DIVERGENCE — ${what} (machine trusts the fight-slice presence-truth)`, {
    dungeon: dungeon?.id ? String(dungeon.id).slice(0, 10) : null,
    dungeon_status: dungeon?.status,
    fight_placement: fight?.placement,
    fight_winner: fight?.winner,
  })
}
