// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import type { FightRow } from '@aresrpg/protocol'

import { reduce_app_state, type AppState } from '../../src/store.ts'
import { fight_in_reach } from '../../src/components/FightPrompt.tsx'
import { nearby_fights } from '../../src/game/hud/MultiplayerHud.tsx'
import { nearby_fight } from '../../src/modules/nearby_fight.ts'
import { sword_fights } from '../../src/modules/world_engage.ts'
import { run_to_target } from '../../src/modules/run_to.ts'

import { automation_fixture } from './automation_fixture.ts'

const fight: FightRow = {
  id: 'fight',
  world: 'nauvis',
  x: 50012,
  z: 50000,
  phase: 'placement',
  access_a: 0,
  access_b: 0,
  opener_a: null,
  opener_b: null,
  managed: false,
  wagered: false,
  placement_ms: '0',
}
const fixture = (): AppState => {
  const state = automation_fixture()
  return { ...state, world: { ...state.world, fights: { fight }, all_fights: { fight } } }
}
const pose = { character_id: 'alice', x: 0, y: 0, z: 0, yaw: 0, riding: false, time_of_day: 0 }

test('nearby discovery converts coordinates, sorts distance, and excludes other worlds and managed fights', () => {
  const fights = {
    fight,
    near: { ...fight, id: 'near', x: 50004 },
    other: { ...fight, id: 'other', world: 'incarnam' },
    managed: { ...fight, id: 'managed', managed: true },
  }
  expect(nearby_fights(fights, 'nauvis', pose).map(({ fight, distance }) => [fight.id, distance])).toEqual([
    ['near', 4],
    ['fight', 12],
  ])
  expect(nearby_fights(fights, 'nauvis', null)).toEqual([])
})
test('run and join replaces automation, uses normal travel target, and opens team selection only upon arrival', () => {
  const running = reduce_app_state(fixture(), { type: 'run_to/fight', fight_id: 'fight' })
  expect(running.automation.run).toBeNull()
  expect(run_to_target(running)).toEqual({ x: 12, z: 0 })
  expect(running.navigation.dialog).toBeNull()
  const arrived = reduce_app_state(running, { type: 'run_to/stopped', reason: 'arrived' })
  expect(arrived.navigation.dialog).toBe('fight:fight')
  expect(arrived.run_to.run).toBeNull()
  expect(reduce_app_state(running, { type: 'run_to/stopped', reason: 'manual' }).navigation.dialog).toBeNull()
})
test('ended fights cancel travel and cannot open invisible arrival dialogs', () => {
  const running = reduce_app_state(fixture(), { type: 'run_to/fight', fight_id: 'fight' })
  const ended = reduce_app_state(running, {
    type: 'server/packet',
    packet: { type: 'packet/fight_phase', fight: 'fight', phase: 'ended' },
  })
  expect(ended.run_to.run).toBeNull()
  expect(reduce_app_state(ended, { type: 'run_to/stopped', reason: 'arrived' }).navigation.dialog).toBeNull()
})
test('unavailable characters and untracked fights cannot start travel; joins require current matching pose and range', () => {
  const state = fixture()
  expect(reduce_app_state(state, { type: 'run_to/fight', fight_id: 'missing' }).run_to.run).toBeNull()
  expect(
    reduce_app_state(
      { ...state, fight: { ...state.fight, mounted: true } },
      { type: 'run_to/fight', fight_id: 'fight' }
    ).run_to.run
  ).toBeNull()
  const character = state.session.characters[0]!
  expect(fight_in_reach(fight, character, pose)).toBe(false)
  expect(fight_in_reach(fight, character, { ...pose, x: 10 })).toBe(true)
  expect(fight_in_reach(fight, character, { ...pose, x: 10, character_id: 'other' })).toBe(false)
  expect(fight_in_reach(fight, { ...character, world: 'incarnam' }, { ...pose, x: 10 })).toBe(false)
})

const heartbeat = (state: AppState, chain_ms: number): AppState =>
  reduce_app_state(reduce_app_state(state, { type: 'clock/observed', chain_ms, received_ms: 0 }), {
    type: 'server/packet',
    packet: {
      type: 'packet/server_info',
      online: 1,
      indexing_lag: 0,
      current_epoch: '1',
      chain_timestamp_ms: chain_ms,
      chain_sample_age_ms: 0,
    },
  })

test('clock expiry removes all public surfaces and cancels travel without a fight event', () => {
  const running = reduce_app_state(fixture(), { type: 'run_to/fight', fight_id: 'fight' })
  const boundary = heartbeat(running, 3_600_000)
  expect(boundary.world.fights.fight).toBeDefined()
  const expired = heartbeat(boundary, 3_600_001)
  expect(expired.world.fights).toEqual({})
  expect(expired.world.all_fights).toEqual({})
  expect(sword_fights(expired.world.fights, 'nauvis')).toEqual([])
  expect(nearby_fights(expired.world.fights, 'nauvis', pose)).toEqual([])
  expect(nearby_fight(expired, pose)).toBeNull()
  expect(expired.run_to.run).toBeNull()
  for (const packet of [
    { type: 'packet/fights', fights: [fight] },
    { type: 'packet/fight_created', fight },
  ] as const) {
    const replayed = reduce_app_state(expired, { type: 'server/packet', packet: packet as never })
    expect(replayed.world.fights).toEqual({})
    expect(replayed.world.all_fights).toEqual({})
  }
})

test('expiry prunes other character windows but preserves participant custody and fight state', () => {
  const base = fixture()
  const state: AppState = {
    ...base,
    session: {
      ...base.session,
      characters: [{ ...base.session.characters[0]!, custody: 'fight', active_fight: { id: 'fight', seat: 0 } }],
    },
    world: { ...base.world, all_fights: { fight, other: { ...fight, id: 'other', world: 'incarnam' } } },
  }
  const expired = heartbeat(state, 3_600_001)
  expect(expired.world.all_fights).toEqual({})
  expect(expired.session.characters[0]?.active_fight).toEqual({ id: 'fight', seat: 0 })
  expect(expired.fight).toBe(state.fight)
})
