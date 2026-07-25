// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #159 — MOBS "DON'T PLAY THEIR TURN" (intermittent). The single-PTB turn resolves my-turn → mob-wave → my-next
// -turn in ONE receipt; the receipt PACES the mob wave (present.js, ~3s/mob). But the 4s poll reads the Fight
// OBJECT, and after my commit executes on-chain (mobs already acted) but BEFORE my receipt returns to the client,
// a poll reads that post-commit object and — with no wave yet built — adopts it WHOLESALE: the board jumps to the
// mobs' final positions and the receipt's wave has nothing left to show. The R2 deferral (store.js) only guarded
// an ALREADY-draining wave; this closes the gap BEFORE the wave exists.
//
// The fix: while my commit is IN-FLIGHT (`busy` — set at submit, cleared in the submit promise's finally, AFTER
// the receipt is applied), a fresher object read is DEFERRED through the same pending_snapshot door — never
// dropped — and adopts once the receipt's wave has drained. Mirrors scenario_solo.test.js's R2 DEFERRAL control.

import { describe, expect, test } from 'bun:test'

import { create_fight_store } from '../src/store.js'
import { engine_view } from '../src/project.js'
import { encode } from '../src/los.js'

const FIGHT = '0xf1'
const CHAR = '0xc1'
const ME = encode(2, 2)
const MOB_START = encode(6, 2)
const MOB_AFTER = encode(3, 2) // the mob walked toward me and struck
const ev = (kind, json) => ({ type: `0xpkg::fight_events::${kind}`, parsedJson: { fight: FIGHT, ...json } })

const fight_object = ({ mob_cell = MOB_START, mob_hp = 20, my_hp = 50 } = {}) => ({
  id: FIGHT,
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
      hp: my_hp,
      max_hp: 50,
      cell: ME,
    },
  ],
  mobs: [{ template: '0xabc', hp: mob_hp, max_hp: 20, cell: mob_cell, ap: 4, mp: 3, level: 1 }],
  queue: [
    { is_mob: false, idx: 0 },
    { is_mob: true, idx: 0 },
  ],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
})

const boot = () => {
  const store = create_fight_store()
  store
    .getState()
    .input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: 20 } } })
  store.getState().input({ type: 'snapshot', fight: fight_object(), version: 5 }, 1_000)
  return store
}

const end_turn = (store) => store.getState().input({ type: 'busy', value: true }) // commit submitted, in-flight

// The post-commit poll: my commit executed on-chain (the mob already walked + struck), object now at v6 — but my
// receipt has NOT returned to the client yet. Without the fix this adopts wholesale and clobbers the mob wave.
const post_commit_poll = (store, now) =>
  store.getState().input({ type: 'snapshot', fight: fight_object({ mob_cell: MOB_AFTER, my_hp: 44 }), version: 6 }, now)

// My turn's receipt finally returns: it carries the mob wave and paces it (the animation the eye must see).
const receipt = (store, now) =>
  store.getState().input(
    {
      type: 'receipt',
      fight_id: FIGHT,
      version: 6,
      receipt: {
        events: [
          ev('TurnStarted', { is_mob: false, idx: 0 }),
          ev('TurnEnded', { is_mob: false, idx: 0 }),
          ev('TurnStarted', { is_mob: true, idx: 0 }),
          ev('MobMoved', { idx: 0, to_cell: MOB_AFTER }),
          ev('Cast', { caster_is_mob: true, caster_idx: 0, target_cell: ME }),
          ev('Hit', {
            victim_is_mob: false,
            victim_idx: 0,
            amount: 6,
            remaining_hp: 44,
            caster_is_mob: true,
            caster_idx: 0,
          }),
          ev('TurnEnded', { is_mob: true, idx: 0 }),
          ev('TurnStarted', { is_mob: false, idx: 0, deadline_ms: 120_000 }),
        ],
      },
    },
    now
  )

describe('#159 — a poll cannot leapfrog an in-flight commit whose wave is not built', () => {
  test('a post-commit poll is a CHECKPOINT — it never adopts, so it cannot leapfrog the receipt wave (M2b)', () => {
    const store = boot()
    end_turn(store) // busy — my commit is in-flight, no wave built yet
    post_commit_poll(store, 3_000)

    // M2b · ONE INGRESS: the object read is DEMOTED to a checkpoint — it NEVER adopts mid-fight, so the #159
    // leapfrog is structurally impossible (the old deferral is deleted; there is nothing to defer). The fold stays
    // the bootstrap base until the receipt's canonical events land.
    expect(store.getState().view_version, 'the checkpoint read never re-adopts — the base is untouched').toBe(5)
    // the mob has NOT teleported to its final cell — the receipt's wave will animate the walk
    expect(engine_view(store.getState()).fighters.get('mob-0').cell, 'mob still at its pre-turn cell').toEqual({
      x: 6,
      y: 2,
    })
  })

  test('the receipt then paces the mob wave (mob moves START→AFTER), and the deferred read is consumed', () => {
    const store = boot()
    end_turn(store)
    post_commit_poll(store, 3_000) // deferred
    receipt(store, 3_100) // the receipt builds the mob wave (the animation)
    store.getState().input({ type: 'busy', value: false }, 3_150) // submit resolved → busy clears

    const remote = store.getState().wave.filter((t) => !t.is_local)
    expect(remote.length, 'the mob wave IS built and paced — the mob visibly plays its turn').toBe(1)
    expect(remote[0].source_id).toBe('mob-0')
    // the wave MASKS the walk: the mob is still shown at its pre-turn cell until the beats present
    expect(engine_view(store.getState()).fighters.get('mob-0').cell, 'mob held at its pre-turn cell').toEqual({
      x: 6,
      y: 2,
    })

    // drain the wave (the beats present): the mob walks to its final cell and my HP drops — reconciled, not jumped
    for (const t of [...store.getState().wave]) store.getState().input({ type: 'presented', seq: t.seq }, 9_000)
    expect(engine_view(store.getState()).fighters.get('mob-0').cell, 'mob revealed at its final cell').toEqual({
      x: 3,
      y: 2,
    })
    expect(engine_view(store.getState()).fighters.get(CHAR).health, 'my HP reconciled through the wave').toBe(44)
    expect(store.getState().view_version, 'the checkpoint contributed nothing — the receipt drove the whole turn').toBe(
      5
    )
  })
})
