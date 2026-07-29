// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1661 — AN ALT IS AUTO-SEATED ON ARRIVAL, NEVER ON MEMBERSHIP.
//
// The witnessed case: a second owned character was seated into the leader's fight while it was still traveling
// to them. It could not act, so it idled its turns away and forfeited — a fight the player never chose to bring
// it into, lost by a character that was never there. The predicate said "armed AND aligned", where armed is
// membership (auto-follow is the only mode, #613) and aligned is SAME WORLD: two facts that are both true long
// before the alt stands beside the leader.
//
// The RULING (#1661): auto-join survives for an alt that is auto-follow-armed AND proximity-ARRIVED, where
// arrival is an EVENT — travel COMPLETED — not a distance and not a shared world field. The reducer already
// owns that event: `with_you` is the one state every arrival path converges on (a near same-world settle, a
// run-in expiry, a dragon landing, all through `enter_with_you`). An alt that never completes travel therefore
// satisfies nothing at all, with no presence check anywhere in the loop — which is the point: a predicate that
// needs to ask "is it there?" is a predicate that got the question wrong.
import { readFileSync } from 'node:fs'

import { expect, test } from 'bun:test'

import { reduce_group, empty_group_state, TRANSIT_SPEED } from '../src/group_loop.js'

const ME = '0xwallet'
const LEADER = '0xleader'
const ALT = '0xalt1'
const WORLD = '0xworld_a'
const OTHER_WORLD = '0xworld_b'
const FIGHT = '0xfight'
const NOW = 5_000_000

const members = (...ids) => ids.map((character, order) => ({ character, owner: ME, order }))
const fold = (inputs, state = empty_group_state()) => inputs.reduce((acc, input) => reduce_group(acc, input).state, state)

/** Leader at the origin with ONE owned alt grouped behind it, reconciled (membership IS auto-follow, #613). */
const grouped_with_alt = (alt_world) =>
  fold([
    { kind: 'group', my_address: ME, leader_character_id: LEADER, members: members(LEADER, ALT) },
    { kind: 'member_world_state', character_id: LEADER, world_id: WORLD },
    { kind: 'member_world_state', character_id: ALT, world_id: alt_world },
    { kind: 'leader_position', x: 0, z: 0, yaw: 0, now: NOW },
    { kind: 'follow_reconcile', leader_character_id: LEADER, now: NOW },
  ])

const seated_by = (state, fight_id = FIGHT) =>
  reduce_group(state, { kind: 'fight_started', fight_id, seated: [LEADER] }).outputs.join_fight.map(
    (row) => row.character_id
  )

// ── ① the witnessed case: same world, travel unfinished ───────────────────────────────────────────────────
test('a SAME-WORLD alt that has not finished traveling is never auto-seated (the idle-forfeit)', () => {
  const armed = grouped_with_alt(WORLD)
  // Both halves of the OLD predicate hold: the alt is an armed follower AND its chain world IS the leader's.
  expect(armed.follow.follower_character_ids).toEqual([ALT])
  expect(armed.world_by_character[ALT]).toBe(armed.world_by_character[LEADER])
  expect(armed.follow.followers[ALT].status).toBe('resolving')
  expect(seated_by(armed)).toEqual([])

  // Its checkpoint lands far across the same world → the catch-up leg. Still same-world, still not arrived.
  const running = reduce_group(armed, {
    kind: 'follow_position_read',
    character_id: ALT,
    position: { x: TRANSIT_SPEED * 40, z: 0 },
    now: NOW,
  }).state
  expect(running.follow.followers[ALT].status).toBe('in_transit')
  expect(seated_by(running)).toEqual([])

  // Half the run-in is not arrival either — nothing about a fight starting shortens the journey.
  const halfway = reduce_group(running, { kind: 'transit_tick', now: NOW + running.follow.followers[ALT].total_ms / 2 })
    .state
  expect(halfway.follow.followers[ALT].status).toBe('in_transit')
  expect(seated_by(halfway)).toEqual([])
})

// ── ② the alt that is not there at all ────────────────────────────────────────────────────────────────────
test('an alt whose travel never lands never auto-seats — and no presence branch exists to maintain', () => {
  // A realm away: the loop asks for its world join and waits. Nothing lands (no client is there to sign it).
  const waiting = grouped_with_alt(OTHER_WORLD)
  expect(waiting.follow.followers[ALT].status).toBe('joining')

  // Even the chain agreeing it is in the leader's world changes nothing — a world field is not an arrival.
  const same_world = reduce_group(waiting, { kind: 'member_world_state', character_id: ALT, world_id: WORLD }).state
  expect(same_world.world_by_character[ALT]).toBe(WORLD)

  // Ten minutes of ticks: no arrival event, so no seat — through four separate fights.
  const later = reduce_group(same_world, { kind: 'transit_tick', now: NOW + 600_000 }).state
  expect(later.follow.followers[ALT].status).toBe('joining')
  for (const fight_id of ['0xf1', '0xf2', '0xf3', '0xf4']) expect(seated_by(later, fight_id)).toEqual([])

  // THE MECHANICAL HALF: the alt above falls out for FREE. If a presence/offline special case ever appears in
  // the loop, the predicate has regressed to asking "is it there?" instead of "did it arrive?" — comments are
  // stripped first so this fence measures CODE, never the prose that explains it.
  const source = readFileSync(new URL('../src/group_loop.js', import.meta.url), 'utf8')
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  expect(code).not.toMatch(/offline|is_online|last_seen|heartbeat|presence/i)
})

// ── ③ the positive control: arrival IS the door ───────────────────────────────────────────────────────────
test('the moment travel COMPLETES, the same alt is seated — exactly once', () => {
  const running = reduce_group(grouped_with_alt(WORLD), {
    kind: 'follow_position_read',
    character_id: ALT,
    position: { x: TRANSIT_SPEED * 40, z: 0 },
    now: NOW,
  }).state
  expect(seated_by(running)).toEqual([])

  const arrived = reduce_group(running, { kind: 'transit_tick', now: NOW + running.follow.followers[ALT].total_ms })
    .state
  expect(arrived.follow.followers[ALT].status).toBe('with_you')

  const joined = reduce_group(arrived, { kind: 'fight_started', fight_id: FIGHT, seated: [LEADER] })
  expect(joined.outputs.join_fight).toEqual([{ character_id: ALT, fight_id: FIGHT }])
  // the request latches: a poll re-announcing the same fight asks for nothing more
  expect(reduce_group(joined.state, { kind: 'fight_started', fight_id: FIGHT, seated: [LEADER] }).outputs.join_fight)
    .toEqual([])
})
