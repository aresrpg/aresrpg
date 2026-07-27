// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// THE JOURNAL ORDINAL COORDINATE LAW (#866, restored core-only by #946). A canonical row's intra-version ordinal
// is derived from the chain's own `seq` — `seq - min(seq of that version)`, re-derived over every journal row
// received so far (`core_inbox.js` `stamp_journal` / `rederive_journal`) — never from a row's position in the page
// that carried it.
//
// WHY IT IS ITS OWN FENCE. The read layer cuts pages on SEQ, never on version (`rpc/api/views.js` — the window is
// `[from, from+limit)`), and the walker re-drives from an arbitrary `from` after a gap, so ONE object version can
// straddle a page boundary. Stamped by position, page two's rows would be (version, 0..k) — colliding with page
// one's real (version, 0..k) — and at equal source rank `admit_events` would give the slot to the newcomer. At a
// death boundary the killing `Hit` is overwritten by whatever follows it and THE CORPSE STANDS BACK UP for the
// rest of the fight, permanently, with no re-convergence. That is the class this file exists to keep dead.
//
// These rows arrived with #866 inside the cutover-parity suite, which asserted them through BOTH the core and the
// legacy settlement fold. #1027 retired that fold, so the legacy arm is gone — but the law it happened to be
// written beside is core-side and still live, which is why it moves here instead of leaving with it. Order
// independence has its own home (`reconcile_properties.test.js`); this file owns the COORDINATE.

import { describe, test, expect } from 'bun:test'

import { empty_core_state, ingest, project_board, revive_wire } from '../src/core.js'
import { input_envelope } from '../src/envelope.js'
import { classify_input } from '../src/classify_input.js'
import { normalize_journal_page } from '../src/journal_normalize.js'

/** The observable board fields this law turns on, key-sorted so equality is order-stable. */
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

/** Fold a `{ msg, at }` stream through the CORE's public door and read its board at every step. */
const fold_core = (stream) => {
  let core = empty_core_state()
  let seq = 0
  return stream.map(({ msg: raw, at }) => {
    const msg = revive_wire(raw)
    core = ingest(
      core,
      input_envelope({
        session_id: msg?.fight_id ?? null,
        input_seq: seq++,
        observed_at_ms: at ?? seq,
        payload: classify_input(msg),
      })
    )
    return observable(project_board(core))
  })
}

// ── THE FIGHT: one seat at 70 hp, an 8 hp mob and a 12 hp mob ──────────────────────────────────────────────────
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

// THE DEATH + ROLLOVER BATCH: my cast kills m0, my turn ends, m1 walks, I walk, my turn opens again.
const rollover = [
  { type: `${EV}Cast`, parsedJson: { fight: F, caster_is_mob: false, caster_idx: 0, damaging: true } },
  { type: `${EV}Hit`, parsedJson: { fight: F, victim_is_mob: true, victim_idx: 0, remaining_hp: '0' } },
  { type: `${EV}TurnEnded`, parsedJson: { fight: F, is_mob: false, idx: 0 } },
  { type: `${EV}MobMoved`, parsedJson: { fight: F, idx: 1, to_cell: 28 } },
  { type: `${EV}Moved`, parsedJson: { fight: F, character: CHAR, to_cell: 7 } },
  { type: `${EV}TurnStarted`, parsedJson: { fight: F, is_mob: false, idx: 0, deadline_ms: '1784000060000' } },
]

/** The chain truth this stream folds to once every row has landed — the bar the core is judged against.
 *  `p0.turn_number` is 2: the adopted ACTIVE base counts as round one and the batch carries exactly one
 *  `TurnStarted` for the seat. */
const SETTLED = {
  active: 'p0',
  fighters: {
    m0: { cell: 9, hp: 0, alive: false, turn_number: 1 },
    m1: { cell: 28, hp: 12, alive: true, turn_number: 1 },
    p0: { cell: 7, hp: 70, alive: true, turn_number: 2 },
  },
}

const DEAD_M0 = { cell: 9, hp: 0, alive: false, turn_number: 1 }

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

describe('a version SPLIT across pages keeps one continuous ordinal run (#866)', () => {
  // ONE object version, TWO contiguous pages — the cut the read layer is free to make anywhere.
  const split = [...boot(), page(200, rollover.slice(0, 3), 2, 8, 3), page(200, rollover.slice(3), 5, 8, 4)]

  test('the whole stream lands on chain truth, page one alone and page two landed', () => {
    expect(fold_core(split).at(-1)).toEqual(SETTLED)
  })

  test('THE FENCE: the killing Hit keeps its slot — page two never overwrites page one', () => {
    // Stamped by position instead of by seq, page two would collide with page one's ordinals and the Hit would
    // lose its slot to the event that follows it: the mob comes back alive and stays alive.
    expect(fold_core(split).at(-1).fighters.m0).toEqual(DEAD_M0)
  })

  test('a further contiguous page leaves the board at chain truth', () => {
    const trailing = [{ type: `${EV}TurnEnded`, parsedJson: { fight: F, is_mob: false, idx: 0 } }]
    expect(fold_core([...split, page(210, trailing, 8, 9, 5)]).at(-1).fighters.m0.alive).toBe(false)
  })

  test('COORDINATE LAW: the receipt twin of a split version dedupes, it never double-folds', () => {
    // My own tx proof lands the whole version at (200, 0..5) BY POSITION; the journal then redelivers it in two
    // pages. Both lanes must resolve to the SAME coordinates or the tail folds twice (TurnStarted counts turns).
    const receipt_only = fold_core([
      ...boot(),
      { msg: { type: 'receipt', fight_id: F, version: 200, receipt: { events: rollover } }, at: 3 },
    ]).at(-1)
    const with_journal = fold_core([
      ...boot(),
      { msg: { type: 'receipt', fight_id: F, version: 200, receipt: { events: rollover } }, at: 3 },
      page(200, rollover.slice(0, 3), 2, 8, 4),
      page(200, rollover.slice(3), 5, 8, 5),
    ]).at(-1)
    expect(with_journal, 'the journal confirmation changed nothing').toEqual(receipt_only)
    expect(with_journal.fighters.m0, 'and the board is chain truth').toEqual(DEAD_M0)
  })

  test('a gap makes the walker re-drive from a MID-VERSION seq, and the run still heals', () => {
    // This is what produces the straddle in the wild: the walker paginates ahead of the cursor and the re-drive
    // redelivers the version from its start, so page two is seen BEFORE page one. The ordinal floor is a min over
    // the received set, so page one's arrival lowers it and the whole version's rows move down together.
    const redriven = [
      ...boot(),
      page(200, rollover.slice(3), 5, 8, 3), // ahead of the cursor: seqs 5,6,7 of a version that starts at 2
      page(200, rollover.slice(0, 3), 2, 8, 4), // the re-drive, from the version's true start
      page(200, rollover.slice(3), 5, 8, 5), // …and the rest, redelivered contiguously
    ]
    expect(fold_core(redriven).at(-1).fighters.m0, 'the core healed into chain truth').toEqual(DEAD_M0)
  })
})
