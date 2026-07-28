// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1485 — HP oscillation after a fight loss: "my HP after a loss are at 0, but a few seconds later they
// instantly go back to full (50). Then somehow they go back down and glitch."
//
// The reported sequence, folded through the ONE `action/sui_data` door: the settlement receipt stamps the
// chain's write_back_hp (final_hp = 0 + a fresh anchor), then `dungeon_settlement`'s trailing load_roster()
// lands a /v1 snapshot the indexer has NOT yet projected the fight into — carrying the PRE-FIGHT current_hp
// and its older `hp_updated_ms`. XP was already protected here by the receipt-proven floor; the HP block was
// not, so the stale snapshot restored full HP until the indexer caught up and dropped it back to 0.

import { test, expect, describe } from 'bun:test'

import { reduce_sui_data } from '../src/reduce.js'

const base = (over = {}) => ({ characters: [], items: [], xp_floor: {}, loaded: false, ...over })

// A lvl-1 senshi at full HP, last settled by the chain at t=1000.
const pre_fight = () => ({ id: 'c1', experience: 0, current_hp: 50, hp_updated_ms: 1000 })

describe('#1485 — a stale /v1 snapshot must never restore HP over a receipt-proven write-back', () => {
  test('the loss receipt stamps 0, and the lagging snapshot does not blip it back to full', () => {
    const start = base({ characters: [pre_fight()] })

    // 1. the defeat settles: results::write_back_hp(character, 0, now) — mirrored as a receipt patch.
    const settled = reduce_sui_data(start, {
      kind: 'receipt_patch',
      op: 'fight_receipt',
      character_id: 'c1',
      final_hp: 0,
      now: 9000,
    })
    expect(settled.characters[0].current_hp).toBe(0)
    expect(settled.characters[0].hp_updated_ms).toBe(9000)

    // 2. the settlement's trailing load_roster() lands BEFORE the indexer projected the fight — the row it
    //    carries is the pre-fight one, anchor and all.
    const stale = reduce_sui_data(settled, { kind: 'snapshot', characters: [pre_fight()] })
    expect(stale.characters[0].current_hp).toBe(0) // was 50 — the reported full-restore blip
    expect(stale.characters[0].hp_updated_ms).toBe(9000)

    // 3. the indexer catches up: same anchor as the receipt-proven write-back, authority handed back.
    const caught_up = reduce_sui_data(stale, {
      kind: 'snapshot',
      characters: [{ id: 'c1', experience: 0, current_hp: 0, hp_updated_ms: 9000 }],
    })
    expect(caught_up.characters[0].current_hp).toBe(0)
  })

  test('a snapshot whose anchor ADVANCED wins — an out-of-band heal is chain truth, not a regression', () => {
    const start = base({ characters: [{ id: 'c1', current_hp: 0, hp_updated_ms: 9000 }] })
    const healed = reduce_sui_data(start, {
      kind: 'snapshot',
      characters: [{ id: 'c1', current_hp: 50, hp_updated_ms: 12000 }],
    })
    expect(healed.characters[0].current_hp).toBe(50)
    expect(healed.characters[0].hp_updated_ms).toBe(12000)
  })

  test('the legacy (kind-less) full merge obeys the same law — dungeon_run_store dispatches through it', () => {
    const start = base({ characters: [pre_fight()] })
    const settled = reduce_sui_data(start, {
      kind: 'receipt_patch',
      op: 'fight_receipt',
      character_id: 'c1',
      final_hp: 0,
      now: 9000,
    })
    const stale = reduce_sui_data(settled, { characters: [pre_fight()] })
    expect(stale.characters[0].current_hp).toBe(0)
  })

  test('a row we hold no anchor for adopts the snapshot untouched (boot)', () => {
    const start = base({ characters: [{ id: 'c1' }] })
    const booted = reduce_sui_data(start, {
      kind: 'snapshot',
      characters: [{ id: 'c1', current_hp: 31, hp_updated_ms: 4000 }],
    })
    expect(booted.characters[0].current_hp).toBe(31)
  })

  test('a snapshot missing the HP block entirely keeps the block we hold (indexer projection gap)', () => {
    const start = base({ characters: [{ id: 'c1', current_hp: 12, hp_updated_ms: 9000 }] })
    const gapped = reduce_sui_data(start, {
      kind: 'snapshot',
      characters: [{ id: 'c1', current_hp: null, hp_updated_ms: null }],
    })
    expect(gapped.characters[0].current_hp).toBe(12)
    expect(gapped.characters[0].hp_updated_ms).toBe(9000)
  })
})
