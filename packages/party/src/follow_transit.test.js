// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #509 red-first contract: explicit, session-scoped follower transit lives inside the ONE group-loop reducer.
import { expect, test } from 'bun:test'

import { empty_group_state, reduce_group, TRANSIT_SPEED, TRANSIT_MIN_MS, TRANSIT_MAX_MS } from './group_loop.js'

const ME = '0xwallet'
const LEADER = '0xleader'
const ALT_1 = '0xalt1'
const ALT_2 = '0xalt2'
const WORLD_A = '0xworld_a'
const WORLD_B = '0xworld_b'
const NOW = 5_000_000

const members = [
  { character: LEADER, owner: ME, order: 0 },
  { character: ALT_1, owner: ME, order: 1 },
  { character: ALT_2, owner: ME, order: 2 },
]

const fold = (state, input) => reduce_group(state, input)
const state_after = (state, input) => {
  const { state: next } = fold(state, input)
  return next
}

const ready = () => {
  let state = empty_group_state()
  state = state_after(state, { kind: 'group', my_address: ME, members })
  state = state_after(state, { kind: 'member_world_state', character_id: LEADER, world_id: WORLD_A, now: NOW })
  state = state_after(state, { kind: 'leader_position', x: 0, z: 0, yaw: 0, now: NOW })
  return state
}

const enable = (state, follower_character_ids = [ALT_1, ALT_2]) =>
  fold(state, {
    kind: 'follow_enable',
    leader_character_id: LEADER,
    follower_character_ids,
    now: NOW,
  })

const joined = (state, character_id, checkpoint, now = NOW) =>
  fold(state, {
    kind: 'follow_world_joined',
    character_id,
    world_id: WORLD_A,
    checkpoint,
    now,
  })

test('explicit enable captures session ids, moves idle followers to joining, and emits sequenced join requests', () => {
  const before = ready()
  expect(before.follow.enabled).toBe(false)

  const { state, outputs } = enable(before)

  expect(state.follow).toMatchObject({
    enabled: true,
    leader_character_id: LEADER,
    follower_character_ids: [ALT_1, ALT_2],
  })
  expect(state.follow.followers[ALT_1].status).toBe('joining')
  expect(state.follow.followers[ALT_2].status).toBe('joining')
  expect(outputs.join_world).toEqual([
    { character_id: ALT_1, world_id: WORLD_A },
    { character_id: ALT_2, world_id: WORLD_A },
  ])
})

test('join receipt starts distance/speed transit with clamp, and ticks decrement ETA through the reducer', () => {
  let { state } = enable(ready(), [ALT_1])
  const distance = TRANSIT_SPEED * 40
  ;({ state } = joined(state, ALT_1, { x: distance, z: 0 }))

  expect(state.follow.followers[ALT_1]).toMatchObject({
    status: 'in_transit',
    total_ms: 40_000,
    remaining_ms: 40_000,
    progress: 0,
  })

  const ticked = fold(state, { kind: 'transit_tick', now: NOW + 12_000 }).state.follow.followers[ALT_1]
  expect(ticked.remaining_ms).toBe(28_000)
  expect(ticked.progress).toBeCloseTo(0.3)

  ;({ state } = enable(ready(), [ALT_1]))
  expect(joined(state, ALT_1, { x: 1, z: 0 }).state.follow.followers[ALT_1].total_ms).toBe(TRANSIT_MIN_MS)
  expect(joined(state, ALT_1, { x: TRANSIT_SPEED * 999, z: 0 }).state.follow.followers[ALT_1].total_ms).toBe(
    TRANSIT_MAX_MS
  )
})

test("expiry dispatches the follower checkpoint write beside the leader's CURRENT avatar cell", () => {
  let { state } = enable(ready(), [ALT_1])
  ;({ state } = joined(state, ALT_1, { x: TRANSIT_SPEED * 10, z: 0 }))
  state = state_after(state, { kind: 'leader_position', x: 50.2, z: 70.8, yaw: 0, now: NOW + 9_000 })

  const { state: arrived, outputs } = fold(state, { kind: 'transit_tick', now: NOW + 10_000 })

  expect(arrived.follow.followers[ALT_1].status).toBe('arrived')
  expect(outputs.write_checkpoint).toEqual([
    {
      character_id: ALT_1,
      world_id: WORLD_A,
      position: { x: 51.5, z: 70.5 },
    },
  ])
})

test('leader world change re-joins and re-anchors ETA with the remaining-progress ratio', () => {
  let { state } = enable(ready(), [ALT_1])
  ;({ state } = joined(state, ALT_1, { x: TRANSIT_SPEED * 100, z: 0 }))
  state = state_after(state, { kind: 'transit_tick', now: NOW + 25_000 })

  const reanchor = fold(state, {
    kind: 'member_world_state',
    character_id: LEADER,
    world_id: WORLD_B,
    now: NOW + 25_000,
  })
  expect(reanchor.outputs.join_world).toEqual([{ character_id: ALT_1, world_id: WORLD_B }])
  expect(reanchor.state.follow.followers[ALT_1]).toMatchObject({ status: 'joining', carry_ratio: 0.75 })

  const resumed = fold(reanchor.state, {
    kind: 'follow_world_joined',
    character_id: ALT_1,
    world_id: WORLD_B,
    checkpoint: { x: TRANSIT_SPEED * 200, z: 0 },
    now: NOW + 25_000,
  }).state.follow.followers[ALT_1]
  expect(resumed.status).toBe('in_transit')
  expect(resumed.total_ms).toBe(150_000)
  expect(resumed.remaining_ms).toBe(150_000)
})

test('dungeon adds the background modifier while reducer ticks keep advancing transit', () => {
  let { state } = enable(ready(), [ALT_1])
  ;({ state } = joined(state, ALT_1, { x: TRANSIT_SPEED * 40, z: 0 }))
  state = state_after(state, { kind: 'dungeon_entered', world_id: WORLD_A, assignments: [] })
  expect(state.follow.dungeon_background).toBe(true)

  state = state_after(state, { kind: 'transit_tick', now: NOW + 10_000 })
  expect(state.follow.followers[ALT_1].remaining_ms).toBe(30_000)
  expect(state.follow.dungeon_background).toBe(true)

  state = state_after(state, { kind: 'dungeon_ended' })
  expect(state.follow.dungeon_background).toBe(false)
})

test('manual active-character selection is structurally inert: follow ids/state survive and no re-selection exists', () => {
  let { state } = enable(ready(), [ALT_1])
  ;({ state } = joined(state, ALT_1, { x: TRANSIT_SPEED * 40, z: 0 }))
  const before = state.follow

  const { state: after, outputs } = fold(state, { kind: 'selection_changed', selected_character_id: ALT_2 })

  expect(after.follow).toBe(before)
  expect(after.follow.leader_character_id).toBe(LEADER)
  expect(after.follow.follower_character_ids).toEqual([ALT_1])
  expect(outputs.select_character).toBeUndefined()
  expect(outputs.hud_focus).toBeNull()
})

test('session reset is the only implicit teardown: follow never survives or activates on a fresh state', () => {
  const active = enable(ready(), [ALT_1]).state
  const reset = fold(active, { kind: 'reset' }).state
  expect(reset.follow.enabled).toBe(false)
  expect(reset.follow.leader_character_id).toBeNull()
  expect(reset.follow.follower_character_ids).toEqual([])
  expect(reset.follow.followers).toEqual({})
})
