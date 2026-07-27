// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Issue #8 — TURN-ORDER CARD HP SNAPS TO ZERO A BEAT EARLY (the death-present sibling of the double-death #134).
//
// LEG P already holds NON-lethal card HP through a paced wave (effect_badges_presented_hp_leg_pq.test.js). But the
// #134 retirement floor added to wave_masked_fold clamps a RETIRED fighter's hp→0 in the presented projection — so
// a LETHAL blow zeroed `presented_health` the instant the receipt folded, while engine_view.dead still HELD the
// fighter visually alive (death_presenting_ids). The card showed "0 HP" on a standing fighter, seconds before its
// death floater. The killing Hit is inside the MASKED window, so the re-fold already holds the fighter at pre-death
// HP — the fix is to NOT floor a fighter whose death beat is still presenting; it dies exactly when the beat acks.
//
// The invariant: presented_health follows the BEAT — it holds the last pre-death value through the death-presenting
// window, then converges to 0/dead the moment the killing turn drains. Every OTHER retired fighter still floors
// (the #134 stale-resurrection must never come back).

import { describe, expect, test } from 'bun:test'

import { committed_truth, create_fight_store } from '../src/store.js'
import { engine_view } from '../src/project.js'
import { presented_state } from '../src/fold.js'

const FIGHT = '0xf1'
const CHAR = '0xc1'
const W = 20
const enc = (x, y) => y * W + x
const ev = (kind, fields) => ({ type: `0x0::fight_events::${kind}`, parsedJson: { fight: FIGHT, ...fields } })

const base_fight = (over = {}) => ({
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
      hp: 10,
      max_hp: 50,
      cell: enc(5, 5),
    },
  ],
  mobs: [{ template: '0xabc', hp: 30, max_hp: 30, cell: enc(8, 8), ap: 4, mp: 3, level: 1 }],
  queue: [
    { is_mob: false, idx: 0 },
    { is_mob: true, idx: 0 },
  ],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
  ...over,
})

const boot = (fight = base_fight()) => {
  const store = create_fight_store()
  store
    .getState()
    .input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: W } } })
  store.getState().input({ type: 'snapshot', fight, version: 5 }, 1_000)
  return store
}
const me = (store) => engine_view(store.getState()).fighters.get(CHAR)

// A MOB turn deals a LETHAL blow to me (10 → 0) — a non-local receipt that PACES a wave the eye must follow.
const mob_kills_me = (store, now = 2_000) =>
  store.getState().input(
    {
      type: 'receipt',
      fight_id: FIGHT,
      version: 6,
      receipt: {
        events: [
          ev('TurnStarted', { is_mob: true, idx: 0, deadline_ms: 0 }),
          ev('Cast', { caster_is_mob: true, caster_idx: 0, target_cell: enc(5, 5) }),
          ev('Hit', { victim_is_mob: false, victim_idx: 0, amount: 10, remaining_hp: 0 }),
          ev('TurnEnded', { is_mob: true, idx: 0 }),
        ],
      },
    },
    now
  )

describe('#8 — the timeline card HP holds through the death beat, never snaps to 0 early', () => {
  test('a LETHAL mob strike holds presented_health at pre-death, then converges to 0/dead on drain', () => {
    const store = boot()
    mob_kills_me(store)

    const during = me(store)
    // The fold KNOWS the death instantly (committed truth is never delayed — chain parity).
    expect(during.committed_health, 'committed KNOWS the kill instantly').toBe(0)
    expect(during.committed_dead, 'committed is dead').toBe(true)
    // But the CARD holds pre-death HP AND stays visually alive until the killing beat presents (the #8 bug: 0/early).
    expect(during.presented_health, 'card HP holds at 10 until the death beat lands').toBe(10)
    expect(during.dead, 'the fighter is held visually alive through its own death beat').toBe(false)
    // The re-fold itself holds the fighter alive at pre-death while the killing Hit is masked.
    expect(presented_state(store.getState()).fighters.p0.alive, 'presented holds alive through the beat').toBe(true)
    expect(committed_truth(store.getState()).fighters.p0.alive, 'committed already floored dead').toBe(false)

    // Drain the paced wave → the death beat presents → the card converges to committed truth (0 / dead).
    for (const t of [...store.getState().wave]) store.getState().input({ type: 'presented', seq: t.seq }, 2_500)
    const after = me(store)
    expect(after.presented_health, 'after the beat, HP drops to 0 with the floater').toBe(0)
    expect(after.dead, 'and the fighter finally reads dead — exactly once').toBe(true)
  })

  test('the #134 floor still binds: a retired fighter whose death is NOT presenting stays floored to 0', () => {
    // A fresh retirement floor with NO matching death beat in the wave (an already-presented / stale-resurrected
    // death) must still clamp presented HP — the death-presenting exemption is the ONLY hole in the floor.
    const store = boot()
    mob_kills_me(store)
    // Drain so the death has PRESENTED (mob-0's turn acked) — I am now floor-dead with no live death beat.
    for (const t of [...store.getState().wave]) store.getState().input({ type: 'presented', seq: t.seq }, 2_500)
    // A version-inflated but STALE object read re-carries me ALIVE at hp 10 (the #134 resurrection shape).
    store.getState().input({ type: 'snapshot', fight: base_fight(), version: 8 }, 3_000)
    const revived = me(store)
    expect(revived.presented_health, 'the floor clamps the stale-resurrected HP to 0').toBe(0)
    expect(revived.dead, 'and holds the fighter dead — no resurrection').toBe(true)
    expect(presented_state(store.getState()).fighters.p0.alive, 'presented stays floored dead').toBe(false)
  })
})
