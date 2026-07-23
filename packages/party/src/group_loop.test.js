// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Red-first units for the GROUP LOOP reducer (D769b design note, MULTICHAR lane): per input kind, the
// emit-once request latches, timer-derived follow projection, and the owned/world/seat eligibility fences.
// GROUP MEMBERSHIP IS AUTO-FOLLOW (#613 DESIGN COLLAPSE): the follower set IS the owned group members behind
// the driven leader — no toggle; `follow_reconcile` is the door, a kick is the only disable.
// Fixtures reuse the REAL party member shape ({ character, owner, order }) and chain ids.
import { expect, test } from 'bun:test'

import {
  reduce_group,
  empty_group_state,
  follow_formation_target,
  project_follower_position,
  FOLLOW_VISIBLE_RANGE,
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

const positioned = () => reduce_group(grouped(), { kind: 'leader_position', x: 0, z: 0, yaw: 0, now: NOW }).state

/** Reconcile a grouped state so its owned group members become the follower set (membership IS auto-follow). */
const armed = (state = grouped()) =>
  reduce_group(state, { kind: 'follow_reconcile', leader_character_id: LEADER, now: NOW }).state

/** Group EXACTLY these owned alts (all standing in the leader's WORLD) behind a positioned leader, then
 *  reconcile → they become the follower set. Returns { state, outputs } — the membership arming call. */
const following = (...ids) => {
  let s = reduce_group(empty_group_state(), {
    kind: 'group',
    my_address: ME,
    leader_character_id: LEADER,
    members: members(LEADER, ...ids),
  }).state
  for (const character_id of [LEADER, ...ids])
    s = reduce_group(s, { kind: 'member_world_state', character_id, world_id: WORLD }).state
  s = reduce_group(s, { kind: 'leader_position', x: 0, z: 0, yaw: 0, now: NOW }).state
  return reduce_group(s, { kind: 'follow_reconcile', leader_character_id: LEADER, now: NOW })
}

// ── membership + world alignment ──────────────────────────────────────────────────────────────────────────────────
test('group fold mirrors membership; nothing is requested while worlds are unknown', () => {
  const { state, outputs } = fold([
    { kind: 'group', my_address: ME, leader_character_id: LEADER, members: members(LEADER, ALT_1) },
  ])
  expect(state.members.map((m) => m.character)).toEqual([LEADER, ALT_1])
  expect(outputs.join_world).toEqual([])
  expect(outputs.follow_move).toEqual([])
})

test('membership mirror alone never enables follow or emits a join (reconcile is the door)', () => {
  const base = fold([
    { kind: 'group', my_address: ME, leader_character_id: LEADER, members: members(LEADER, ALT_1) },
    { kind: 'member_world_state', character_id: LEADER, world_id: WORLD },
  ])
  const first = reduce_group(base.state, { kind: 'member_world_state', character_id: ALT_1, world_id: OTHER_WORLD })
  expect(first.outputs.join_world).toEqual([])
  expect(first.state.follow.enabled).toBe(false)
})

test('a followed leader world change re-joins its owned group followers to the new world', () => {
  const { state } = following(ALT_1, ALT_2) // both stand in WORLD (same as leader) → resolving followers
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
  const base = fold([
    {
      kind: 'group',
      my_address: ME,
      leader_character_id: LEADER,
      members: [...members(LEADER), { character: STRANGER, owner: '0xother', order: 1 }],
    },
    { kind: 'member_world_state', character_id: LEADER, world_id: WORLD },
    { kind: 'member_world_state', character_id: STRANGER, world_id: OTHER_WORLD },
  ])
  const { outputs } = reduce_group(base.state, { kind: 'follow_reconcile', leader_character_id: LEADER, now: NOW })
  expect(outputs.join_world).toEqual([]) // STRANGER is not owned → never a follower
})

test('member_blocked(world_join) latches a member out of world requests (executed-failure law)', () => {
  const base = fold([
    { kind: 'group', my_address: ME, leader_character_id: LEADER, members: members(LEADER, ALT_1) },
    { kind: 'member_world_state', character_id: LEADER, world_id: WORLD },
    { kind: 'member_world_state', character_id: ALT_1, world_id: OTHER_WORLD },
    { kind: 'follow_reconcile', leader_character_id: LEADER, now: NOW },
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

test('invite_accepted appends a distinct member but never activates follow implicitly (reconcile does)', () => {
  const base = fold([
    { kind: 'group', my_address: ME, leader_character_id: LEADER, members: members(LEADER) },
    { kind: 'member_world_state', character_id: LEADER, world_id: WORLD },
    { kind: 'member_world_state', character_id: ALT_1, world_id: OTHER_WORLD },
  ])
  const { state, outputs } = reduce_group(base.state, { kind: 'invite_accepted', character_id: ALT_1, owner: ME })
  expect(state.members.map((m) => m.character)).toEqual([LEADER, ALT_1])
  expect(outputs.join_world).toEqual([])
  expect(state.follow.enabled).toBe(false) // membership changed, but follow arms on the next reconcile
  // idempotent — accepting twice neither duplicates nor requests
  const again = reduce_group(state, { kind: 'invite_accepted', character_id: ALT_1, owner: ME })
  expect(again.state.members.length).toBe(2)
  expect(again.outputs.join_world).toEqual([])
})

// ── follower-set bounds ──────────────────────────────────────────────────────────────────────────────────────────
test('the follower set caps at the five formation slots in chain order', () => {
  const ids = ['0xa', '0xb', '0xc', '0xd', '0xe', '0xf']
  const grouped_many = fold([
    { kind: 'group', my_address: ME, leader_character_id: LEADER, members: members(LEADER, ...ids) },
    { kind: 'member_world_state', character_id: LEADER, world_id: WORLD },
    ...ids.map((character_id) => ({ kind: 'member_world_state', character_id, world_id: WORLD })),
  ]).state
  const { state, outputs } = reduce_group(grouped_many, {
    kind: 'follow_reconcile',
    leader_character_id: LEADER,
    now: NOW,
  })
  // all same-world as the leader → the entry read (no redundant joins), capped at the five formation slots
  expect(outputs.read_position).toHaveLength(MAX_OWNED_FOLLOWERS)
  expect(outputs.join_world).toEqual([])
  expect(state.follow.follower_character_ids).toEqual(ids.slice(0, MAX_OWNED_FOLLOWERS))
})

// ── membership IS auto-follow: arm on grouping, drop on kick (#613) ───────────────────────────────────────────────
test('a same-world owned member auto-follows on reconcile and reads its position (no redundant join)', () => {
  const { state, outputs } = following(ALT_1)
  expect(state.follow).toMatchObject({ enabled: true, leader_character_id: LEADER, follower_character_ids: [ALT_1] })
  expect(state.follow.followers[ALT_1].status).toBe('resolving')
  expect(outputs.join_world).toEqual([]) // #613 — same world ⇒ no zones::join_world (that rejoin burns gas)
  expect(outputs.read_position).toEqual([{ character_id: ALT_1, world_id: WORLD }])
})

test('a KICK (member removed from the group) drops that follower; the rest keep following', () => {
  const two = following(ALT_1, ALT_2).state
  // the party kicks ALT_1 → the group now holds only LEADER + ALT_2 → reconcile drops ALT_1's row
  const regrouped = reduce_group(two, {
    kind: 'group',
    my_address: ME,
    leader_character_id: LEADER,
    members: members(LEADER, ALT_2),
  }).state
  const { state } = reduce_group(regrouped, { kind: 'follow_reconcile', leader_character_id: LEADER, now: NOW })
  expect(state.follow.enabled).toBe(true)
  expect(state.follow.follower_character_ids).toEqual([ALT_2])
  expect(state.follow.followers[ALT_1]).toBeUndefined()
  expect(state.follow.followers[ALT_2]).toBeDefined()
})

test('kicking the LAST follower disarms the whole system (enabled false, leader released)', () => {
  const one = following(ALT_1).state
  const regrouped = reduce_group(one, {
    kind: 'group',
    my_address: ME,
    leader_character_id: LEADER,
    members: members(LEADER),
  }).state
  const { state } = reduce_group(regrouped, { kind: 'follow_reconcile', leader_character_id: LEADER, now: NOW })
  expect(state.follow.enabled).toBe(false)
  expect(state.follow.leader_character_id).toBe(null)
  expect(state.follow.follower_character_ids).toEqual([])
  expect(state.follow.followers).toEqual({})
})

test('reconcile is idempotent — re-running with the same membership re-emits no new join/read', () => {
  const one = following(ALT_1).state
  const again = reduce_group(one, { kind: 'follow_reconcile', leader_character_id: LEADER, now: NOW })
  expect(again.state.follow.follower_character_ids).toEqual([ALT_1])
  expect(again.state.follow.followers[ALT_1]).toBe(one.follow.followers[ALT_1]) // the live row is untouched
  expect(again.outputs.join_world).toEqual([])
  expect(again.outputs.read_position).toEqual([])
})

// ── timer-derived follower projection (#509 tranche 2) ────────────────────────────────────────────────────────────
test('project_follower_position runs the alt from its checkpoint to the slot at the timer progress', () => {
  const pose = { x: 0, z: 0, yaw: 0 }
  const slot = follow_formation_target(pose, 0, 0)
  const at = (progress) =>
    project_follower_position({ status: 'in_transit', checkpoint: { x: 100, z: 0 }, progress }, pose, 0)
  expect(at(0)).toMatchObject({ x: 100, z: 0 }) // progress 0 → still at the join checkpoint
  expect(at(1)).toMatchObject({ x: slot.x, z: slot.z }) // progress 1 → arrived at the slot
  const mid = at(0.5)
  expect(mid.x).toBeCloseTo((100 + slot.x) / 2) // linear run-in
  expect(mid.z).toBeCloseTo(slot.z / 2)
  // #613 — with_you is a free-run companion steered at the edge, no longer a slot projection; joining and any
  // other non-in_transit status project nothing here.
  expect(project_follower_position({ status: 'with_you' }, pose, 0)).toBe(null)
  expect(project_follower_position({ status: 'joining' }, pose, 0)).toBe(null)
})

test('#509 — a following alt is INVISIBLE far out, then renders its run-in once inside the range (despawn-and-continue)', () => {
  let { state } = following(ALT_1)
  // same-world but FAR (50 blocks > FOLLOW_VISIBLE_RANGE=30) → the in-world catch-up flight starts at the
  // read checkpoint, no world join (#613).
  expect(FOLLOW_VISIBLE_RANGE).toBe(30)
  ;({ state } = reduce_group(state, {
    kind: 'follow_position_read',
    character_id: ALT_1,
    position: { x: 50, z: 0 },
    now: NOW,
  }))
  expect(state.follow.followers[ALT_1].status).toBe('in_transit')
  // progress 0 → the projection sits at the far checkpoint → beyond the range → NOT rendered (visual despawn)
  expect(reduce_group(state, { kind: 'leader_position', x: 0, z: 0, yaw: 0, now: NOW }).outputs.follow_render).toEqual(
    []
  )
  // advance the proof-of-time timer to mid-run → the projection crosses into range → the alt renders its run-in
  const ticked = reduce_group(state, { kind: 'transit_tick', now: NOW + 5000 })
  expect(ticked.outputs.follow_render.map((row) => row.character_id)).toEqual([ALT_1])
})

// ── fight join + HUD focus ────────────────────────────────────────────────────────────────────────────────────────
test('a SOLO leader (no owned group members) emits no fight-join (#540 — nobody to steer)', () => {
  const solo = reduce_group(
    reduce_group(empty_group_state(), {
      kind: 'group',
      my_address: ME,
      leader_character_id: LEADER,
      members: members(LEADER),
    }).state,
    { kind: 'follow_reconcile', leader_character_id: LEADER, now: NOW }
  ).state
  expect(solo.follow.enabled).toBe(false)
  const { outputs } = reduce_group(solo, { kind: 'fight_started', fight_id: '0xfight', seated: [LEADER] })
  expect(outputs.join_fight).toEqual([])
})

test('a SOLO leader emits no dungeon-enter for a non-member alt (#540)', () => {
  const solo = reduce_group(
    reduce_group(empty_group_state(), {
      kind: 'group',
      my_address: ME,
      leader_character_id: LEADER,
      members: members(LEADER),
    }).state,
    { kind: 'follow_reconcile', leader_character_id: LEADER, now: NOW }
  ).state
  const assignments = [{ character_id: ALT_1, key_item_id: '0xk1', key_kiosk_id: '0xkk1', key_kiosk_cap_id: '0xkc1' }]
  const { outputs } = reduce_group(solo, { kind: 'dungeon_entered', world_id: WORLD, assignments })
  expect(outputs.enter_dungeon).toEqual([])
})

test('fight_started emits join_fight ONCE per aligned unseated group member; seats/latches dedupe', () => {
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
test('dungeon_entered sequences enter_dungeon once per owned group member with an assignment (leader excluded)', () => {
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
