// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// GROUP SESSION SCENARIO (MULTICHAR lane, the brief's headless story): ONE human drives a leader + 2 owned
// alts through the whole loop — invite → explicit transit → arrival → the leader engages → members
// auto-join → turn-order HUD focus → victory — as one input sequence against the group store, asserting the
// EFFECT-REQUEST stream (the coop-scenario idiom: plain objects, explicit clocks, zero browser).
import { expect, test } from 'bun:test'

import { create_group_store } from './store.js'
import { TRANSIT_SPEED } from './group_loop.js'

const ME = '0xwallet'
const LEADER = '0xleader'
const ALT_1 = '0xalt1'
const ALT_2 = '0xalt2'
const WORLD = '0xfirst_shore'
const OTHER_WORLD = '0xglacial'
const FIGHT = '0xfight'
const T0 = 9_000_000

test('GROUP SESSION: invite → transit → arrive → engage → auto-join → HUD focus per turn → victory', () => {
  const { store, dispatch } = create_group_store()
  /** @type {string[]} transcript of every effect request, in order */
  const transcript = []
  const record = (outputs) => {
    for (const row of outputs.join_world) transcript.push(`join_world ${row.character_id} -> ${row.world_id}`)
    for (const row of outputs.write_checkpoint) transcript.push(`checkpoint ${row.character_id}`)
    // follow_render is null on frames that didn't recompute it (only pose/transit ticks project positions).
    for (const row of outputs.follow_render ?? []) transcript.push(`follow ${row.character_id}`)
    for (const row of outputs.join_fight) transcript.push(`join_fight ${row.character_id} -> ${row.fight_id}`)
    if (outputs.hud_focus) transcript.push(`hud_focus ${outputs.hud_focus}`)
    for (const row of outputs.enter_dungeon) transcript.push(`enter_dungeon ${row.character_id}`)
    return outputs
  }
  const feed = (input) => record(dispatch(input))

  // ── 1. the leader stands alone in its world; the picker invites two owned alts ─────────────────────────
  feed({
    kind: 'group',
    my_address: ME,
    leader_character_id: LEADER,
    members: [{ character: LEADER, owner: ME, order: 0 }],
  })
  feed({ kind: 'member_world_state', character_id: LEADER, world_id: WORLD })
  feed({ kind: 'invite_accepted', character_id: ALT_1, owner: ME })
  feed({ kind: 'invite_accepted', character_id: ALT_2, owner: ME })

  // ── 2. world facts alone are inert; the explicit enable joins BOTH included alts through one effect lane ─
  feed({ kind: 'member_world_state', character_id: ALT_1, world_id: WORLD })
  feed({ kind: 'member_world_state', character_id: ALT_2, world_id: OTHER_WORLD })
  expect(transcript).toEqual([])
  feed({ kind: 'leader_position', x: 100, z: 100, yaw: 0, now: T0 })
  feed({
    kind: 'follow_enable',
    leader_character_id: LEADER,
    follower_character_ids: [ALT_1, ALT_2],
    now: T0,
  })
  expect(transcript.filter((line) => line.startsWith('join_world'))).toEqual([
    `join_world ${ALT_1} -> ${WORLD}`,
    `join_world ${ALT_2} -> ${WORLD}`,
  ])

  // ── 3. each join receipt begins its own ETA; the timer-derived render emits only on a pose/transit tick ─
  feed({ kind: 'member_world_state', character_id: ALT_2, world_id: WORLD })
  feed({
    kind: 'follow_world_joined',
    character_id: ALT_1,
    world_id: WORLD,
    checkpoint: { x: 100 + TRANSIT_SPEED * 10, z: 100 },
    now: T0,
  })
  feed({
    kind: 'follow_world_joined',
    character_id: ALT_2,
    world_id: WORLD,
    checkpoint: { x: 100 - TRANSIT_SPEED * 10, z: 100 },
    now: T0,
  })
  expect(transcript.filter((line) => line.startsWith('follow'))).toEqual([]) // no render tick since the joins

  // expiry writes each arrival checkpoint; the arrived followers then project onto their slots and render
  feed({ kind: 'leader_position', x: 101, z: 100, yaw: 0, now: T0 + 9_000 })
  feed({ kind: 'transit_tick', now: T0 + 10_000 })
  expect(transcript.filter((line) => line.startsWith('checkpoint'))).toEqual([
    `checkpoint ${ALT_1}`,
    `checkpoint ${ALT_2}`,
  ])
  feed({ kind: 'follow_checkpoint_written', character_id: ALT_1 })
  feed({ kind: 'follow_checkpoint_written', character_id: ALT_2 })
  expect(transcript).toContain(`follow ${ALT_1}`)
  expect(transcript).toContain(`follow ${ALT_2}`)

  // ── 4. the leader engages a mob group: both alts auto-join exactly once ────────────────────────────────
  feed({ kind: 'fight_started', fight_id: FIGHT, seated: [LEADER] })
  expect(transcript).toContain(`join_fight ${ALT_1} -> ${FIGHT}`)
  expect(transcript).toContain(`join_fight ${ALT_2} -> ${FIGHT}`)
  // their join receipts land (escrow reconcile); a poll re-announcing the fight re-emits nothing
  feed({ kind: 'fight_seat_update', seated: [LEADER, ALT_1, ALT_2] })
  feed({ kind: 'fight_started', fight_id: FIGHT, seated: [LEADER, ALT_1, ALT_2] })
  expect(transcript.filter((line) => line.startsWith('join_fight'))).toHaveLength(2)

  // ── 5. turn order drives the HUD: each OWNED turn focuses its seat; mob turns change nothing ───────────
  feed({ kind: 'turn_started', character_id: LEADER })
  feed({ kind: 'turn_started', character_id: 'mob-0' })
  feed({ kind: 'turn_started', character_id: ALT_1 })
  feed({ kind: 'turn_started', character_id: ALT_2 })
  feed({ kind: 'turn_started', character_id: LEADER })
  expect(transcript.filter((line) => line.startsWith('hud_focus'))).toEqual([
    `hud_focus ${LEADER}`,
    `hud_focus ${ALT_1}`,
    `hud_focus ${ALT_2}`,
    `hud_focus ${LEADER}`,
  ])

  // ── 6. victory: the fight clears; arrived positions resume on the very next leader pose tick ───────────
  feed({ kind: 'fight_ended' })
  expect(store.getState().fight).toBe(null)
  expect(store.getState().focus_character_id).toBe(null)
  const resumed = record(dispatch({ kind: 'leader_position', x: 200, z: 200, yaw: 1, now: T0 + 12_000 }))
  expect(resumed.follow_render.map((row) => row.character_id)).toEqual([ALT_1, ALT_2])

  // the full transcript is the replayable proof — keep it deterministic
  expect(transcript.length).toBeGreaterThan(10)
})
