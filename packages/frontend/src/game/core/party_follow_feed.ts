// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/* eslint-disable functional/immutable-data -- this external presentation feed owns its private live follower cache. */

import { SPEED_BUDGET_BLOCKS_PER_SECOND } from '@aresrpg/protocol'

import { owned_character_position, record_owned_character_position } from './owned_character_feed.ts'

const FOLLOW_SPEED = SPEED_BUDGET_BLOCKS_PER_SECOND - 1
const FOLLOW_SPACING = 2
export const PARTY_FOLLOW_JOIN_DISTANCE = 3

export type PartyFollowPoint = Readonly<{ x: number; y: number; z: number }>
export type PartyFollowerView = PartyFollowPoint & Readonly<{ character_id: string; world: string; distance: number }>
export type PartyFollowSnapshot = Readonly<{
  party_id: string | null
  leader_id: string | null
  followers: readonly PartyFollowerView[]
}>

type PartyFollowInput = Readonly<{
  party_id: string
  leader_id: string
  world: string
  target?: PartyFollowPoint
  followers: readonly Readonly<{ character_id: string; x: number; y: number; z: number }>[]
}>

const EMPTY: PartyFollowSnapshot = Object.freeze({ party_id: null, leader_id: null, followers: Object.freeze([]) })
const feed: {
  snapshot: PartyFollowSnapshot
  last_ms: number
  target: PartyFollowPoint | null
  listeners: Set<() => void>
} = { snapshot: EMPTY, last_ms: 0, target: null, listeners: new Set() }

export const advance_party_follower = (
  current: PartyFollowPoint,
  target: PartyFollowPoint,
  elapsed_ms: number
): Readonly<PartyFollowPoint & { distance: number }> => {
  const dx = target.x - current.x
  const dz = target.z - current.z
  const distance = Math.hypot(dx, dz)
  const travel = Math.min(distance, (FOLLOW_SPEED * Math.max(0, elapsed_ms)) / 1_000)
  const ratio = distance === 0 ? 0 : travel / distance
  const x = current.x + dx * ratio
  const z = current.z + dz * ratio
  return Object.freeze({ x, y: target.y, z, distance: Math.max(0, distance - travel) })
}

export const party_follower_target = (leader: PartyFollowPoint, index: number): PartyFollowPoint =>
  Object.freeze({ x: leader.x + (index + 1) * FOLLOW_SPACING, y: leader.y, z: leader.z })

const stop_party_follow = (): PartyFollowSnapshot => {
  if (feed.snapshot.party_id === null) return feed.snapshot
  feed.snapshot = EMPTY
  feed.last_ms = 0
  feed.target = null
  feed.listeners.forEach((listener) => listener())
  return feed.snapshot
}

const elapsed_since_last_follow = (same_party: boolean, now_ms: number): number =>
  same_party && feed.last_ms !== 0 ? Math.min(Math.max(now_ms - feed.last_ms, 0), 250) : 0

const follow_target = (input: PartyFollowInput, same_party: boolean): PartyFollowPoint | null => {
  const target = same_party ? (input.target ?? feed.target) : (input.target ?? null)
  feed.target = target
  return target
}

const step_follower = (
  source: PartyFollowInput['followers'][number],
  previous: ReadonlyMap<string, PartyFollowerView>,
  target: PartyFollowPoint | null,
  elapsed_ms: number,
  world: string,
  index: number
): PartyFollowerView => {
  const current = previous.get(source.character_id) ?? owned_character_position(source.character_id, world) ?? source
  const point = { x: current.x, y: current.y, z: current.z }
  const distance = 'distance' in current && typeof current.distance === 'number' ? current.distance : 0
  const stepped = target
    ? advance_party_follower(point, party_follower_target(target, index), elapsed_ms)
    : { ...point, distance }
  const row = Object.freeze({ character_id: source.character_id, world, ...stepped })
  record_owned_character_position(source.character_id, world, row)
  return row
}

export const update_party_follow = (
  input: PartyFollowInput | null,
  now_ms: number = Date.now()
): PartyFollowSnapshot => {
  if (!input) return stop_party_follow()
  const same_party = feed.snapshot.party_id === input.party_id && feed.snapshot.leader_id === input.leader_id
  const elapsed_ms = elapsed_since_last_follow(same_party, now_ms)
  const target = follow_target(input, same_party)
  const previous = new Map(feed.snapshot.followers.map((row) => [row.character_id, row]))
  const followers = input.followers.map((source, index) =>
    step_follower(source, previous, target, elapsed_ms, input.world, index)
  )
  feed.last_ms = now_ms
  feed.snapshot = Object.freeze({
    party_id: input.party_id,
    leader_id: input.leader_id,
    followers: Object.freeze(followers),
  })
  feed.listeners.forEach((listener) => listener())
  return feed.snapshot
}

export const read_party_follow = (): PartyFollowSnapshot => feed.snapshot
export const subscribe_party_follow = (listener: () => void): (() => void) => {
  feed.listeners.add(listener)
  return () => void feed.listeners.delete(listener)
}
export const reset_party_follow_for_testing = (): void => {
  feed.snapshot = EMPTY
  feed.last_ms = 0
  feed.target = null
}
