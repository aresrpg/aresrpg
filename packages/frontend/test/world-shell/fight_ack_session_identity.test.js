// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1724 — THE TURN-ACK CARRIES ITS ENQUEUE-TIME SESSION IDENTITY.
//
// `drain_wave` enqueues a turn and produces TWO kinds of input from it: the per-beat `trap_triggered` acks
// (stamped with the session_generation captured at enqueue) and the turn ack (`presented`). Both types are
// IDENTITY_SCOPED at the store door — `refuse_reason` drops either one whose stamped generation no longer
// matches the core's. But the ack was emitted UNSTAMPED, so the two halves of one enqueued turn crossed the
// same gate under different rules: a session bump between enqueue and playback refused every trigger while
// the ack sailed through, and `present_turn_traps` — the turn-level fallback that presents a whole turn's
// trap_trigger beats at once — flipped every marker to `presented` in a single input. Markers that should
// have died one per boom vanished together at the turn ack: "all traps vanish at turn start".
//
// The fix is emitter-side and one line of provenance: the ack rides the same identity its beats did, so a
// superseded wave is refused as a UNIT. `fight_id` is deliberately NOT stamped — a re-key (#1609) moves the
// id while this very wave survives by design, and gating the ack on it would strand the wave undrained.

import { describe, expect, test } from 'bun:test'
import { create_fight_store } from '@aresrpg/fight/store'
import { engine_view } from '@aresrpg/fight/project'

const FIGHT = '0xf1'
const CHAR = '0xc1'
const W = 20
const enc = (x, y) => y * W + x
const A = enc(9, 5) // two traps on the mob's approach lane — it crosses both in one collapsed walk
const B = enc(8, 5)

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
      mp: 3,
      base_ap: 9,
      base_mp: 3,
      hp: 50,
      max_hp: 50,
      cell: enc(5, 5),
    },
  ],
  mobs: [{ template: '0xabc', hp: 200, max_hp: 200, cell: enc(11, 5), ap: 4, mp: 4, level: 1 }],
  queue: [{ is_mob: false, idx: 0 }],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
  turn_entropy: 90_000,
  turn_ordinal: 1,
}

/** A fight with two armed traps and a mob walk that has just crossed both — markers still painted, awaiting
 *  their per-beat booms. This is the exact state `drain_wave` holds between enqueue and playback. */
const mid_wave = () => {
  const store = create_fight_store()
  store
    .getState()
    .input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: W } } })
  store.getState().input(
    {
      type: 'snapshot',
      fight: FIGHT_OBJECT,
      version: 5,
      ctx: {
        chain_traps: [
          { anchor: A, owner_team: 0, cells: [A] },
          { anchor: B, owner_team: 0, cells: [B] },
        ],
        chain_traps_version: 5,
      },
    },
    1_000
  )
  store
    .getState()
    .input(
      { type: 'receipt', version: 7, receipt: { events: [ev('MobMoved', { idx: 0, to_cell: enc(7, 5) })] } },
      1_200
    )
  return store
}

const prims = (store) => engine_view(store.getState()).trap_prims

describe('#1724 — a superseded wave is refused as a unit, never dumped', () => {
  test('the adapter stamps its turn ack with the enqueue-time session_generation', async () => {
    const source = await Bun.file(new URL('../../src/world-shell/voxel_fight_adapter.js', import.meta.url)).text()
    // ONE ack object, built beside the beats from the same captured generation, used by BOTH emit sites
    // (the playback-settle `.finally` and the no-queue local path).
    expect(source).toMatch(/const ack = \{ type: 'presented', seq: turn\.seq, session_generation \}/)
    expect(source).toMatch(
      /for \(const id of claimed\) replay_owned\.delete\(id\)\s*\n\s*fight_store\.getState\(\)\.input\(ack\)/
    )
    expect(source).toMatch(/if \(played == null && turn\.is_local\) fight_store\.getState\(\)\.input\(ack\)/)
    // and no unstamped ack survives anywhere in the drain loop
    expect(source.includes("input({ type: 'presented', seq: turn.seq })")).toBe(false)
  })

  test('both markers survive the boom window while their triggers are still owed', () => {
    const store = mid_wave()
    const triggers = store.getState().wave.flatMap((t) => t.beats.filter((b) => b.kind === 'trap_trigger'))
    expect(triggers.length).toBe(2)
    expect(prims(store)).toEqual([A, B])
  })

  test('a STALE-generation ack is refused — the markers do not dump', () => {
    const store = mid_wave()
    const stale = store.getState().core.session_generation + 1
    // The refusal the per-beat triggers already suffer, now shared by the ack that outlived their session.
    for (const turn of store.getState().wave)
      store.getState().input({ type: 'presented', seq: turn.seq, session_generation: stale }, 1_300)

    expect(store.getState().refused).toMatchObject({ type: 'presented', reason: 'session_generation' })
    expect(prims(store)).toEqual([A, B])
  })

  // THE HAPPY PATH, which the stamp must not break: a CURRENT wave acks and presents exactly as before.
  test('a current-generation ack still lands and presents the whole turn', () => {
    const store = mid_wave()
    const { session_generation } = store.getState().core
    for (const turn of store.getState().wave)
      store.getState().input({ type: 'presented', seq: turn.seq, session_generation }, 1_300)

    expect(prims(store)).toEqual([])
    expect(store.getState().my_traps.every((trap) => trap.gone && trap.presented)).toBe(true)
  })
})
