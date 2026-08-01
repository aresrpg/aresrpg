// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Issue #1584 — A STATUS-ONLY OBJECT READ CARRIES NEW INFORMATION.
//
// `adopt_snapshot` drops a same-phase object read whose CONTENT hashes identical to the adopted base: with no event
// tail, a read that says nothing new is a redundant checkpoint. `snapshot_content_hash` excluded
// `invisibility_statuses` from that content, so a read whose ONLY delta was the status class hashed equal to its
// predecessor and was refused. Statuses are AUTHORITATIVE-ONLY — the client cannot re-derive them from anything it
// holds (the chain's `fx.statuses` is the sole source; there is no event that reconstructs a whole status set) — so
// the exclusion made the fold silently refuse chain truth about invisibility, buffs and debuffs.
//
// The pair of facts this file pins: a status delta is CONTENT (the read adopts and the badge appears), and the
// dedupe guard is still armed (a genuinely identical read is still dropped). The second leg is what makes the first
// a real measurement — the hash must discriminate, not simply stop deduping.

import { describe, expect, test } from 'bun:test'

import * as SE from '../../sim/src/spell_effect.js'
import { encode } from '../src/los.js'
import { engine_view } from '../src/project.js'
import { read_fighter_statuses } from '../src/fight_status_snapshot.js'
import { create_fight_store } from '../src/store.js'

const FIGHT = '0xf1584'
const CHAR = '0xc1584'
const SEAT = encode(5, 5)
const MOB = encode(8, 8)

/** A live `+20 Strength · 3 turns` row on my seat, decoded off the wire exactly as the chain mints it. */
const BUFF = read_fighter_statuses({
  fx: {
    statuses: [
      {
        fighter: 0,
        kind: SE.K_ALTER_STAT,
        remaining_turns: 3,
        source: 0,
        effect: { stat: SE.STAT_STRENGTH, value: 32_788, chance: 100, element: 255 },
      },
    ],
  },
})

// The SDK decode hands u64 fields over as BigInt (`sdk/src/sui/read/_object.js` `to_bigint` — `0n` even when the
// field is absent), so every live read carries them. `world_seed`/`spawn_id` are on the hashed content.
const fight_object = (statuses) => ({
  id: FIGHT,
  world_seed: 12_345n,
  spawn_id: 0n,
  status: 1,
  width: 20,
  height: 19,
  participants: [
    {
      owner: '0xaaa',
      character: CHAR,
      class: 'senshi',
      team: 0,
      ap: 6,
      mp: 3,
      base_ap: 6,
      base_mp: 3,
      hp: 50,
      max_hp: 50,
      cell: SEAT,
    },
  ],
  mobs: [{ template: '0xabc', hp: 30, max_hp: 30, cell: MOB, ap: 4, mp: 3, level: 1 }],
  queue: [
    { is_mob: false, idx: 0 },
    { is_mob: true, idx: 0 },
  ],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
  turn_entropy: 90_000,
  turn_ordinal: 1,
  invisibility_statuses: statuses,
})

const badges = (store) => engine_view(store.getState()).fighters.get(CHAR).effects

/** Boot on a read that positively states NO statuses — the authoritative empty set. */
const boot = () => {
  const store = create_fight_store()
  store
    .getState()
    .input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: 20 } } })
  store.getState().input({ type: 'snapshot', fight: fight_object([]), version: 5 }, 1_000)
  return store
}

describe('#1584 the snapshot content hash counts the status class', () => {
  test('a read whose ONLY delta is a new status is adopted — the badge the chain states reaches the fold', () => {
    const store = boot()
    expect(badges(store), 'the base read stated no statuses').toEqual([])

    // Byte-identical to the base except for the status class: same roster, same phase, same geometry, same turn.
    store.getState().input({ type: 'snapshot', fight: fight_object(BUFF), version: 6 }, 2_000)

    // THE REPORTED DEFECT: the status class was stripped before hashing, so this read hashed equal to its
    // predecessor and `adopt_snapshot` returned the inbox untouched — view_version stayed 5 and badges stayed [].
    expect(store.getState().core.inbox.base_version, 'the status-only read carried new information and re-based').toBe(
      6
    )
    expect(
      badges(store).find((row) => row.kind === SE.K_ALTER_STAT)?.remaining_turns,
      'the chain-stated buff reached the badge the HUD renders'
    ).toBe(3)
  })

  test('the dedupe guard is still armed — a read identical in every field, statuses included, is dropped', () => {
    const store = boot()
    store.getState().input({ type: 'snapshot', fight: fight_object(BUFF), version: 6 }, 2_000)
    expect(store.getState().core.inbox.base_version).toBe(6)

    store.getState().input({ type: 'snapshot', fight: fight_object(BUFF), version: 7 }, 3_000)
    expect(store.getState().core.inbox.base_version, 'nothing new to say — the read stayed a checkpoint').toBe(6)
  })

  test('a status EXPIRY is content too — a read that drops the row re-bases and clears the badge', () => {
    const store = boot()
    store.getState().input({ type: 'snapshot', fight: fight_object(BUFF), version: 6 }, 2_000)
    expect(badges(store).length).toBe(1)

    // The authoritative empty set is a positive claim, not silence: it must be adoptable in both directions.
    store.getState().input({ type: 'snapshot', fight: fight_object([]), version: 7 }, 3_000)
    expect(store.getState().core.inbox.base_version).toBe(7)
    expect(badges(store), 'the chain says the row is gone').toEqual([])
  })
})
