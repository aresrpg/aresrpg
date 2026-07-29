// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1643 — THE CLOCK-SKEW FREEZE. The post-fight roster patch used to stamp `hp_updated_ms` with the CLIENT's
// wall clock, and `keep_settled_hp` compares that field against the chain's own monotone settle stamp to decide
// whether a snapshot is a lagging projection. On a machine whose clock runs ahead (a stale VM, a bad NTP, a
// user-set date), the stamped anchor is a value the chain will not reach for years: EVERY subsequent snapshot
// reads as "older than what we hold" and its HP block is rejected forever. The roster row freezes at the
// predicted HP — a defeat's 0 — and no heal, no regen read, no re-login ever moves it again.
//
// THE LAW (the ruling on the row): a client-side patch never writes the chain's anchor. The prediction's own
// base instant rides on `hp_previsional_ms`, a field nothing compares; the chain's stamp retires it on arrival
// by construction, because the comparison that retires it has chain stamps on BOTH sides.

import { test, expect, describe } from 'bun:test'

import { reduce_sui_data } from '../src/reduce.js'

const base = (over = {}) => ({ characters: [], items: [], xp_floor: {}, loaded: false, ...over })

// A lvl-1 seat at full HP, last settled by the chain at t=1000.
const pre_fight = () => ({ id: 'c1', experience: 0, current_hp: 50, hp_updated_ms: 1000 })

// A client whose wall clock runs a decade ahead of the chain.
const SKEWED_NOW = 4_000_000_000_000

const defeat = (sui, previsional_ms) =>
  reduce_sui_data(sui, {
    kind: 'receipt_patch',
    op: 'fight_receipt',
    character_id: 'c1',
    final_hp: 0,
    previsional_ms,
  })

describe('#1643 — a client wall clock can never win, or freeze, a roster HP row', () => {
  test('the optimistic defeat patch leaves the CHAIN anchor untouched', () => {
    const settled = defeat(base({ characters: [pre_fight()] }), SKEWED_NOW)
    expect(settled.characters[0].current_hp).toBe(0)
    expect(settled.characters[0].hp_updated_ms, 'the chain anchor is not the client to write').toBe(1000)
    expect(settled.characters[0].hp_previsional_ms, 'the prediction carries its own local base').toBe(SKEWED_NOW)
  })

  test('a lagging pre-fight snapshot still cannot restore the pre-fight HP (#1485 stays fixed)', () => {
    const settled = defeat(base({ characters: [pre_fight()] }), SKEWED_NOW)
    const lagging = reduce_sui_data(settled, { kind: 'snapshot', characters: [pre_fight()] })
    expect(lagging.characters[0].current_hp, 'the indexer has not projected the fight yet').toBe(0)
  })

  test('THE FREEZE: the chain catches up and then heals — a skewed client must not reject either read', () => {
    const settled = defeat(base({ characters: [pre_fight()] }), SKEWED_NOW)

    // 1. the indexer projects the write-back: current_hp 0 at the chain's own settle stamp.
    const caught_up = reduce_sui_data(settled, {
      kind: 'snapshot',
      characters: [{ id: 'c1', experience: 0, current_hp: 0, hp_updated_ms: 9000 }],
    })
    expect(caught_up.characters[0].hp_updated_ms, 'the chain stamp is adopted').toBe(9000)
    expect(
      caught_up.characters[0].hp_previsional_ms ?? null,
      'the prevision is retired the moment the chain speaks'
    ).toBe(null)

    // 2. an out-of-band heal lands. THIS is the read the skewed stamp used to reject forever.
    const healed = reduce_sui_data(caught_up, {
      kind: 'snapshot',
      characters: [{ id: 'c1', experience: 0, current_hp: 50, hp_updated_ms: 12000 }],
    })
    expect(healed.characters[0].current_hp, 'chain truth wins — the row is not frozen at 0').toBe(50)
    expect(healed.characters[0].hp_updated_ms).toBe(12000)
  })

  test('the heal lands even when it arrives BEFORE the settle projection (a skew-proof single hop)', () => {
    const settled = defeat(base({ characters: [pre_fight()] }), SKEWED_NOW)
    const healed = reduce_sui_data(settled, {
      kind: 'snapshot',
      characters: [{ id: 'c1', experience: 0, current_hp: 50, hp_updated_ms: 12000 }],
    })
    expect(healed.characters[0].current_hp).toBe(50)
  })

  test('a prediction on a row we hold no anchor for is retired by the first chain stamp', () => {
    const settled = defeat(base({ characters: [{ id: 'c1', current_hp: 50 }] }), SKEWED_NOW)
    expect(settled.characters[0].current_hp).toBe(0)
    const snapshot = reduce_sui_data(settled, {
      kind: 'snapshot',
      characters: [{ id: 'c1', current_hp: 42, hp_updated_ms: 7000 }],
    })
    expect(snapshot.characters[0].current_hp).toBe(42)
  })

  test('a dispatcher with no local instant to offer fabricates none', () => {
    const settled = defeat(base({ characters: [pre_fight()] }), null)
    expect(settled.characters[0].current_hp).toBe(0)
    expect(settled.characters[0].hp_previsional_ms).toBe(null)
    expect(settled.characters[0].hp_updated_ms).toBe(1000)
  })
})
