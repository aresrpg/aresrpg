// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// LEG G — TELEPORT CAST ROLLED BACK — a bug where a teleport cast kept getting rolled back. A
// teleport-class cast relocates the CASTER (an instant self-Displaced, effect_kind 14). Its
// predicted cell must (1) paint this frame, (2) survive the confirming receipt, and (3) never be un-teleported
// by a later stale read once receipt-proven — the committed floor never regresses a receipt-proven cell, the
// exact contract a walk receipt already enjoys.

import { describe, expect, test } from 'bun:test'

import { create_fight_store } from '../src/store.js'
import { engine_view } from '../src/project.js'
import { decode } from '../src/los.js'
import { DISPLACE_TELEPORT } from '../src/fight_render_prims.js'

const FIGHT = '0xf1'
const CHAR = '0xc1'
const W = 20
const enc = (x, y) => y * W + x
const HOME = enc(3, 3)
const DEST = enc(12, 8) // the teleport landing, far from HOME
const ev = (kind, fields) => ({ type: `0x0::fight_events::${kind}`, parsedJson: { fight: FIGHT, ...fields } })

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
      ap: 9,
      mp: 4,
      base_ap: 9,
      base_mp: 4,
      hp: 50,
      max_hp: 50,
      cell: HOME,
    },
  ],
  mobs: [{ template: '0xabc', hp: 200, max_hp: 200, cell: enc(15, 15), ap: 4, mp: 3, level: 1 }],
  queue: [{ is_mob: false, idx: 0 }],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
}

const boot = () => {
  const store = create_fight_store()
  store
    .getState()
    .input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: W } } })
  store.getState().input({ type: 'snapshot', fight: FIGHT_OBJECT, version: 5 }, 1_000)
  return store
}

const me = (store) => engine_view(store.getState()).fighters.get(CHAR)
const at = (cell) => decode(cell)
const teleport = (store) =>
  store.getState().input(
    {
      type: 'predicted',
      basis_version: 6,
      intent_id: 'tp1',
      actions: [
        { kind: 'Cast', caster_is_mob: false, caster_idx: 0, target_cell: DEST, ap_cost: 3 },
        { kind: 'Displaced', target_is_mob: false, target_idx: 0, to_cell: DEST, effect_kind: DISPLACE_TELEPORT },
      ],
      beats: [{ kind: 'cast', at: 0, duration: 100, payload: {} }],
    },
    1_100
  )

describe('LEG G — a teleport cast holds its predicted cell across adoption', () => {
  test('the predicted teleport paints the caster at the landing this frame', () => {
    const store = boot()
    teleport(store)
    expect(me(store).cell, 'the caster jumps to the landing (instant, no walk-hold)').toEqual(at(DEST))
  })

  test('the confirming receipt keeps the caster at the landing (no revert, no divergence)', () => {
    const store = boot()
    teleport(store)
    store.getState().input(
      {
        type: 'receipt',
        fight_id: FIGHT,
        version: 6,
        receipt: {
          events: [
            ev('Cast', { caster_is_mob: false, caster_idx: 0, target_cell: DEST }),
            ev('Displaced', {
              target_is_mob: false,
              target_idx: 0,
              from_cell: HOME,
              to_cell: DEST,
              kind: DISPLACE_TELEPORT,
            }),
          ],
        },
      },
      2_000
    )
    expect(me(store).committed_health, 'sanity: caster resolved').toBe(50)
    expect(me(store).cell, 'a receipt-proven teleport holds the landing').toEqual(at(DEST))
    expect(store.getState().divergence, 'the prediction matched — no correction').toBeNull()
  })

  test('a later STALE below-floor read must not un-teleport a receipt-proven caster (committed floor)', () => {
    const store = boot()
    teleport(store)
    store.getState().input(
      {
        type: 'receipt',
        fight_id: FIGHT,
        version: 6,
        receipt: {
          events: [
            ev('Cast', { caster_is_mob: false, caster_idx: 0, target_cell: DEST }),
            ev('Displaced', {
              target_is_mob: false,
              target_idx: 0,
              from_cell: HOME,
              to_cell: DEST,
              kind: DISPLACE_TELEPORT,
            }),
          ],
        },
      },
      2_000
    )
    for (const t of [...store.getState().wave]) store.getState().input({ type: 'presented', seq: t.seq }, 2_100)
    // a torn/stale object read BELOW the floor still showing HOME must be dropped — never a revert-loop
    store.getState().input({ type: 'snapshot', fight: FIGHT_OBJECT, version: 4 }, 2_200)
    expect(me(store).cell, 'the receipt-proven landing survives a stale below-floor read').toEqual(at(DEST))
  })
})

// ── G-FIX — MULTI-PEER ROLLBACK: a local turn kept getting rolled back by a third-party player on the fight. A
// PEER's committed turn reaches this client as a wholesale Fight OBJECT; foreign_replay DEFERS the adopt behind a
// paced replay, and when that replay drains the deferred re-drive adopts wholesale. The bug: that wholesale adopt
// PURGED my still-un-flushed optimistic intents (they predict a version I have NOT committed — the peer bumped the
// object, not me), snapping my drafted turn back. The fix re-anchors my intents over the adopted foreign base and
// re-derives the overlay (base + intents), idempotent by construction (absolute post-state folds).
const PEER = '0xc2'
const P_HOME = enc(5, 3)
const FIGHT_COOP = {
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
      ap: 9,
      mp: 4,
      base_ap: 9,
      base_mp: 4,
      hp: 50,
      max_hp: 50,
      cell: HOME,
    },
    {
      owner: '0xbbb',
      character: PEER,
      class: 'senshi',
      team: 0,
      ap: 6,
      mp: 3,
      base_ap: 6,
      base_mp: 3,
      hp: 50,
      max_hp: 50,
      cell: P_HOME,
    },
  ],
  mobs: [{ template: '0xabc', hp: 30, max_hp: 30, cell: enc(15, 15), ap: 4, mp: 3, level: 1 }],
  queue: [
    { is_mob: false, idx: 0 },
    { is_mob: false, idx: 1 },
    { is_mob: true, idx: 0 },
  ],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
}
const boot_coop = () => {
  const store = create_fight_store()
  store
    .getState()
    .input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: W } } })
  store.getState().input({ type: 'snapshot', fight: FIGHT_COOP, version: 5 }, 1_000)
  return store
}
const drain = (store, now) => {
  for (const t of [...store.getState().wave]) store.getState().input({ type: 'presented', seq: t.seq }, now)
}
// the peer walked P_HOME → P_MOVED — a genuinely-newer FOREIGN object read (no events; the poll saw only the result)
const P_MOVED = enc(9, 6)
const peer_moved = {
  ...FIGHT_COOP,
  participants: [FIGHT_COOP.participants[0], { ...FIGHT_COOP.participants[1], cell: P_MOVED }],
}

describe('LEG G-FIX — a foreign adoption must not roll back my un-flushed optimistic turn', () => {
  test('① a peer turn adopted mid-my-draft keeps my optimistic teleport (red today: purged → snapped HOME)', () => {
    const store = boot_coop()
    teleport(store) // I optimistically teleport HOME → DEST (un-flushed; no receipt yet)
    expect(me(store).cell, 'my prediction paints the landing this frame').toEqual(at(DEST))
    // the peer's committed move arrives as a wholesale read → foreign_replay DEFERS the adopt behind the replay
    store.getState().input({ type: 'snapshot', fight: peer_moved, version: 6 }, 1_200)
    expect(store.getState().wave.length, 'the peer move paces a foreign replay wave').toBeGreaterThan(0)
    expect(store.getState().view_version, 'the wholesale adopt is deferred behind the replay').toBe(5)
    expect(me(store).cell, 'my teleport still holds while the peer replay drains').toEqual(at(DEST))
    // drain the replay → the deferred wholesale read adopts (this is where the old code purged my intent)
    drain(store, 1_300)
    expect(store.getState().view_version, 'the foreign base adopted').toBe(6)
    expect(me(store).cell, 'my un-flushed teleport SURVIVES the foreign adoption (re-anchored over the base)').toEqual(
      at(DEST)
    )
  })

  test('② own-poll race: my own committed action reflected in the adopted base does NOT double-apply', () => {
    const store = boot_coop()
    // I optimistically move HOME → MID (mp 4→3) and cast the mob (hp 30 → 18) — an un-purged draft.
    const MID = enc(6, 4)
    store.getState().input(
      {
        type: 'intent',
        intent: { kind: 'move', character: CHAR, to_cell: MID, mp_left: 3 },
        version: 6,
        event_idx: 0,
      },
      1_100
    )
    store.getState().input(
      {
        type: 'intent',
        intent: { kind: 'Hit', victim_is_mob: true, victim_idx: 0, remaining_hp: 18 },
        version: 6,
        event_idx: 1,
      },
      1_100
    )
    // the poll reflects MY OWN committed action (me at MID mp 3, mob 18) — a genuinely-newer read. The mob HP drop
    // trips foreign_replay (a diff can't tell my cast from a peer's), so this rides the SAME rebase path as ①.
    const own_poll = {
      ...FIGHT_COOP,
      participants: [{ ...FIGHT_COOP.participants[0], cell: MID, mp: 3 }, FIGHT_COOP.participants[1]],
      mobs: [{ ...FIGHT_COOP.mobs[0], hp: 18 }],
    }
    store.getState().input({ type: 'snapshot', fight: own_poll, version: 6 }, 1_200)
    drain(store, 1_300)
    const me_now = me(store)
    const mob_now = engine_view(store.getState()).fighters.get('mob-0')
    // EXACT values — re-deriving my intents over a base that already reflects them is a NO-OP (absolute folds),
    // never a double: the mob is 18 (not 6), my MP is 3 (not 2), my cell is MID (not double-stepped).
    expect(mob_now.committed_health, 'mob HP is exact — no double-subtract').toBe(18)
    expect(me_now.mp, 'my MP is exact — no double-spend').toBe(3)
    expect(me_now.cell, 'my cell is exact — no double-step').toEqual(at(MID))
  })
})
