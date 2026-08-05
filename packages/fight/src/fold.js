// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// fight/fold.js — the PURE fold/merge/base functions behind the store's ONE door (split out of store.js to keep
// each file ≤600 LoC; INC-0). Nothing here reads `get`/`set`: every function is a plain transform over state.
//
// · merge_entries / sorted_log — the keyed `(version, event_idx)` log, order-independent (dedupe / adopt / stale).
// · base_from_view — the snapshot half of snapshot+tail: the adopted rich view → the thin fold base.
// · recompute — snapshot base + sorted authoritative tail → committed state + the derived PROVIDER token.
// · presented_state / display_state — the PRESENTATION projections (the eye's pacing floor) the consumers read.
// · paced_wave_turns — the ONE pacing decision: an accepted batch's non-local events → wave turns (window in
//   seq space), keyed on the chain version the ROWS carry, transport-blind. WHICH rows have arrived in full and
//   may pace yet is its leaf, `turn_bracket.js` (#2209).
//
// COMMITTED TRUTH IS NOT HERE (#1027). The committed board is the HEADLESS CORE's, projected by `project_board`
// and read through the store's ONE door (`store.committed_truth`). This module owns the PRESENTATION folds only —
// which is why nothing here derives committed state at all, and why `core_fold.js` may import this file's base.

import { mob_entity_id, mob_entity_index } from './fight_control.js'
import { entity_id_of_fold_key, participant_entity_id } from './participant_identity.js'
import { apply_action, seat_resolver } from './inputs.js'
import * as settle_input from './inputs.js'
import { STATUS_PLACEMENT } from './board_state.js'
import { GRID_W } from './los.js'
import { base_from_view } from './fold_base.js'
import { turn_handover_at } from './draft_budget.js'
import { blocks_a_walk } from './fight_render_prims.js'
import { holds_the_fold, masks_entries, pace_segment } from './present.js'
import { adopt_chain_traps, fold_trap_ledger } from './trap_ledger.js'
import {
  claim_version,
  fold_claimed_budget,
  with_budget_predictions,
  without_expired_budget_predictions,
} from './budget_claims.js'

export { base_budget, base_from_view, last_action_of } from './fold_base.js'

// M2b · ONE INGRESS (#291): with a SINGLE canonical source (the accept machine's deduped, contiguous `apply`
// stream — receipts and journal pages folded through ONE door keyed `(fight_id, seq)`) there is no longer a merge
// between competing chain sources to arbitrate. SOURCE_PRIORITY survives for exactly ONE job: layering my optimistic
// PREDICTION under CANONICAL truth at a key collision — canonical always wins, a prediction never overrides a
// proven fact. Every non-intent source is canonical (the accept machine already resolved cross-transport identity).
const source_rank = (source) => (source === 'intent' ? 0 : 1)
const entry_key = (action) => `${action.version}:${action.event_idx}`
export const sorted_log = (entries) =>
  Object.values(entries).sort((a, b) => a.version - b.version || a.event_idx - b.event_idx)

/** Layer new actions into the keyed entry map: at a key collision CANONICAL wins over a PREDICTION (intent), and a
 *  same-class write replaces (the accept machine already deduped canonical, so a canonical-vs-canonical collision is
 *  a re-fold of the same fact). This is the LAST role of source ranking after one ingress — prediction-vs-canonical. */
export const merge_entries = (entries, actions) => {
  const next = { ...entries }
  for (const action of actions) {
    const key = entry_key(action)
    const existing = next[key]
    if (!existing || source_rank(action.source) >= source_rank(existing.source)) next[key] = action
  }
  return next
}

/** THE FOLD FLOOR — the object version of the snapshot base every projection folds on top of. It is read off the
 *  ONE inbox that admits it (#1799): the store used to mirror it onto a `view_version` field and every new input
 *  path had to remember the second write. Absent core (a hand-built projection input) folds from the origin. */
const adopted_base_version = (s) => Number(s.core?.inbox?.base_version ?? -1)

// ── V1 · RETIREMENT FLOOR (register V1 · BLANKPAGE §③) ────────────────────────────────────────────────────────
// Death is a FLOORED, append-only retirement — NOT a boolean re-derived from a snapshot's raw hp every recompute.
// `retired` is a durable accumulator `{ fighter_key → floor_version }` (carried through recompute like my_traps),
// appended from AUTHORITATIVE deaths only (a receipt/poll/snapshot Hit→0 or Abandoned; intents never retire — they
// are predictions), and cleared per init. `alive` DERIVES from it: a floor-dead fighter can never resurrect from a
// later higher-version read that carries a positive hp (the resurrection root, symptom ②). Only init clears it; a
// snapshot that contradicts a retirement (alive again at a higher version) is a parity incident — we hold dead.

/** Fold the append-only death floors: base-dead fighters floor at the adopted view's version (their death predates
 *  the base); tail deaths floor at the proving event's version. Idempotent — a key already retired keeps its floor. */
export const derive_retired = (prev, base, authoritative_tail, base_version) => {
  const retired = { ...(prev ?? {}) }
  for (const [key, f] of Object.entries(base.fighters ?? {}))
    if (f.alive === false && retired[key] == null) retired[key] = base_version
  for (const e of authoritative_tail ?? []) {
    const key =
      e.kind === 'Hit' && Number(e.remaining_hp) <= 0
        ? `${e.victim_is_mob ? 'm' : 'p'}${Number(e.victim_idx)}`
        : e.kind === 'Abandoned'
          ? `p${Number(e.seat)}`
          : null
    if (key && retired[key] == null) retired[key] = e.version
  }
  return retired
}

/** Force every retired fighter dead in a committed fighters map — `alive` derives from retirement, never from a
 *  later snapshot's raw hp. A no-op when nothing is retired or every retired key is already dead (the common case);
 *  a retired fighter still carrying positive hp (the contradiction a stale/torn read paints) is clamped to 0/dead. */
export const apply_retirement = (fighters, retired) => {
  if (!fighters || !retired) return fighters
  const stale = Object.keys(retired).filter((key) => {
    const f = fighters[key]
    return f && f.alive !== false
  })
  if (!stale.length) return fighters
  const out = { ...fighters }
  for (const key of stale) {
    const f = out[key]
    out[key] = { ...f, alive: false, hp: f.hp != null && f.hp > 0 ? 0 : f.hp }
  }
  return out
}

/** THE PROVIDER TOKEN (NORTH_STAR consequence 2, verbatim): at any instant exactly ONE provider holds the push
 *  channel. Derived — never a stored latch — from the same wave/turn facts the projections read:
 *   · a non-local (mob/peer) wave is draining → `chain_replay` (the receipt/fight state replays; HUD pushes nothing)
 *   · else it is MY window to push (playable turn OR placement) → `local_turn` (my clicks → the local sim)
 *   · else → `idle_wait` (a peer's turn — nothing until their commit lands, then it becomes chain_replay)
 *  The store's door refuses any input whose provenance doesn't match this token (a logged non-event). */
export const provider_of = ({ presenting, playable, view, spectator = false }) =>
  presenting
    ? 'chain_replay'
    : !spectator && (playable || view?.status === STATUS_PLACEMENT)
      ? 'local_turn'
      : 'idle_wait'

/** PLACEMENT GHOSTS — a peer's uncommitted pick is a cosmetic hint, never a source of truth, so it dies fast:
 *  15s covers a re-pick cadence with headroom while a stale/dead broadcast never lingers into the fight proper. */
export const GHOST_STALE_MS = 15_000

/**
 * THE TURN-HANDOVER PREDICATE (#1808) — is MY turn genuinely playable at `now`? Three facts, one home: the
 * committed active seat is mine, no NON-LOCAL (mob/peer) replay is still draining locally, and the CHAIN has
 * finished spending this turn's mob-resolution budget (`turn_handover_at`). The third is what the client used to
 * skip: the paced replay is only the client's GUESS at the chain's resolution window and can drain far ahead of
 * it, so the turn was granted and then held back by a countdown nobody could act on. `recompute` folds this;
 * the store's clock tick asks it to know when a time-ONLY transition must re-fold and hand the turn over.
 *
 * THE CLOCK FRAME (#2099) — `turn_handover_at` is a CHAIN instant and `now` is the client's own wall clock, so
 * this comparison is only honest in ONE frame. `chain_offset_ms` (folded from observed chain reads,
 * draft_budget `fold_chain_offset`) moves `now` into chain time; without it a skewed client silently lost its
 * skew from every turn behind a bare Waiting state. This is the SOLE consumer of the offset — the min-turn
 * floor and the submit gate still read raw local time (they measure a duration the player already lived, and
 * the chain's own `assert_min_turn` belt covers them).
 * @param {{ active: string | null, my_key: string | null, wave?: any[], deadline_ms?: number | null,
 *   turn_ms?: number | null, chain_offset_ms?: number | null }} turn @param {number} now
 */
export const turn_is_playable = ({ active, my_key, wave, deadline_ms, turn_ms, chain_offset_ms }, now) =>
  active != null &&
  active === my_key &&
  !(wave ?? []).some((t) => !t.is_local && holds_the_fold(t)) &&
  now + (chain_offset_ms ?? 0) >= turn_handover_at(deadline_ms, turn_ms)

/** Re-fold the committed state from the snapshot base + the sorted tail, and reconcile the turn-floor anchor.
 *  `now` stamps the floor the instant MY turn opens; only the false→true edge re-stamps. */
export const recompute = (draft, now) => {
  const observed_deadline = Number(draft.turn_deadline_ms ?? 0)
  const base = base_from_view(draft.view, draft.fight_id)
  const base_version = adopted_base_version(draft)
  const all_log = without_expired_budget_predictions(
    with_budget_predictions(sorted_log(draft.entries), draft.budget_predictions)
  )
  const log = all_log.filter((e) => e.version > base_version)
  const claimed_budget = (draft.claimed_budget ?? []).filter((row) => claim_version(row) > base_version)
  const committed = fold_claimed_budget(base, log, claimed_budget)
  const authoritative_tail = log.filter((entry) => entry.source !== 'intent')
  const chain_committed = authoritative_tail.reduce(apply_action, base)
  // V1: append-only death floors, carried forward (base-dead at the adopted base version + tail deaths at their
  // own version). Intents never retire (predictions). `alive` derives from this — apply_retirement below overrides
  // any later positive-hp read for a floor-dead fighter (the resurrection root).
  const retired = derive_retired(draft.retired, base, authoritative_tail, base_version)
  const authoritative_log = all_log.filter((e) => e.version >= base_version && e.source !== 'intent')
  const last_version = authoritative_log.length ? authoritative_log[authoritative_log.length - 1].version : -1
  const applied_version = Math.max(base_version, last_version)
  const settlement = settle_input.reconcile_settlement(draft.settlement, base, authoritative_log, draft)
  // A spectator is permanently seatless inside the core, not merely masked in the UI projection. Global party
  // focus updates still cross the ctx door while WATCH is open; discarding their resolved key here keeps locality,
  // provider ownership, turn clocks, and every local-push gate read-only from the same fold truth.
  const spectator = draft.ctx?.spectator === true
  const my_key = spectator ? null : draft.my_key
  let { turn_started_at, my_turn_no = 0 } = draft
  // Chain timestamps are monotonic within one Fight. A version-inflated but semantically stale object may prune a
  // fresher TurnStarted tail; preserve the greatest observed chain deadline without synthesising a client deadline.
  const turn_deadline_ms = Math.max(observed_deadline, Number(committed.turn_deadline_ms ?? 0)) || null
  // PLAYABLE-turn anchor + TURN-END DISARM share ONE boundary. The SINGLE-PTB fold resolves my-end→mob-wave→my-next
  // -turn in ONE receipt, so `committed active` never leaves me (my_turn stays true ALL fight) — a
  // `my_turn && !was_my_turn` edge fires only ONCE (turn 1). Key off the PLAYABLE rising edge instead
  // (`turn_is_playable` above) — cleared while a wave presents / the chain is still resolving mobs / off-turn,
  // re-stamped the instant the turn is genuinely mine. The SAME gate disarms a stale spell (else it casts on the
  // first click of a fresh turn); my OWN casts are LOCAL waves (is_local) → they never trip it.
  const presenting = (draft.wave ?? []).some((t) => !t.is_local && holds_the_fold(t))
  const playable = turn_is_playable(
    {
      active: committed.active,
      my_key,
      wave: draft.wave,
      deadline_ms: turn_deadline_ms,
      turn_ms: draft.view?.turn_ms,
      chain_offset_ms: draft.chain_offset_ms,
    },
    now
  )
  // MY SEAT-TURN COUNTER (cast.move `seat_turn` twin, the cooldown gate's clock): bumped EXACTLY on the PLAYABLE
  // rising edge — the SAME false→true boundary turn_started_at stamps, so it is DEADLINE-INDEPENDENT (a starved /
  // stale / zero chain deadline still counts my turn). Placement never counts (active is null there → playable
  // false); session-init resets it to 0 via empty_fight. This replaces the old DungeonBoard bump that fired only
  // on a POSITIVE, CHANGED turn_deadline_ms — under lag that guard froze the counter while last_cast_turn advanced,
  // pinning every cd>0 spell on-cooldown forever (register #34: a side-store clock derived from a transport edge).
  if (playable && turn_started_at == null) {
    turn_started_at = now
    my_turn_no += 1
  }
  if (!playable) turn_started_at = null
  const armed_spell_id = playable ? draft.armed_spell_id : null
  // THE FOLDED TURN-SEED reaches the view, the same way the deadline does. The chain-only fold stamps it from the
  // TurnStarted wire (a dynamic field the decoded snapshot never carries); we surface it onto `view.turn_entropy`
  // /`view.turn_ordinal` so every preview reads the SEED off `s.view` (project.js / board_view), never the
  // store-root `turn_ordinal` — that is the fold's ANCHOR token, a different fact under a colliding name. Absent ⇒
  // the decoded view's own null stands, and `crit_clock_of` refuses the clock (honest refusal, never a fake-0 seed).
  const turn_seed_inputs = chain_committed.turn_seed_inputs ?? null
  const view = turn_seed_inputs
    ? { ...draft.view, turn_entropy: turn_seed_inputs.turn_entropy, turn_ordinal: turn_seed_inputs.turn_ordinal }
    : draft.view
  const provider = provider_of({ presenting, playable, view: draft.view, spectator })
  // THE ONE TRAP LEDGER (#1858 · #2033): the public board read is ADOPTED here, one door upstream of the
  // consumption fold, so a trap this client never cast is an ordinary ledger row from its first sighting —
  // predictable, legality-visible, and retired by its own trigger beat like any other. `ctx.chain_traps` is a
  // raw read, never a second render source; project_views reads this list alone.
  const my_traps = fold_trap_ledger({
    authoritative_tail,
    base,
    traps: adopt_chain_traps(draft.my_traps, draft.ctx?.chain_traps, Number(draft.ctx?.chain_traps_version ?? 0)),
    view: draft.view,
  })
  // GLYPH EXPIRY (persistent, NOT detonated): unlike a trap, a glyph is never sprung by a fighter standing on it
  // (check_glyphs ticks + persists). It dies only by EXPIRY, and expiry runs on THE CHAIN'S clock: a glyph's
  // duration ticks once per PLAYER turn-end (cast.move:1708, inside tick_turn_end's non-mob arm), so the ordinal
  // Move stamps at every player turn START — `TurnEntropy.ordinal` (fight.move:646-655), published on TurnStarted
  // and surfaced onto `view.turn_ordinal` just above — counts exactly the glyph's turns, identically for EVERY
  // viewer. #1535: this used to ride `my_turn_no`, the VIEWER's own playable rising edge — one tick per ROUND in
  // coop where the chain ticks once per teammate turn, and a spectator (pinned at 0) watched glyphs live forever.
  // DERIVED, never accumulated: the authored budget + the ordinal the glyph was placed at are the facts and
  // `turns_remaining` is their projection, so a re-fold can never double-tick. The clock is monotone — an absent
  // or stale ordinal HOLDS it rather than reviving a glyph, and a clock that never advances errs toward
  // persistence ("it stays"). At 0 it's gone forever. Already-gone kept.
  const glyph_clock = Math.max(Number(view?.turn_ordinal ?? 0), Number(draft.glyph_clock ?? 0))
  const my_glyphs = (draft.my_glyphs ?? []).map((g) => {
    if (g.gone) return g
    // `placed_at_ordinal`, not `placed_at`: my_traps' `placed_at` is a chain POSITION ({version, event_idx});
    // this is a player-turn COUNT. Stamped the first fold that sees the record — its own cast.
    const placed_at_ordinal = g.placed_at_ordinal ?? glyph_clock
    const turns = g.turns ?? g.turns_remaining
    const turns_remaining = turns - Math.max(0, glyph_clock - placed_at_ordinal)
    return turns_remaining <= 0
      ? { ...g, turns, placed_at_ordinal, turns_remaining: 0, gone: true }
      : { ...g, turns, placed_at_ordinal, turns_remaining }
  })
  // PLACEMENT GHOSTS GC (durable accumulator, same class as my_traps/my_glyphs above): a committed Placed for a
  // character SUPERSEDES (drops) any ghost recorded for them FOREVER — the chain truth is now real, the hint's
  // job is done. Scanned off `log` (this recompute's own authoritative tail — never `source: 'intent'`, i.e.
  // never MY OWN optimistic Placed), so this is a fast-path; a peer whose commit never produced a discrete event
  // on this client (e.g. baked straight into an adopted snapshot) still falls to the GHOST_STALE_MS floor below.
  const placed_characters = new Set(
    log.filter((e) => e.kind === 'Placed' && e.source !== 'intent').map((e) => String(e.character))
  )
  const placement_ghosts = Object.fromEntries(
    Object.entries(draft.placement_ghosts ?? {}).filter(
      ([character, ghost]) => !placed_characters.has(character) && now - ghost.at < GHOST_STALE_MS
    )
  )
  // #170 OPTIMISTIC-DEATH LATCH — an INTENT-predicted death is (by design) never floored into `retired`: intents
  // are predictions. But a version-inflated yet semantically STALE poll (it read the Fight OBJECT before my commit
  // landed, mob still alive) purges the intent and the corpse STANDS BACK UP — then dies a SECOND time when my
  // commit receipt confirms the kill (the double-death, 3rd recurrence). This TRACKS every optimistic death (key →
  // the receipt_seq it was predicted under) and CARRIES it across the intent-purging poll; `receipt_seq` advances
  // ONLY on a receipt (never a poll), so a stale poll cannot clear it, and MY-TURN RECEIPT releases it — a CONFIRMED
  // kill then rides `retired` (dropped here as redundant), a MISPREDICTED one (a resisted survivor the raw-base
  // prediction over-killed — apply_resistance shaves chain damage) evaporates. The latch is only APPLIED to the eye
  // (project engine_view.dead) while a commit is IN-FLIGHT (`busy`): with NO commit pending a fresh chain read that
  // lacks the kill is AUTHORITATIVE and must restore the mob (a reverted/force-passed tx — kill_adoption LEG A), so
  // gating the hold on `busy` is what distinguishes "the kill is coming" from "the kill never landed". Presentation
  // only — committed/targeting read the honest fold, so a held corpse is never castable.
  const optimistic_dead = {}
  for (const [key, entry] of Object.entries(draft.optimistic_dead ?? {}))
    if (entry.seq === draft.receipt_seq && retired[key] == null) optimistic_dead[key] = entry
  for (const [key, f] of Object.entries(committed.fighters ?? {}))
    if (f.alive === false && retired[key] == null && optimistic_dead[key] == null)
      optimistic_dead[key] = { seq: draft.receipt_seq }
  return {
    ...draft,
    ...committed,
    view,
    fighters: apply_retirement(committed.fighters, retired),
    retired,
    optimistic_dead,
    settlement,
    applied_version,
    log,
    my_key,
    turn_started_at,
    turn_playable: playable,
    my_turn_no,
    armed_spell_id,
    turn_deadline_ms,
    provider,
    my_traps,
    my_glyphs,
    glyph_clock,
    placement_ghosts,
  }
}

/** entity id (a character id, or `mob-N`) → its fold key `p{seat}` / `m{idx}` against an adopted view's escrow;
 *  null when the roster does not carry it. The ONE home for that mapping — the presentation resolvers below and
 *  the store's committed health oracle both read it, so a renamed seat can never mean two different fighters.
 *  (Its INVERSE is `entity_id_of_fold_key`, homed with the identity predicates it joins through — #2219.) */
export const entity_fold_key = (escrow, source_id) => {
  const id = String(source_id)
  const mob_idx = mob_entity_index(id)
  if (mob_idx != null) return `m${mob_idx}`
  const seat = (escrow ?? []).findIndex((p) => participant_entity_id(p) === id)
  return seat >= 0 ? `p${seat}` : null
}

/** Snapshot base + authoritative tail PLUS accepted chain-silent point grants — the BUDGET anchor, a presentation
 * question (what may I still spend this turn), never committed truth: only legality/budget consumers read it. */
export const claimed_budget_state = (s) => {
  const base = base_from_view(s.view, s.fight_id)
  const base_version = adopted_base_version(s)
  const log = sorted_log(s.entries ?? {}).filter((e) => e.version > base_version && e.source !== 'intent')
  const claimed_budget = (s.claimed_budget ?? []).filter((row) => claim_version(row) > base_version)
  const claimed = fold_claimed_budget(base, log, claimed_budget)
  return { ...claimed, fighters: apply_retirement(claimed.fighters, s.retired) }
}

/** Fold keys `p{seat}`/`m{idx}` whose KILLING damage beat still rides an UNACKED wave turn — the same wave fact
 *  project.death_presenting_ids reads for `engine_view.dead`, expressed in fold-key space (fold.js can't import
 *  project.js). #170 (5th recurrence): there is no separate 'death' beat kind anymore (the presenter derives the
 *  death visual from the presented-state edge, not an event-shaped beat) — hold on the 'damage' beat that carries
 *  `killed`, read straight off its source Hit (`victim_is_mob`/`victim_idx` → the key), so no entity resolver is
 *  needed. A masked killing Hit means the fighter is still ALIVE at pre-death HP in the re-fold; these keys mark
 *  "its death is presenting RIGHT NOW", distinct from an already-presented death. */
export const death_presenting_keys = (wave) => {
  const keys = new Set()
  for (const t of (wave ?? []).filter(holds_the_fold))
    for (const b of t.beats ?? []) {
      const e = b.kind === 'damage' && b.payload?.killed ? b.payload?.source_event : null
      if (e && e.victim_idx != null) keys.add(`${e.victim_is_mob ? 'm' : 'p'}${Number(e.victim_idx)}`)
    }
  return keys
}

/** R1 · THE ONE LOCALITY DERIVATION — "is this turn MINE", in SEAT space. A source is local iff it names my
 *  character, or is a non-mob seat equal to mine; my seat comes from my stamped key, or — production opens every
 *  session with `my_key: null` (world-shell/dungeon_fight_shim.js) — from `ctx.my_entity_id` against the adopted
 *  roster. Produced id strings never decide locality, and neither does the key string alone (#2228): EVERY reader
 *  of this fact calls here (the paced wave's `is_local`, the turn bracket's hold window), so a seat can never be
 *  local to one and foreign to the other. @param {any} s
 *  @returns {(src: { character?: any, is_mob?: boolean, idx?: any } | null) => boolean} */
const local_source = (s) => {
  const my_entity = s.ctx?.my_entity_id ?? null
  const my_seat = settle_input.actor_from_key(s.my_key)?.idx ?? seat_resolver(s.view)(my_entity)
  return (src) => {
    if (!src) return false
    if (src.character != null) return my_entity != null && String(src.character) === String(my_entity)
    return !src.is_mob && my_seat != null && Number(src.idx) === Number(my_seat)
  }
}

/** The entry window an open turn bracket (turn_bracket.js) masks while the wire finishes delivering it — the
 *  same `{version, from_idx, until_idx}` shape a wave turn carries, so the mask below reads one vocabulary. */
const hold_window = (s) => {
  const rows = s.wave_hold?.rows ?? []
  if (rows.length < 2) return []
  // MY OWN turn never masks — prediction paints it first, exactly the law `masks_entries` applies to a local
  // wave turn. The bracket's opening `TurnStarted` names whose turn it is, so the same question is asked here —
  // through R1 (`local_source`), never a second derivation: #2228, a key-space compare with no seat resolver
  // masked the local player's OWN turn whenever his key was not stamped yet (production inits it null).
  const [open] = rows
  if (local_source(s)(open)) return []
  const idxs = rows.map((row) => Number(row.event_idx)).filter(Number.isFinite)
  if (!idxs.length) return []
  return [{ version: Number(open.version), from_idx: Math.min(...idxs), until_idx: Math.max(...idxs) }]
}

/** The wave-masked fold behind BOTH projections below: base view + tail with every still-unacked window's
 *  entries removed; my own segments and every acked turn's events show instantly — hold-at-last-shown with
 *  per-turn reveal (the D115 guarantee, rebuilt on the log). Never folds from empty: if the adopted view ever
 *  reaches a version the mask can no longer straddle (the deferral in the snapshot door makes this
 *  unreachable), committed truth shows — an early reveal over a rollback, never a regression.
 *  `hold_intents` is the ONE axis the two projections differ on (see presented_state / display_state). */
const wave_masked_fold = (s, hold_intents) => {
  // #2209 — a turn bracket still in delivery masks exactly as the wave turn it is about to become: its rows are
  // already admitted, so without this the board would snap the mob onto its landing cell and then walk it there
  // from behind (the §7b insta-jump), for as long as the wire takes to finish the turn. A bracket that carries
  // only its opening `TurnStarted` masks NOTHING — that row moves nobody, and holding it back would delay the
  // handover the turn gate reads (the tail every receipt leaves open).
  const pending = [...hold_window(s), ...(s.wave ?? []).filter(masks_entries)]
  if (!pending.length) return s
  const windowed = pending.filter((t) => t.from_idx != null)
  const base_version = adopted_base_version(s)
  if (s.view != null && windowed.length && !(base_version < Math.min(...windowed.map((t) => t.version)))) return s
  const masked = (e) =>
    windowed.some((t) => e.version === t.version && e.event_idx >= t.from_idx && e.event_idx <= t.until_idx)
  const base = base_from_view(s.view, s.fight_id)
  const log = (s.log ?? []).filter((e) => (e.source === 'intent' && !hold_intents) || !masked(e))
  // V1 · RETIREMENT FLOOR — the re-fold reads the RAW view base, so it must re-apply the append-only death floor
  // exactly as the committed door does. Without it a floor-dead fighter RESURRECTS in the eye's projection whenever a
  // masking wave drains over a version-inflated-but-stale view that still carries it alive — the corpse stands up,
  // then dies a SECOND time when the wave acks (the double-death). The floor holds authoritative deaths only
  // (intents never retire), so a live prediction is untouched; the death-present HOLD stays owned by
  // project.death_presenting_ids (engine_view.dead), never by this fold's `alive`.
  //
  // #8 · DEATH-PRESENTING HP HOLD — but a fighter whose killing beat is STILL PRESENTING (its Hit sits inside a
  // masked window, so the re-fold already holds it alive at pre-death HP) must NOT be floored here: flooring snaps
  // its card HP to 0 seconds before the death floater lands (engine_view.dead already holds the visual death via
  // the same wave fact). It dies exactly when its beat acks — the turn drains, the key leaves this set, the floor
  // binds. Every OTHER retired fighter still floors (the #134 stale-resurrection of an ALREADY-presented death).
  const claimed_budget = (s.claimed_budget ?? []).filter((row) => claim_version(row) > base_version)
  const folded = fold_claimed_budget(base, log, claimed_budget)
  const presenting = death_presenting_keys(s.wave)
  const floor = presenting.size
    ? Object.fromEntries(Object.entries(s.retired ?? {}).filter(([key]) => !presenting.has(key)))
    : s.retired
  return { ...s, ...folded, fighters: apply_retirement(folded.fighters, floor) }
}

/** The EFFECTIVE projection — legality, budget, tackle reach read it. My own INTENTS paint first (prediction
 *  never waits on a beat), so a drafted move's destination is live THIS fold even while its walk still plays. */
export const presented_state = (s) => wave_masked_fold(s, false)

/** The DISPLAY projection — the rendered fighter CELL reads it (board_view / engine_view). Identical to
 *  presented_state EXCEPT a WINDOWED intent is HELD: a local walk's Moved intent has nothing to predict-paint
 *  but the walk itself, so the pre-move cell holds until the walk beat presents (§7b — never an insta-jump,
 *  the SNAP-THEN-RUN fix). Non-local moves are already receipt-masked here exactly as in presented. */
export const display_state = (s) => wave_masked_fold(s, true)

/** Pace a receipt's raw events into wave turns (non-local only — my own turn already painted optimistically).
 *  Runs on the PRE-receipt draft, so every resolver reads the state the eye currently sees:
 *   · resolve_fighter_id — seat → the REAL entity id (character id / 'mob-N'), never a 'player-N' default
 *   · fighter_cells      — an entity's pre-receipt cell (real move paths instead of single-cell teleports)
 *   · resolve_cast       — the frozen Cast carries no spell id; its ActionResolved envelope names a player's
 *     SpellTemplate object, while legacy rows and mobs retain their presentation constants
 *  Locality is decided by SEAT (R1): my segments never enter the paced wave, whatever id string they produced.
 *  Each turn carries its raw-receipt event-index window [from_idx, until_idx] — the presented fold
 *  (presented_state) hides exactly the entries inside a still-unacked window.
 *  `fighter_health` is the PRE-RECEIPT committed HP oracle the damage pricer needs; the store supplies it from
 *  the core door (`committed_truth`) because committed truth is not this module's to derive (#1027). */
const wave_turns_of = (draft, raw_events, version, trap_cells = [], base_seq = 0, fighter_health = null) => {
  const ctx = draft.ctx ?? {}
  if (!Array.isArray(raw_events) || !raw_events.length || !ctx.beat_ctx) return []
  const my_entity = ctx.my_entity_id ?? null
  const escrow = draft.view?.escrow ?? []
  const grid_w = Number(ctx.beat_ctx.grid_width) || GRID_W
  // Trap OWNERSHIP is a property of the LEDGER ROW, not of the visible set. Since the public board folds into
  // the same ledger, `trap_cells` names every trap this viewer can SEE — including an ally's — and reading
  // ownership off it would attribute their detonation to the local entity. Only a row this client PLACED
  // (`chain !== true`) names a local owner; everything else renders through the neutral fallback, which is
  // exactly what a `Hit` carrying no source deserves.
  const owned_trap_cells = new Set(
    (draft.my_traps ?? [])
      .filter((trap) => trap.chain !== true)
      .flatMap((trap) => trap.cells ?? [])
      .map(Number)
      .filter(Number.isFinite)
  )
  const resolve_trap_owner = (_cell, encoded) =>
    my_entity != null && owned_trap_cells.has(Number(encoded)) ? String(my_entity) : null
  const resolve_fighter_id = ({ is_mob, idx, character }) =>
    character != null
      ? String(character)
      : is_mob
        ? mob_entity_id(idx)
        : (participant_entity_id(escrow[Number(idx)] ?? {}) ?? `player-${Number(idx)}`)
  const cell_of = (key) => {
    const encoded = draft.fighters?.[key]?.cell
    return encoded == null ? null : { x: Number(encoded) % grid_w, y: Math.floor(Number(encoded) / grid_w) }
  }
  const fighter_cells = (source_id) => {
    const key = entity_fold_key(escrow, source_id)
    return key ? cell_of(key) : null
  }
  const fighter_id_of_key = (key) => entity_id_of_fold_key(escrow, key)
  const fighter_positions = new Map(
    Object.entries(draft.fighters ?? {}).flatMap(([key, fighter]) => {
      // Same body mask as the fold's trap ledger — ONE home (`blocks_a_walk`), the chain's `add_living_bodies`.
      if (!blocks_a_walk(fighter)) return []
      const id = fighter_id_of_key(key)
      const cell = cell_of(key)
      return id && cell ? [[String(id), cell]] : []
    })
  )
  const resolve_cast = (event, resolved) => ({
    spell_id: event.caster_is_mob ? 'mob_attack_dungeon' : (resolved?.spell ?? 'dungeon_strike'),
  })
  // R1 — locality by SEAT, read from its ONE home above (`local_source`); a paced turn carries its author as
  // `turn.source`, the same shape the bracket's opening row speaks.
  const source_is_local = local_source(draft)
  const is_local = (turn) => source_is_local(turn.source ?? null)
  const { turns } = pace_segment(
    raw_events,
    {
      fight_id: draft.fight_id,
      ...ctx.beat_ctx,
      trap_cells,
      trap_rows: (draft.my_traps ?? []).filter((trap) => !trap.gone),
      resolve_trap_owner,
      resolve_fighter_id,
      fighter_cells,
      fighter_positions,
      fighter_health,
      resolve_cast,
      // Board terrain facts, straight off the adopted view (board_state.js decode) — feeds present.js's
      // obstacle-aware move-path reconstruction (mob-crossed-obstacle bug, design ruling 2026-07-19). Same pattern as
      // trap_cells above: this module forwards raw facts, present.js/fight_render_prims.js own the interpretation.
      obstacles: draft.view?.obstacles,
      holes: draft.view?.holes,
      shape_mask: draft.view?.shape_mask,
      board_width: draft.view?.width,
      board_height: draft.view?.grid_height,
    },
    { is_local }
  )
  // Only bookkeeping beats ⇒ no 3s slot (skipped mob / terminal marker / a peer's bare turn-open handoff).
  // By beat KIND, never post-rescale duration — the all-instant spread inflates a lone bookkeeping beat to the
  // whole slot, so a duration test lied TRUE: every peer paid a phantom 3s wave per handoff (coop red, 07-17).
  const presentable = (t) => t.beats.some((b) => !['turn_start', 'turn_end', 'turn_skip', 'fight_end'].includes(b.kind))
  // The presentation window rides in SEQ SPACE (M2b): the paced beats carry their POSITION within this accepted
  // batch (produce_receipt_render_turns' event_index), and canonical entries key `event_idx = Number(seq)`, so the
  // window is offset by `base_seq` (the seq of the batch's first event) to join the two lanes on the one ordinal.
  const idx_window = (t) => {
    const idxs = t.beats.map((b) => b.payload?.source_event?.event_index).filter((n) => Number.isFinite(n))
    return idxs.length
      ? { from_idx: Math.min(...idxs) + base_seq, until_idx: Math.max(...idxs) + base_seq }
      : { from_idx: null, until_idx: null }
  }
  // ③b DEDUPE (ruled 07-19): the prediction already predicted + slid MY OWN turn's displacement (client-
  // independence). A receipt displacement_leg whose every slide MATCHES the already-presented predicted
  // displacement (same victim + same landing cell) is redundant — DISCARD it (no double-play). A MISMATCH
  // plays the leg as the correction: chain truth adopts, never regressing a receipt-proven fact.
  const presented = presented_state(draft) // reflects MY prediction (intents not yet purged at receipt time)
  const leg_matches_prediction = (t) => {
    const slides = t.beats.filter((b) => b.kind === 'displacement')
    if (!slides.length) return false
    return slides.every((b) => {
      const e = b.payload?.source_event
      if (!e || e.to_cell == null) return false
      const key = `${e.target_is_mob ? 'm' : 'p'}${Number(e.target_idx)}`
      return presented.fighters?.[key]?.cell === Number(e.to_cell)
    })
  }
  // a LOCAL row survives only as its displacement LEG (present.js) — the rest of my turn painted at click —
  // and only when that leg is NOT already what the prediction presented (③b dedupe).
  return turns
    .filter((t) => (t.is_local ? t.displacement_leg && !leg_matches_prediction(t) : presentable(t)))
    .map((t, i) => ({
      seq: draft.wave_seq + 1 + i,
      version,
      source_id: t.source_id,
      is_local: !!t.is_local,
      authoritative: true,
      duration: t.duration,
      beats: t.beats,
      ...idx_window(t),
    }))
}

/**
 * THE PACING DECISION — the ONE home (`wave_turns_of` is private to this module; grep `paced_wave_turns` for
 * every caller). Newly-admitted authoritative rows become presentation wave turns keyed on the CHAIN VERSION
 * they carry, never on the transport that delivered them — an OBSERVING seat learns its peers' turns through
 * the journal (the SSE stream / the walker's pages), an ACTING seat through its own receipt, and both must see
 * the same wave (#1649: the gate used to read `msg.type === 'receipt'`, so observers presented nothing at all).
 *  · the version AND the entry window's `base_seq` are read off the ROWS. A receipt names its object version in
 *    the envelope, but a journal batch names none — `classify_input` falls back to the batch head, which is a
 *    seq, not a chain version — while every journal row carries its own. A receipt's rows all carry that one
 *    object version, so the receipt lane's output is byte-identical to what it was.
 *  · a batch spanning SEVERAL versions is a CATCH-UP (a walker gap page, a stream replayed from the top), never
 *    live play: the chain's own min-turn keeps two transactions seconds apart, so they cannot share one live
 *    delivery. It FOLDS without pacing — replaying settled minutes as 3s slots is not presentation, and the
 *    eye's anchor (the pre-batch board every resolver below reads) is only true for the first of them anyway.
 * @param {any} draft the PRE-input state — the board the eye currently shows
 * @param {Array<Record<string, any>>} changed the newly-admitted authoritative actions
 * @param {{ trap_cells?: any[], fighter_health?: ((id: string, event: any) => number|null) | null }} [opts]
 */
export const paced_wave_turns = (draft, changed, { trap_cells = [], fighter_health = null } = {}) => {
  if (!changed.length) return []
  const version = Number(changed[0].version)
  if (!changed.every((action) => Number(action.version) === version)) return []
  // The beat producer speaks the raw chain-event shape; provenance/order/closure fields are not event content.
  const raw_events = changed.map(({ kind, version: row_version, event_idx, seq, source, resolve_seat, ...data }) => ({
    type: kind,
    parsedJson: data,
  }))
  return wave_turns_of(draft, raw_events, version, trap_cells, Number(changed[0].event_idx ?? 0), fighter_health)
}
