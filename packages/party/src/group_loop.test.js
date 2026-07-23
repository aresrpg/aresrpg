// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Red-first units for the GROUP LOOP reducer (D769b design note, MULTICHAR lane): per input kind, the
// emit-once request latches, the teleport-if-stuck pure rule, and the owned/world/seat eligibility fences.
// Fixtures reuse the REAL party member shape ({ character, owner, order }) and chain ids.
import { expect, test } from 'bun:test'

import {
  reduce_group,
  empty_group_state,
  follow_formation_target,
  should_snap_to_leader,
  stuck_too_long,
  FOLLOW_SNAP_DISTANCE,
  FOLLOW_STUCK_MS,
  MAX_OWNED_FOLLOWERS,
} from './group_loop.js'

const ME = '0xwallet'
const LEADER = '0xleader'
const ALT_1 = '0xalt1'
const ALT_2 = '0xalt2'
const STRANGER = '0xstranger'
const WORLD = '0xworld_a'
const OTHER_WORLD = '0xworld_b'
const NOW = 5_000_000

const members = (...ids) => ids.map((character, order) => ({ character, owner: ME, order }))

/** Fold a list of inputs; return the last { state, outputs }. */
const fold = (inputs, state = empty_group_state()) =>
  inputs.reduce((acc, input) => reduce_group(acc.state, input), { state, outputs: null })

const grouped = (
  world_rows = [
    [LEADER, WORLD],
    [ALT_1, WORLD],
    [ALT_2, WORLD],
  ]
) =>
  fold([
    { kind: 'group', my_address: ME, leader_character_id: LEADER, members: members(LEADER, ALT_1, ALT_2) },
    ...world_rows.map(([character_id, world_id]) => ({ kind: 'member_world_state', character_id, world_id })),
  ]).state

/** #540 — fight_started/dungeon_entered only steer aligned alts once the player has explicitly consented
 *  (follow.enabled); arm it the same way the future auto-follow UI will (enable_group_follow → follow_enable). */
const armed = (state = grouped(), follower_character_ids = [ALT_1, ALT_2]) =>
  reduce_group(state, { kind: 'follow_enable', leader_character_id: LEADER, follower_character_ids, now: NOW }).state

// ── membership + world alignment ──────────────────────────────────────────────────────────────────────────────────
test('group fold mirrors membership; nothing is requested while worlds are unknown', () => {
  const { state, outputs } = fold([
    { kind: 'group', my_address: ME, leader_character_id: LEADER, members: members(LEADER, ALT_1) },
  ])
  expect(state.members.map((m) => m.character)).toEqual([LEADER, ALT_1])
  expect(outputs.join_world).toEqual([])
  expect(outputs.follow_move).toEqual([])
})

test('world divergence alone never enables follow or emits a join', () => {
  const base = fold([
    { kind: 'group', my_address: ME, leader_character_id: LEADER, members: members(LEADER, ALT_1) },
    { kind: 'member_world_state', character_id: LEADER, world_id: WORLD },
  ])
  const first = reduce_group(base.state, { kind: 'member_world_state', character_id: ALT_1, world_id: OTHER_WORLD })
  expect(first.outputs.join_world).toEqual([])
  expect(first.state.follow.enabled).toBe(false)
})

test('an explicitly followed leader world change re-arms join_world for included followers only', () => {
  const positioned = reduce_group(grouped(), { kind: 'leader_position', x: 0, z: 0, yaw: 0, now: NOW }).state
  const { state } = reduce_group(positioned, {
    kind: 'follow_enable',
    leader_character_id: LEADER,
    follower_character_ids: [ALT_1, ALT_2],
    now: NOW,
  })
  const { outputs } = reduce_group(state, {
    kind: 'member_world_state',
    character_id: LEADER,
    world_id: OTHER_WORLD,
    now: NOW,
  })
  expect(outputs.join_world.map((r) => r.character_id).sort()).toEqual([ALT_1, ALT_2].sort())
  expect(outputs.join_world.every((r) => r.world_id === OTHER_WORLD)).toBe(true)
})

test('non-owned members and the leader never receive a join_world request', () => {
  const { outputs } = fold([
    {
      kind: 'group',
      my_address: ME,
      leader_character_id: LEADER,
      members: [...members(LEADER), { character: STRANGER, owner: '0xother', order: 1 }],
    },
    { kind: 'member_world_state', character_id: LEADER, world_id: WORLD },
    { kind: 'member_world_state', character_id: STRANGER, world_id: OTHER_WORLD },
  ])
  expect(outputs.join_world).toEqual([])
})

test('member_blocked(world_join) latches a member out of world requests (executed-failure law)', () => {
  const base = fold([
    { kind: 'group', my_address: ME, leader_character_id: LEADER, members: members(LEADER, ALT_1) },
    { kind: 'member_world_state', character_id: LEADER, world_id: WORLD },
    { kind: 'member_world_state', character_id: ALT_1, world_id: OTHER_WORLD },
    { kind: 'member_blocked', character_id: ALT_1, scope: 'world_join' },
  ])
  // a leader world change would normally re-arm — the blocked latch must hold
  const { outputs } = reduce_group(base.state, {
    kind: 'member_world_state',
    character_id: LEADER,
    world_id: OTHER_WORLD,
  })
  expect(outputs.join_world).toEqual([])
})

test('invite_accepted appends a distinct member but never activates follow implicitly', () => {
  const base = fold([
    { kind: 'group', my_address: ME, leader_character_id: LEADER, members: members(LEADER) },
    { kind: 'member_world_state', character_id: LEADER, world_id: WORLD },
    { kind: 'member_world_state', character_id: ALT_1, world_id: OTHER_WORLD },
  ])
  const { state, outputs } = reduce_group(base.state, { kind: 'invite_accepted', character_id: ALT_1, owner: ME })
  expect(state.members.map((m) => m.character)).toEqual([LEADER, ALT_1])
  expect(outputs.join_world).toEqual([])
  expect(state.follow.enabled).toBe(false)
  // idempotent — accepting twice neither duplicates nor requests
  const again = reduce_group(state, { kind: 'invite_accepted', character_id: ALT_1, owner: ME })
  expect(again.state.members.length).toBe(2)
  expect(again.outputs.join_world).toEqual([])
})

// ── explicit follow bounds ───────────────────────────────────────────────────────────────────────────────────────
test('explicit follower inclusion caps at the five formation slots in chain order', () => {
  const ids = ['0xa', '0xb', '0xc', '0xd', '0xe', '0xf']
  const { state: grouped_many } = fold([
    { kind: 'group', my_address: ME, leader_character_id: LEADER, members: members(LEADER, ...ids) },
    { kind: 'member_world_state', character_id: LEADER, world_id: WORLD },
    ...ids.map((character_id) => ({ kind: 'member_world_state', character_id, world_id: WORLD })),
  ])
  const { state, outputs } = reduce_group(grouped_many, {
    kind: 'follow_enable',
    leader_character_id: LEADER,
    follower_character_ids: ids.slice(0, MAX_OWNED_FOLLOWERS),
    now: NOW,
  })
  expect(outputs.join_world).toHaveLength(MAX_OWNED_FOLLOWERS)
  expect(state.follow.follower_character_ids).toEqual(ids.slice(0, MAX_OWNED_FOLLOWERS))
})

// ── per-character follow toggle (#496/#171) ───────────────────────────────────────────────────────────────────────
const positioned = () => reduce_group(grouped(), { kind: 'leader_position', x: 0, z: 0, yaw: 0, now: NOW }).state

test('set_follow arms ONE owned alt behind the current leader and emits only its world join', () => {
  const { state, outputs } = reduce_group(positioned(), {
    kind: 'set_follow',
    character_id: ALT_1,
    enabled: true,
    leader_character_id: LEADER,
    now: NOW,
  })
  expect(state.follow).toMatchObject({ enabled: true, leader_character_id: LEADER, follower_character_ids: [ALT_1] })
  expect(state.follow.followers[ALT_1].status).toBe('joining')
  expect(outputs.join_world).toEqual([{ character_id: ALT_1, world_id: WORLD }])
  // a second row toggles on independently, keeping the captured leader (no leader_character_id passed)
  const two = reduce_group(state, { kind: 'set_follow', character_id: ALT_2, enabled: true, now: NOW })
  expect(two.state.follow.follower_character_ids).toEqual([ALT_1, ALT_2])
  expect(two.outputs.join_world).toEqual([{ character_id: ALT_2, world_id: WORLD }])
})

test('set_follow OFF drops one follower, clears its transit row, and the rest keep following', () => {
  const armed_two = reduce_group(positioned(), {
    kind: 'follow_enable',
    leader_character_id: LEADER,
    follower_character_ids: [ALT_1, ALT_2],
    now: NOW,
  }).state
  const { state } = reduce_group(armed_two, { kind: 'set_follow', character_id: ALT_1, enabled: false })
  expect(state.follow.enabled).toBe(true)
  expect(state.follow.follower_character_ids).toEqual([ALT_2])
  expect(state.follow.followers[ALT_1]).toBeUndefined()
  expect(state.follow.followers[ALT_2]).toBeDefined()
})

test('set_follow OFF for the LAST follower disarms the whole system (enabled false, leader released)', () => {
  const armed_one = reduce_group(positioned(), {
    kind: 'set_follow',
    character_id: ALT_1,
    enabled: true,
    leader_character_id: LEADER,
    now: NOW,
  }).state
  const { state } = reduce_group(armed_one, { kind: 'set_follow', character_id: ALT_1, enabled: false })
  expect(state.follow.enabled).toBe(false)
  expect(state.follow.leader_character_id).toBe(null)
  expect(state.follow.follower_character_ids).toEqual([])
  expect(state.follow.followers).toEqual({})
})

test('set_follow is idempotent — re-arming a follower or disarming a non-follower changes nothing', () => {
  const armed_one = reduce_group(positioned(), {
    kind: 'set_follow',
    character_id: ALT_1,
    enabled: true,
    leader_character_id: LEADER,
    now: NOW,
  }).state
  const again = reduce_group(armed_one, { kind: 'set_follow', character_id: ALT_1, enabled: true, now: NOW })
  expect(again.state).toBe(armed_one)
  expect(again.outputs.join_world).toEqual([])
  const inert = reduce_group(armed_one, { kind: 'set_follow', character_id: ALT_2, enabled: false })
  expect(inert.state).toBe(armed_one)
})

// ── fight join + HUD focus ────────────────────────────────────────────────────────────────────────────────────────
// #540 — MEMBERSHIP IS NOT CONSENT: an aligned alt used to auto-attempt every fight the active character
// engaged (never completes its join, the fight never starts, refresh doesn't re-adopt — a full multi-char
// block). RED (pre-fix): this fired join_fight for ALT_1/ALT_2 with follow never explicitly enabled.
test('fight_started emits NOTHING for aligned alts while follow is not enabled (#540)', () => {
  const state = grouped()
  expect(state.follow.enabled).toBe(false)
  const { outputs } = reduce_group(state, { kind: 'fight_started', fight_id: '0xfight', seated: [LEADER] })
  expect(outputs.join_fight).toEqual([])
})

test('dungeon_entered emits NOTHING for owned alts while follow is not enabled (#540)', () => {
  const state = grouped()
  const assignments = [{ character_id: ALT_1, key_item_id: '0xk1', key_kiosk_id: '0xkk1', key_kiosk_cap_id: '0xkc1' }]
  const { outputs } = reduce_group(state, { kind: 'dungeon_entered', world_id: WORLD, assignments })
  expect(outputs.enter_dungeon).toEqual([])
})

test('fight_started emits join_fight ONCE per aligned unseated owned member once follow is armed; seats/latches dedupe', () => {
  const state = armed()
  const first = reduce_group(state, { kind: 'fight_started', fight_id: '0xfight', seated: [LEADER] })
  expect(first.outputs.join_fight.map((r) => r.character_id).sort()).toEqual([ALT_1, ALT_2].sort())
  expect(first.outputs.join_fight.every((r) => r.fight_id === '0xfight')).toBe(true)
  // the same fight re-announced (poll refresh) re-emits NOTHING
  const again = reduce_group(first.state, { kind: 'fight_started', fight_id: '0xfight', seated: [LEADER] })
  expect(again.outputs.join_fight).toEqual([])
  // a seat landing reconciles; a NEW fight re-arms
  const seated = reduce_group(again.state, { kind: 'fight_seat_update', seated: [LEADER, ALT_1] })
  expect(seated.state.fight.seated).toContain(ALT_1)
  const fresh = reduce_group(seated.state, { kind: 'fight_started', fight_id: '0xnext', seated: [LEADER] })
  expect(fresh.outputs.join_fight.map((r) => r.character_id).sort()).toEqual([ALT_1, ALT_2].sort())
})

test('#495 — fight_started joins ONLY armed followers, never an aligned-but-unfollowing party alt', () => {
  // ALT_1 and ALT_2 are both owned and standing in the leader's world, but only ALT_1 toggled follow ON.
  const armed_one = reduce_group(positioned(), {
    kind: 'set_follow',
    character_id: ALT_1,
    enabled: true,
    leader_character_id: LEADER,
    now: NOW,
  }).state
  const { outputs } = reduce_group(armed_one, { kind: 'fight_started', fight_id: '0xfight', seated: [LEADER] })
  expect(outputs.join_fight.map((r) => r.character_id)).toEqual([ALT_1])
})

test('fight_started with join_open:false arms focus/seats but emits NO join (closed chain window)', () => {
  const state = armed()
  const { state: next, outputs } = reduce_group(state, {
    kind: 'fight_started',
    fight_id: '0xfight',
    seated: [LEADER],
    join_open: false,
  })
  expect(outputs.join_fight).toEqual([])
  expect(next.fight.fight_id).toBe('0xfight')
  // focus still works on the armed fight
  expect(reduce_group(next, { kind: 'turn_started', character_id: ALT_1 }).outputs.hud_focus).toBe(ALT_1)
  // the window re-opening on the SAME fight (placement poll) emits the joiners exactly once
  const opened = reduce_group(next, { kind: 'fight_started', fight_id: '0xfight', seated: [LEADER], join_open: true })
  expect(opened.outputs.join_fight.map((r) => r.character_id).sort()).toEqual([ALT_1, ALT_2].sort())
})

test('an out-of-world or blocked member never receives join_fight', () => {
  const base = armed(
    grouped([
      [LEADER, WORLD],
      [ALT_1, WORLD],
      [ALT_2, OTHER_WORLD],
    ])
  )
  const { state } = reduce_group(base, { kind: 'member_blocked', character_id: ALT_1, scope: 'fight_join' })
  const { outputs } = reduce_group(state, { kind: 'fight_started', fight_id: '0xfight', seated: [LEADER] })
  expect(outputs.join_fight).toEqual([])
})

test('turn_started focuses OWNED seats only, once per change, and only while a fight is live', () => {
  const state = grouped()
  // no fight → no focus
  expect(reduce_group(state, { kind: 'turn_started', character_id: ALT_1 }).outputs.hud_focus).toBe(null)
  const fight = reduce_group(state, { kind: 'fight_started', fight_id: '0xfight', seated: [LEADER, ALT_1, ALT_2] })
  const alt_turn = reduce_group(fight.state, { kind: 'turn_started', character_id: ALT_1 })
  expect(alt_turn.outputs.hud_focus).toBe(ALT_1)
  // same seat again (poll echo) → silent; a mob/non-owned turn → silent, focus retained
  expect(reduce_group(alt_turn.state, { kind: 'turn_started', character_id: ALT_1 }).outputs.hud_focus).toBe(null)
  const mob_turn = reduce_group(alt_turn.state, { kind: 'turn_started', character_id: 'mob-0' })
  expect(mob_turn.outputs.hud_focus).toBe(null)
  expect(mob_turn.state.focus_character_id).toBe(ALT_1)
  // back to the leader's turn → refocus the leader
  expect(reduce_group(mob_turn.state, { kind: 'turn_started', character_id: LEADER }).outputs.hud_focus).toBe(LEADER)
  // fight_ended clears
  const ended = reduce_group(mob_turn.state, { kind: 'fight_ended' })
  expect(ended.state.fight).toBe(null)
  expect(ended.state.focus_character_id).toBe(null)
})

// ── dungeon sequencing ────────────────────────────────────────────────────────────────────────────────────────────
test('dungeon_entered sequences enter_dungeon once per owned member with an assignment (leader excluded)', () => {
  const state = armed()
  const assignments = [
    { character_id: LEADER, key_item_id: '0xk0', key_kiosk_id: '0xkk0', key_kiosk_cap_id: '0xkc0' },
    { character_id: ALT_1, key_item_id: '0xk1', key_kiosk_id: '0xkk1', key_kiosk_cap_id: '0xkc1' },
    { character_id: ALT_2, key_item_id: '0xk2', key_kiosk_id: '0xkk2', key_kiosk_cap_id: '0xkc2' },
  ]
  const { state: next, outputs } = reduce_group(state, { kind: 'dungeon_entered', world_id: WORLD, assignments })
  expect(outputs.enter_dungeon.map((r) => r.character_id)).toEqual([ALT_1, ALT_2])
  expect(outputs.enter_dungeon[0].key_item_id).toBe('0xk1')
  // replay (poll echo) emits nothing; dungeon_ended clears
  expect(reduce_group(next, { kind: 'dungeon_entered', world_id: WORLD, assignments }).outputs.enter_dungeon).toEqual(
    []
  )
  expect(reduce_group(next, { kind: 'dungeon_ended' }).state.dungeon).toBe(null)
})

test('#495 — dungeon_entered enters ONLY armed followers, skipping an unfollowing alt that holds a key', () => {
  const armed_one = reduce_group(positioned(), {
    kind: 'set_follow',
    character_id: ALT_1,
    enabled: true,
    leader_character_id: LEADER,
    now: NOW,
  }).state
  const assignments = [
    { character_id: ALT_1, key_item_id: '0xk1', key_kiosk_id: '0xkk1', key_kiosk_cap_id: '0xkc1' },
    { character_id: ALT_2, key_item_id: '0xk2', key_kiosk_id: '0xkk2', key_kiosk_cap_id: '0xkc2' },
  ]
  const { outputs } = reduce_group(armed_one, { kind: 'dungeon_entered', world_id: WORLD, assignments })
  expect(outputs.enter_dungeon.map((r) => r.character_id)).toEqual([ALT_1])
})

// ── pure rule parity (migrated from frontend owned_follow.test.js) ───────────────────────────────────────────────
test('formation slots stay 3–6 blocks behind the leader along its yaw convention', () => {
  for (let slot = 0; slot < MAX_OWNED_FOLLOWERS; slot += 1) {
    const target = follow_formation_target({ x: 0, z: 0 }, 0, slot)
    const distance = Math.hypot(target.x, target.z)
    expect(distance).toBeGreaterThanOrEqual(3)
    expect(distance).toBeLessThanOrEqual(7)
  }
  expect(follow_formation_target({ x: 0, z: 0 }, 0, 99)).toBe(null)
})

test('should_snap_to_leader/stuck_too_long keep their strict-threshold contracts', () => {
  expect(should_snap_to_leader({ x: 0, z: 0 }, { x: FOLLOW_SNAP_DISTANCE, z: 0 })).toBe(false)
  expect(should_snap_to_leader({ x: 0, z: 0 }, { x: FOLLOW_SNAP_DISTANCE + 1, z: 0 })).toBe(true)
  expect(stuck_too_long(NOW, NOW + FOLLOW_STUCK_MS)).toBe(false)
  expect(stuck_too_long(NOW, NOW + FOLLOW_STUCK_MS + 1)).toBe(true)
  expect(stuck_too_long(undefined, NOW)).toBe(false)
})

test('reset returns to the empty state while preserving injected config thresholds', () => {
  const custom = empty_group_state({ snap_distance: 12, stuck_ms: 500 })
  const busy = fold(
    [
      { kind: 'group', my_address: ME, leader_character_id: LEADER, members: members(LEADER, ALT_1) },
      { kind: 'fight_started', fight_id: '0xf', seated: [] },
    ],
    custom
  )
  const { state } = reduce_group(busy.state, { kind: 'reset' })
  expect(state.members).toEqual([])
  expect(state.fight).toBe(null)
  expect(state.config.snap_distance).toBe(12)
  expect(state.config.stuck_ms).toBe(500)
})
