// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// §① INGRESS+INBOX unit truth (Fight V2 build step 2). The corpus proves the happy path in bulk; these pin the
// paths it does NOT contain (no p2p, no hash conflict in the two-week set): courtesy admission, failure-as-data +
// refetch, sparse buffering, and the wire decode. Synthetic minimal inputs, one behaviour per test.

import { describe, test, expect } from 'bun:test'

import { empty_inbox } from '../src/core_state.js'
import {
  admit_events,
  adopt_snapshot,
  buffer_courtesy,
  reconcile_courtesy,
  note_journal_head,
  batch_to_actions,
  truth_frontier,
  truth_version,
} from '../src/core_inbox.js'
import { fold_canonical } from '../src/core_fold.js'
import { roster_open } from '../src/board_state.js'
import { revive_wire, coord_key } from '../src/core_wire.js'

/** A minimal chain Hit event at (version, ordinal-by-position). */
const hit = (victim_idx, remaining_hp) => ({
  type: '0x0::fight_events::Hit',
  parsedJson: { victim_is_mob: false, victim_idx, remaining_hp },
})
const receipt_actions = (events, version) => batch_to_actions({ events }, { version, source: 'receipt' })
const poll_actions = (events, version) => batch_to_actions({ events }, { version, source: 'poll' })
/** The adoption door's inbox half. `refusal` — the reason a gate turned the read away (#1689) — has its own
 *  block at the end of this file; the tests between here and there are about the base it produces. */
const adopt = (...args) => adopt_snapshot(...args).inbox

describe('revive_wire — the $bigint un-wrap at the decode seam', () => {
  test('unwraps a $bigint envelope to its native u64 string, recursively, without mutating input', () => {
    const wire = { turn_ms: { $bigint: '45000' }, nested: [{ hp: { $bigint: '70' } }, 3], plain: 'x' }
    const out = revive_wire(wire)
    expect(out).toEqual({ turn_ms: '45000', nested: [{ hp: '70' }, 3], plain: 'x' })
    expect(wire.turn_ms).toEqual({ $bigint: '45000' }) // input untouched (immutability)
  })
  test('a scalar and a non-wrapper object pass through', () => {
    expect(revive_wire(5)).toBe(5)
    expect(revive_wire({ a: 1 })).toEqual({ a: 1 })
  })
})

describe('admit_events — dedupe, source priority, failure-as-data', () => {
  test('a re-delivery of an identical event is idempotent (one log row)', () => {
    const actions = receipt_actions([hit(0, 50)], 100)
    const once = admit_events(empty_inbox(), actions, 1).inbox
    const twice = admit_events(once, actions, 2).inbox
    expect(Object.keys(twice.log)).toEqual(Object.keys(once.log))
    expect(Object.keys(once.log)).toEqual(['100:0'])
  })

  test('a conflicting hash at one coordinate is failure-as-data + a refetch request; the higher-rank source wins', () => {
    const inbox0 = admit_events(empty_inbox(), poll_actions([hit(0, 50)], 100), 1).inbox // poll first
    const clash = admit_events(inbox0, receipt_actions([hit(0, 30)], 100), 2) // receipt disagrees at 100:0
    expect(clash.failures).toHaveLength(1)
    expect(clash.failures[0]).toMatchObject({ kind: 'hash_conflict', kept: 'receipt', sources: ['poll', 'receipt'] })
    expect(clash.effects).toHaveLength(1)
    expect(clash.effects[0]).toMatchObject({ kind: 'refetch', version: 100 })
    expect(clash.inbox.log['100:0'].remaining_hp).toBe(30) // receipt is the one-way floor — it wins the slot
  })

  test('the derived frontier is the max admitted coordinate', () => {
    const { inbox } = admit_events(empty_inbox(), receipt_actions([hit(0, 50), hit(1, 40)], 100), 1)
    expect(coord_key(truth_frontier(inbox))).toBe('100:1')
    expect(truth_version(inbox)).toBe(100)
  })
})

describe('adopt_snapshot — the one bootstrap/reconcile door (#1336)', () => {
  const fight = {
    width: 12,
    height: 12,
    status: 1,
    participants: [{ character: '0xa', cell: '5', hp: '70', ap: '6', mp: '3' }],
    mobs: [],
  }

  test('a bootstrap snapshot adopts as the base; the events it subsumes stay logged but fall below the fold floor', () => {
    const with_events = admit_events(empty_inbox(), receipt_actions([hit(0, 50)], 100), 1).inbox
    const adopted = adopt(with_events, fight, 200, {})
    expect(adopted.base_version).toBe(200)
    expect(adopted.base_view.escrow).toHaveLength(1)
    // Full re-adoption discards the wholly subsumed old tail; no partial state crosses the cursor boundary.
    expect(Object.keys(adopted.log)).toEqual([])
    expect(coord_key(truth_frontier(adopted))).toBe('200:-1')
    expect(fold_canonical(adopted).fighters.p0.hp).not.toBe(50)
  })

  test('a snapshot ahead of the fold cursor fully re-adopts through the same door', () => {
    const at200 = adopt(empty_inbox(), fight, 200, {})
    const later = adopt(at200, { ...fight, status: 3, participants: [{ ...fight.participants[0], hp: 33 }] }, 300, {})
    expect(later.base_version).toBe(300)
    expect(later.base_view.status).not.toBe(at200.base_view.status)
    expect(later.base_view.escrow[0].hp).toBe(33)
  })

  test('a snapshot at or behind the fold cursor is discarded whole', () => {
    const at200 = adopt(empty_inbox(), fight, 200, {})
    const earlier = adopt(at200, fight, 150, {})
    const equal = adopt(at200, fight, 200, {})
    expect(earlier).toBe(at200)
    expect(equal).toBe(at200)
  })

  // THE ROSTER WINDOW (#1274) — `join` is legal only in placement, so a placement base is PROVISIONAL and the
  // base is max(placement reads) while any exists, min(the rest) otherwise. Both halves are pure over the SET.
  const placement = { ...fight, status: 0 }
  const joined = { ...placement, participants: [...placement.participants, { character: '0xb', cell: '6', hp: '70' }] }

  test('a PLACEMENT base re-derives from a later placement read — the joiner becomes visible', () => {
    const created = adopt(empty_inbox(), placement, 200, {})
    expect(created.base_view.escrow).toHaveLength(1)

    const after_join = adopt(created, joined, 210, {})
    expect(after_join.base_version).toBe(210)
    expect(after_join.base_view.escrow.map((row) => row.character)).toEqual(['0xa', '0xb'])
  })

  // ── THE ADMISSION LAW, resealed 2026-08-02 ────────────────────────────────────────────────────────────────
  // The three seals below used to encode a PHASE heuristic: "a placement read always outranks an active one, an
  // active base never re-adopts, and the base converges on max(placement reads)". The coop_roster_transition
  // conviction (packages/fight/test/coop_roster_transition.test.js) proved that letter wrong in BOTH directions
  // — it over-protected (a creator whose poll straddled join+force_start could never learn the joiner's seat,
  // because the read carrying the grown roster shares its version with the events that closed the window) and
  // under-protected (the version guard was scoped to a placement base, so a STALE placement read rolled an
  // ACTIVE base back into the roster window). The invariant is INFORMATION ORDER, not phase; the ruled law is
  // "an ACTIVE base never regresses; a PROVISIONAL base admits version-ordered roster supersets". These seals
  // now state that law, in both of its directions.

  test('a PROVISIONAL base admits the read that closed the window WITH its joiner (the join door)', () => {
    const created = adopt(empty_inbox(), placement, 200, {})
    // The active read that froze the roster is the ONLY door this seat has: no later placement read can exist.
    const activated = adopt(created, { ...joined, status: 1 }, 220, {})
    expect(activated.base_version).toBe(220)
    expect(activated.base_view.escrow.map((row) => row.character)).toEqual(['0xa', '0xb'])
  })

  test('a PROVISIONAL base admits a superset only in VERSION ORDER — a superset from the past is still behind', () => {
    const created = adopt(empty_inbox(), joined, 210, {})
    const stale = adopt(created, { ...joined, participants: [...joined.participants, { character: '0xc' }] }, 205, {})
    expect(stale).toBe(created) // untouched — a gain of seats never buys a read out of its ordering
  })

  test('an ACTIVE base NEVER REGRESSES — neither a stale read nor one that re-opens the roster window (#701)', () => {
    const active = adopt(empty_inbox(), { ...joined, status: 1 }, 220, {})
    // the chain never returns a fight to placement, so a placement-shaped read against a frozen base is stale or
    // torn by construction — and before 2026-08-02 it ADOPTED, rolling the frozen roster back into the window.
    expect(adopt(active, joined, 210, {})).toBe(active)
    expect(adopt(active, placement, 230, {})).toBe(active)
    // and the ordinary stale-checkpoint half of #701 is unchanged
    expect(adopt(active, { ...joined, status: 1 }, 215, {})).toBe(active)
  })

  test('the roster window is ORDER-INDEPENDENT — every arrival order converges on the same ROSTER', () => {
    const reads = [
      [placement, 200],
      [joined, 210],
      [{ ...joined, status: 1 }, 220],
    ]
    const fold = (inbox, order) => order.reduce((acc, [rows, v]) => adopt(acc, rows, v, {}), inbox)
    const orders = [
      [reads[0], reads[1], reads[2]],
      [reads[2], reads[1], reads[0]],
      [reads[1], reads[2], reads[0]],
      [reads[2], reads[0], reads[1]],
      [reads[1], reads[0], reads[2], reads[1]], // + a dupe: adoption is idempotent
    ]
    // Reads ALONE: which seats exist can never depend on arrival order. The base VERSION may legitimately differ
    // (a client that saw the active read first is further along than one still holding a provisional base — the
    // old `always 210` answer was only reachable through the stale-read regression closed above).
    for (const order of orders) {
      const inbox = fold(empty_inbox(), order)
      expect(inbox.base_view.escrow).toHaveLength(2)
      expect(roster_open(inbox.base_view) ? 210 : 220).toBe(inbox.base_version)
    }
    // With the transition PROVEN by the event tail — the steady state the one-ingress law guarantees — every
    // order converges on the identical base, version included. Strictly stronger than the seal it replaces.
    for (const order of orders) {
      const tailed = admit_events(empty_inbox(), receipt_actions([hit(0, 40)], 220), 1).inbox
      const inbox = fold(tailed, order)
      expect(inbox.base_version).toBe(220)
      expect(inbox.base_view.escrow).toHaveLength(2)
    }
  })

  test('events above the adopted base survive the adoption', () => {
    const at100 = adopt(empty_inbox(), fight, 100, {})
    const with_tail = admit_events(at100, receipt_actions([hit(0, 20)], 150), 1).inbox
    expect(Object.keys(with_tail.log)).toEqual(['150:0'])
  })

  test('red: a folded buff survives an older snapshot behind the event cursor', () => {
    const at100 = adopt(empty_inbox(), fight, 100, {})
    const buff = {
      kind: 'StatusAdded',
      target_is_mob: false,
      target_idx: 0,
      status: { kind: 6, remaining_turns: 3, stat: 0, value: 1 },
      version: 200,
      event_idx: 0,
      source: 'receipt',
    }
    const buffed = admit_events(at100, [buff], 1).inbox
    expect(fold_canonical(buffed).fighters.p0.statuses).toHaveLength(1)

    const stale = adopt(buffed, { ...fight, participants: [{ ...fight.participants[0], hp: '1' }] }, 150, {})
    expect(stale).toBe(buffed)
    expect(fold_canonical(stale).fighters.p0.statuses).toEqual([buff.status])
    expect(fold_canonical(stale).fighters.p0.hp).toBe(70)
  })

  // #1689 — EVERY GATE ABOVE NAMES ITSELF. The refusals were indistinguishable to the caller: one unchanged
  // inbox for a torn read, a stale one and a checkpoint alike. Each gate now hands its reason back with the
  // untouched inbox, which is what lets the presentation say "syncing" for one and "the read came back
  // incomplete" for another.
  const reason_of = (...args) => adopt_snapshot(...args).refusal?.reason ?? null

  test('an adopted read carries NO refusal', () => {
    expect(reason_of(empty_inbox(), fight, 200, {})).toBe(null)
  })

  test('a TORN read (a board with no lifecycle scalar) is refused as `torn`', () => {
    const { status: _dropped, ...no_status } = fight
    expect(reason_of(empty_inbox(), no_status, 200, {})).toBe('torn')
  })

  test('the ordering gates name themselves apart from the fault', () => {
    const at200 = adopt(empty_inbox(), fight, 200, {})
    expect(reason_of(at200, fight, 150, {})).toBe('behind')
    expect(reason_of(at200, fight, 200, {})).toBe('behind') // at the cursor is behind it
    // ahead of the cursor, same phase, byte-identical content and no tail to prove a change: a checkpoint
    expect(reason_of(at200, fight, 201, {})).toBe('unchanged')
    // a roster-less read may seed a base but never replace a live one — held, not adopted
    expect(reason_of(at200, { ...fight, participants: [] }, 300, {})).toBe('roster_hold')
    // a post-placement read that introduces a joiner is the JOIN DOOR (resealed 2026-08-02) — it adopts, and
    // names no refusal; the same read WITHOUT a roster gain is still an unproven transition.
    const placed = adopt(empty_inbox(), placement, 200, {})
    expect(reason_of(placed, { ...joined, status: 1 }, 220, {})).toBe(null)
    expect(reason_of(placed, { ...placement, status: 1 }, 220, {})).toBe('unproven_transition')
    // an ACTIVE base names the regression it refuses — a read that would re-open the roster window is behind it
    const active = adopt(empty_inbox(), { ...joined, status: 1 }, 220, {})
    expect(reason_of(active, joined, 210, {})).toBe('behind')
  })
})

describe('courtesy (p2p) — unverified, never advances the frontier alone', () => {
  test('a courtesy row buffers as unverified and does not enter the log or move the frontier', () => {
    const courtesy = buffer_courtesy(
      empty_inbox(),
      batch_to_actions({ events: [hit(0, 50)] }, { version: 100, source: 'p2p' })
    )
    expect(Object.keys(courtesy.courtesy)).toEqual(['100:0'])
    expect(Object.keys(courtesy.log)).toEqual([])
    expect(coord_key(truth_frontier(courtesy))).toBe('-1:-1') // COORD_ZERO — no verified truth yet
  })

  test('a byte-identical verified row graduates the courtesy (it drops from the buffer, never double-folds)', () => {
    const buffered = buffer_courtesy(
      empty_inbox(),
      batch_to_actions({ events: [hit(0, 50)] }, { version: 100, source: 'p2p' })
    )
    const verified = admit_events(buffered, receipt_actions([hit(0, 50)], 100), 1).inbox
    const settled = reconcile_courtesy(verified)
    expect(Object.keys(settled.log)).toEqual(['100:0']) // truth admitted
    expect(Object.keys(settled.courtesy)).toEqual([]) // courtesy graduated + dropped
  })

  test('a courtesy overtaken by a newer snapshot base is dropped (it is moot)', () => {
    const fight = { width: 12, height: 12, status: 1, participants: [], mobs: [] }
    const buffered = buffer_courtesy(
      empty_inbox(),
      batch_to_actions({ events: [hit(0, 50)] }, { version: 100, source: 'p2p' })
    )
    const past = reconcile_courtesy(adopt(buffered, fight, 200, {}))
    expect(Object.keys(past.courtesy)).toEqual([])
  })
})

describe('note_journal_head — the starve gap is a FINDING, fired once per head advance', () => {
  test('head beyond the delivered body seq surfaces a journal_gap once', () => {
    const first = note_journal_head(empty_inbox(), 2, [{ seq: 0 }, { seq: 1 }], 1) // delivered 0,1; head 2 → no gap
    expect(first.failures).toEqual([])
    const gap = note_journal_head(first.inbox, 8, [], 2) // head jumps to 8, no new bodies → gap
    expect(gap.failures).toHaveLength(1)
    expect(gap.failures[0]).toMatchObject({ kind: 'journal_gap', head: 8, delivered: 1, missing: 6 })
    const again = note_journal_head(gap.inbox, 8, [], 3) // same head, re-poll → no duplicate finding
    expect(again.failures).toEqual([])
  })
})
