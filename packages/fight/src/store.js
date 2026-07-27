// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// fight/store.js — the ONE zustand store and the ONE write door for ALL fight state.
//
// THE ONE-REDUCER LAW (enforced by ares test fightcore gate b): `input(msg, now)` is the ONLY
// function repo-wide that writes fight state. Async results (receipt / journal / p2p / snapshot) NEVER `set()` a
// store — they dispatch an input, prediction paints first, and canonical truth folds through the ONE accept door.
// Every canonical entry is keyed `(version, event_idx = seq)`; the log is order-independent (a re-fold of the
// sorted, deduped entries), so any interleave of {receipt, journal page, dup delivery, stale object read}
// converges to the same committed state.
//
// ONE INGRESS (M2b, #291 — the base lane): receipts (my tx's optimistic early copy) and journal pages (the
// authoritative read-layer log) BOTH normalize into ONE `accept_batch` stream keyed `(fight_id, seq)` —
// contiguous, content-deduped, gap-checked — and its `apply` events fold as the SOLE canonical source. The 4s
// Fight OBJECT read is DEMOTED to a bootstrap base (adopted ONCE, seeding the accept cursor from journalHead) + a
// live-fight CHECKPOINT (a version/journalHead watermark that pokes the journal walker); it never re-adopts,
// never merges, never overwrites the fold. Everything that guessed history from an object read is deleted.
//
// PRESENTATION (the S2 wave lane): non-local receipt segments are paced (present.js — ~3s PER mob turn) into
// `wave` turns the renderer drains; it acks each with input({type:'presented'}). `presenting` is DERIVED
// (wave_seq > presented_seq) — never a stored latch. Projections show state at the PRESENTED floor while a wave
// drains, so committed truth never jumps the eye ahead of the beats.
//
// PLAYER MIN-TURN FLOOR: ONE 3s floor per player
// turn from the turn's own start; casts are INSTANT. THE FLOOR YIELDS TO THE DEADLINE (a turn can be lost to
// the 3s toast at 0:01 otherwise): no hold inside the last floor-width of the chain clock. The chain-side assert
// (turns.move: clock − turn_start ≥ 3000 on end_turn) stays ticketed — this client floor is the UX until then.

import { createStore } from 'zustand/vanilla'

import { classify_input } from './classify_input.js'
import { input_envelope } from './envelope.js'
import { empty_core_state, ingest, project_board } from './core.js'
import { auto_commit_fire_at } from './draft_budget.js'
import { auto_commit_decision, turn_commit_key, turn_submit_epoch } from './turn_commit.js'
import { DISPLACE_TELEPORT } from './fight_render_prims.js'
import {
  apply_action,
  empty_state,
  fighter_key,
  normalize_accepted,
  normalize_intent,
  seat_resolver,
} from './inputs.js'
import * as settle_input from './inputs.js'
import { accept_batch, empty_accept_state, seed_accept_state } from './journal_accept.js'
import { content_key, normalize_journal_page, normalize_receipt } from './journal_normalize.js'
import { u64 } from './journal_u64.js'
import { board_state_from_fight, fight_geometry_complete } from './board_state.js'
import { prediction_identity } from './budget_claims.js'
import { peer_batch_legality } from './peer_legality.js'
import { reconcile_predictions } from './reconcile_action.js'
import { create_trace_tap } from './trace_tap.js'
import {
  apply_retirement,
  base_budget,
  carry_statuses,
  entity_fold_key,
  last_action_of,
  merge_entries,
  presented_state,
  recompute,
  wave_turns_of,
} from './fold.js'

// The PRESENTATION projections consumers read live in fold.js now (the ≤600-LoC split); re-export the public
// names so project.js and tools keep importing them from the store's door.
export { claimed_budget_state, presented_state, display_state } from './fold.js'
// TEST-ONLY (#1027): the legacy committed fold, kept reachable for the cutover-parity suites alone. It has no
// runtime reader left — `committed_truth` below is the committed door — and it retires with those suites.
export { committed_state } from './fold.js'

/**
 * THE COMMITTED-TRUTH DOOR (#1027) — the ONE committed board, repo-wide. It is the HEADLESS CORE's fold
 * (`state.core`, fed by `with_core_fold` below) projected by `project_board`; there is no switch and no second
 * derivation to drift from it. Presentation (`presented_state` / `display_state` / `claimed_budget_state`) is a
 * different question and still derives from the settlement machinery, so the eye's pacing, the SNAP-THEN-RUN hold
 * and the draft budget are untouched by this.
 *
 * The APPEND-ONLY DEATH FLOOR rides on top: `retired` is a store-level fact about authoritative deaths
 * (fold.derive_retired), and dropping it here would re-open the resurrection root — a later object read carrying a
 * positive hp standing a floor-dead fighter back up.
 *
 * It lives in the store rather than in `project.js` because both of its inputs (`core`, `retired`) are store atoms
 * and the store's own doors read it; `project.js` re-exports it for the board, exactly as it does the folds above.
 *
 * TOTAL — there is no coreless arm. It used to fall back to a second fold over `s.entries` for hand-built
 * projection inputs, and that arm WAS the switch ADR §2 forbids: two derivations, one of them unreachable from
 * the door. A projection input carries a core (`empty_core_state(null)` is one) exactly as a real store atom does.
 */
export const committed_truth = (s) => {
  const board = project_board(s.core)
  return { ...board, fighters: apply_retirement(board.fighters, s.retired) }
}

/** The PRE-RECEIPT committed HP oracle the wave pricer needs (chain `Hit.amount` is raw authored damage while
 *  `remaining_hp` is saturated, so a floater is priced from the victim's committed HP). It reads the SAME door as
 *  everything else committed — the wave pacer receives it, never derives it (fold.js owns no committed fold). */
const committed_health = (s) => {
  const { fighters } = committed_truth(s)
  const escrow = s.view?.escrow ?? []
  return (source_id) => {
    const key = entity_fold_key(escrow, source_id)
    return key ? (fighters?.[key]?.hp ?? null) : null
  }
}

export const PLAYER_TURN_FLOOR_MS = 3000
export const MIN_ACTION_MS = 5000
// COURTESY event_idx lane (#334): a peer's relayed prediction retires by CLAIM, never by key, so it may sit
// pending across UNRELATED canonical events (my turn-end, a mob move). Those events key `(version, seq)` with seq
// contiguous from 0 and bounded far below this base — so seating courtesy at `BASE + intent_cursor` keeps it in a
// disjoint key lane that a colliding canonical seq can never clobber in merge_entries. Reconcile ignores event_idx
// (it matches kind + actor), so the offset is invisible to retirement.
const COURTESY_EVENT_BASE = 1_000_000
// grace past a wave turn's OWN duration before the tick watchdog force-acks it — derived headroom, never a
// guessed absolute (the turn's duration is the base; this only pads renderer jitter).
export const WAVE_ACK_GRACE_MS = 6000

// ── THE TRUTH SOURCE ──────────────────────────────────────────────────────────────────────────────────────────
// The COMMITTED board every projection reads (project.js) is folded by the HEADLESS CORE that lives in this atom
// as `core` (core_*.js). It is the ONLY committed-truth owner — there is no second fold to fall back to and no
// switch between them. The settlement/presentation machinery below still owns the PACED folds (`presented_state`
// / `display_state`), which is a different question from what is committed.

/** The door accepts a `{ page }` alias for a journal delivery (the production edge always sends the
 *  already-normalized `{ batch }` — dungeon_run_store.js). Resolving it HERE, once at the ingress, is what keeps
 *  the settlement reducer and the core's classify bridge looking at the SAME message: a shape the door accepts
 *  must never be a shape the core silently ignores, since the core owns committed truth. */
const resolve_journal_alias = (msg, fight_id) =>
  msg?.type === 'journal' && msg.batch == null && msg.page != null
    ? { ...msg, batch: normalize_journal_page(msg.page, { fight_id: msg.fight_id ?? fight_id }) }
    : msg

/** The classify bridge reads whatever fields a message carries, so a hostile accessor on one of them (the
 *  trace suite's poison-getter case) would otherwise take the door down. A message the bridge cannot read is
 *  MALFORMED, and malformed is a first-class outcome here: a null payload lands on the core's `failures` as a
 *  `malformed_envelope` record (core_ingest.js). Never a throw, never a silent skip — a failure on the record. */
const payload_of = (msg) => {
  try {
    return classify_input(msg)
  } catch {
    return null
  }
}

/**
 * THE CORE'S INGRESS — the SAME one door, wrapped once. `input(msg, now)` remains the ONLY writer of fight state;
 * this folds that same message into the headless core AFTER the legacy pipeline has committed, so the core is fed
 * by the identical ingress the recorder tee taps (one home for "what the machinery observed"). The envelope bridge
 * is `classify_input` — the same pure map the tee and the historical-corpus converter already share.
 *
 * The capture ordinal lives in THIS closure, never in the atom: it is provenance for the envelope, not fight state
 * (the tee keeps its own the same way). Session identity comes from the STORE's own post-commit `fight_id`, never
 * from the raw message — the door already gated the message's provenance, and a hostile accessor on a diagnostic
 * field must not reach the reducer. `ingest` returns the SAME atom for a fold no-op (a draft, an unmapped
 * lifecycle), and returning `s` unchanged makes zustand skip the notify — a no-op input costs no subscriber round.
 *
 * NO FAULT BOUNDARY, deliberately: the core is the truth owner, so swallowing a throw here would freeze the
 * board silently — the exact class the no-silent-failure law bans. `ingest` is total by construction (ingest.js).
 * @param {(msg: any, now?: number) => any} door the settlement/presentation reducer door
 * @param {(fn:(s:any)=>any)=>void} set
 * @param {()=>any} get
 */
const with_core_fold = (door, set, get) => {
  let capture_seq = 0
  return (raw, now = Date.now()) => {
    const msg = resolve_journal_alias(raw, get().fight_id)
    const result = door(msg, now)
    const envelope = input_envelope({
      session_id: get().fight_id ?? null,
      input_seq: capture_seq++,
      observed_at_ms: now,
      payload: payload_of(msg),
    })
    set((s) => {
      const core = ingest(s.core, envelope, now)
      return core === s.core ? s : { ...s, core }
    })
    return result
  }
}

// PROVIDER TOKEN + SESSION IDENTITY (INC-0 — the additive mechanical floor). `refuse_reason` is the ONE gate the
// door runs before every input: a LOCAL push (my HUD intent / composite prediction) is refused unless the local
// client holds the mic (NORTH_STAR C2/C3 — "during chain_replay and idle_wait, HUD triggers NOTHING"); a chain
// or presentation-ack input crossing a fight/session boundary is dropped (B-F02/F06). A MISSING id is HELD (R5 —
// an id-less resume snapshot is claimed by the current session, never dropped). Every refusal is a logged
// non-event: the reducer records it in `state.refused` (the turn_lost idiom — the fight core is hermetic, so it
// cannot call the frontend fight_state_trace; an edge subscriber surfaces `refused`, as subscribe_turn_lost does).
const LOCAL_PUSH = new Set(['intent', 'predicted'])
const IDENTITY_SCOPED = new Set(['receipt', 'poll', 'p2p', 'snapshot', 'presented', 'placement_ghost', 'courtesy'])
const refuse_reason = (state, msg) => {
  if (LOCAL_PUSH.has(msg.type) && state.provider !== 'local_turn')
    return { type: msg.type, reason: 'provider', provider: state.provider }
  if (IDENTITY_SCOPED.has(msg.type)) {
    if (msg.fight_id != null && state.fight_id != null && String(msg.fight_id) !== String(state.fight_id))
      return { type: msg.type, reason: 'fight_id', got: String(msg.fight_id), want: String(state.fight_id) }
    if (msg.session_generation != null && msg.session_generation !== state.session_generation)
      return {
        type: msg.type,
        reason: 'session_generation',
        got: msg.session_generation,
        want: state.session_generation,
      }
  }
  return null
}

/** THE ONE CANONICAL DECODE (M2b, #291): run a normalized batch (a receipt's optimistic early copy OR an
 *  authoritative journal page) through the accept machine — contiguous, content-deduped, gap-checked — and decode
 *  its ordered `apply` output into canonical actions (event_idx = Number(seq)). Returns the new cursor + the actions
 *  the fold merges + the gap/fault effects the edge/telemetry act on. `base_seq` (the first applied seq) puts a
 *  receipt's paced wave window into seq space. This is the SOLE door canonical fight events enter through. */
const accept_and_decode = (s, batch, resolve_seat_override = null) => {
  const { state: accept_state, effects } = accept_batch(s.accept_state, batch)
  const apply = effects.find((e) => e.type === 'apply')?.events ?? []
  const gap = effects.find((e) => e.type === 'fetch_gap') ?? null
  const fault = effects.find((e) => e.type === 'protocol_fault') ?? null
  const actions = normalize_accepted(apply, {
    resolve_seat: resolve_seat_override ?? s.ctx?.resolve_seat ?? seat_resolver(s.view),
    base_of: base_budget(s.view),
  })
  // A journal page is the authoritative proof even when an earlier receipt/p2p copy already occupied its seq and
  // `apply` is empty. Decode every content-matching row the accept machine has admitted so prediction claims retire
  // identically in journal-first and journal-confirmation order; version eligibility in reconcile_action prevents a
  // redelivered historical Cast from claiming a newer prediction.
  const confirmed =
    batch?.source === 'journal'
      ? (batch.events ?? []).filter((event) => {
          const accepted = accept_state.digests?.[event.seq]
          return accepted != null && accepted === content_key(event)
        })
      : []
  const confirmed_actions = normalize_accepted(confirmed, {
    resolve_seat: resolve_seat_override ?? s.ctx?.resolve_seat ?? seat_resolver(s.view),
    base_of: base_budget(s.view),
  })
  return {
    accept_state,
    actions,
    confirmed_actions,
    apply,
    gap,
    fault,
    base_seq: apply.length ? Number(apply[0].seq) : 0,
  }
}

const actor_key = (is_mob, idx) => `${is_mob ? 'm' : 'p'}${Number(idx)}`

const budget_target = (action) => {
  if (action?.kind === 'Granted') return actor_key(action.target_is_mob, action.target_idx)
  if (action?.kind === 'Moved') return fighter_key({ character: action.character, resolve_seat: action.resolve_seat })
  return null
}

/** The board supplies an absolute whole-draft remainder so undo can restore it. Store the mutation this particular
 * Moved row contributed as well: unlike the absolute, the signed delta composes if an earlier speculative grant or
 * move later disappears. Legacy/non-resolvable inputs keep the absolute fallback in inputs.js. */
const with_move_budget_delta = (s, action) => {
  if (action?.kind !== 'Moved' || action.mp_left == null) return action
  const target = budget_target(action)
  const fighter = target == null ? null : presented_state(s).fighters?.[target]
  const before = fighter?.mp_unclamped ?? fighter?.mp
  const after = Number(action.mp_left)
  if (before == null || !Number.isFinite(Number(before)) || !Number.isFinite(after)) return action
  return { ...action, mp_delta: after - Number(before) }
}

const boundary_target = (action) => {
  if (action?.kind === 'TurnEnded') return actor_key(action.is_mob, action.idx)
  if (action?.kind === 'Hit' && Number(action.remaining_hp) <= 0)
    return actor_key(action.victim_is_mob, action.victim_idx)
  if (action?.kind === 'Abandoned') return actor_key(false, action.seat)
  return null
}

/** Merge newly proven non-canonical budget facts, then let a target's own turn-end/death boundary win. A boundary
 * clears only rows no newer than itself, so old journal redelivery cannot erase a later turn's accepted budget. */
const update_claimed_budget = (current, claimed, boundaries) => {
  const rows = new Map((current ?? []).map((row) => [row.key, row]))
  for (const row of claimed ?? []) rows.set(row.key, row)
  const ends = (boundaries ?? [])
    .map((action) => ({
      key: boundary_target(action),
      version: Number(action.version),
      event_idx: Number(action.event_idx),
    }))
    .filter((row) => row.key && Number.isFinite(row.version))
  for (const [key, row] of rows) {
    const target = budget_target(row.action)
    const version = Number(row.claimed_at?.version ?? row.action.version)
    const event_idx = Number(row.claimed_at?.event_idx ?? row.action.event_idx)
    if (
      ends.some(
        (end) =>
          end.key === target && (end.version > version || (end.version === version && end.event_idx >= event_idx))
      )
    )
      rows.delete(key)
  }
  return [...rows.values()].sort(
    (a, b) =>
      Number(a.claimed_at?.version ?? a.action.version) - Number(b.claimed_at?.version ?? b.action.version) ||
      Number(a.claimed_at?.event_idx ?? a.action.event_idx) - Number(b.claimed_at?.event_idx ?? b.action.event_idx) ||
      a.key.localeCompare(b.key)
  )
}

const merge_budget_predictions = (current, incoming) => {
  const rows = new Map((current ?? []).map((row) => [row.key, row]))
  for (const row of incoming ?? []) rows.set(row.key, row)
  return [...rows.values()].sort(
    (a, b) =>
      Number(a.action.version) - Number(b.action.version) ||
      Number(a.action.event_idx) - Number(b.action.event_idx) ||
      a.key.localeCompare(b.key)
  )
}

const retain_budget_predictions = (rows, reconcile) => {
  if (!reconcile) return rows
  return (rows ?? []).filter(({ action }) => {
    const retired_key = reconcile.retire.has(`${action.version}:${action.event_idx}`)
    const retired_intent = action.intent_id != null && reconcile.retired_intents.has(action.intent_id)
    return !retired_key && !retired_intent
  })
}

const preceding_action = (entries, actions) => {
  const first = actions?.[0]
  if (first?.event_idx == null) return null
  return (
    Object.values(entries ?? {}).find(
      (entry) => entry.source !== 'intent' && Number(entry.event_idx) === Number(first.event_idx) - 1
    ) ?? null
  )
}

/** Claims are transport-independent once their actions are authoritative. `authoritative` may contain an older
 * journal prefix, so both actions and pending rows are version-windowed before the FIFO identity matcher runs. */
const claim_predictions = (s, authoritative, now) => {
  const pending = Object.values(s.entries).filter((entry) => entry.source === 'intent')
  const seen = new Set(pending.map(prediction_identity))
  // A p2p/poll early copy may occupy an intent's `(version,event_idx)` before the journal confirms it. Preserve the
  // per-cast proof/Grant and Moved.mp_left outside that collision-prone log, then synthesize only whichever rows the
  // canonical merge displaced. This registry is prediction evidence, never a second canonical ingress.
  for (const { action } of s.budget_predictions ?? []) {
    const key = prediction_identity(action)
    if (!seen.has(key)) {
      pending.push(action)
      seen.add(key)
    }
  }
  pending.sort((a, b) => Number(a.version) - Number(b.version) || Number(a.event_idx) - Number(b.event_idx))
  if (!pending.length || !authoritative?.length) return null
  const oldest = Math.min(...pending.map((entry) => Number(entry.version)))
  const actions = authoritative.filter((action) => Number(action.version) >= oldest)
  if (!actions.length) return null
  const ceiling = Math.max(...actions.map((action) => Number(action.version)))
  const eligible = pending.filter((entry) => Number(entry.version) <= ceiling)
  if (!eligible.length) return null
  const my_actor = settle_input.actor_from_key(s.my_key)
  const ended_my_turn =
    !!my_actor &&
    actions.some(
      (action) =>
        action.kind === 'TurnEnded' &&
        !!action.is_mob === !!my_actor.is_mob &&
        Number(action.idx) === Number(my_actor.idx)
    )
  return {
    ended_my_turn,
    result: reconcile_predictions(eligible, actions, {
      version: ceiling,
      at: now,
      ended_my_turn,
      preceding: preceding_action(s.entries, actions),
    }),
  }
}

/** Build the rich board view from a snapshot msg + the merged ctx — the ONE snapshot decode (bootstrap adoption
 *  and the checkpoint watermark both read it, so the object is decoded identically in both). */
const snapshot_view = (ctx, msg, version) =>
  board_state_from_fight({
    fight: msg.fight,
    version,
    run: msg.run !== undefined ? msg.run : (ctx.run ?? null),
    rooms_total: msg.rooms_total ?? ctx.rooms_total ?? 0,
    mob_names: ctx.mob_names ?? {},
    mob_levels: ctx.mob_levels ?? {},
    mob_elements: ctx.mob_elements ?? {},
    creator: ctx.creator ?? null,
    offset: ctx.offset ?? undefined,
  })

// Observer identity is stripped at every context ingress, not merely hidden by engine_view. Global owned-party
// focus updates remain live while WATCH is open; retaining one here would make its journal turns look local.
const observer_ctx = (ctx = {}) =>
  ctx.spectator === true ? { ...ctx, address: null, creator: null, my_entity_id: null } : ctx

const empty_fight = () => ({
  ...empty_state(null),
  entries: {},
  applied_version: -1,
  // M2b · ONE INGRESS (#291). The accept machine's cursor (journal_accept.js) — the ONE canonical ingress: receipts
  // AND journal pages normalize (journal_normalize.js) into ONE stream keyed `(fight_id, seq)`, deduped by content
  // and gap-checked here. `entries` holds ONLY its `apply` output (canonical) + my optimistic intents; the 4s
  // snapshot is DEMOTED to a bootstrap base + a live-fight checkpoint, never a state source that overwrites the fold.
  accept_state: empty_accept_state(),
  journal_gap: null, // { fight_id, from } — the accept machine (or a snapshot watermark) needs the journal walked from `from`; the edge reads this and paginates
  protocol_fault: null, // { seq, accepted, received, ... } — a re-delivered seq whose content DISAGREED with accepted truth (never overwritten; surfaced as telemetry)
  // ACCEPTED SILENT BUDGET FACTS — bounded, non-canonical overlays [{key,intent_id,action}]. M2b claim retirement
  // otherwise loses give_points and the Moved budget delta because neither is carried by its canonical event and
  // live snapshots are checkpoint-only. Retain them until the TARGET fighter's own TurnEnded (or death). fold.js
  // applies them to effective/claim-budget projections only: canonical history and committed_state stay untouched.
  claimed_budget: [],
  // BUDGET PREDICTION EVIDENCE — prediction metadata only, keyed by prediction identity. Canonical ingress can
  // overwrite an intent at the same `(version,event_idx)` before journal confirmation (p2p/poll-first), so each
  // silent Grant, its Cast anchor, and Moved budget delta live here until claim/expiry/rollback. They are
  // synthesized only for reconciliation and missing optimistic paint; canonical entries still come exclusively
  // from accept_batch.
  budget_predictions: [],
  view: null, // the adopted rich board view (board_state_from_fight) — the BOOTSTRAP base (adopted once per fight, then checkpoint-only)
  view_version: -1,
  ctx: {}, // init/context data (mob identity maps, offset, my_entity_id, beat_ctx resolvers) — NEVER hashed
  sim: null, // @aresrpg/sim FightState — the prediction seam (a shim supplies the roster)
  wave: [], // paced presentation turns [{seq, version, final, source_id, is_local, duration, beats}]
  // ④+⑦b MY PLACED TRAPS — the ONE fold-state home (ruled 07-19; the keyless read drops Fight.fx, the receipt
  // carries no trap event, so this is a durable accumulator like `wave`, carried through recompute). Records
  // [{ draft_id, cells:number[], gone }]: appended at a trap-cast dispatch, `gone`-marked when a COMMITTED
  // (receipt-proven) fighter lands on it (permanent — never regress), dropped by draft id when its cast is
  // dropped, cleared on init. engine_view projects the LIVE set (gone + presented-occupied excluded); the sim
  // door reads THAT. trap_overlay stays render-only — zero sim reads from it.
  my_traps: [],
  // MY PLACED GLYPHS — the caster's OWN placed glyph zones (the orange ground blob that STAYS). Same durable-
  // accumulator class as my_traps (the keyless read drops Fight.fx, the receipt carries no glyph event), but the
  // LIFECYCLE differs (sim/fight_traps.js is the truth): a glyph is PERSISTENT — check_glyphs ticks whoever stands
  // on it at TURN_START and never removes it — so it dies only by EXPIRY (decay_glyphs drops turns_remaining at 0).
  // Records [{ draft_id, cells:number[], turns_remaining, gone }]: appended at a glyph-cast dispatch, decremented on
  // each of MY turn-advances (the only clean client turn signal; errs toward persistence — the client has no chain
  // glyph read), dropped by shared cell on flush, cleared on init. engine_view projects the LIVE (non-gone) cells;
  // the render (voxel_fight_adapter) reads THAT projection directly — single home, no render-mirror module.
  my_glyphs: [],
  // PLACEMENT GHOSTS — a PEER's uncommitted placement pick, relayed p2p: picks aren't committed
  // pre-start, so teammates SEE where others intend to stand. Character-keyed map { [character]: { cell,
  // at } } — one ghost per character, latest pick wins. GC'd in recompute (fold.js): a committed Placed for that
  // character supersedes it forever, a stale one (GHOST_STALE_MS) expires. Cosmetic ONLY — never read by
  // legality/commit paths, excluded from canonical_state/state_hash (a lying ghost can't do anything).
  placement_ghosts: {},
  // COURTESY CHANNEL (#334) — the SECOND channel (docs/FIGHT_PIPELINE.md). `courtesy_seen` dedupes a peer's
  // relayed draft batches by intent_id (a re-delivered batch folds ONCE); `flagged` is the ONE neutral toast fact
  // an illegal injected batch raises ({ peer, reason, at, shown? } — the turn_lost idiom, an edge surfaces it
  // once). Both are presentation-only, cleared per init; a peer's legal draft paints as a `courtesy: true`
  // prediction in `entries` and retires through the ordinary claim engine, never a second canonical ingress.
  courtesy_seen: {},
  flagged: null,
  // V1 — APPEND-ONLY DEATH FLOORS { fighter_key → floor_version } (durable accumulator, same class as my_traps).
  // A fighter proven dead by an authoritative action floors here forever within the fight; `alive` DERIVES from it
  // (fold.apply_retirement), so no later higher-version read carrying a positive hp can resurrect a floor-dead
  // fighter (the resurrection root, symptom ②). Cleared per init (a new fight); never pruned by a snapshot adopt.
  retired: {},
  optimistic_dead: {}, // #170 intent-death latch (key → { seq }) — tracks a predicted death so a stale poll that
  // purged the prediction can't resurrect it; released when receipt_seq advances, and only HELD to the eye while
  // `busy` (commit in-flight — else a fresh kill-less read authoritatively restores the mob, kill_adoption LEG A)
  wave_seq: 0,
  presented_seq: 0, // renderer ack floor — `presenting` = wave_seq > presented_seq (derived, never a latch)
  wave_head: null, // { seq, at } — the head wave turn (any locality) + when a tick first saw it (watchdog clock)
  turn_lost: null, // { key, reason:'missed'|'latched'|'burned', shown? } — a drafted turn that expired uncommitted; the toast edge consumes it once (no-silent-failure law)
  staged: [], // intents awaiting a PTB (txs.js)
  armed_spell_id: null, // the armed card (fight-session UI state — ONE home so every HUD surface agrees)
  hovered_spell_id: null, // the passively hovered card (D299a readout)
  hand: [], // the spell bar's name_keys (hand_update input)
  busy: false, // a fight tx is in flight (txs orchestration drives via the door)
  commit_due: false, // tick-derived level; project.commit_due is the edge-facing projection
  commit_latch: null, // executed-failure proof mirrored through the busy input (never read from another store)
  commit_attempt_epoch: null, // reducer-owned once claim; a new playable turn/receipt produces another key, and
  // discarding a non-empty uncommitted draft ('clear_staged', #1045) gives this claim back exactly once per turn
  // so a refused commit still leaves the turn endable
  receipt_seq: 0, // receipt feedback re-arms a same-player solo turn without weakening failure idempotency
  last_action_ms: 0, // chain floor for the next legal commit, adopted at the snapshot input door
  error: null,
  my_key: null, // which fighter I am — drives the floor + local-vs-peer pacing (never part of the parity hash)
  turn_started_at: null, // wall clock my current turn began (floor anchor); NOT re-stamped per cast
  my_turn_no: 0, // MY seat-turn counter (cast.move seat_turn twin) — bumped once per my PLAYABLE turn-start in recompute (deadline-independent); the cooldown gate's clock. Reset here per init/session.
  pending_end_turn: null, // { ready_at } while an end-turn is held under the floor
  intent_seq: 0, // monotonic event_idx for optimistic intents (keeps my clicks out of the receipt's key lane)
  settlement: settle_input.empty_settlement(), // chain-confirmed terminal + bounded attempt state
  provider: 'idle_wait', // NORTH_STAR C2: the sole push channel — 'local_turn'|'chain_replay'|'idle_wait'. DERIVED by recompute (never a stored latch); idle until the first fold.
  session_generation: 0, // bumped per init; an async input tagged with a superseded generation drops (A→B crossing guard)
  refused: null, // { type, reason, ... , at } — the last input the provider/identity gate refused (a logged non-event the edge surfaces once)
  divergence: null, // { version, at, deferred? } — the last equal-version object that disagreed with the event fold (keystone #3: the reconcile-divergence log)
})

/** THE ONE DOOR: chain inputs (snapshot/receipt/poll/p2p/terminal confirmation/outcome), local prediction,
 * presentation acks, and UI/tx signals all reduce here; nothing else writes fight state.
 * @param {(fn:(s:any)=>any)=>void} set
 * @param {()=>any} get
 * @param {ReturnType<typeof create_trace_tap>} trace_tap
 */
const make_input =
  (set, get, trace_tap) =>
  (msg, now = Date.now()) => {
    const state = get()
    // TRACE TAP (issue #209): every message crossing this door, VERBATIM, before any gate/set — pure data
    // capture, zero behavior change (@aresrpg/fight/trace_tap). Fault containment lives on this producer
    // boundary: no diagnostic consumer — including a hostile accessor on an otherwise valid message — may stop
    // the ONE reducer door.
    try {
      trace_tap.tap_trace_input(state, msg, now)
    } catch {
      /* a diagnostic tap NEVER perturbs the fight flow */
    }
    // THE PROVIDER/SESSION GATE (INC-0, NORTH_STAR C2/C3): a mismatched-provenance local push, or a chain/ack
    // input for another fight or a superseded session, is REFUSED — recorded in `state.refused` (a logged
    // non-event) and never applied. Missing id is HELD (the current session claims it). Control signals
    // (init/ctx/tick/arm/…) carry no provenance and always pass.
    const refused = refuse_reason(state, msg)
    if (refused) return set((s) => ({ ...s, refused: { ...refused, at: now } }))
    if (settle_input.is_settlement_input(msg.type))
      return set((s) => ({ ...s, settlement: settle_input.reduce_settlement(s.settlement, msg) }))
    switch (msg.type) {
      case 'init':
        set(() => {
          const ctx = observer_ctx(msg.ctx ?? {})
          return {
            ...empty_fight(),
            // A new session generation per init — an in-flight async result tagged with the prior generation
            // (a fight-A response landing after fight B opened) drops at the gate above instead of corrupting B.
            session_generation: (state.session_generation ?? 0) + 1,
            fight_id: msg.fight_id ?? null,
            my_key: ctx.spectator === true ? null : (msg.my_key ?? null),
            ctx,
            settlement:
              msg.fight_id == null
                ? settle_input.pending_settlement(state.settlement)
                : settle_input.empty_settlement(),
          }
        })
        return
      case 'ctx':
        // MULTICHAR seat focus: a my_entity_id switch re-resolves my_key against the adopted view — a stale
        // stamped seat keeps the projection + transaction_character_id on the WRONG character (burned gas).
        // Unresolvable (no view yet / unknown entity) keeps the current key; adoption re-stamps as before.
        set((s) => {
          const ctx = observer_ctx({ ...s.ctx, ...msg.ctx })
          const seat = 'my_entity_id' in (msg.ctx ?? {}) ? seat_resolver(s.view)(ctx.my_entity_id) : null
          return recompute({ ...s, ctx, my_key: seat != null ? `p${seat}` : s.my_key }, now)
        })
        return
      case 'receipt':
      case 'poll':
      case 'p2p': {
        // OPTIMISTIC EARLY COPY (M2b · ONE INGRESS). A receipt (my tx), a liquidation/overdue-crank poll, and a peer
        // relay all carry the SAME chain events the journal will serve — an early copy, arriving before the indexer.
        // Once the CONFIRMED log (applied_version) has reached this version, the copy is redundant (the authoritative
        // journal owns it): a redelivery at or below the floor is inert. Ahead of the floor it folds through the ONE
        // accept door at the optimistic next seq; the journal later CONFIRMS it (content-key dedupe) or corrects
        // forward (a gap/fault). Peer relays enter here too — the peer lane shapes its input to this door (#291).
        if (msg.version != null && Number(msg.version) <= state.applied_version) return
        const head = u64(state.accept_state.head)
        const batch = normalize_receipt(msg.receipt ?? msg.events ?? [], {
          fight_id: msg.fight_id ?? state.fight_id,
          from_seq: (head == null ? 0n : head + 1n).toString(),
          version: msg.version,
          digest: msg.receipt?.digest,
        })
        set((s) => {
          const { accept_state, actions, apply, gap, fault, base_seq } = accept_and_decode(s, batch, msg.resolve_seat)
          const my_actor = settle_input.actor_from_key(s.my_key)
          const ended_my_turn =
            !!my_actor &&
            actions.some(
              (action) =>
                action.kind === 'TurnEnded' &&
                !!action.is_mob === !!my_actor.is_mob &&
                Number(action.idx) === Number(my_actor.idx)
            )
          // PREDICTIONS RETIRE BY CLAIM, NEVER BY PURGE (#308, M6). A RECEIPT settles exactly the claim keys (kind +
          // actor) its accepted events carry: a matching prediction retires (byte-match ⇒ silent, mismatch ⇒ ONE
          // forward correction); an UNRELATED receipt touches nothing; a turn-ending receipt expires what it never
          // claimed. poll/p2p never retire a live prediction (#170 — a stale early copy is not my turn's proof).
          const entries = { ...s.entries }
          const claim = msg.type === 'receipt' ? claim_predictions(s, actions, now) : null
          const reconcile = claim?.result ?? null
          if (reconcile) for (const key of reconcile.retire) if (entries[key]?.source === 'intent') delete entries[key]
          const budget_predictions = retain_budget_predictions(s.budget_predictions, reconcile)
          const canonical = Object.values(s.entries).filter((entry) => entry.source !== 'intent')
          const claimed_budget = update_claimed_budget(s.claimed_budget, reconcile?.claimed, [...canonical, ...actions])
          // A RECEIPT paces its NON-LOCAL turns into presentation waves (mine paint optimistically; a peer turn's
          // presentation is the peer lane's). Only genuinely-new accepted events (apply) pace — a redelivery yields
          // an empty apply, so no second visual wave (the accept machine subsumes the old wave_versions dedupe). The
          // window rides in SEQ space via base_seq (fold.js:idx_window).
          const raw_pace = apply.map((e) => ({ type: e.kind, parsedJson: e.data }))
          const new_turns =
            msg.type === 'receipt' && apply.length
              ? wave_turns_of(s, raw_pace, msg.version, msg.trap_cells ?? [], base_seq, committed_health(s))
              : []
          const wave = [...s.wave, ...new_turns]
          return recompute(
            {
              ...s,
              accept_state,
              commit_due: false,
              receipt_seq: msg.type === 'receipt' ? s.receipt_seq + 1 : s.receipt_seq,
              staged: ended_my_turn ? [] : s.staged,
              divergence: reconcile?.divergence ?? s.divergence,
              entries: merge_entries(entries, actions),
              claimed_budget,
              budget_predictions,
              journal_gap: gap ? { fight_id: gap.fight_id, from: gap.from } : s.journal_gap,
              protocol_fault: fault ?? s.protocol_fault,
              wave,
              wave_seq: wave.length ? wave[wave.length - 1].seq : s.wave_seq,
            },
            now
          )
        })
        return
      }
      case 'journal': {
        // THE AUTHORITATIVE CATCH-UP / BACKFILL (M2b · ONE INGRESS). A journal batch (a page ALREADY normalized by
        // the effectful walker, rpc/fight_journal.js — one normalize home, at the edge) carries the real per-fight
        // seqs, so it folds straight through the accept door: a redelivered page dedupes by seq, a hole requests its
        // own fill (the walker re-drives from `from`). Pure canonical fold — no presentation pacing here (backfilled
        // history is not re-animated; a live peer/mob turn's presentation rides the receipt/peer lane). `journal_gap`
        // clears when this page catches the frontier up (no fetch effect), or re-arms if it reveals a further hole.
        const { batch } = msg // the legacy `{ page }` alias is normalized at the ingress (resolve_journal_alias)
        set((s) => {
          const { accept_state, actions, confirmed_actions, gap, fault } = accept_and_decode(s, batch)
          const claim = claim_predictions(s, confirmed_actions, now)
          const reconcile = claim?.result ?? null
          const entries = { ...s.entries }
          if (reconcile) for (const key of reconcile.retire) if (entries[key]?.source === 'intent') delete entries[key]
          const budget_predictions = retain_budget_predictions(s.budget_predictions, reconcile)
          const canonical = Object.values(s.entries).filter((entry) => entry.source !== 'intent')
          const claimed_budget = update_claimed_budget(s.claimed_budget, reconcile?.claimed, [
            ...canonical,
            ...confirmed_actions,
          ])
          return recompute(
            {
              ...s,
              accept_state,
              entries: merge_entries(entries, actions),
              claimed_budget,
              budget_predictions,
              staged: claim?.ended_my_turn ? [] : s.staged,
              divergence: reconcile?.divergence ?? s.divergence,
              journal_gap: gap ? { fight_id: gap.fight_id, from: gap.from } : null,
              protocol_fault: fault ?? s.protocol_fault,
            },
            now
          )
        })
        return
      }
      case 'snapshot': {
        // THE 4s OBJECT READ — DEMOTED (M2b · ONE INGRESS, #291). A decoded Fight OBJECT is NOT a state source. It
        // does exactly two jobs: it BOOTSTRAPS the fold's base ONCE per fight (the first read — adopt the rich view +
        // seed the accept cursor from journalHead), and thereafter it is a CHECKPOINT: a version/journalHead watermark
        // and gap detector that pokes the journal walker. It NEVER re-adopts, NEVER merges events, NEVER overwrites
        // the fold. The snapshot-diff SPECTATOR REPLAY and the mid-fight wholesale RE-ADOPT (with their deferral) are
        // DELETED — everything that guessed history from an object read dies; canonical truth is the accept stream.
        const is_open = msg.fight == null // the pre-engage roam (a run with no fight yet) — a lobby view, never journaled
        // HOLD-NOT-DEGRADE (adoption seam law, 07-18): a read whose BoardGeom is missing (decode maps an absent board
        // to width/height 0) is a TORN record, not a shape — drop it whole; the poll loop re-reads until it is whole.
        if (msg.fight != null && !fight_geometry_complete(msg.fight)) return
        const version = Number(msg.version ?? 0)
        // BOOTSTRAP — the first base of this fight (view still null), or every roam view (there is no journal to fold
        // a lobby view on top of). This is the SOLE moment an object read writes the fold: it seeds the base + cursor.
        if (is_open || state.view == null) {
          if (!is_open && version <= state.view_version) return // never regress the base below itself
          set((s) => {
            const ctx = observer_ctx({ ...s.ctx, ...(msg.ctx ?? {}) })
            // V2 · A5 OMISSION-HOLD: a base that does NOT model the status class must not drop a floored
            // invisibility/buff — backfill its status rows from the prior committed state (a no-op for a modelled read).
            const view = carry_statuses(snapshot_view(ctx, msg, version), committed_truth(s))
            // The base subsumes every canonical fact at or below its version; keep only my optimistic intents + any
            // canonical tail already folded above it (a resume that raced ahead of the read).
            const entries = {}
            for (const [key, entry] of Object.entries(s.entries))
              if (entry.version > version || entry.source === 'intent') entries[key] = entry
            const seat = seat_resolver(view)(ctx.my_entity_id) // adoption may be the first moment my seat resolves
            return recompute(
              {
                ...s,
                view,
                view_version: version,
                accept_state: is_open ? s.accept_state : seed_accept_state(msg.journal_head),
                entries,
                // A bootstrap base already contains every silent pool mutation at/below its version. Normally no
                // claim can predate the first view (the provider gate blocks local prediction), but keep the seam
                // explicit for resume/race safety so a carried grant can never be folded twice.
                claimed_budget: (s.claimed_budget ?? []).filter(
                  (row) => Number(row.claimed_at?.version ?? row.action?.version) > version
                ),
                budget_predictions: (s.budget_predictions ?? []).filter((row) => Number(row.action?.version) > version),
                ctx,
                my_key: seat != null ? `p${seat}` : s.my_key,
                commit_due: false,
                last_action_ms: Math.max(s.last_action_ms, last_action_of(msg.fight, s.last_action_ms)),
              },
              now
            )
          })
          return
        }
        // CHECKPOINT — the base is already set. NEVER re-adopt, NEVER merge. Adopt last_action_ms (the events omit it),
        // and if the object's journalHead is AHEAD of our accepted frontier, request the missing seq range: the walker
        // fills it and the fold catches up from the JOURNAL, never from this object read. The object's own fighter
        // values are ignored — a stale/torn read can no longer teleport the board (the resurrection/rollback class).
        set((s) => {
          const journal_head = u64(msg.journal_head)
          const accepted = u64(s.accept_state.head)
          const next = accepted == null ? 0n : accepted + 1n
          const journal_gap =
            journal_head != null && journal_head > next
              ? { fight_id: s.fight_id, from: next.toString() }
              : s.journal_gap
          return {
            ...s,
            last_action_ms: Math.max(s.last_action_ms, last_action_of(msg.fight, s.last_action_ms)),
            journal_gap,
          }
        })
        return
      }
      case 'intent': {
        // The player MIN-TURN floor lives ONLY on end_turn, measured from turn_started_at — never per cast.
        if (msg.intent?.kind === 'end_turn' && state.turn_started_at != null) {
          const ready_at = state.turn_started_at + PLAYER_TURN_FLOOR_MS
          // THE FLOOR YIELDS TO THE DEADLINE (head doc): a park in the last floor-width could only eat the turn.
          const deadline = Number(state.turn_deadline_ms ?? 0)
          if (now < ready_at && !(deadline > 0 && deadline - now <= PLAYER_TURN_FLOOR_MS)) {
            set((s) => ({ ...s, pending_end_turn: { ready_at, intent: msg } }))
            return // held — a human never sees this (they exceed 3s naturally); a bot's instant pass is blocked
          }
        }
        const action = with_move_budget_delta(
          state,
          normalize_intent(msg.intent, {
            version: msg.version ?? Math.max(1, state.applied_version + 1),
            event_idx: msg.event_idx ?? state.intent_seq,
            actor: settle_input.actor_from_key(state.my_key),
            resolve_seat: msg.resolve_seat ?? state.ctx?.resolve_seat ?? seat_resolver(state.view),
          })
        )
        set((s) => {
          // A local wave turn (my optimistic beats at natural durations) rides along when the caller built one —
          // the renderer plays it THIS frame (is_local: no 3s pacing) and acks it like any other turn.
          // MY OWN WALK IS WINDOWED (SNAP-THEN-RUN, reported twice in testing): a Moved intent windows its own event so
          // the DISPLAY fold (display_state) holds the pre-move cell until this walk beat presents (§7b: never an
          // insta-jump — the walk IS the render). EFFECTIVE (presented_state) still paints the destination this fold
          // so draft/legality/reach are unblocked; a cast carries NO window (B3: it routes through 'predicted').
          const beats = Array.isArray(msg.beats) ? msg.beats : []
          const walk_window = action.kind === 'Moved' ? { from_idx: action.event_idx, until_idx: action.event_idx } : {}
          const wave = beats.length
            ? [
                ...s.wave,
                {
                  seq: s.wave_seq + 1,
                  version: action.version,
                  final: false,
                  source_id: s.ctx?.my_entity_id ?? s.my_key,
                  is_local: true,
                  duration: beats.reduce((sum, b) => sum + (b.duration || 0), 0),
                  beats,
                  ...walk_window,
                },
              ]
            : s.wave
          const budget_predictions =
            action.kind === 'Moved' && action.mp_left != null
              ? merge_budget_predictions(s.budget_predictions, [{ key: prediction_identity(action), action }])
              : s.budget_predictions
          return recompute(
            {
              ...s,
              entries: merge_entries(s.entries, [action]),
              budget_predictions,
              intent_seq: s.intent_seq + 1,
              staged: action.kind === 'TurnEnded' ? [] : s.staged,
              pending_end_turn: null,
              // A cast stays armed while the targetable click is only a verdict; clear it atomically once the
              // normalized local Cast is accepted into the reducer log. Other intents never touch the selection.
              armed_spell_id: action.kind === 'Cast' ? null : s.armed_spell_id,
              wave,
              wave_seq: wave.length ? wave[wave.length - 1].seq : s.wave_seq,
            },
            now
          )
        })
        return
      }
      case 'predicted': {
        // COMPOSITE PREDICTION (register #22 dissolved at the door): a whole optimistic cast result — its Cast
        // and every Displaced/Hit/status effect — folds in ONE set(), so no subscriber can ever observe a Cast
        // without its effects. The rows are PREDICTION (source 'intent'): purged by the confirming receipt like
        // any optimistic entry, NEVER raising the confirmed floor (recompute excludes intents). `intent_id` tags
        // the batch so a reverted tx rolls the whole cast back atomically; `basis_version` is the floor it predicts.
        const base_version = Math.max(1, Number(msg.basis_version ?? state.applied_version + 1))
        const actor = settle_input.actor_from_key(state.my_key)
        const resolve_seat = msg.resolve_seat ?? state.ctx?.resolve_seat ?? seat_resolver(state.view)
        let projected = presented_state(state)
        const actions = (msg.actions ?? []).map((raw, i) => {
          const action = normalize_intent(raw, {
            version: raw.version ?? base_version,
            event_idx: raw.event_idx ?? state.intent_seq + i,
            actor,
            resolve_seat,
          })
          let tagged = msg.intent_id != null ? { ...action, intent_id: msg.intent_id } : action
          if (tagged.kind === 'Cast' && tagged.target_cell != null) {
            const caster = actor_key(tagged.caster_is_mob, tagged.caster_idx)
            const caster_cell = projected.fighters?.[caster]?.cell
            // RETURN_SPELL only intercepts a wholly point-shaped cast aimed at a living ENEMY. Pin this dispatch-
            // time fact so a bare canonical Cast proves a silent grant only for an exact self cast (Vanish).
            if (caster_cell != null && Number(tagged.target_cell) === Number(caster_cell))
              tagged = { ...tagged, self_targeted: true }
          }
          projected = apply_action(projected, tagged)
          return tagged
        })
        const grant_intents = new Set(
          actions
            .filter((action) => action.kind === 'Granted' && action.intent_id != null)
            .map((action) => action.intent_id)
        )
        const predicted_budget = actions
          .filter(
            (action) => grant_intents.has(action.intent_id) && (action.kind === 'Cast' || action.kind === 'Granted')
          )
          .map((action) => ({ key: prediction_identity(action), action }))
        set((s) => {
          const beats = Array.isArray(msg.beats) ? msg.beats : []
          // ③ PREDICTED-DISPLACEMENT WINDOW (ruled 07-19, option a): a predicted `Displaced` is the walk-window
          // class — a mover whose motion beat is in flight. Window its entries so display_state HOLDS each victim
          // at the pre-push cell until the slide beat presents (the rig animates FROM there, never a teleport
          // ahead of the slide); the presented/effective fold still sees the destination this frame (draft
          // legality unblocked). A cast with no Displaced carries NO window — B3, its effects paint immediately.
          // A TELEPORT is INSTANT by design (the local sim NEVER needs the chain for such an effect): its
          // Displaced is tagged effect_kind K_TELEPORT and EXCLUDED from the window — the caster jumps to the landing
          // cell THIS frame in DISPLAY too (the render blinks, so there is no slide to hold for).
          const displaced_idxs = actions
            .filter((a) => a.kind === 'Displaced' && a.effect_kind !== DISPLACE_TELEPORT)
            .map((a) => a.event_idx)
          const window = displaced_idxs.length
            ? { from_idx: Math.min(...displaced_idxs), until_idx: Math.max(...displaced_idxs) }
            : {}
          const wave = beats.length
            ? [
                ...s.wave,
                {
                  seq: s.wave_seq + 1,
                  version: base_version,
                  final: false,
                  source_id: s.ctx?.my_entity_id ?? s.my_key,
                  is_local: true,
                  duration: beats.reduce((sum, b) => sum + (b.duration || 0), 0),
                  beats,
                  ...window,
                },
              ]
            : s.wave
          // ④+⑦b+① fold the trap THIS cast places into the durable `my_traps` home (keyed by the cast batch's
          // draft id) — a same-turn push then force-stops on it through the sim door AND detonates its payload.
          // Each place_traps entry is an encoded cell OR {cell, payload} (predict_cast.placed_traps): the record
          // stores flat cells (the projection/drop-path read them raw) + the trap's shared detonation payload.
          // Recorded at dispatch so the force-stop is live THIS frame; the flush-drop path removes it if uncommitted.
          const place_traps = Array.isArray(msg.place_traps) ? msg.place_traps : []
          const trap_cells = place_traps.map((e) => (e != null && typeof e === 'object' ? e.cell : e))
          const trap_payload =
            place_traps.map((e) => (e != null && typeof e === 'object' ? e.payload : null)).find((p) => p?.length) ?? []
          const my_traps = trap_cells.length
            ? [
                ...s.my_traps,
                // RETIRES only on a receipt-proven ENTER (fold.js `detonated` — a committed fighter on the cell);
                // a version bump is NOT a firing, so no placed_view_version anchor (the `superseded` proxy is gone).
                // B (register): `basis_version` = the floor this cast predicts. Once an authoritative receipt raises
                // the applied floor to/past it, the trap is COMMITTED chain truth and drop_traps can no longer evict
                // it (version-gated input, composite §1) — the boundary-rollback race becomes structurally inert.
                {
                  draft_id: msg.intent_id ?? null,
                  basis_version: base_version,
                  cells: trap_cells,
                  gone: false,
                  payload: trap_payload,
                },
              ]
            : s.my_traps
          // fold any glyph THIS cast places into the durable my_glyphs home (predict_cast.placed_glyphs): each entry
          // is { cells:number[], turns } — the whole AoE zone as one record so it expires + renders as one unit.
          // Recorded at dispatch so the orange zone shows THIS frame; the flush-drop path removes it if uncommitted.
          const place_glyphs = Array.isArray(msg.place_glyphs) ? msg.place_glyphs : []
          const my_glyphs = place_glyphs.length
            ? [
                ...s.my_glyphs,
                ...place_glyphs.map((g) => ({
                  draft_id: msg.intent_id ?? null,
                  cells: Array.isArray(g?.cells) ? g.cells : [],
                  turns_remaining: Number(g?.turns ?? g?.turns_remaining ?? 1),
                  gone: false,
                })),
              ]
            : s.my_glyphs
          return recompute(
            {
              ...s,
              entries: merge_entries(s.entries, actions),
              budget_predictions: merge_budget_predictions(s.budget_predictions, predicted_budget),
              intent_seq: s.intent_seq + actions.length,
              pending_end_turn: null,
              armed_spell_id: actions.some((a) => a.kind === 'Cast') ? null : s.armed_spell_id,
              wave,
              wave_seq: wave.length ? wave[wave.length - 1].seq : s.wave_seq,
              my_traps,
              my_glyphs,
            },
            now
          )
        })
        return
      }
      case 'drop_traps': {
        // The flush-drop / turn-boundary rollback: a trap-cast that never reaches the chain takes its optimistic
        // `my_traps` record back (by draft id when known, else by any shared cell — the flush knows the cells).
        set((s) => {
          const ids = new Set(msg.draft_ids ?? [])
          const cells = new Set(msg.cells ?? [])
          // B (register · composite §1): drop_traps is a VERSION-GATED input. A COMMITTED trap — its cast's
          // basis_version at/below the applied floor (an authoritative receipt has superseded it) — is chain truth,
          // structurally immune to ANY stale reset whoever fires it (the turn-boundary rollback was the last
          // un-enumerated writer, same species as V3). Only a still-optimistic (uncommitted) trap rolls back.
          const committed = (t) => t.basis_version != null && Number(t.basis_version) <= s.applied_version
          const my_traps = (s.my_traps ?? []).filter(
            (t) => committed(t) || !(ids.has(t.draft_id) || t.cells.some((c) => cells.has(c)))
          )
          return recompute({ ...s, my_traps }, now)
        })
        return
      }
      case 'drop_glyphs': {
        // The flush-drop / turn-boundary rollback: a glyph-cast that never reaches the chain takes its optimistic
        // my_glyphs record back (by draft id when known, else by any shared cell — the flush knows the zone cells).
        set((s) => {
          const ids = new Set(msg.draft_ids ?? [])
          const cells = new Set(msg.cells ?? [])
          const my_glyphs = (s.my_glyphs ?? []).filter(
            (g) => !(ids.has(g.draft_id) || g.cells.some((c) => cells.has(c)))
          )
          return recompute({ ...s, my_glyphs }, now)
        })
        return
      }
      case 'placement_ghost': {
        // A peer's LOCAL pick, relayed p2p (voxel_fight_adapter's placement click handler broadcasts its own
        // exactly as it dispatches the local optimistic 'Placed' intent). Own-seat excluded — never render my
        // OWN click as a hint of itself (I already see my real pick). Identity-scoped above: a mismatched
        // fight_id/session is refused before reaching here. recompute() owns the GC (commit-supersede + stale
        // expiry, fold.js) — this door only upserts the latest pick per character.
        if (!msg.character || String(msg.character) === String(state.ctx?.my_entity_id ?? '')) return
        set((s) =>
          recompute(
            {
              ...s,
              placement_ghosts: { ...s.placement_ghosts, [String(msg.character)]: { cell: msg.cell, at: now } },
            },
            now
          )
        )
        return
      }
      case 'courtesy': {
        // THE COURTESY CHANNEL (#334) — channel two (docs/FIGHT_PIPELINE.md). A peer's committed draft, relayed
        // real-time over the party transport, enters the ONE door as a legality-gated PREDICTION: it PAINTS
        // (source 'intent' → the overlay, NEVER committed truth) and the canonical receipt/journal retires it by
        // CLAIM — the SAME engine my own predictions ride, never a purge. An ILLEGAL injected batch never paints
        // and raises ONE neutral flag. Identity-scoped above (a cross-fight/session relay is refused), but NOT a
        // local push: it is a peer's turn, so it needs no mic — it enters during my chain_replay/idle_wait.
        const intent_id = msg.intent_id ?? null
        if (intent_id != null && state.courtesy_seen[intent_id]) return // a re-delivered batch folds ONCE (dedupe)
        const resolve_seat = msg.resolve_seat ?? state.ctx?.resolve_seat ?? seat_resolver(state.view)
        const seat = msg.peer != null ? resolve_seat(msg.peer) : null
        const peer_key = seat == null ? null : `p${seat}`
        // LEGALITY IS THE EYE'S FIRST LINE: reduce the batch over MY committed positions + the turn-start refill.
        const verdict = peer_batch_legality({
          committed: committed_truth(state),
          view: state.view,
          actor_key: peer_key,
          actions: msg.actions ?? [],
          resolve_seat,
        })
        const courtesy_seen = intent_id != null ? { ...state.courtesy_seen, [intent_id]: true } : state.courtesy_seen
        if (!verdict.legal)
          // NO paint, NO cursor advance — the illegal action never reaches the eye. ONE neutral flag (edge-consumed
          // once, the turn_lost idiom); the batch is marked seen so a re-delivery never re-flags.
          return set((s) => ({
            ...s,
            flagged: { peer: msg.peer ?? null, reason: verdict.reason, at: now },
            courtesy_seen,
          }))
        const actor = settle_input.actor_from_key(peer_key)
        const base_version = Math.max(1, state.applied_version + 1)
        // The peer's actions are the receipt/journal vocabulary (Cast/Hit/Moved), stripped of transport keys — so
        // normalize_intent's passthrough stamps them as intents keyed to the PEER's actor. `courtesy: true` marks
        // the overlay so it retires by claim only (reconcile_action skips it in MY end-of-turn blanket).
        const actions = (msg.actions ?? []).map((raw, i) => ({
          ...normalize_intent(raw, {
            version: raw.version ?? base_version,
            event_idx: raw.event_idx ?? COURTESY_EVENT_BASE + state.intent_seq + i,
            actor,
            resolve_seat,
          }),
          courtesy: true,
          ...(intent_id != null ? { intent_id } : {}),
        }))
        set((s) =>
          recompute(
            {
              ...s,
              entries: merge_entries(s.entries, actions),
              intent_seq: s.intent_seq + actions.length,
              courtesy_seen,
            },
            now
          )
        )
        return
      }
      case 'flagged_shown': // the toast edge consumed the courtesy flag — reducer-owned idempotency (remount-safe)
        set((s) => ({ ...s, flagged: s.flagged ? { ...s.flagged, shown: true } : null }))
        return
      case 'rollback': {
        // A reverted/failed tx (txs .catch — B-F03) removes the predicted entries and recomputes to committed
        // truth. Prediction is not transport truth: this is the ONLY way a bad prediction leaves — no fabricated
        // optimistic version survives its own tx failing (the sticky predicted HP/cell/AP class). Targeted by
        // `intent_id` (a composite cast batch) or `predicts` {version, event_idx}; default = the whole optimistic
        // turn. ONLY intent rows are ever removed; an authoritative receipt/snapshot fact is never rolled back.
        set((s) => {
          const drop = (e) => {
            if (e.source !== 'intent') return false
            if (msg.intent_id != null) return e.intent_id === msg.intent_id
            if (msg.predicts) return e.version === msg.predicts.version && e.event_idx === msg.predicts.event_idx
            return true
          }
          const entries = Object.fromEntries(Object.entries(s.entries).filter(([, e]) => !drop(e)))
          const budget_predictions = (s.budget_predictions ?? []).filter((row) => !drop(row.action))
          return recompute({ ...s, entries, budget_predictions }, now)
        })
        return
      }
      case 'presented': {
        const seq = msg.seq ?? state.wave_seq
        set((s) =>
          recompute(
            {
              ...s,
              commit_due: false,
              presented_seq: Math.max(s.presented_seq, seq),
              wave: s.wave.filter((t) => t.seq > seq),
            },
            now
          )
        )
        // M2b: the snapshot deferral is gone — an object read never adopts mid-fight, so a drained wave has nothing
        // to flush. Canonical catch-up rides the journal (journal_gap → the walker), never a stashed wholesale read.
        return
      }
      case 'arm':
        set((s) => ({ ...s, armed_spell_id: s.armed_spell_id === msg.spell_id ? null : (msg.spell_id ?? null) }))
        return
      case 'board_click':
        // SPELL DESELECT: clicking any non-targetable cell with a spell armed deselects
        // it — armed ∧ ¬targetable ⇒ DISARM — the ONE deselect rule, in the core. `cell` (null = off-board)
        // rides for provenance; `targetable` is the edge's castable verdict (the set needs the frontend seed
        // row — an edge input by the same doctrine as move_wash's `targeting`). Emits nothing, stages nothing:
        // drafting a cast on a targetable click stays the adapter's.
        if (state.armed_spell_id && !msg.targetable) set((s) => ({ ...s, armed_spell_id: null }))
        return
      case 'hover_spell':
        set((s) => ({ ...s, hovered_spell_id: msg.spell_id ?? null }))
        return
      case 'hand_update':
        set((s) => ({ ...s, hand: msg.hand ?? [] }))
        return
      case 'busy':
        set((s) => ({
          ...s,
          busy: !!msg.value,
          commit_latch: msg.latch === undefined ? s.commit_latch : msg.latch,
          commit_attempt_epoch: msg.attempt_epoch === undefined ? s.commit_attempt_epoch : (msg.attempt_epoch ?? null),
          ...(msg.value ? { error: null, commit_due: false } : {}),
        }))
        return
      case 'error':
        set((s) => ({ ...s, error: msg.message ?? null }))
        return
      case 'tick': {
        const deadline = Number(state.turn_deadline_ms ?? 0)
        const deadline_fresh = state.turn_deadline_fresh === true && deadline > 0
        const tick_last_action = Number(msg.last_action_ms ?? state.last_action_ms ?? 0)
        const last_action_ms = Math.max(
          state.last_action_ms,
          Number.isFinite(tick_last_action) ? tick_last_action : state.last_action_ms
        )
        const draft_count = Number(msg.draft_count ?? state.staged.length)
        const commit_latch = msg.latch === undefined ? state.commit_latch : msg.latch
        const submit_epoch = turn_submit_epoch(state)
        const turn_key = turn_commit_key({
          fight_id: state.fight_id,
          entity_id: state.ctx?.my_entity_id ?? state.my_key,
          deadline_ms: deadline,
        })
        const decision = auto_commit_decision({
          enabled:
            msg.enabled !== false &&
            deadline_fresh &&
            state.active != null &&
            state.active === state.my_key &&
            state.winner === -1 &&
            state.phase === 'active',
          busy: state.busy,
          now_ms: now,
          deadline_ms: deadline,
          latch: commit_latch,
          turn_key,
        })
        // Absolute chain deadline, never receipt/UI re-anchored. The 5s submit margin survives r8's measured 2.6s
        // latency; auto_commit_fire_at clamps a short admin dial to actions.move::assert_min_turn's legal boundary.
        // The distinct last_action_ms pacing floor remains on the mid-turn KILL path alone (kill_due below).
        const deadline_due = deadline_fresh && now >= auto_commit_fire_at(deadline, state.view?.turn_ms)
        // LETHAL AUTO-COMMIT (owner ruling 2026-07-21): the killing blow that leaves zero living enemies auto-fires
        // the turn commit the moment its vfx sequence + death animation have PRESENTED (the wave fully drained) — no
        // manual END TURN. Reads the LOCAL fold (presented_state — my OPTIMISTIC kill counts; the prior committed-only
        // rule kept a prediction "manual"), and requires an EMPTY wave so the death beat plays out first and no
        // queued action is still mid-flight. The commit's receipt still drives decided_winner exactly as today — no
        // optimistic victory is ever painted (no-false-victory intact). commit_due below routes this through the
        // epoch/latch, so it fires exactly ONCE and an executed-failed commit is never auto-retried.
        const local_mobs = Object.values(presented_state(state).fighters ?? {}).filter((fighter) => fighter.is_mob)
        const kill_due =
          deadline_fresh &&
          local_mobs.length > 0 &&
          local_mobs.every((fighter) => !fighter.alive) &&
          (state.wave ?? []).length === 0 && // the vfx sequence + death animation have drained; nothing mid-flight
          state.turn_started_at != null &&
          now >= state.turn_started_at + PLAYER_TURN_FLOOR_MS &&
          now >= last_action_ms + MIN_ACTION_MS
        // TURN-LOST output (no-silent-failure law — the old auto_flush 'missed' toast, rebuilt as a reducer
        // output): a DRAFTED turn that expires uncommitted surfaces exactly once per turn_key. 'latched' (an
        // executed on-chain failure — gas spent, never retried) is lost the moment the latch lands; 'missed'
        // (busy past the deadline) and 'burned' (submit epoch consumed, no receipt ever folded) are lost only
        // once the chain deadline truly passes. The toast edge (txs.subscribe_turn_lost) consumes it.
        const epoch_burned = submit_epoch != null && submit_epoch === state.commit_attempt_epoch && !state.busy
        const expired = deadline_fresh && now >= deadline
        const lost_reason =
          draft_count > 0 && state.turn_lost?.key !== turn_key
            ? decision === 'latched'
              ? 'latched'
              : expired && decision === 'missed'
                ? 'missed'
                : expired && decision === 'fire' && epoch_burned
                  ? 'burned'
                  : null
            : null
        set((s) => ({
          ...s,
          commit_due:
            submit_epoch != null &&
            submit_epoch !== state.commit_attempt_epoch &&
            decision === 'fire' &&
            (deadline_due || kill_due),
          commit_latch,
          last_action_ms,
          turn_lost: lost_reason ? { key: turn_key, reason: lost_reason } : s.turn_lost,
        }))
        // WAVE WATCHDOG (the old MOB_WAVE_CAP_MS force-drain, rebuilt): the TRUE head turn — LOCAL included,
        // since unacked death beats hold a kill's despawn (project.death_presenting_ids) — overstaying its
        // duration + grace (renderer wedged/unmounted) is force-acked through the same door: no unbounded holds.
        const head = (get().wave ?? [])[0] ?? null
        set((s) => ({
          ...s,
          wave_head: head ? (s.wave_head?.seq === head.seq ? s.wave_head : { seq: head.seq, at: now }) : null,
        }))
        const watch = get().wave_head
        if (head && watch && watch.seq === head.seq && now > watch.at + (head.duration || 0) + WAVE_ACK_GRACE_MS)
          get().input({ type: 'presented', seq: head.seq }, now)
        return
      }
      case 'turn_lost_shown': // the toast edge consumed this loss — reducer-owned idempotency (remount-safe)
        set((s) =>
          s.turn_lost && s.turn_lost.key === msg.key ? { ...s, turn_lost: { ...s.turn_lost, shown: true } } : s
        )
        return
      case 'divergence_shown':
        set((s) =>
          s.divergence?.kind === 'action' && s.divergence.version === msg.version && s.divergence.action === msg.action
            ? { ...s, divergence: { ...s.divergence, shown: true } }
            : s
        )
        return
      case 'flush': {
        const pending = state.pending_end_turn
        if (!pending || now < pending.ready_at) return
        get().input(pending.intent, now) // re-drive the held end-turn now that the floor has passed
        return
      }
      case 'stage': // pre-commit draft (clicked but not yet in a PTB) — draft, NOT committed fight state
        set((s) => ({ ...s, staged: [...s.staged, msg.intent] }))
        return
      case 'clear_staged':
        // #1045 THE TURN STAYS ENDABLE. Discarding a NON-EMPTY draft that never produced a receipt is the flush's
        // own proof that this turn's commit attempt did not happen (the refusal path: `rollback` then this input —
        // dungeon_run_store.commit_turn's catch + DungeonBoard.flush_commit's tail). Give the submit claim back so
        // the deadline/kill auto-commit can still fire the BARE PASS that ends the turn — never a retry: the
        // refused actions are exactly what this input throws away. Self-bounding at ONE recovery per turn — that
        // bare pass clears an ALREADY-EMPTY draft, which releases nothing, so a failing commit can never loop. A
        // SUCCESSFUL commit is unaffected: its receipt already emptied `staged` and advanced the epoch's
        // receipt_seq. An EXECUTED failure stays blocked by its own latch (auto_commit_decision → 'latched'),
        // so the tx-retry burn law is untouched.
        set((s) => ({
          ...s,
          staged: [],
          commit_due: false,
          commit_attempt_epoch: s.staged.length ? null : s.commit_attempt_epoch,
        }))
        return
      default:
        return
    }
  }

export const create_fight_store = () => {
  const trace_tap = create_trace_tap()
  const store = createStore((set, get) => ({
    ...empty_fight(),
    // THE HEADLESS CORE — the committed-truth owner, folded by `with_core_fold` below. It is stamped HERE rather
    // than in `empty_fight()` because it owns its OWN reset: an `init` classifies as session_opened /
    // session_closed and the core returns a fresh atom for both (ingest.js), so re-seeding it from the settlement
    // reset would wipe the session the very same message just opened. One home for "a new fight clears the fold".
    core: empty_core_state(null),
    input: with_core_fold(make_input(set, get, trace_tap), set, get),
    // A raw fold helper for tests/tools that want a committed state from a log without the store plumbing.
    fold: (log) => log.reduce(apply_action, empty_state(get().fight_id)),
  }))
  return { ...store, trace_tap }
}

/** The app-wide singleton — VANILLA zustand (node-clean); the React hook (`use_fight`) is a frontend adapter. */
export const fight_store = create_fight_store()
