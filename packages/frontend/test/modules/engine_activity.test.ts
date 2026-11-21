// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { sync_world_activity } from '../../src/modules/engine_activity.ts'
import { reduce_app_state, type AppState } from '../../src/store.ts'

import { automation_fixture, character } from './automation_fixture.ts'

const ROOT_MS = 500_000

/** The scene's own rule: an action starts only when the lock's identity changes. */
const recording_world = () => {
  const started: string[] = []
  let key: string | null = null
  return {
    started,
    set_active: () => {},
    set_interactive: () => {},
    set_action_lock: (next: Readonly<{ character_id: string; animation: 'gather' | null }> | null) => {
      const next_key = next ? `${next.character_id}:${next.animation ?? ''}` : null
      if (next_key === key) return
      key = next_key
      if (next?.animation === 'gather') started.push(next.character_id)
    },
  }
}

const observed_row = (state: AppState): AppState =>
  reduce_app_state(state, {
    type: 'server/packet',
    packet: {
      type: 'packet/agent_observed',
      id: state.session.agent_view.serial,
      characters: [{ ...character(), id: 'remote', name: 'Agent', at_ms: ROOT_MS }],
      selected_character_id: 'remote',
      failed: false,
    },
  })
const watching_at = (chain_ms: number, sample_age_ms = 0): AppState => {
  const state = reduce_app_state(automation_fixture(), {
    type: 'agent/watch',
    observation: {
      pairing: { address: 'paired', multisig_public_key: 'public', signer_mode: 'disposable' },
      public_identifier: 'google',
      character_id: null,
    },
  })
  return observed_row({ ...state, chain_clock: { chain_ms, observed_at: performance.now() - sample_age_ms } })
}

test('a watched gather starts once, however often its row and unrelated state arrive', () => {
  const world = recording_world()
  const state = watching_at(ROOT_MS - 60_000)
  sync_world_activity(world, state)
  sync_world_activity(world, observed_row(state))
  sync_world_activity(world, { ...state, navigation: { ...state.navigation } })
  expect(world.started).toEqual(['remote'])
})

test('the watched gather ends on live chain time, not on the age of the last heartbeat', () => {
  const world = recording_world()
  sync_world_activity(world, watching_at(ROOT_MS - 2_000, 3_000))
  expect(world.started).toEqual([])
  sync_world_activity(world, watching_at(ROOT_MS - 2_000))
  expect(world.started).toEqual(['remote'])
})

test('a watched gather cannot outlive a lost chain clock', () => {
  const world = recording_world()
  sync_world_activity(world, { ...watching_at(ROOT_MS - 60_000), chain_clock: null })
  sync_world_activity(world, watching_at(ROOT_MS - 60_000, 60_000))
  expect(world.started).toEqual([])
})
