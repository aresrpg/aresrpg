// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// v2/inbox.js — §① INGRESS+INBOX admission (Fight V2 build step 2). The serialized door's journal-admission half:
// every chain-read source (receipt · poll · p2p · journal · snapshot) resolves to admission over ONE keyed log,
// ordered by the chain-event coordinate, arrival-order-independent (a shuffle property pins it).
//
// THE EVENT COORDINATE (step-0 finding, decided + documented). The consensus ideal keys the frontier on the chain's
// DENSE journal `seq` (0,1,2… contiguous). The corpus proves that index is not the delivery vehicle for event
// BODIES today: the journal delivers seq 0,1 (FightCreated/FightJoined) then STARVES — `head` advances 2→8 while the
// event array stays empty — and the real gameplay (Placed/MobMoved/Cast/Hit/…) rides the RECEIPT stream, which
// carries no seq. So the universal coordinate every source shares is `(version, ordinal)`: `version` = the object
// version the event was emitted at, `ordinal` = its position within that version's batch. Within one version, journal
// `seq` and receipt `event_idx` denote the SAME intra-version position, so the coordinate is source-independent. The
// journal `head`/`seq` is recorded as provenance and its gap surfaces as a FINDING (a real historical desync
// signature), but `(version, ordinal)` is the order/dedupe key. `applied_version` — the max coordinate version — plus
// the adopted snapshot version is the truth watermark; the "final journal index" a replay must reach is the max
// coordinate the file carries.
//
// COURTESY (consensus §1 · rider R1). p2p rows enter an UNVERIFIED buffer; they NEVER advance the frontier alone.
// They graduate to truth only byte-identical to a verified row (the fold-level rebuild signal) — otherwise they only
// surface in a marked projection layer. Everything else here is verified truth (a receipt is my own tx's proof; a
// poll/journal is an authoritative read).
//
// FAILURE IS DATA. A conflicting content hash at an already-admitted coordinate is a `hash_conflict` record + an
// authoritative `refetch` effect REQUEST (never a throw, never an auto-applied guess). A known journal gap
// (head ≫ delivered) is a `journal_gap` record. The shell drains both; the core stays total and pure.

import { hash_state } from '@aresrpg/sim/evolve'
import { decode_fight_event } from '@aresrpg/sdk/fight'

import { normalize_events, seat_resolver } from '../inputs.js'
import { board_state_from_fight } from '../board_state.js'

import { revive_wire, coord_key, coord_cmp, COORD_ZERO } from './wire.js'

// A verified source's precedence when two deliveries collide at one coordinate. RECEIPT is the one-way floor (my own
// tx proof — never overridden); a poll/journal read is authoritative; a legacy event-shaped snapshot ranks below a
// receipt (the V1 V9 ordering). Intents are not admitted here (they live in the ledger, §③).
const SOURCE_RANK = { journal: 1, poll: 1, p2p: 1, snapshot: 2, receipt: 3 }

/** The coordinate of one admitted log action. */
const action_coord = (action) => ({ version: Number(action.version), ordinal: Number(action.event_idx) })

/**
 * The truth FRONTIER — DERIVED, never stored (a stored watermark drifts the instant a snapshot prunes the log rows it
 * counted; deriving makes it order-independent by construction). It is the highest coordinate of admitted truth: the
 * max log coordinate, or the adopted base (`{ base_version, -1 }`) when the log is empty — the base covers its whole
 * version, so an event at/below it is settled, not frontier. COORD_ZERO before the first read.
 * @param {import('./state.js').InboxState} inbox
 * @returns {import('./wire.js').EventCoord}
 */
export const truth_frontier = (inbox) => {
  const base = inbox.base_version >= 0 ? { version: inbox.base_version, ordinal: -1 } : { ...COORD_ZERO }
  return Object.values(inbox.log).reduce((hi, action) => {
    const coord = action_coord(action)
    return coord_cmp(coord, hi) > 0 ? coord : hi
  }, base)
}

/** The truth watermark VERSION — the higher of the highest admitted log version and the adopted snapshot base. */
export const truth_version = (inbox) => truth_frontier(inbox).version

/** The semantic content of an action, stripped of provenance/order/closure fields, for the dedupe/conflict hash.
 *  Two deliveries of the SAME event (same kind + fields) at one coordinate hash equal → idempotent; a different
 *  hash at the same coordinate is a real conflict. `resolve_seat` (a closure) and the order/source fields never
 *  belong to content, so they are excluded — which also keeps the stored log pure DATA (shuffle-safe, serializable). */
const action_hash = (action) => {
  const { source, resolve_seat, version, event_idx, seq, ...content } = action
  return hash_state(content)
}

/** Strip the resolver closure + seq from a normalized action so the log holds PURE DATA — `resolve_seat` is
 *  re-attached at FOLD time from the CURRENT base view (never baked stale into the log), and `seq` rides separately. */
const as_data = ({ resolve_seat, ...rest }) => rest

/**
 * Decode a receipt/poll/p2p batch's raw events into pure-data actions keyed by `(version, ordinal=event_idx)`.
 * Reuses the SDK-proven `normalize_events` (one home for the chain-event decode) with NEITHER the seat resolver NOR
 * the turn-start budget baked in — both are VIEW-DEPENDENT and are attached at FOLD time (v2/fold.js) so the stored
 * log is pure, order-independent event DATA (the shuffle property depends on this: a `TurnStarted`'s ap/mp must not
 * change with whether a snapshot happened to precede its arrival).
 * @param {any} rows the batch (already wire-revived): `{ events: [...] }` or a bare event array
 * @param {{ version:number, source:string, fight_id?:string|null }} opts
 * @returns {Array<Record<string, any>>}
 */
export const batch_to_actions = (rows, { version, source, fight_id = null }) =>
  normalize_events(rows, { version: Number(version ?? 0), source, fight_id, resolve_seat: null, base_of: null }).map(
    as_data
  )

/**
 * Decode a JOURNAL batch's events into pure-data actions. Journal events are `{ kind, data, seq, version }` (not the
 * `{ type, parsedJson }` receipt shape), so each is reshaped onto the ONE decoder (`decode_fight_event` splits the
 * type suffix as `kind` and coerces numerics) and stamped with its OWN version + an intra-version ordinal (position
 * among events sharing that version — the seq densifies the same order). `seq` rides for the gap finding.
 * @param {any} rows the journal batch (wire-revived): `{ events:[{ kind, data, seq, version }], head }`
 * @returns {Array<Record<string, any>>}
 */
export const journal_to_actions = (rows) => {
  const events = Array.isArray(rows?.events) ? rows.events : []
  /** @type {Map<number, number>} */
  const per_version = new Map()
  return events.map((ev) => {
    const version = Number(ev.version ?? 0)
    const ordinal = per_version.get(version) ?? 0
    per_version.set(version, ordinal + 1)
    const decoded = decode_fight_event({ type: `journal::${ev.kind}`, parsedJson: ev.data ?? {} }) ?? { kind: ev.kind }
    return { ...decoded, version, event_idx: ordinal, source: 'journal', seq: Number(ev.seq ?? ordinal) }
  })
}

/**
 * Admit verified chain-event actions into the inbox log. Idempotent by coordinate; a higher-or-equal-rank source
 * adopts on a collision; a DIFFERENT content hash at an occupied coordinate is failure-as-data + a refetch request.
 * The frontier is DERIVED (`truth_frontier`), so admission only touches the log. Pure: returns a fresh
 * `{ inbox, failures, effects }` (the door threads them). Actions already reflected by the adopted snapshot base
 * (version ≤ base_version) are dropped as settled — order-independently, since a snapshot always wins its version.
 * @param {import('./state.js').InboxState} inbox
 * @param {Array<Record<string, any>>} actions pure-data actions (batch_to_actions / journal_to_actions)
 * @param {number} now
 * @returns {{ inbox: import('./state.js').InboxState, failures: any[], effects: any[] }}
 */
export const admit_events = (inbox, actions, now) => {
  let { log } = inbox
  const failures = []
  const effects = []
  for (const action of actions) {
    const coord = action_coord(action)
    if (coord.version <= inbox.base_version) continue // settled: the snapshot base already reflects it
    const key = coord_key(coord)
    const existing = log[key]
    if (existing) {
      if (action_hash(existing) === action_hash(action)) continue // idempotent re-delivery (dedupe)
      // A real conflict at one index — surface it as DATA + request the authoritative refetch; the higher-rank
      // source wins the slot (receipt is the one-way floor). NEVER auto-guess between two truths.
      const winner = SOURCE_RANK[action.source] >= SOURCE_RANK[existing.source] ? action : existing
      failures.push({
        kind: 'hash_conflict',
        coord,
        sources: [existing.source, action.source],
        kept: winner.source,
        at: now,
      })
      effects.push({ kind: 'refetch', version: coord.version, reason: 'hash_conflict', at: now })
      log = winner === existing ? log : { ...log, [key]: winner }
      continue
    }
    log = { ...log, [key]: action }
  }
  return { inbox: log === inbox.log ? inbox : { ...inbox, log }, failures, effects }
}

/**
 * Adopt a decoded Fight OBJECT (snapshot) as the SNAPSHOT+TAIL base at its version — the boot seed AND every later
 * catch-up read (consensus §Unanimous: "boot IS catch-up"). A read at/below the current base version is stale →
 * ignored (never regresses). A newer read adopts wholesale; log entries it now subsumes (version ≤ V) are pruned
 * (they are settled into the base). Pure. `board_state_from_fight` decodes the rich view (the ONE home); the raw
 * `rows` are wire-revived first (the `$bigint` un-wrap).
 * @param {import('./state.js').InboxState} inbox
 * @param {any} rows the raw snapshot fight object
 * @param {number} version the object version
 * @param {Record<string, any>} ctx decode context (mob identity maps, offset) — never folded
 * @returns {import('./state.js').InboxState}
 */
export const adopt_snapshot = (inbox, rows, version, ctx = {}) => {
  const object_version = Number(version ?? 0)
  if (object_version <= inbox.base_version) return inbox
  const fight = revive_wire(rows)
  const base_view = board_state_from_fight({
    fight,
    version: object_version,
    run: ctx.run ?? null,
    rooms_total: ctx.rooms_total ?? 0,
    mob_names: ctx.mob_names ?? {},
    mob_levels: ctx.mob_levels ?? {},
    mob_elements: ctx.mob_elements ?? {},
    creator: ctx.creator ?? null,
    ...(ctx.offset ? { offset: ctx.offset } : {}),
  })
  const log = Object.fromEntries(
    Object.entries(inbox.log).filter(([, action]) => Number(action.version) > object_version)
  )
  return { ...inbox, base_view, base_version: object_version, log }
}

/**
 * Buffer a COURTESY (p2p) batch as UNVERIFIED. It never advances the frontier; it graduates into the verified log
 * only when a verified row later admits byte-identical to it (handled on admit — see `reconcile_courtesy`). Until
 * then it lives in `inbox.courtesy` and may surface ONLY in a marked projection layer (rider R1). Pure.
 * @param {import('./state.js').InboxState} inbox
 * @param {Array<Record<string, any>>} actions
 * @returns {import('./state.js').InboxState}
 */
export const buffer_courtesy = (inbox, actions) => {
  let { courtesy } = inbox
  for (const action of actions) {
    const coord = { version: Number(action.version), ordinal: Number(action.event_idx) }
    if (coord.version <= truth_version(inbox)) continue // already verified past — the courtesy is moot
    const key = coord_key(coord)
    if (!courtesy[key]) courtesy = { ...courtesy, [key]: action }
  }
  return courtesy === inbox.courtesy ? inbox : { ...inbox, courtesy }
}

/** Drop any courtesy row a verified row has now matched byte-identically OR overtaken (the frontier passed it) —
 *  its job (pre-warming the eye) is done, and it must never double-fold. Pure. Run after every verified admit. */
export const reconcile_courtesy = (inbox) => {
  const kept = Object.entries(inbox.courtesy).filter(([key, courtesy]) => {
    const coord = { version: Number(courtesy.version), ordinal: Number(courtesy.event_idx) }
    if (coord.version <= truth_version(inbox)) return false // overtaken by verified truth
    const verified = inbox.log[key]
    return !(verified && action_hash(verified) === action_hash(courtesy)) // graduated (byte-identical) → drop
  })
  return kept.length === Object.keys(inbox.courtesy).length ? inbox : { ...inbox, courtesy: Object.fromEntries(kept) }
}

/**
 * Record the journal `head` + the highest delivered body seq, and surface a gap as a FINDING. A head strictly beyond
 * the CUMULATIVE highest delivered seq means the indexer knows of events whose BODIES never arrived (the corpus's
 * real starve signature — head advances 2→8 while the event array stays empty). Data, not a stall: receipts fill the
 * gap via the version watermark. Fired ONCE per head advance (not per empty re-poll) so the finding is a signal, not
 * spam. Returns `{ inbox, failures }`. Pure.
 * @param {import('./state.js').InboxState} inbox
 * @param {number} head
 * @param {Array<Record<string, any>>} journal_actions the just-decoded journal actions (for the delivered seq)
 * @param {number} now
 */
export const note_journal_head = (inbox, head, journal_actions, now) => {
  const head_seq = Number(head ?? -1)
  const seq_head = Math.max(inbox.seq_head, Number.isFinite(head_seq) ? head_seq : -1)
  const delivered_seq = journal_actions.reduce((max, a) => Math.max(max, Number(a.seq ?? -1)), inbox.delivered_seq)
  const advanced = seq_head > inbox.seq_head
  const failures =
    advanced && seq_head > delivered_seq + 1
      ? [
          {
            kind: 'journal_gap',
            head: seq_head,
            delivered: delivered_seq,
            missing: seq_head - 1 - delivered_seq,
            at: now,
          },
        ]
      : []
  return {
    inbox:
      seq_head === inbox.seq_head && delivered_seq === inbox.delivered_seq
        ? inbox
        : { ...inbox, seq_head, delivered_seq },
    failures,
  }
}

/** The seat resolver against the current base view — the ONE character→seat map, attached to actions at fold time
 *  (never baked stale into the log). Re-exported so the fold reads it from the inbox's own view. */
export const inbox_resolver = (inbox) => seat_resolver(inbox.base_view)

/** The empty-frontier sentinel, re-exported for the door/tests. */
export { COORD_ZERO }
