// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/* eslint-disable functional/immutable-data -- this external presentation feed owns its private live follower cache. */

import { chain_to_client_coordinate, client_to_chain_coordinate } from '@aresrpg/immutable'
import { step_walking_follower } from './walking_follower.ts'
import { walking_edge, type WalkWorld } from './walkable.ts'

import { owned_character_position, record_owned_character_position } from './owned_character_feed.ts'

const FOLLOW_SPACING = 2
export const PARTY_FOLLOW_JOIN_DISTANCE = 3

export type PartyFollowPoint = Readonly<{ x: number; y: number; z: number }>
export type PartyFollowerView = PartyFollowPoint &
  Readonly<{ character_id: string; world: string; checkpoint: string; distance: number }>
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
  followers: readonly Readonly<{ character_id: string; checkpoint: string; x: number; y: number; z: number }>[]
}>

const EMPTY: PartyFollowSnapshot = Object.freeze({ party_id: null, leader_id: null, followers: Object.freeze([]) })
const feed: {
  snapshot: PartyFollowSnapshot
  last_ms: number
  target: PartyFollowPoint | null
  motions: Map<string, Readonly<{ checkpoint: string; motion: ReturnType<typeof step_walking_follower>['motion'] }>>
  listeners: Set<() => void>
} = { snapshot: EMPTY, last_ms: 0, target: null, motions: new Map(), listeners: new Set() }

export const party_follower_target = (leader: PartyFollowPoint, index: number): PartyFollowPoint =>
  Object.freeze({ x: leader.x + (index + 1) * FOLLOW_SPACING, y: leader.y, z: leader.z })

const stop_party_follow = (): PartyFollowSnapshot => {
  if (feed.snapshot.party_id === null) return feed.snapshot
  feed.snapshot = EMPTY
  feed.last_ms = 0
  feed.target = null
  feed.motions.clear()
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
  target: PartyFollowPoint | null,
  elapsed_ms: number,
  world: string,
  index: number,
  terrain: WalkWorld | null
): PartyFollowerView => {
  const current = owned_character_position(source.character_id, world, source.checkpoint) ?? source
  const point = { x: current.x, y: current.y, z: current.z }
  let stepped = { ...point, distance: Infinity }
  if (target && terrain) {
    const x = chain_to_client_coordinate(point.x)
    const z = chain_to_client_coordinate(point.z)
    const destination = party_follower_target(target, index)
    const retained = feed.motions.get(source.character_id)
    const previous_motion = retained?.checkpoint === source.checkpoint ? retained.motion : null
    if (terrain.ready({ min_x: x - 3, max_x: x + 3, min_z: z - 3, max_z: z + 3 })) {
      const footing = walking_edge(terrain, [x, point.y, z], x, z)
      const y = footing?.[1] ?? terrain.ground_height(x, z)
      const result = step_walking_follower(
        terrain,
        previous_motion,
        [x, y, z],
        {
          x: chain_to_client_coordinate(destination.x),
          z: chain_to_client_coordinate(destination.z),
        },
        elapsed_ms
      )
      feed.motions.set(source.character_id, { checkpoint: source.checkpoint, motion: result.motion })
      stepped = {
        x: client_to_chain_coordinate(result.position[0]),
        y: result.position[1],
        z: client_to_chain_coordinate(result.position[2]),
        distance: result.distance,
      }
    }
  }
  const row = Object.freeze({ character_id: source.character_id, world, checkpoint: source.checkpoint, ...stepped })
  record_owned_character_position(source.character_id, world, row)
  return row
}

export const update_party_follow = (
  input: PartyFollowInput | null,
  now_ms: number = Date.now(),
  terrain: WalkWorld | null = null
): PartyFollowSnapshot => {
  if (!input) return stop_party_follow()
  const same_party = feed.snapshot.party_id === input.party_id && feed.snapshot.leader_id === input.leader_id
  if (!same_party) feed.motions.clear()
  const identities = new Set(input.followers.map((row) => row.character_id))
  feed.motions.forEach((_, id) => {
    if (!identities.has(id)) feed.motions.delete(id)
  })
  const elapsed_ms = elapsed_since_last_follow(same_party, now_ms)
  const target = follow_target(input, same_party)
  const followers = input.followers.map((source, index) =>
    step_follower(source, target, elapsed_ms, input.world, index, terrain)
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
  feed.motions.clear()
}
