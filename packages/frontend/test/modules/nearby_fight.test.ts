// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { create_character_source, create_fight, type HydratedFightCheckpoint } from '@aresrpg/fight'
import type { FightRow } from '@aresrpg/protocol'

import { nearby_fight, nearby_fight_view } from '../../src/modules/nearby_fight.ts'
import { create_app, reduce_app_state } from '../../src/store.ts'

import { automation_fixture } from './automation_fixture.ts'

const pose = { character_id: 'alice', x: 0, y: 0, z: 0, yaw: 0, riding: false, time_of_day: 0 }
const row = (id: string, x: number): FightRow => ({
  id,
  x: 50_000 + x,
  z: 50_000,
  world: 'nauvis',
  phase: 'active',
  managed: false,
  wagered: false,
  access_a: 0,
  access_b: 0,
  opener_a: null,
  opener_b: null,
  placement_ms: '0',
})
const fixture = () => {
  const state = automation_fixture()
  return { ...state, world: { ...state.world, fights: { a: row('a', 20), b: row('b', 40) } } }
}

test('one stable board stays selected within 50 blocks, even when another becomes closer', () => {
  const state = fixture()
  expect(nearby_fight(state, pose)).toEqual({ character_id: 'alice', fight: 'a' })
  const selected = reduce_app_state(state, { type: 'fight/nearby', nearby: { character_id: 'alice', fight: 'a' } })
  expect(nearby_fight(selected, { ...pose, x: 39 })?.fight).toBe('a')
  expect(nearby_fight(selected, { ...pose, x: 71 })?.fight).toBe('b')
  expect(nearby_fight(selected, { ...pose, x: -30 })?.fight).toBe('a')
  expect(nearby_fight(selected, { ...pose, x: -30.01 })).toBeNull()
})

test('wrong poses, worlds, arena fights, ended fights and immersive boards cannot acquire ambient demand', () => {
  const state = fixture()
  expect(nearby_fight(state, { ...pose, character_id: 'other' })).toBeNull()
  expect(nearby_fight(state, null)).toBeNull()
  expect(nearby_fight({ ...state, fight: { ...state.fight, mounted: true } }, pose)).toBeNull()
  expect(nearby_fight({ ...state, session: { ...state.session, link_status: 'idle' } }, pose)).toBeNull()
  const fights = {
    a: { ...row('a', 5), world: 'incarnam' },
    b: { ...row('b', 5), managed: true },
    c: { ...row('c', 5), phase: 'ended' as const },
    d: { ...row('d', 5), wagered: true },
  }
  expect(nearby_fight({ ...state, world: { ...state.world, fights } }, pose)).toBeNull()
})

const checkpoint = (): HydratedFightCheckpoint =>
  create_fight({
    mode: 'local',
    seed: 9n,
    setup: {
      fight_id: 'nearby',
      board_seed: 1n,
      spells: {},
      mobs: [],
      players: [
        {
          character: 'stranger',
          owner: 'other',
          team: 0n,
          ready: false,
          hp: 100n,
          source: create_character_source({ classe: 'senshi', level: 1n }),
        },
        {
          character: 'enemy',
          owner: 'enemy',
          team: 1n,
          ready: false,
          hp: 100n,
          source: create_character_source({ classe: 'senshi', level: 1n }),
        },
      ],
    },
  }).state()

test('ambient events animate without mounting a player fight; leaving releases the runtime and ignores late snapshots', () => {
  const app = create_app()
  app.initialize({ quality: 'low', music_enabled: false, render_distance: null })
  const stop = app.observe(['fight'])
  try {
    app.dispatch({ type: 'fight/nearby', nearby: { character_id: 'alice', fight: 'nearby' } })
    const initial = checkpoint()
    const packet = {
      type: 'packet/fight_state' as const,
      fight: 'nearby',
      seats: {},
      state: { contract: initial.contract, players: initial.sources.players },
    }
    app.dispatch({ type: 'server/packet', packet: packet as never })
    const cached = app.store.getState().fight.cached.nearby!
    expect(cached).toBeDefined()
    expect(app.store.getState().fight.checkpoint).toBeNull()
    app.dispatch({
      type: 'fight/reconciled',
      mode: 'remote',
      checkpoint: cached,
      zone_ids: [],
      events: [{ type: 'fight_started', payload: {} }] as never,
      presentation_batch: 1,
      error: null,
      awaiting_turn_witness: false,
      project: false,
    })
    const { fight } = app.store.getState()
    expect(fight.mounted).toBe(false)
    expect(nearby_fight_view(fight, 'nearby').presentations).toHaveLength(1)
    app.dispatch({ type: 'fight/nearby', nearby: null })
    expect(app.store.getState().fight.cached.nearby).toBeUndefined()
    app.dispatch({ type: 'server/packet', packet: packet as never })
    expect(app.store.getState().fight.cached.nearby).toBeUndefined()
  } finally {
    stop()
  }
})
