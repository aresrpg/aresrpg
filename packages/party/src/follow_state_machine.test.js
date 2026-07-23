// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #613 — the RULED follower state machine, red-first per field defect. The chain is the truth: entry
// evaluation reads world-equality FIRST (no redundant same-world join — a real zones::join_world executes on a
// rejoin and burns sponsor gas), the ARRIVING timer completes INTO a with_you free-run state (never a frozen
// 00:00), that state steers via pet_follow at the edge (free_run + a leader anchor), and an executed refusal
// names an explicit blocked row instead of a context-free toast.
import { expect, test } from 'bun:test'

import {
  empty_group_state,
  reduce_group,
  FOLLOW_VISIBLE_RANGE,
  project_follower_position,
  follow_formation_target,
} from './group_loop.js'

const ME = '0xwallet'
const LEADER = '0xleader'
const ALT = '0xalt1'
const WORLD_A = '0xworld_a'
const WORLD_B = '0xworld_b'
const NOW = 5_000_000

const members = [
  { character: LEADER, owner: ME, order: 0 },
  { character: ALT, owner: ME, order: 1 },
]

const fold = (state, input) => reduce_group(state, input)
const next = (state, input) => fold(state, input).state

/** Leader parked at origin in WORLD_A; the alt's world is caller-chosen (same vs different world). */
const ready = (alt_world = WORLD_A) => {
  let s = empty_group_state()
  s = next(s, { kind: 'group', my_address: ME, leader_character_id: LEADER, members })
  s = next(s, { kind: 'member_world_state', character_id: LEADER, world_id: WORLD_A, now: NOW })
  s = next(s, { kind: 'member_world_state', character_id: ALT, world_id: alt_world, now: NOW })
  s = next(s, { kind: 'leader_position', x: 0, z: 0, yaw: 0, now: NOW })
  return s
}

// Group membership IS auto-follow (#613 DESIGN COLLAPSE): the owned group members (here just ALT) follow by
// construction — no toggle. `enable` is the reconcile the frontend fires after a membership/world sync.
const enable = (state) => fold(state, { kind: 'follow_reconcile', leader_character_id: LEADER, now: NOW })

// ── DESIGN COLLAPSE — group membership IS auto-follow: no toggle; an owned group member follows, a kick drops it.
test('#613 an owned group member auto-follows on reconcile; a KICK (gone from the group) is the only disable', () => {
  const { state, outputs } = enable(ready(WORLD_A)) // ALT is an owned group member → auto-followed
  expect(state.follow.enabled).toBe(true)
  expect(state.follow.follower_character_ids).toEqual([ALT])
  expect(outputs.read_position).toEqual([{ character_id: ALT, world_id: WORLD_A }])
  // KICK: the party drops ALT (only the leader remains) → reconcile disarms it and re-emits the render.
  const s = next(state, { kind: 'group', my_address: ME, leader_character_id: LEADER, members: [members[0]] })
  const kicked = fold(s, { kind: 'follow_reconcile', leader_character_id: LEADER })
  expect(kicked.state.follow.enabled).toBe(false)
  expect(kicked.state.follow.follower_character_ids).toEqual([])
  expect(kicked.state.follow.followers[ALT]).toBeUndefined()
})

// ── Defect ① — entry evaluation: a SAME-WORLD follower never fires the world-join tx (the money leak). ──────
test('#613·1 a same-world member auto-follows with NO join_world (reads chain truth, resolves position instead)', () => {
  const { state, outputs } = enable(ready(WORLD_A))
  expect(outputs.join_world).toEqual([]) // the redundant same-world join is gone (no zones::join_world, no gas)
  expect(outputs.read_position).toEqual([{ character_id: ALT, world_id: WORLD_A }]) // chain-truth read first
  expect(state.follow.followers[ALT].status).toBe('resolving')
})

test('#613·1 a DIFFERENT-world follower still takes the join transaction + timer leg', () => {
  const { state, outputs } = enable(ready(WORLD_B))
  expect(outputs.join_world).toEqual([{ character_id: ALT, world_id: WORLD_A }])
  expect(outputs.read_position).toEqual([])
  expect(state.follow.followers[ALT].status).toBe('joining')
})

test('#613·1 a leader world change never re-joins a follower already standing in that world', () => {
  let state = ready(WORLD_B) // ALT is in WORLD_B, leader in WORLD_A
  state = next(state, { kind: 'follow_reconcile', leader_character_id: LEADER, now: NOW })
  // the leader hops to WORLD_B — where ALT already is → read its position, never a redundant same-world join
  const moved = fold(state, { kind: 'member_world_state', character_id: LEADER, world_id: WORLD_B, now: NOW + 1000 })
  expect(moved.outputs.join_world).toEqual([])
  expect(moved.outputs.read_position).toEqual([{ character_id: ALT, world_id: WORLD_B }])
})

test('#613·1 same-world NEAR resolves straight to with_you — no timer, no transit', () => {
  let { state } = enable(ready(WORLD_A))
  ;({ state } = fold(state, { kind: 'follow_position_read', character_id: ALT, position: { x: 2, z: 1 }, now: NOW }))
  expect(state.follow.followers[ALT].status).toBe('with_you')
  expect(state.follow.followers[ALT].remaining_ms ?? 0).toBe(0)
})

test('#613·1 same-world FAR resolves into the in-world catch-up transit (still no join)', () => {
  let out = enable(ready(WORLD_A))
  const far = FOLLOW_VISIBLE_RANGE + 20
  out = fold(out.state, { kind: 'follow_position_read', character_id: ALT, position: { x: far, z: 0 }, now: NOW })
  expect(out.state.follow.followers[ALT].status).toBe('in_transit')
  expect(out.outputs.join_world).toEqual([]) // catch-up leg rides the flight timer, never a world join
})

// ── Defect ② — the ARRIVING timer completes INTO with_you (the frozen-00:00 bar is gone). ───────────────────
test('#613·2 a completed transit timer transitions the follower to with_you (no dead 00:00)', () => {
  let { state } = enable(ready(WORLD_B)) // different world → join → transit
  ;({ state } = fold(state, {
    kind: 'follow_world_joined',
    character_id: ALT,
    world_id: WORLD_A,
    checkpoint: { x: 100, z: 0 },
    now: NOW,
  }))
  expect(state.follow.followers[ALT].status).toBe('in_transit')
  const arrived = fold(state, { kind: 'transit_tick', now: NOW + 10 * 60_000 }).state.follow.followers[ALT]
  expect(arrived.status).toBe('with_you') // completion is CONSUMED — the label becomes "with you"
  expect(arrived.remaining_ms).toBe(0)
})

// ── Defect ③ — a with_you follower is continuously present (moves with the leader, never range-despawns). ────
test('#613·3 a with_you follower stays rendered across leader movement — not range-gated', () => {
  let { state } = enable(ready(WORLD_A))
  ;({ state } = fold(state, { kind: 'follow_position_read', character_id: ALT, position: { x: 1, z: 0 }, now: NOW }))
  // leader sprints far from the origin: a formation/range model despawned here — the free-run companion must not.
  const far = fold(state, { kind: 'leader_position', x: 500, z: 500, yaw: 1, now: NOW + 1000 })
  const row = far.outputs.follow_render.find((r) => r.character_id === ALT)
  expect(row).toBeTruthy()
  expect(row.free_run).toBe(true)
})

// ── Defect ④ — the with_you render row carries the pet_follow consumer contract (free_run + leader anchor). ──
test('#613·4 with_you render rows carry free_run + the leader anchor (the step_pet_follow wiring)', () => {
  let { state } = enable(ready(WORLD_A))
  ;({ state } = fold(state, { kind: 'follow_position_read', character_id: ALT, position: { x: 1, z: 0 }, now: NOW }))
  const { outputs } = fold(state, { kind: 'leader_position', x: 3, z: 4, yaw: 0.5, now: NOW + 1000 })
  const row = outputs.follow_render.find((r) => r.character_id === ALT)
  expect(row.free_run).toBe(true)
  expect(row.anchor).toMatchObject({ x: 3, z: 4, yaw: 0.5 }) // the owner target step_pet_follow steers toward
})

// ── Defect ⑤ — an executed refusal names an explicit blocked row (never a stuck timer / context-free toast). ─
test('#613·5 member_blocked(world_join) puts the follower row into an explicit blocked state', () => {
  let { state } = enable(ready(WORLD_B)) // joining → the join executes and fails on an unopened fight result
  ;({ state } = fold(state, { kind: 'member_blocked', character_id: ALT, scope: 'world_join' }))
  expect(state.follow.followers[ALT].status).toBe('blocked')
  expect(state.blocked[ALT].world_join).toBe(true) // the executed-failure latch still holds (never re-fired)
})

// ── Defect ⑥ — the travel leg drives position from the flight timer (progress-derived), never a teleport. ────
test('#613·6 the in_transit position rides the flight progress (checkpoint→slot), never an instant jump', () => {
  const pose = { x: 0, z: 0, yaw: 0 }
  const slot = follow_formation_target(pose, 0, 0)
  const at = (progress) =>
    project_follower_position({ status: 'in_transit', checkpoint: { x: 90, z: 0 }, progress }, pose, 0)
  expect(at(0).x).toBeCloseTo(90) // rode in from the far join checkpoint — never spawned on the leader
  expect(at(0.5).x).toBeCloseTo((90 + slot.x) / 2) // half the timer = half the run-in
  expect(at(1).x).toBeCloseTo(slot.x) // completes at the slot, never snapped there early
})

test('#613·6 an in_transit render row is the timer leg (NOT the free-run pet steering)', () => {
  let { state } = enable(ready(WORLD_B)) // different world → join → in_transit
  ;({ state } = fold(state, {
    kind: 'follow_world_joined',
    character_id: ALT,
    world_id: WORLD_A,
    checkpoint: { x: 25, z: 0 }, // within FOLLOW_VISIBLE_RANGE → renders its run-in immediately
    now: NOW,
  }))
  expect(state.follow.followers[ALT].status).toBe('in_transit')
  const row = fold(state, { kind: 'leader_position', x: 0, z: 0, yaw: 0, now: NOW }).outputs.follow_render.find(
    (r) => r.character_id === ALT
  )
  expect(row).toBeTruthy()
  expect(row.free_run ?? false).toBe(false)
})
