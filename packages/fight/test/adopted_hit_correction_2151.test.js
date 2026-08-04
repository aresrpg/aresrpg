// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2151 (caster half) — AN ADOPTED ACTION MUST BE ABLE TO CORRECT THE HISTORY IT SUPERSEDED.
//
// THE DEFECT (convicted in the #2145 dig, and structural in `fold.js`): my own cast paints its combat-log line
// optimistically, from the prediction. When the receipt lands and the prediction is WRONG, the store logs
// `fight prediction diverged; authoritative action adopted` and adopts the number everywhere EXCEPT the history:
// `wave_turns_of` filters MY OWN authoritative turn out of the wave entirely (only a displacement leg survives),
// so no authoritative beat is ever produced for it, so nothing re-reaches the log. The predicted 7 stands
// forever against a chain that committed 8.
//
// The divergence was not a channel that could fix it either: it carried `predicted`/`applied` as bare
// `remaining_hp` deltas — no amount, no victim, nothing a presenter could address a line with.
//
// THE LAW SEALED HERE: an adopted divergence carries its CORRECTION — the victim's real entity id and the
// authoritative amount, priced through the ONE pricing home (`price_hit`) with the same pre-receipt committed
// oracle the wave pricer uses. It is a REPLACEMENT instruction, not a re-play: the wave is untouched, so the
// floater and the VFX never fire twice.

import { describe, expect, test } from 'bun:test'

import { create_fight_store } from '../src/store.js'

const FIGHT = '0xf2151'
const CHAR = '0xcaster'
const W = 20
const enc = (x, y) => y * W + x
const ME = enc(5, 5)
const MOB = enc(7, 5)

const FIGHT_OBJECT = {
  id: FIGHT,
  status: 1,
  width: W,
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
      cell: ME,
    },
  ],
  // 13 HP — the dig's own shape: the client predicts 7 (remaining 6), the chain commits 8 (remaining 5).
  mobs: [{ template: '0xabc', hp: 13, max_hp: 30, cell: MOB, ap: 4, mp: 3, level: 1 }],
  queue: [
    { is_mob: false, idx: 0 },
    { is_mob: true, idx: 0 },
  ],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
  turn_entropy: 90_000,
  turn_ordinal: 1,
}

const boot = () => {
  const store = create_fight_store()
  store
    .getState()
    .input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: W } } })
  store.getState().input({ type: 'snapshot', fight: FIGHT_OBJECT, version: 5 }, 1_000)
  return store
}

/** MY optimistic cast: 7 damage on a 13-HP mob ⇒ the prediction paints it at 6. */
const predict = (store, remaining_hp = 6) =>
  store.getState().input(
    {
      type: 'predicted',
      basis_version: 6,
      intent_id: 'cast:2151:1',
      actions: [
        { kind: 'Cast', caster_is_mob: false, caster_idx: 0, target_cell: MOB, ap_cost: 3, damaging: true },
        { kind: 'Hit', victim_is_mob: true, victim_idx: 0, remaining_hp },
      ],
      beats: [{ kind: 'cast', at: 0, duration: 100, payload: {} }],
    },
    1_100
  )

/** The authoritative receipt for that same cast — the chain's amplified 8, leaving the mob at 5. */
const receipt = (store, { amount = 8, remaining_hp = 5 } = {}) =>
  store.getState().input(
    {
      type: 'receipt',
      version: 6,
      events: [
        {
          type: `0x0::fight_events::Hit`,
          parsedJson: {
            fight: FIGHT,
            victim_is_mob: true,
            victim_idx: 0,
            amount: String(amount),
            remaining_hp: String(remaining_hp),
          },
        },
        {
          type: `0x0::fight_events::Cast`,
          parsedJson: { fight: FIGHT, caster_is_mob: false, caster_idx: 0, target_cell: MOB },
        },
      ],
    },
    2_000
  )

describe('#2151 — an adopted divergence carries the correction its history needs', () => {
  test('the divergence names the victim and the AUTHORITATIVE amount', () => {
    const store = boot()
    predict(store)
    receipt(store)
    const { divergence } = store.getState()
    expect(divergence?.action, 'sanity: the claim diverged at all').toBe('Hit:m0')
    // RED at HEAD: `correction` does not exist — the divergence carried only remaining_hp deltas.
    expect(divergence.correction).toEqual({ target_id: 'mob-0', kind: 'damage', amount: 8 })
  })

  test('a KILLING adopted blow is corrected to the HP that was there to take, not the raw amount', () => {
    // The pricing home is shared with the wave pricer: a saturating hit reads the pre-receipt committed HP (13),
    // so an authoritative 40 on a 13-HP mob corrects the line to 13 — never to 40.
    const store = boot()
    predict(store)
    receipt(store, { amount: 40, remaining_hp: 0 })
    expect(store.getState().divergence.correction).toEqual({ target_id: 'mob-0', kind: 'damage', amount: 13 })
  })

  test('a prediction that MATCHED the chain raises no divergence and therefore no correction', () => {
    // The control that proves the correction rides divergence and is not stamped on every receipt.
    const store = boot()
    predict(store, 5)
    receipt(store)
    expect(store.getState().divergence, 'a byte-matched claim retires silently').toBeNull()
  })

  test('the wave is NOT re-played for my own corrected turn — a replacement, never a second beat', () => {
    const store = boot()
    predict(store)
    receipt(store)
    // The prediction's own click-time turn stays (it is what painted the floater). What must NEVER appear is an
    // AUTHORITATIVE turn for the same cast — that would re-play the beat instead of replacing the line.
    const replayed = store.getState().wave.filter((turn) => turn.authoritative && turn.is_local)
    expect(replayed, 'my own authoritative turn never becomes a second damage beat').toEqual([])
  })
})
