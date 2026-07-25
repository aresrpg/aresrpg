// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// #761 — THE TWO DIVERGENCE CLASSES AT A DEATH + TURN ROLLOVER. A driven fight on the cutover build reported the
// legacy board disagreeing with the core at a death/rollover boundary and re-converging afterwards, on exactly:
//   fighters.m0.hp · fighters.m0.alive · fighters.m1.cell · fighters.p0.cell · fighters.p0.turn_number
// (`active` AGREED — the seat that was active before the batch is the seat the batch hands the turn back to.)
//
// THE DEATH IS NOT THE MECHANISM. Folded over the same contiguous stream — receipt lane or journal lane — a death
// plus a full rollover is byte-equal through both arms (§0 below). The divergence is an INGRESS-ORDINAL class, and
// there are two of them, one per arm. Both are pinned here.
//
// ── CLASS A · THE GAP WINDOW (the legacy arm reads stale; self-healing) ────────────────────────────────────────
// journal_accept.js:90-95 — a page whose first seq is beyond `head + 1` is a GAP: `fetch_gap` is emitted and the
// loop BREAKS. Nothing is applied and the page is NOT buffered — it is discarded. `committed_state` (fold.js:388)
// therefore reads the board from before that page until the walker re-drives from `from` and redelivers it
// contiguously. v2/inbox.js `admit_events` has no such gate — admission is keyed on the source-independent
// `(version, ordinal)` coordinate with a content hash, so the page admits immediately and v2/fold.js `sorted_tail`
// sorts it into place (order-independence is pinned by test/v2/shuffle.test.js). A death + rollover page carries
// many fields at once, which is why that boundary is where a human notices the hold. §1 reproduces the driven
// field set byte-for-byte and proves the legacy board is HELD at its pre-page value, never a wrong value.
//
// ── CLASS B · THE PAGE-SPLIT ORDINAL COLLISION (the core arm reads WRONG; permanent) ───────────────────────────
// v2/inbox.js:100-111 — `journal_to_actions` derives each event's intra-version ordinal from its position WITHIN
// THE PAGE (`per_version` is local to the call and starts at 0 for every page). The read layer cuts pages on SEQ,
// never on version (rpc/api/views.js:1189-1196 — the window is `[from, from+limit)`), and the walker re-drives
// from an arbitrary `from` after a gap, so ONE object version can straddle a page boundary. When it does, page
// two's rows are stamped (version, 0..k) — colliding with page one's real (version, 0..k) — and `admit_events`
// gives the slot to the newcomer at equal source rank (v2/inbox.js:139). At a death boundary the killing `Hit` is
// overwritten by whatever event follows it, and the corpse STANDS BACK UP for the rest of the fight. There is no
// re-convergence: the legacy arm is right and the core is wrong. §2 pins the CURRENT, DEFECTIVE behavior — it is
// deliberately green so it flips loudly the moment the coordinate law is fixed.

import { describe, test, expect } from 'bun:test'

import { create_fight_store, committed_state } from '../../src/store.js'
import { empty_core_state, ingest, project_board, revive_wire } from '../../src/v2/index.js'
import { input_envelope } from '../../src/envelope.js'
import { classify_input } from '../../src/classify_input.js'
import { normalize_journal_page } from '../../src/journal_normalize.js'

// The shadow's field set (fight_v2_shadow.js FIGHTER_FIELDS + active), key-sorted so equality is order-stable.
const FIGHTER_FIELDS = ['cell', 'hp', 'alive', 'turn_number']
const observable = (board) => ({
  active: board?.active ?? null,
  fighters: Object.fromEntries(
    Object.keys(board?.fighters ?? {})
      .sort()
      .map((key) => [
        key,
        Object.fromEntries(FIGHTER_FIELDS.map((field) => [field, board.fighters[key][field] ?? null])),
      ])
  ),
})

/** The shadow's comparator, restated so the field set this file asserts is the one production reports. */
const diverging_fields = (legacy, core) => {
  const fields = []
  if ((legacy.active ?? null) !== (core.active ?? null)) fields.push('active')
  const keys = new Set([...Object.keys(legacy.fighters), ...Object.keys(core.fighters)])
  for (const key of [...keys].sort())
    for (const field of FIGHTER_FIELDS)
      if ((legacy.fighters[key]?.[field] ?? null) !== (core.fighters[key]?.[field] ?? null))
        fields.push(`fighters.${key}.${field}`)
  return fields.sort()
}

/** Fold a `{ msg, at }` stream through BOTH arms exactly as the production tee does (fight_trace_tee.js): the store
 *  commits, then the legacy board (`committed_state`) is read beside the core's (`project_board`). Returns the
 *  per-step pair plus the legacy gap latch, so a divergence names its step AND its cause. */
const fold_both = (stream) => {
  const store = create_fight_store()
  let core = empty_core_state()
  let seq = 0
  return stream.map(({ msg: raw, at }) => {
    const msg = revive_wire(raw)
    const now = at ?? seq
    store.getState().input(msg, now)
    core = ingest(
      core,
      input_envelope({
        session_id: msg?.fight_id ?? store.getState().fight_id ?? null,
        input_seq: seq++,
        observed_at_ms: now,
        payload: classify_input(msg),
      })
    )
    return {
      legacy: observable(committed_state(store.getState())),
      core: observable(project_board(core)),
      journal_gap: store.getState().journal_gap,
    }
  })
}

// ── THE FIGHT: the driven fight's own shape — one seat at 70 hp, an 8 hp mob and a 12 hp mob ───────────────────
const F = '0xfeed'
const CHAR = '0xa11ce'
const EV = '0x0::fight_events::'

const fight_object = () => ({
  width: 12,
  height: 12,
  status: 1, // active → base_from_view derives base_turn_number 1
  participants: [{ character: CHAR, cell: '5', hp: '70', ap: '6', mp: '3' }],
  mobs: [
    { cell: '9', hp: '8' },
    { cell: '40', hp: '12' },
  ],
})

const boot = () => [
  { msg: { type: 'init', fight_id: F, my_key: null, ctx: { my_entity_id: CHAR } }, at: 1 },
  { msg: { type: 'snapshot', fight_id: F, version: 100, journal_head: 2, fight: fight_object() }, at: 2 },
]

const turn_one = [
  { type: `${EV}TurnStarted`, parsedJson: { fight: F, is_mob: false, idx: 0, deadline_ms: '1784000000000' } },
]

// THE DEATH + ROLLOVER BATCH: my cast kills m0, my turn ends, m1 walks, I walk, my turn opens again.
const rollover = [
  { type: `${EV}Cast`, parsedJson: { fight: F, caster_is_mob: false, caster_idx: 0, damaging: true } },
  { type: `${EV}Hit`, parsedJson: { fight: F, victim_is_mob: true, victim_idx: 0, remaining_hp: '0' } },
  { type: `${EV}TurnEnded`, parsedJson: { fight: F, is_mob: false, idx: 0 } },
  { type: `${EV}MobMoved`, parsedJson: { fight: F, idx: 1, to_cell: 28 } },
  { type: `${EV}Moved`, parsedJson: { fight: F, character: CHAR, to_cell: 7 } },
  { type: `${EV}TurnStarted`, parsedJson: { fight: F, is_mob: false, idx: 0, deadline_ms: '1784000060000' } },
]

/** The chain truth this stream folds to once every row has landed — the bar both arms are judged against. */
const SETTLED = {
  active: 'p0',
  fighters: {
    m0: { cell: 9, hp: 0, alive: false, turn_number: 1 },
    m1: { cell: 28, hp: 12, alive: true, turn_number: 1 },
    p0: { cell: 7, hp: 70, alive: true, turn_number: 3 },
  },
}

/** A journal page as the effectful walker delivers it (already normalized at the edge — rpc/fight_journal.js). */
const page = (version, events, from_seq, head, at) => ({
  msg: {
    type: 'journal',
    fight_id: F,
    version,
    batch: normalize_journal_page(
      {
        fight: F,
        journal_head: head,
        events: events.map((event, i) => ({
          seq: String(from_seq + i),
          kind: event.type.split('::').pop(),
          data: event.parsedJson,
          digest: '0xdead',
          version: String(version),
        })),
      },
      { fight_id: F }
    ),
  },
  at,
})

const DRIVEN_FIELDS = [
  'fighters.m0.alive',
  'fighters.m0.hp',
  'fighters.m1.cell',
  'fighters.p0.cell',
  'fighters.p0.turn_number',
]

describe('§0 — a death + turn rollover folds byte-equal through both arms', () => {
  test('JOURNAL lane, contiguous: every beat agrees, and the settled board is chain truth', () => {
    const steps = fold_both([...boot(), page(150, turn_one, 2, 3, 3), page(200, rollover, 3, 9, 4)])
    for (let i = 0; i < steps.length; i++)
      expect(steps[i].core, `the arms diverged at step ${i}`).toEqual(steps[i].legacy)
    expect(steps.at(-1).legacy).toEqual(SETTLED)
  })

  test('RECEIPT lane, contiguous: the same batch through my own tx proof also agrees at every beat', () => {
    const steps = fold_both([
      ...boot(),
      { msg: { type: 'receipt', fight_id: F, version: 150, receipt: { events: turn_one } }, at: 3 },
      { msg: { type: 'receipt', fight_id: F, version: 200, receipt: { events: rollover } }, at: 4 },
    ])
    for (let i = 0; i < steps.length; i++)
      expect(steps[i].core, `the arms diverged at step ${i}`).toEqual(steps[i].legacy)
    expect(steps.at(-1).legacy).toEqual(SETTLED)
  })
})

describe('§1 · CLASS A — the GAP WINDOW: the legacy arm holds a page it cannot place', () => {
  // The walker paginates ahead of the legacy cursor: the cursor is seeded from a 4s-stale object read
  // (`seed_accept_state(journal_head)`) and an interleaved tx moves the real journal on, so the page carrying the
  // death + rollover starts at seq 5 while the accept machine expects 3.
  const gapped = [...boot(), page(150, turn_one, 2, 3, 3), page(200, rollover, 5, 11, 4)]
  const hole_fill = [
    { type: `${EV}Placed`, parsedJson: { fight: F, character: CHAR, cell: 5 } },
    { type: `${EV}Ready`, parsedJson: { fight: F, character: CHAR } },
  ]

  test('the legacy board is HELD at its pre-page value while the core folds chain truth', () => {
    const steps = fold_both(gapped)
    const before = steps.at(-2)
    const at_gap = steps.at(-1)
    expect(at_gap.journal_gap, 'the legacy arm latches the hole it is waiting on').toMatchObject({ from: '3' })
    expect(at_gap.legacy, 'a stale read, never a wrong one').toEqual(before.legacy)
    expect(at_gap.core, 'the core arm is at chain truth').toEqual(SETTLED)
  })

  test('the reported field set is exactly the driven divergence (active agrees)', () => {
    const at_gap = fold_both(gapped).at(-1)
    expect(diverging_fields(at_gap.legacy, at_gap.core)).toEqual(DRIVEN_FIELDS)
  })

  test('filling the hole is NOT enough — the discarded page is never buffered, only redelivered', () => {
    const after_fill = fold_both([...gapped, page(180, hole_fill, 3, 11, 5)]).at(-1)
    expect(after_fill.journal_gap, 'the hole is closed').toBe(null)
    expect(diverging_fields(after_fill.legacy, after_fill.core), 'and the arms still disagree').toEqual(DRIVEN_FIELDS)
  })

  test('the re-walk redelivers the page contiguously and the arms re-converge, byte-equal', () => {
    const settled = fold_both([...gapped, page(180, hole_fill, 3, 11, 5), page(200, rollover, 5, 11, 6)]).at(-1)
    expect(diverging_fields(settled.legacy, settled.core)).toEqual([])
    expect(settled.legacy).toEqual(SETTLED)
  })
})

describe('§2 · CLASS B — the PAGE-SPLIT ordinal collision resurrects a dead fighter on the CORE arm', () => {
  // ONE object version, TWO contiguous pages — the read layer cuts on seq, never on version. Page two's rows are
  // re-stamped from ordinal 0 and overwrite page one's at the same coordinates; the killing `Hit` is among them.
  const split = [...boot(), page(200, rollover.slice(0, 3), 2, 8, 3), page(200, rollover.slice(3), 5, 8, 4)]

  test('a version split across two pages folds identically only while the split has not landed', () => {
    const steps = fold_both(split)
    expect(steps.at(-2).core, 'page one alone agrees').toEqual(steps.at(-2).legacy)
  })

  test('PINNED DEFECT — the core loses the killing Hit and the mob is alive again; the legacy arm is right', () => {
    const after_split = fold_both(split).at(-1)
    // The legacy arm holds chain truth: the accept machine keys on the absolute seq, which no page split can shift.
    expect(after_split.legacy.fighters.m0, 'legacy: dead, correctly').toEqual({
      cell: 9,
      hp: 0,
      alive: false,
      turn_number: 1,
    })
    // THE DEFECT, asserted as it stands today so the fix flips this test red: v2/inbox.js `journal_to_actions`
    // re-stamps page two from ordinal 0, `admit_events` hands the slot to the newcomer, and the Hit is gone.
    expect(after_split.core.fighters.m0, 'core: RESURRECTED — this is the bug, not the contract').toEqual({
      cell: 9,
      hp: 8,
      alive: true,
      turn_number: 1,
    })
    expect(diverging_fields(after_split.legacy, after_split.core)).toEqual(['fighters.m0.alive', 'fighters.m0.hp'])
  })

  test('the resurrection is PERMANENT — a further contiguous page never heals it', () => {
    const trailing = [{ type: `${EV}TurnEnded`, parsedJson: { fight: F, is_mob: false, idx: 0 } }]
    const settled = fold_both([...split, page(210, trailing, 8, 9, 5)]).at(-1)
    expect(settled.core.fighters.m0.alive, 'still standing').toBe(true)
    expect(settled.legacy.fighters.m0.alive, 'still dead, correctly').toBe(false)
  })
})
