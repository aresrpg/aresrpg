// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// #1143 — TWO CLIENTS, TWO TRANSPORTS, ONE STATUS TRUTH.
//
// The reported symptom is an ASYMMETRY: a partner's self-buff paints on the partner's client and never on the
// observer's, while other kinds cross fine. Every existing gate misses it for the same reason —
// `viewer_fingerprint_parity.test.js` replays ONE envelope stream through several viewer identities, and
// `buff_status_fold.test.js` drives its receipt and journal arms off the SAME row list. Both prove the fold is
// viewer-free. Neither can see the defect, because in production THE TWO CLIENTS DO NOT RECEIVE THE SAME ROWS.
//
// THE ASYMMETRY WAS IN THE TRANSPORT, NOT THE FOLD:
//   · the ACTOR gets its own tx RECEIPT — which carries the action-envelope triple
//     `ActionStarted`/`ActionEffect`/`ActionResolved`, and `inputs.js::self_status_from_effect` mints the timed
//     status row off it the instant the receipt lands;
//   · every OTHER client's live ordered transport is the RPC journal — and the indexer DROPPED that whole triple
//     (`packages/rpc/indexer/src/handlers/ares/journal.rs`, `_ => return None`), on the premise its own comment
//     stated: "NO client consumes them today". `self_status_from_effect` had consumed them since #481.
//
// So an observer's only status path was the 4s `Fight.fx.statuses` object poll — and `core_inbox.js::adopt_snapshot`
// refuses any read at or behind the event frontier, so that poll could never deliver it either: the buff was
// PERMANENTLY invisible, not late. Only the kinds that ALSO ride a flat journalled event crossed — a drain's debt
// row from the journalled `Drain`, invisibility from `StanceChanged`/`Revealed`, a point grant through the escrow
// pool the snapshot carries. Asymmetric per direction AND per kind, exactly as reported.
//
// THE FIX is in the read layer: `journal.rs` now journals `ActionStarted`/`ActionEffect` (`ActionResolved` stays
// deferred — no fold reads it). This file is the consumer contract that keeps it honest, in BOTH directions:
// the journalled kind set AND each row's field set are READ OFF THE INDEXER ITSELF, never transcribed here. A
// fixture that states its own version of the read layer's scope or shape is the second home that let this defect
// hide in a green suite for three investigations. Every reader THROWS rather than degrade to a plausible empty
// answer (instruments never coerce).
//
// Refs #1146 (the coop observer epic), #1993 (the projection shape orders).

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, test } from 'bun:test'

import * as SE from '../../sim/src/spell_effect.js'
import { create_fight_store } from '../src/store.js'
import { fight_visible_view } from '../src/project.js'
import { read_fighter_statuses } from '../src/fight_status_snapshot.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const JOURNAL_RS = join(HERE, '..', '..', 'rpc', 'indexer', 'src', 'handlers', 'ares', 'journal.rs')

/**
 * The event kinds the RPC indexer actually appends to a fight's journal — parsed out of `journal.rs`'s own match
 * arms, so this fixture can never claim a transport the read layer does not provide. A parse that finds nothing
 * is a broken instrument, not an empty answer.
 */
const journalled_kinds = () => {
  const source = readFileSync(JOURNAL_RS, 'utf8')
  const arms = [...source.matchAll(/^\s+"([A-Za-z]+)" =>/gm)].map((match) => match[1])
  if (arms.length < 10) throw new Error(`journal.rs match-arm scan found ${arms.length} kinds — the parse broke`)
  return new Set(arms)
}

/**
 * The field NAMES inside the first `json!({ … })` block after `marker` in journal.rs — i.e. the exact `data` shape
 * the read layer writes for that kind. Same instrument principle as the kind scan above: the indexer's own source
 * is the only statement of what a journalled row carries, and a fixture that transcribes its own version of that
 * is the second home the whole defect hid in. A parse that finds nothing THROWS.
 */
const journalled_fields = (marker) => {
  const source = readFileSync(JOURNAL_RS, 'utf8')
  const [, after] = source.split(marker)
  if (after == null) throw new Error(`journal.rs has no \`${marker}\` — the parse broke`)
  const open = after.indexOf('json!({')
  const fields = [...after.slice(open, after.indexOf('})', open)).matchAll(/"([a-z_]+)":/g)].map((match) => match[1])
  if (!fields.length) throw new Error(`journal.rs \`${marker}\` exposed no fields — the parse broke`)
  return fields.sort()
}

const JOURNALLED = journalled_kinds()

const FIGHT = '0xf1143'
const ACTOR = '0xactor1143'
const OBSERVER = '0xobserver1143'
const ACTOR_CELL = 105
const OBSERVER_CELL = 106

const participant = (character, cell) => ({
  owner: character,
  character,
  class: 'senshi',
  team: 0,
  hp: 50,
  max_hp: 50,
  ap: 6,
  mp: 3,
  base_ap: 6,
  base_mp: 3,
  cell,
})

/** The shared chain object read both clients bootstrap from — no statuses yet. */
const fight_at = (statuses = []) => ({
  id: FIGHT,
  status: 1,
  width: 20,
  height: 19,
  participants: [participant(ACTOR, ACTOR_CELL), participant(OBSERVER, OBSERVER_CELL)],
  mobs: [],
  queue: [
    { is_mob: false, idx: 0 },
    { is_mob: false, idx: 1 },
  ],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
  invisibility_statuses: statuses,
})

// A `+20 Strength · 3 turns` self-buff, authored exactly as the chain mints it: every `spell_effect::Effect`
// field, in the WIRE's own value convention (u64 as a decimal string, u8 as a number — the fullnode's parsedJson
// rule both transports speak), with the value CENTERED at 32768 (#983) and `TF_ONLY_CASTER` proving the recipient.
const SELF_BUFF = {
  kind: SE.K_ALTER_STAT,
  element: 255,
  value: String(32_768 + 20),
  value_max: String(32_768 + 20),
  area_shape: SE.SHAPE_POINT,
  area_size: '0',
  target_filter: SE.TF_ONLY_CASTER,
  chance: 100,
  turns: 3,
  stat: SE.STAT_STRENGTH,
  flags: 0,
  phase: 0,
}

/** The ordered rows ONE self-buff cast transaction emits on chain — the full truth, before any transport. The two
 *  envelope rows carry EXACTLY the field set `journal.rs` writes (asserted below, parsed from it); `ActionResolved`
 *  is receipt-only by design — the indexer defers it, so no journalled shape exists for it to match. */
const CAST_ROWS = [
  {
    kind: 'ActionStarted',
    data: {
      fight: FIGHT,
      caster_is_mob: false,
      caster_idx: '0',
      turn_ordinal: '1',
      action_ordinal: '0',
      action_kind: 0,
      target_cell: String(ACTOR_CELL),
      ap_cost: '3',
      effect_count: '1',
    },
  },
  {
    kind: 'ActionEffect',
    data: {
      fight: FIGHT,
      caster_is_mob: false,
      caster_idx: '0',
      turn_ordinal: '1',
      action_ordinal: '0',
      effect_ordinal: '0',
      effect: SELF_BUFF,
    },
  },
  { kind: 'Cast', data: { fight: FIGHT, caster_is_mob: false, caster_idx: 0, target_cell: ACTOR_CELL } },
  {
    kind: 'ActionResolved',
    data: {
      fight: FIGHT,
      caster_is_mob: false,
      caster_idx: '0',
      turn_ordinal: '1',
      action_ordinal: '0',
      target_cell: String(ACTOR_CELL),
      spell: '0xselfbuff',
    },
  },
]

/** THE ACTOR's transport: its own tx receipt, carrying every row the transaction emitted. */
const receipt_input = (rows) => ({
  type: 'receipt',
  fight_id: FIGHT,
  version: 2,
  receipt: { events: rows.map((row) => ({ type: `0x0::fight_events::${row.kind}`, parsedJson: row.data })) },
})

/** THE OBSERVER's transport: the RPC journal page — the same transaction, minus every kind the indexer drops. */
const journal_input = (rows) => {
  const carried = rows.filter((row) => JOURNALLED.has(row.kind))
  return {
    type: 'journal',
    fight_id: FIGHT,
    page: {
      fight: FIGHT,
      journal_head: String(carried.length),
      events: carried.map((row, seq) => ({
        seq: String(seq),
        version: '2',
        kind: row.kind,
        data: row.data,
        digest: '0x1143',
      })),
    },
  }
}

const client = (my_key, my_entity_id) => {
  const store = create_fight_store()
  store.getState().input({
    type: 'init',
    fight_id: FIGHT,
    my_key,
    ctx: { my_entity_id, address: my_entity_id, beat_ctx: { grid_width: 20 } },
  })
  store.getState().input({ type: 'snapshot', fight: fight_at(), version: 1 }, 1_000)
  return store
}

/** The status rows one client believes a fighter carries — the collection every badge surface derives from. */
const status_rows = (store, entity_id) =>
  (fight_visible_view(store.getState()).entities?.[entity_id]?.statuses?.rows ?? []).map((row) => ({
    kind: Number(row.kind),
    value: row.value ?? null,
    stat: row.stat ?? null,
    remaining_turns: Number(row.remaining_turns),
  }))

describe('#1143 — a coop observer sees the same statuses as the actor', () => {
  test('the indexer journals the envelope rows the actor folds its status from', () => {
    // The premise of the whole file, stated as a measurement rather than an assumption. It ran INVERTED first
    // (both `false`) — that reading, off this same scan of the shipped `journal.rs`, is what proved the defect
    // was the transport and not the fold. `ActionResolved` stays deferred on purpose: no fold reads it.
    expect(JOURNALLED.has('Cast')).toBe(true)
    expect(JOURNALLED.has('ActionStarted')).toBe(true)
    expect(JOURNALLED.has('ActionEffect')).toBe(true)
    expect(JOURNALLED.has('ActionResolved')).toBe(false)
  })

  test('the journal rows this file folds carry EXACTLY the fields the indexer writes', () => {
    // Shape parity, not transport parity: these fixtures were authored from the EXPECTED envelope, so a field the
    // real journal names differently (or omits) would let the fold pass here and starve in production. Both sides
    // of the comparison are read from the shipped source; neither is transcribed.
    const data_of = (kind) => CAST_ROWS.find((row) => row.kind === kind).data
    expect(Object.keys(data_of('ActionStarted')).sort()).toEqual(journalled_fields('"ActionStarted" => {'))
    expect(Object.keys(data_of('ActionEffect')).sort()).toEqual(journalled_fields('"ActionEffect" => {'))
    expect(Object.keys(data_of('ActionEffect').effect).sort()).toEqual(journalled_fields('fn effect_json('))
  })

  test('a self-buff reaches BOTH clients — the actor by receipt, the observer by journal', () => {
    const actor = client('p0', ACTOR)
    const observer = client('p1', OBSERVER)

    actor.getState().input(receipt_input(CAST_ROWS), 1_100)
    observer.getState().input(journal_input(CAST_ROWS), 1_100)

    // The actor paints the buff off its own envelope.
    expect(status_rows(actor, ACTOR)).toContainEqual({
      kind: SE.K_ALTER_STAT,
      value: 20,
      stat: SE.STAT_STRENGTH,
      remaining_turns: 3,
    })
    // Viewer identity may select controls, never truth: the observer must agree.
    expect(status_rows(observer, ACTOR)).toEqual(status_rows(actor, ACTOR))
  })

  test("the observer's next object poll carries the buff, and both clients still agree", () => {
    const actor = client('p0', ACTOR)
    const observer = client('p1', OBSERVER)

    actor.getState().input(receipt_input(CAST_ROWS), 1_100)
    observer.getState().input(journal_input(CAST_ROWS), 1_100)

    // The 4s poll — the chain's own `Fight.fx.statuses`, the observer's only other status path.
    // Authored the way the wire states it — `read_fighter_statuses` yields `fighter`-keyed rows (the chain fid),
    // which `board_state` maps onto entity ids. Decoded here through that same reader so the fixture speaks the
    // chain's dialect (CENTERED value) rather than a hand-decoded one.
    const polled = fight_at(
      read_fighter_statuses({
        fx: {
          statuses: [
            {
              fighter: 0,
              kind: SE.K_ALTER_STAT,
              remaining_turns: 3,
              source: 0,
              effect: { stat: SE.STAT_STRENGTH, value: 32_768 + 20, chance: 100, element: 255 },
            },
          ],
        },
      })
    )
    observer.getState().input({ type: 'snapshot', fight: polled, version: 2 }, 5_100)
    actor.getState().input({ type: 'snapshot', fight: polled, version: 2 }, 5_100)

    expect(status_rows(observer, ACTOR)).toEqual(status_rows(actor, ACTOR))
  })

  // The END-TURN half of the report ("all bonuses vanished for EVERYONE"). A whole-roster wipe is the signature
  // of a BASE SWAP, not of per-fighter aging — statuses live in `base_view` for anyone who did not mint them
  // locally, and every adoption replaces that base wholesale. So the leg worth driving is a re-adoption across
  // the turn boundary: the row must survive exactly once (never zero, never doubled by the log it was minted from).
  test('a locally-minted status survives a base re-adoption and the turn boundary — exactly once', () => {
    const actor = client('p0', ACTOR)
    actor.getState().input(receipt_input(CAST_ROWS), 1_100)
    expect(status_rows(actor, ACTOR)).toHaveLength(1)

    const polled = fight_at(
      read_fighter_statuses({
        fx: {
          statuses: [
            {
              fighter: 0,
              kind: SE.K_ALTER_STAT,
              remaining_turns: 3,
              source: 0,
              effect: { stat: SE.STAT_STRENGTH, value: 32_768 + 20, chance: 100, element: 255 },
            },
          ],
        },
      })
    )
    actor.getState().input({ type: 'snapshot', fight: polled, version: 3 }, 5_100)
    expect(status_rows(actor, ACTOR)).toHaveLength(1)

    // End the actor's turn. Per #2000/D42 a turn END ages nothing — the row is untouched.
    actor.getState().input(journal_input([{ kind: 'TurnEnded', data: { fight: FIGHT, is_mob: false, idx: 0 } }]), 6_000)
    expect(status_rows(actor, ACTOR)).toEqual([
      { kind: SE.K_ALTER_STAT, value: 20, stat: SE.STAT_STRENGTH, remaining_turns: 3 },
    ])
  })
})
