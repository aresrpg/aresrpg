// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// fight/store.js — the ONE zustand store and the ONE write door for ALL fight state.
//
// THE ONE-REDUCER LAW (enforced by ares test fightcore gate b): `input(msg, now)` is the ONLY
// function repo-wide that writes fight state. Async results (receipt / journal / p2p / snapshot) NEVER `set()` a
// store — they dispatch an input, prediction paints first, and canonical truth folds through the ONE accept door.
// Every canonical entry is keyed `(version, event_idx = seq)` and re-folded in that chain order; duplicate and
// differently paged event deliveries therefore converge without a client-local sequence becoming authority.
//
// ONE INGRESS (#1336): core_ingest/core_inbox is the sole raw decoder and canonical fold for receipts, journal
// pages, and Fight object reads. A snapshot behind or at the fold cursor is discarded; one ahead of the frontier
// performs a full re-adopt through that same door, never a partial merge. The `entries`/`wave` state below is a
// presentation-only sibling seam for prediction retirement and renderer pacing, never a second chain-state owner.
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
import { empty_core_state, ingest } from './core.js'
import { normalize_intent, seat_resolver } from './inputs.js'
import * as settle_input from './inputs.js'
import { peer_batch_legality } from './peer_legality.js'
import { reduce_chain_input, reduce_snapshot_input } from './store_chain.js'
import { reduce_intent, reduce_predicted } from './store_prediction.js'
import { committed_truth, COURTESY_EVENT_BASE, empty_fight, observer_ctx } from './store_state.js'
import { expired_wave_seq, reduce_tick_state, reduce_wave_head } from './store_tick.js'
import { create_trace_tap } from './trace_tap.js'
import { merge_entries, recompute } from './fold.js'
import { present_trap } from './trap_ledger.js'

// The PRESENTATION projections consumers read live in fold.js now (the ≤600-LoC split); re-export the public
// names so project.js and tools keep importing them from the store's door.
export { claimed_budget_state, presented_state, display_state } from './fold.js'
export {
  committed_truth,
  MIN_ACTION_MS,
  min_turn_ready_at,
  PLAYER_TURN_FLOOR_MS,
  submit_wait_ms,
  WAVE_ACK_GRACE_MS,
} from './store_state.js'

// ── THE TRUTH SOURCE ──────────────────────────────────────────────────────────────────────────────────────────
// The COMMITTED board every projection reads (project.js) is folded by the HEADLESS CORE that lives in this atom
// as `core` (core_*.js). It is the ONLY committed-truth owner — there is no second fold to fall back to and no
// switch between them. The settlement/presentation machinery below still owns the PACED folds (`presented_state`
// / `display_state`), which is a different question from what is committed.

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
 * this folds the message into the headless core FIRST, then hands only that normalized result to the
 * settlement/presentation adapter. The envelope bridge is `classify_input` — the same pure map the tee and the
 * historical-corpus converter already share. A zustand subscriber may synchronously call `input()` while the
 * adapter is notifying. Those re-entrant calls are captured immediately, then folded FIFO after the current core
 * is installed; no older fold can overwrite a core produced by a nested call.
 *
 * The capture ordinal lives in THIS closure, never in the atom: it is provenance for the envelope, not fight state
 * (the tee keeps its own the same way). Session identity comes from the STORE's own post-commit `fight_id`, never
 * from the raw message — the door already gated the message's provenance, and a hostile accessor on a diagnostic
 * field must not reach the reducer. `ingest` returns the SAME atom for a fold no-op (a draft, an unmapped
 * lifecycle), and returning `s` unchanged makes zustand skip the notify — a no-op input costs no subscriber round.
 *
 * NO FAULT BOUNDARY, deliberately: the core is the truth owner, so swallowing a throw here would freeze the
 * board silently — the exact class the no-silent-failure law bans. `ingest` is total by construction (ingest.js).
 * @param {(serialized_set:(fn:(s:any)=>any)=>void)=>(msg:any, now?:number, core?:any)=>any} make_door
 *   builds the settlement/presentation reducer door against the serialized set seam
 * @param {(fn:(s:any)=>any)=>void} set
 * @param {()=>any} get
 */
const with_core_fold = (make_door, set, get) => {
  let capture_seq = 0
  let folding = false
  let active_core = null
  const pending = []

  const drain = () => {
    while (pending.length) fold(pending.shift())
  }

  const publish_core = () => {
    const core = active_core
    set((s) => (core === s.core ? s : { ...s, core }))
    drain()
    if (active_core !== core) publish_core()
  }

  const serialized_set = (update) => {
    set(update)
    // A subscriber's input is captured while `set` notifies. Drain it before the outer adapter can issue a
    // second notification, so level-triggered effects observe the nested busy/consumed claim exactly once.
    drain()
  }

  const fold = ({ msg, now, envelope }) => {
    active_core = ingest(active_core, envelope, now)
    const core = active_core
    const result = door(msg, now, core)
    // A nested fold may have advanced `active_core` while this adapter notified. Publish the newest ordered fold,
    // never this call's now-stale local `core`.
    publish_core()
    return result
  }

  const door = make_door(serialized_set)

  return (raw, now = Date.now()) => {
    const outer = !folding
    if (outer) {
      folding = true
      active_core = get().core
    }
    let entry
    try {
      const msg = raw
      const envelope = input_envelope({
        session_id: get().fight_id ?? null,
        input_seq: capture_seq++,
        observed_at_ms: now,
        payload: payload_of(msg),
      })
      entry = { msg, now, envelope }
    } catch (error) {
      if (outer) {
        active_core = null
        folding = false
      }
      throw error
    }
    if (!outer) {
      pending.push(entry)
      return
    }

    try {
      const result = fold(entry)
      drain()
      return result
    } finally {
      active_core = null
      folding = false
    }
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
const IDENTITY_SCOPED = new Set([
  'receipt',
  'poll',
  'p2p',
  'snapshot',
  'presented',
  'trap_triggered',
  'placement_ghost',
  'courtesy',
])
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

// A turn-level ack is the headless/watchdog fallback for presentation only. In the mounted renderer each trigger
// already advanced at its own beat; folding the same stable ids here is therefore an idempotent no-op.
const present_turn_traps = (traps, turn) =>
  (turn.beats ?? []).reduce(
    (next_traps, beat, index) =>
      beat.kind === 'trap_trigger'
        ? present_trap(next_traps, {
            anchor: beat.payload?.trap_anchor,
            cell: beat.payload?.trap_cell,
            trigger_id: `wave:${turn.seq}:${index}`,
          })
        : next_traps,
    traps
  )

/** THE ONE DOOR: chain inputs (snapshot/receipt/poll/p2p/terminal confirmation/outcome), local prediction,
 * presentation acks, and UI/tx signals all reduce here; nothing else writes fight state.
 * @param {(fn:(s:any)=>any)=>void} set
 * @param {()=>any} get
 * @param {ReturnType<typeof create_trace_tap>} trace_tap
 */
const make_input =
  (set, get, trace_tap) =>
  (msg, now = Date.now(), next_core = get().core) => {
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
            core: next_core,
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
      case 'p2p':
      case 'journal':
        // Canonical decoding/admission already happened in `core_ingest` before this adapter runs. The extracted
        // pure adapter derives prediction retirement and renderer pacing from that normalized result.
        set((s) => reduce_chain_input(s, msg, next_core, now))
        return
      case 'snapshot':
        // Bootstrap and reconciliation are the same core operation. A behind/equal snapshot is a whole-input no-op;
        // an ahead snapshot is a full base replacement. This adapter mirrors the adopted base for the renderer only.
        if (next_core.last_read?.adopted !== true) return
        set((s) => reduce_snapshot_input(s, msg, next_core, now))
        return
      case 'intent':
        set((s) => reduce_intent(s, msg, now))
        return
      case 'predicted':
        set((s) => reduce_predicted(s, msg, now))
        return
      case 'trap_triggered':
        // Canonical lifecycle was already receipt-folded. This event advances only the overlay presentation cursor:
        // the concrete anchor selects one consumed row; position projection and turn advancement infer nothing.
        set((s) =>
          recompute(
            {
              ...s,
              my_traps: present_trap(s.my_traps, {
                anchor: msg.anchor,
                cell: msg.cell,
                trigger_id: msg.trigger_id,
              }),
            },
            now
          )
        )
        return
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
              my_traps: s.wave
                .filter((turn) => turn.seq <= seq)
                .reduce((traps, turn) => present_turn_traps(traps, turn), s.my_traps),
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
        set((s) => reduce_tick_state(s, msg, next_core, now))
        // WAVE WATCHDOG (the old MOB_WAVE_CAP_MS force-drain, rebuilt): the TRUE head turn — LOCAL included,
        // since unacked death beats hold a kill's despawn (project.death_presenting_ids) — overstaying its
        // duration + grace (renderer wedged/unmounted) is force-acked through the same door: no unbounded holds.
        const head = (get().wave ?? [])[0] ?? null
        set((s) => reduce_wave_head(s, head, now))
        const expired_seq = expired_wave_seq(get(), now)
        if (expired_seq != null) get().input({ type: 'presented', seq: expired_seq }, now)
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
    input: with_core_fold((serialized_set) => make_input(serialized_set, get, trace_tap), set, get),
  }))
  return { ...store, trace_tap }
}

/** The app-wide singleton — VANILLA zustand (node-clean); the React hook (`use_fight`) is a frontend adapter. */
export const fight_store = create_fight_store()
