// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2151 (observer half) — A CONFIRMED HIT IS PRICED BY THE JOURNAL, NOT BY WHATEVER HP THE CLIENT HOLDS.
//
// THE DEFECT (convicted in the #2145 dig, §5): an observing seat printed `hit Pecker the Widow for 5` against a
// journal `Hit` carrying `amount: 10`. The pricer clamps every confirmed floater with
// `min(raw_amount, hp_before)`, and `hp_before` is an ORACLE — `store_state.committed_health`, read off the
// committed fold. That oracle is only pre-receipt for rows the fold has not yet seen.
//
// It is provably NOT pre-receipt for the PRESENTATION-OWED lane (#2124, core_inbox `admit_events`): an owed row
// sits at or below `base_version`, i.e. the adopted snapshot ALREADY contains its damage, so the oracle answers
// with the victim's POST-hit HP. `min(10, 5)` = 5 — the dig's exact number, and a number the acting seat (whose
// oracle really is pre-receipt) never computes. Two clients, one committed fact, two rendered amounts.
//
// THE LAW SEALED HERE: the clamp exists for exactly ONE case — a killing blow, where the chain's raw authored
// damage overshoots the HP that was there to take. The journal says so itself: `remaining_hp > 0` is the victim
// SURVIVING, which is proof no saturation occurred, so the raw amount IS the amount and no oracle may lower it.
// The clamp may only ever run on `remaining_hp === 0`. A stale, ahead, or absent HP reading can no longer
// corrupt a surviving victim's floater, because it is no longer consulted.

import { describe, expect, test } from 'bun:test'

import { produce_receipt_render_turns } from '../src/fight_render_events.js'

const FIGHT = 'fight-2151'

const cast = () => ({
  type: '0xENGINE::fight_events::Cast',
  parsedJson: { fight: FIGHT, caster_is_mob: false, caster_idx: '0', target_cell: '49' },
})

const hit = (amount, remaining_hp, victim_idx = '1') => ({
  type: '0xENGINE::fight_events::Hit',
  parsedJson: {
    fight: FIGHT,
    victim_is_mob: true,
    victim_idx,
    amount: String(amount),
    remaining_hp: String(remaining_hp),
  },
})

const resolve_fighter_id = ({ is_mob, idx, character }) => character ?? `${is_mob ? 'm' : 'p'}${idx}`

/** The rendered damage beats, in order — the numbers the floater and the combat-log line both read. */
const damages = (raw_events, fighter_health) =>
  produce_receipt_render_turns(raw_events, { fight_id: FIGHT, resolve_fighter_id, fighter_health })
    .events.filter((beat) => beat.kind === 'damage')
    .map((beat) => beat.payload.damage)

describe('#2151 — confirmed-hit pricing derives from the journal, never from a display-side clamp', () => {
  test('a SURVIVING victim renders the journal amount even when the HP oracle already counted the hit', () => {
    // The captured shape: mob 1 at 15 HP takes the chain's authored 10 and lives at 5. The observer's oracle is
    // the ALREADY-ADOPTED snapshot, so it answers 5 — the post-hit HP. RED at HEAD: renders 5.
    expect(damages([cast(), hit(10, 5)], () => 5)).toEqual([10])
  })

  test('a KILLING blow still clamps to the HP that was there to take', () => {
    // The positive control for the rule above: this is the ONE case the clamp exists for, and it must survive.
    // With `remaining_hp === 0` the raw 10 overshot a 5-HP victim, so the floater says 5 — not 10.
    expect(damages([cast(), hit(10, 0)], () => 5)).toEqual([5])
  })

  test('the rule is the journal reading, not a constant — the same oracle prices two hits differently', () => {
    // One receipt, one victim, two hits: 10 raw landing on a survivor, then 10 raw landing the kill. A single
    // oracle answer (5) must produce 10 then 5. A test that could pass on `raw` alone, or on `min` alone, fails.
    expect(damages([cast(), hit(10, 5), hit(10, 0)], () => 15)).toEqual([10, 5])
  })

  test('an ABSENT oracle is unchanged — a kill it cannot price renders the raw authored amount', () => {
    expect(damages([cast(), hit(10, 0)], () => null)).toEqual([10])
  })
})
