// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import {
  advance_party_follower,
  party_follower_target,
  read_party_follow,
  reset_party_follow_for_testing,
  update_party_follow,
} from '../../../src/game/core/party_follow_feed.ts'
import {
  owned_character_position,
  reset_owned_character_positions_for_testing,
} from '../../../src/game/core/owned_character_feed.ts'
import { create_position_publisher } from '../../../src/game/core/position_publication.ts'
import { party_follow_join_plan } from '../../../src/modules/party_follow.ts'
import { active_party_follow } from '../../../src/modules/party_follow.ts'

test('party followers move in flat space at the legal run speed without overshooting', () => {
  const stepped = advance_party_follower({ x: 0, y: 0, z: 0 }, { x: 20, y: 7, z: 0 }, 1_000)
  expect(stepped).toEqual({ x: 10.5, y: 7, z: 0, distance: 9.5 })

  const arrived = advance_party_follower(stepped, { x: 12, y: 4, z: 0 }, 1_000)
  expect(arrived).toEqual({ x: 12, y: 4, z: 0, distance: 0 })
})

test('followers occupy distinct slots in one line beside the leader', () => {
  const leader = { x: 10, y: 4, z: 20 }
  expect(party_follower_target(leader, 0)).toEqual({ x: 12, y: 4, z: 20 })
  expect(party_follower_target(leader, 1)).toEqual({ x: 14, y: 4, z: 20 })
})

test('switching to a follower preserves follow mode while excluding the controlled character', () => {
  const state = {
    settings: { follow_leader: true },
    party: {
      party_by_character: { '0xa': '0xp', '0xb': '0xp', '0xc': '0xp' },
      by_id: {
        '0xp': {
          id: '0xp',
          members: [
            { character_id: '0xa', name: 'Ari' },
            { character_id: '0xb', name: 'Bex' },
            { character_id: '0xc', name: 'Cyr' },
          ],
          invited: [],
        },
      },
    },
    session: {
      selected_character_id: '0xb',
      characters: [
        { id: '0xa', world: 'nauvis' },
        { id: '0xb', world: 'nauvis', custody: 'kiosk' },
        { id: '0xc', world: 'nauvis', custody: 'kiosk' },
      ],
    },
  }
  const follow = active_party_follow(state as never)
  expect(follow?.leader.id).toBe('0xa')
  expect(follow?.followers.map(({ id }) => id)).toEqual(['0xc'])
})

test('the external feed retains live positions and projects only into its selected world', () => {
  reset_party_follow_for_testing()
  reset_owned_character_positions_for_testing()
  const input = {
    party_id: '0xp',
    leader_id: '0xa',
    world: 'nauvis',
    target: { x: 20, y: 7, z: 0 },
    followers: [{ character_id: '0xb', x: 0, y: 0, z: 0 }],
  }
  update_party_follow(input, 1_000)
  update_party_follow(input, 1_100)
  expect(read_party_follow().followers[0]).toMatchObject({ character_id: '0xb', x: 1.05, y: 7 })
  expect(owned_character_position('0xb', 'nauvis')).toMatchObject({ x: 1.05, y: 7 })
})

test('position publication throttles and suppresses stationary follower packets', () => {
  let now = 0
  const sent: string[] = []
  const publisher = create_position_publisher({
    now: () => now,
    send: (character_id) => {
      sent.push(character_id)
      return true
    },
  })
  const position = { x: 0, y: 0, z: 0, riding: false }
  expect(publisher.publish('0xb', position, 100)).toBeTrue()
  now = 100
  expect(publisher.publish('0xb', position, 100)).toBeFalse()
  expect(publisher.publish('0xb', { ...position, x: 0.3 }, 100)).toBeTrue()
  expect(sent).toEqual(['0xb', '0xb'])
})

test('auto-join waits for every eligible follower then respects the leader side capacity', () => {
  const state = {
    settings: { follow_leader: true },
    party: {
      party_by_character: { '0xa': '0xp', '0xb': '0xp', '0xc': '0xp' },
      by_id: {
        '0xp': {
          id: '0xp',
          members: [
            { character_id: '0xa', name: 'Ari' },
            { character_id: '0xb', name: 'Bex' },
            { character_id: '0xc', name: 'Cyr' },
          ],
          invited: [],
        },
      },
    },
    session: {
      selected_character_id: '0xa',
      characters: [
        { id: '0xa', world: 'nauvis' },
        { id: '0xb', world: 'nauvis', custody: 'kiosk', kiosk: '0xk', kiosk_cap: '0xcap' },
        { id: '0xc', world: 'nauvis', custody: 'kiosk', kiosk: '0xk', kiosk_cap: '0xcap' },
      ],
    },
    fight: {
      cached: {
        '0xf': {
          contract: {
            id: '0xf',
            round: 0n,
            ended: false,
            access_a: 1n,
            access_b: 0n,
            board: { start_cells_a: [1n, 2n], start_cells_b: [3n] },
            fighters: [
              { team: 0n, kind: { type: 'player', character: '0xa' } },
              { team: 1n, kind: { type: 'mob' } },
            ],
          },
        },
      },
    },
  }
  const positions = {
    party_id: '0xp',
    leader_id: '0xa',
    followers: [
      { character_id: '0xb', world: 'nauvis', x: 0, y: 0, z: 0, distance: 0 },
      { character_id: '0xc', world: 'nauvis', x: 0, y: 0, z: 0, distance: 9 },
    ],
  }

  expect(party_follow_join_plan(state as never, '0xf', positions)).toBeNull()
  const ready = { ...positions, followers: positions.followers.map((row) => ({ ...row, distance: 0 })) }
  const plan = party_follow_join_plan(state as never, '0xf', ready)
  expect(plan).toMatchObject({ fight: '0xf', team: 0, party: '0xp' })
  expect(plan?.followers.map(({ id }) => id)).toEqual(['0xb'])
})
