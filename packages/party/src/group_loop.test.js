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

// ── membership + world alignment ──────────────────────────────────────────────────────────────────────────────────
test('group fold mirrors membership; nothing is requested while worlds are unknown', () => {
  const { state, outputs } = fold([
    { kind: 'group', my_address: ME, leader_character_id: LEADER, members: members(LEADER, ALT_1) },
  ])
  expect(state.members.map((m) => m.character)).toEqual([LEADER, ALT_1])
  expect(outputs.join_world).toEqual([])
  expect(outputs.follow_move).toEqual([])
})

test('a member in another world gets ONE join_world request toward the leader world, latched until confirmed', () => {
  const base = fold([
    { kind: 'group', my_address: ME, leader_character_id: LEADER, members: members(LEADER, ALT_1) },
    { kind: 'member_world_state', character_id: LEADER, world_id: WORLD },
  ])
  const first = reduce_group(base.state, { kind: 'member_world_state', character_id: ALT_1, world_id: OTHER_WORLD })
  expect(first.outputs.join_world).toEqual([{ character_id: ALT_1, world_id: WORLD }])
  // the same divergence folded again re-emits NOTHING (request latch)
  const again = reduce_group(first.state, { kind: 'member_world_state', character_id: ALT_1, world_id: OTHER_WORLD })
  expect(again.outputs.join_world).toEqual([])
  // confirmation drains the latch
  const confirmed = reduce_group(again.state, { kind: 'member_world_state', character_id: ALT_1, world_id: WORLD })
  expect(confirmed.outputs.join_world).toEqual([])
  expect(confirmed.state.requested_world_joins[ALT_1]).toBeUndefined()
})

test('a LEADER world change re-arms join_world for every aligned member — the group follows a travel', () => {
  const state = grouped()
  const { outputs } = reduce_group(state, { kind: 'member_world_state', character_id: LEADER, world_id: OTHER_WORLD })
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

test('invite_accepted appends a distinct member and immediately checks world alignment', () => {
  const base = fold([
    { kind: 'group', my_address: ME, leader_character_id: LEADER, members: members(LEADER) },
    { kind: 'member_world_state', character_id: LEADER, world_id: WORLD },
    { kind: 'member_world_state', character_id: ALT_1, world_id: OTHER_WORLD },
  ])
  const { state, outputs } = reduce_group(base.state, { kind: 'invite_accepted', character_id: ALT_1, owner: ME })
  expect(state.members.map((m) => m.character)).toEqual([LEADER, ALT_1])
  expect(outputs.join_world).toEqual([{ character_id: ALT_1, world_id: WORLD }])
  // idempotent — accepting twice neither duplicates nor re-requests
  const again = reduce_group(state, { kind: 'invite_accepted', character_id: ALT_1, owner: ME })
  expect(again.state.members.length).toBe(2)
  expect(again.outputs.join_world).toEqual([])
})

// ── follow (formation + teleport-if-stuck) ────────────────────────────────────────────────────────────────────────
test('leader_position emits one follow_move per aligned owned follower on its stable formation slot', () => {
  const state = grouped()
  const pose = { kind: 'leader_position', x: 100, z: 50, yaw: 0, now: NOW }
  const { outputs } = reduce_group(state, pose)
  expect(outputs.follow_move.map((r) => r.character_id)).toEqual([ALT_1, ALT_2])
  const expected_0 = follow_formation_target({ x: 100, z: 50 }, 0, 0)
  expect(outputs.follow_move[0].x).toBeCloseTo(expected_0.x)
  expect(outputs.follow_move[0].z).toBeCloseTo(expected_0.z)
  expect(outputs.follow_move[0].yaw).toBe(0)
  expect(outputs.follow_move.every((r) => r.teleport === false)).toBe(true)
})

test('an out-of-world member is excluded from follow until its world aligns', () => {
  const state = grouped([
    [LEADER, WORLD],
    [ALT_1, WORLD],
    [ALT_2, OTHER_WORLD],
  ])
  const { outputs } = reduce_group(state, { kind: 'leader_position', x: 0, z: 0, yaw: 0, now: NOW })
  expect(outputs.follow_move.map((r) => r.character_id)).toEqual([ALT_1])
})

test('teleport fires when the tracked rendered position falls beyond the snap distance from the leader', () => {
  const state = grouped()
  const far = FOLLOW_SNAP_DISTANCE + 5
  const tracked = reduce_group(state, {
    kind: 'member_position',
    positions: [{ character_id: ALT_1, x: far, z: 0 }],
    now: NOW,
  })
  const { state: next, outputs } = reduce_group(tracked.state, {
    kind: 'leader_position',
    x: 0,
    z: 0,
    yaw: 0,
    now: NOW + 100,
  })
  const row = outputs.follow_move.find((r) => r.character_id === ALT_1)
  expect(row.teleport).toBe(true)
  // the snap resets the track — the NEXT tick must not teleport again
  const after = reduce_group(next, { kind: 'leader_position', x: 0, z: 0, yaw: 0, now: NOW + 200 })
  expect(after.outputs.follow_move.find((r) => r.character_id === ALT_1).teleport).toBe(false)
})

test('teleport fires when a follower makes no progress toward its slot past the staleness threshold', () => {
  const state = grouped()
  const stuck_at = { character_id: ALT_1, x: 10, z: 10 } // off-slot but inside the snap radius
  const t0 = fold(
    [
      { kind: 'leader_position', x: 0, z: 0, yaw: 0, now: NOW },
      { kind: 'member_position', positions: [stuck_at], now: NOW },
      { kind: 'member_position', positions: [stuck_at], now: NOW + FOLLOW_STUCK_MS + 1 },
    ],
    state
  )
  const { outputs } = reduce_group(t0.state, {
    kind: 'leader_position',
    x: 0,
    z: 0,
    yaw: 0,
    now: NOW + FOLLOW_STUCK_MS + 50,
  })
  expect(outputs.follow_move.find((r) => r.character_id === ALT_1).teleport).toBe(true)
})

test('a follower actually moving keeps its progress fresh — no stuck teleport', () => {
  const state = grouped()
  const t0 = fold(
    [
      { kind: 'leader_position', x: 0, z: 0, yaw: 0, now: NOW },
      { kind: 'member_position', positions: [{ character_id: ALT_1, x: 10, z: 10 }], now: NOW },
      {
        kind: 'member_position',
        positions: [{ character_id: ALT_1, x: 8, z: 8 }],
        now: NOW + FOLLOW_STUCK_MS + 1,
      },
    ],
    state
  )
  const { outputs } = reduce_group(t0.state, {
    kind: 'leader_position',
    x: 0,
    z: 0,
    yaw: 0,
    now: NOW + FOLLOW_STUCK_MS + 50,
  })
  expect(outputs.follow_move.find((r) => r.character_id === ALT_1).teleport).toBe(false)
})

test('follower slots cap at MAX_OWNED_FOLLOWERS in chain group order', () => {
  const ids = ['0xa', '0xb', '0xc', '0xd', '0xe', '0xf']
  const { state } = fold([
    { kind: 'group', my_address: ME, leader_character_id: LEADER, members: members(LEADER, ...ids) },
    { kind: 'member_world_state', character_id: LEADER, world_id: WORLD },
    ...ids.map((character_id) => ({ kind: 'member_world_state', character_id, world_id: WORLD })),
  ])
  const { outputs } = reduce_group(state, { kind: 'leader_position', x: 0, z: 0, yaw: 0, now: NOW })
  expect(outputs.follow_move.length).toBe(MAX_OWNED_FOLLOWERS)
})

// ── fight join + HUD focus ────────────────────────────────────────────────────────────────────────────────────────
test('fight_started emits join_fight ONCE per aligned unseated owned member; seats/latches dedupe', () => {
  const state = grouped()
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

test('fight_started with join_open:false arms focus/seats but emits NO join (closed chain window)', () => {
  const state = grouped()
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
  const { state } = fold(
    [{ kind: 'member_blocked', character_id: ALT_1, scope: 'fight_join' }],
    grouped([
      [LEADER, WORLD],
      [ALT_1, WORLD],
      [ALT_2, OTHER_WORLD],
    ])
  )
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
  const state = grouped()
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
