// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import type { CharacterRow } from '@aresrpg/protocol'

import { run_to_target } from '../../src/modules/run_to.ts'
import { automation_command, automation_wake_delay, reduce_automation } from '../../src/modules/automation.ts'
import type { AppInput, AppState } from '../../src/store.ts'

import { automation_fixture, character, key, ready_to_gather, resource, tick } from './automation_fixture.ts'

const started: AppInput = {
  type: 'world/gather_started',
  gathering: {
    attempt_id: 'attempt',
    character_id: 'alice',
    item_type: resource.item_type,
    protector: resource.protector,
    started_at_ms: 1,
    duration_ms: 12_000,
    ends_at_ms: 12_001,
    confirmed: false,
    authoritative: false,
    ambushed: false,
    quantity: null,
  },
}
const confirmed: AppInput = {
  type: 'world/gather_confirmed',
  character_id: 'alice',
  attempt_id: 'attempt',
  quantity: 3,
  ambushed: false,
  fallback_ends_at_ms: 12_001,
}
const consume = (state: AppState): AppState => ({
  ...state,
  world: { ...state.world, zones: { [key]: { ...state.world.zones[key]!, res_taken: [1] } } },
})

test('one command per harvest, duplicate confirmations count once, and consumption must be visible', () => {
  const planned = reduce_automation(automation_fixture(), tick())
  const gathering = reduce_automation(planned, tick(1_250))
  expect(automation_command(gathering, planned)?.type).toBe('world/gather')
  let state = reduce_automation(gathering, started)
  expect(automation_command(state, gathering)).toBeNull()
  state = reduce_automation(state, confirmed)
  expect(state.automation.quantity).toBe(3)
  expect(reduce_automation(state, confirmed)).toBe(state)
  expect(reduce_automation(state, tick(2_000))).toBe(state)
  const next = reduce_automation(consume(state), tick(2_250))
  expect(next.automation.run?.step.type).toBe('planning')
})

test('consumption arriving before the receipt does not authorize another gather', () => {
  const state = consume(reduce_automation(ready_to_gather(), started))
  expect(reduce_automation(state, tick())).toBe(state)
  const confirmed_state = reduce_automation(state, confirmed)
  expect(reduce_automation(confirmed_state, tick()).automation.run?.step.type).toBe('planning')
})

test('the gather root outlives confirmation and consumed-node projection', () => {
  let state = consume(reduce_automation(reduce_automation(ready_to_gather(), started), confirmed))
  state = { ...state, world: { ...state.world, gathering: { alice: started.gathering } } }
  expect(reduce_automation(state, tick())).toBe(state)
})

test('stop and character changes discard late completions without restarting', () => {
  const state = reduce_automation(ready_to_gather(), started)
  const stopped = reduce_automation(state, { type: 'automation/stop', reason: 'stopped' })
  expect(reduce_automation(stopped, confirmed).automation.run).toBeNull()
  const switched = reduce_automation(
    { ...state, session: { ...state.session, selected_character_id: 'bob' } },
    { type: 'character/select', character_id: 'bob' }
  )
  expect(switched.automation.run).toBeNull()
})

test('failed and uncertain gathers stop, stale attempt failures do not', () => {
  const state = reduce_automation(ready_to_gather(), started)
  expect(reduce_automation(state, { type: 'world/gather_failed', character_id: 'alice', attempt_id: 'old' })).toBe(
    state
  )
  const failed = reduce_automation(state, { type: 'world/gather_failed', character_id: 'alice', attempt_id: 'attempt' })
  expect(failed.automation.reason).toBe('failed')
  expect(reduce_automation(failed, tick()).automation.run).toBeNull()
  expect(reduce_automation(state, tick(90_000))).toBe(state)
})

test('stale zone generations are replanned instead of gathering a replacement pack', () => {
  const inspecting = reduce_automation(automation_fixture(), tick())
  const changed = {
    ...inspecting,
    world: { ...inspecting.world, zones: { [key]: { ...inspecting.world.zones[key]!, seed: '2' } } },
  }
  expect(reduce_automation(changed, tick()).automation.run?.step.type).toBe('planning')
})

test('freshness, tools, custody, and checkpoint roots gate automated writes', () => {
  const state = automation_fixture()
  expect(reduce_automation({ ...state, session: { ...state.session, indexing_lag: 301 } }, tick()).automation.run).toBe(
    state.automation.run
  )
  expect(
    reduce_automation({ ...state, session: { ...state.session, link_status: 'connecting' } }, tick()).automation.run
  ).toBe(state.automation.run)
  const untooled = { ...state, session: { ...state.session, characters: [{ ...character(), equipment: [] }] } }
  expect(reduce_automation(untooled, tick()).automation.run).toBeNull()
  const rooted = { ...state, session: { ...state.session, characters: [{ ...character(), at_ms: 999_999 }] } }
  const inspecting = reduce_automation(rooted, tick())
  expect(reduce_automation(inspecting, tick()).automation.run?.step.type).toBe('inspecting')
})

test('manual run-to stops automation while renderer inactivity preserves it', () => {
  const state = automation_fixture()
  const far = { ...tick(), pose: { ...tick().pose!, x: -100 } }
  const moving = reduce_automation(state, far)
  expect(moving.automation.run?.step.type).toBe('moving')
  const inactive = reduce_automation(moving, { type: 'run_to/stopped', reason: 'inactive', restore_flat: false })
  expect(inactive.automation.run?.step.type).toBe('planning')
  expect(reduce_automation(moving, { ...far, world_ms: 120_000 })).toBe(moving)
  expect(reduce_automation(moving, { type: 'run_to/position', world: 'nauvis', x: 1, z: 1 }).automation.run).toBeNull()
  expect(
    reduce_automation(moving, { type: 'run_to/stopped', reason: 'manual', restore_flat: false }).automation.run
  ).toBeNull()
})

test('only the gather-correlated protector is forfeited, once, then custody gates resumption', () => {
  let state = reduce_automation(reduce_automation(ready_to_gather(), started), confirmed)
  const unrelated = { type: 'world/ambush_resolved', character_id: 'alice', attempt_id: 'old', fight: 'other' } as const
  expect(reduce_automation(state, unrelated)).toBe(state)
  state = reduce_automation(state, { ...unrelated, attempt_id: 'attempt', fight: 'protector' })
  state = {
    ...state,
    fight: {
      ...state.fight,
      mode: 'remote',
      cached: {
        protector: {
          contract: {
            id: 'protector',
            ended: false,
            fighters: [
              {
                kind: { type: 'player', character: 'alice', owner: 'owner' },
                dead: false,
                forfeited: false,
                settled: false,
              },
            ],
          },
        },
      },
    },
  } as unknown as AppState
  const submitting = reduce_automation(state, tick())
  expect(automation_command(submitting, state)).toEqual({
    type: 'fight/input',
    fight: 'protector',
    origin: 'local',
    input: { type: 'forfeit', fighter: 0n },
  })
  expect(automation_command(reduce_automation(submitting, tick()), submitting)).toBeNull()
  const completed = reduce_automation(submitting, {
    type: 'fight/forfeit_completed',
    fight: 'protector',
    fighter: 0n,
    ok: true,
  })
  const custody_pending = {
    ...completed,
    session: { ...completed.session, characters: [{ ...character(), custody: 'fight' as const }] },
  }
  expect(reduce_automation(custody_pending, tick()).automation.run?.step.type).toBe('gathering')
  expect(reduce_automation(completed, tick()).automation.run?.step.type).toBe('planning')
  expect(
    reduce_automation(submitting, { type: 'fight/forfeit_completed', fight: 'protector', fighter: 0n, ok: false })
      .automation.reason
  ).toBe('failed')
})

test('ambush resolution failure stops and duplicate resolution cannot re-arm forfeit', () => {
  const state = reduce_automation(ready_to_gather(), started)
  expect(
    reduce_automation(state, { type: 'world/ambush_failed', character_id: 'alice', attempt_id: 'attempt' }).automation
      .reason
  ).toBe('failed')
  const resolved = reduce_automation(state, {
    type: 'world/ambush_resolved',
    character_id: 'alice',
    attempt_id: 'attempt',
    fight: 'protector',
  })
  expect(automation_command(resolved, state)).toBeNull()
})

test('search accepts fractional action time and waits for a complete newer zone generation', () => {
  const base = automation_fixture()
  const inspecting: AppState = {
    ...base,
    world: { ...base.world, zones: {}, spawns: {} },
    automation: {
      ...base.automation,
      run: {
        ...base.automation.run!,
        step: { type: 'inspecting', target: { key, x: 50_000, z: 50_000, node: null } },
      },
    },
  }
  const searching = reduce_automation(inspecting, { ...tick(), world_ms: 101_000.5 })
  expect(searching.automation.run?.step.type).toBe('searching')
  expect(automation_command(searching, inspecting)?.type).toBe('world/search_zone')
  expect(reduce_automation(searching, tick())).toBe(searching)
  const partial = { ...searching, world: { ...searching.world, zones: base.world.zones } }
  expect(reduce_automation(partial, tick())).toBe(partial)
  const complete = { ...partial, world: base.world }
  expect(reduce_automation(complete, tick()).automation.run?.step.type).toBe('planning')
  expect(reduce_automation(searching, { type: 'world/search_zone_failed', key }).automation.reason).toBe('failed')
  expect(reduce_automation(searching, { type: 'world/search_zone_failed', key: 'other' })).toBe(searching)
})

test('an unavailable population is never declared depleted and a refresh needs a newer search timestamp', () => {
  const base = automation_fixture()
  const inspecting: AppState = {
    ...base,
    world: { ...base.world, spawns: {} },
    automation: {
      ...base.automation,
      run: {
        ...base.automation.run!,
        step: { type: 'inspecting', target: { key, x: 50_000, z: 50_000, node: null } },
      },
    },
  }
  expect(reduce_automation(inspecting, tick())).toBe(inspecting)
  const refresh: AppState = {
    ...base,
    automation: {
      ...base.automation,
      run: {
        ...base.automation.run!,
        step: {
          type: 'searching',
          target: { key, world: 'nauvis', x: 50_000, z: 50_000, kind: 'reroll', previous_searched_at_ms: 1 },
        },
      },
    },
  }
  expect(reduce_automation(refresh, tick())).toBe(refresh)
  const newer = {
    ...refresh,
    world: { ...refresh.world, zones: { [key]: { ...refresh.world.zones[key]!, searched_at_ms: 2 } } },
  }
  expect(reduce_automation(newer, tick()).automation.run?.step.type).toBe('planning')
})

test('automation requests pet riding while ordinary run-to preserves manual control', () => {
  const state = automation_fixture()
  const run = {
    status: 'running' as const,
    source: 'automation' as const,
    controlled_character_id: 'alice',
    name: 'nauvis',
    world: 'nauvis',
    x: 50_010,
    z: 50_020,
  }
  expect(run_to_target({ ...state, run_to: { run, restore_flat: false } })).toEqual({ x: 10, z: 20, ride_pet: true })
  expect(run_to_target({ ...state, run_to: { run: { ...run, source: 'position' }, restore_flat: false } })).toEqual({
    x: 10,
    z: 20,
  })
})

test('a cached protector waits for the remote command path before marking forfeit submitted', () => {
  let state = reduce_automation(reduce_automation(ready_to_gather(), started), confirmed)
  state = reduce_automation(state, {
    type: 'world/ambush_resolved',
    character_id: 'alice',
    attempt_id: 'attempt',
    fight: 'protector',
  })
  state = {
    ...state,
    fight: {
      ...state.fight,
      mode: null,
      cached: {
        protector: {
          contract: {
            id: 'protector',
            ended: false,
            dungeon: null,
            wagered: false,
            fighters: [
              {
                kind: { type: 'player', character: 'alice', owner: 'owner' },
                dead: false,
                forfeited: false,
                settled: false,
              },
            ],
          },
        },
      },
    },
  } as unknown as AppState
  const awaiting_mount = reduce_automation(state, tick())
  expect(awaiting_mount.automation.run?.step).toMatchObject({ forfeit: 'idle' })
  expect(automation_command(awaiting_mount, state)).toBeNull()
  const mounted = { ...awaiting_mount, fight: { ...awaiting_mount.fight, mode: 'remote' as const } }
  const submitting = reduce_automation(mounted, tick())
  expect(automation_command(submitting, mounted)).toMatchObject({ type: 'fight/input', input: { type: 'forfeit' } })
})

test('the next inspection wakes at the known chain root instead of a full poll later', () => {
  const base = reduce_automation(automation_fixture(), tick())
  const rooted: AppState = {
    ...base,
    chain_clock: { chain_ms: 101_000, received_ms: 1_000 },
    session: { ...base.session, characters: [{ ...character(), at_ms: 101_025 }] },
  }
  expect(automation_wake_delay(rooted, 101_001)).toBe(24)
  expect(automation_wake_delay(rooted, 101_024.5)).toBe(1)
  expect(automation_wake_delay(rooted, 101_025)).toBe(250)
  expect(automation_wake_delay({ ...rooted, chain_clock: null }, 101_001)).toBe(24)
})

test('inspection wakes at the legal travel budget, including the both-end pet rule', () => {
  const base = reduce_automation(automation_fixture(), tick())
  const { step } = base.automation.run!
  if (step.type !== 'inspecting') throw new Error('Expected an inspection')
  const walking: AppState = {
    ...base,
    chain_clock: { chain_ms: 101_800, received_ms: 1_000 },
    session: { ...base.session, characters: [{ ...character(), at_ms: 101_000 }] },
    automation: {
      ...base.automation,
      run: { ...base.automation.run!, step: { ...step, target: { ...step.target, x: 50_010 } } },
    },
  }
  expect(automation_wake_delay(walking, 101_800)).toBe(70)
  const equipped = {
    ...character(),
    at_ms: 101_000,
    equipment: [...character().equipment, { slot: 'pet' } as CharacterRow['equipment'][number]],
  }
  const newly_equipped = { ...walking, session: { ...walking.session, characters: [equipped] } }
  expect(automation_wake_delay(newly_equipped, 101_800)).toBe(70)
  const riding = {
    ...newly_equipped,
    chain_clock: { chain_ms: 101_550, received_ms: 1_000 },
    session: { ...walking.session, characters: [{ ...equipped, pet: true }] },
  }
  expect(automation_wake_delay(riding, 101_550)).toBe(30)
})

test('a resource already within the manual interaction radius gathers without walking to its center', () => {
  const state = automation_fixture()
  const nearby = { ...tick(), pose: { ...tick().pose!, x: -10 } }
  const inspecting = reduce_automation(state, nearby)
  expect(inspecting.automation.run?.step.type).toBe('inspecting')
  const gathering = reduce_automation(inspecting, nearby)
  expect(automation_command(gathering, inspecting)?.type).toBe('world/gather')
})

test('page navigation and temporary clock or connection gaps preserve the active run', () => {
  const state = automation_fixture()
  const elsewhere: AppState = { ...state, navigation: { ...state.navigation, page: 'leaderboard' } }
  expect(reduce_automation(elsewhere, { type: 'page/open', page: 'leaderboard' }).automation.run).toBe(
    state.automation.run
  )
  const disconnected = { ...elsewhere, session: { ...elsewhere.session, link_status: 'connecting' as const } }
  expect(reduce_automation(disconnected, tick()).automation.run).toBe(state.automation.run)
  expect(reduce_automation(elsewhere, { ...tick(), world_ms: null }).automation.run).toBe(state.automation.run)
})

test('a timing refusal retains the run and waits before retrying the current target', () => {
  const gathering = reduce_automation(ready_to_gather(), started)
  const refusal = {
    type: 'world/gather_failed',
    character_id: 'alice',
    attempt_id: 'attempt',
    retry_at_ms: 1_500,
  } as const
  const retrying = reduce_automation(gathering, refusal)
  expect(retrying.automation.run?.step.type).toBe('retrying')
  expect(retrying.automation.quantity).toBe(0)
  expect(reduce_automation(retrying, { ...tick(), monotonic_ms: 1_499 })).toBe(retrying)
  const inspecting = reduce_automation(retrying, { ...tick(), monotonic_ms: 1_500 })
  expect(inspecting.automation.run?.step.type).toBe('inspecting')
  const next = reduce_automation(inspecting, { ...tick(), monotonic_ms: 1_501 })
  expect(automation_command(next, inspecting)?.type).toBe('world/gather')
})

test('stop cancels a pending retry and stale attempts cannot schedule retries', () => {
  const gathering = reduce_automation(ready_to_gather(), started)
  const refusal = {
    type: 'world/gather_failed',
    character_id: 'alice',
    attempt_id: 'attempt',
    retry_at_ms: 1_500,
  } as const
  expect(reduce_automation(gathering, { ...refusal, attempt_id: 'old' })).toBe(gathering)
  const retrying = reduce_automation(gathering, refusal)
  const stopped = reduce_automation(retrying, { type: 'automation/stop', reason: 'stopped' })
  expect(reduce_automation(stopped, { ...tick(), monotonic_ms: 9_000 }).automation.run).toBeNull()
})

test('zone-search timing retries re-enter inspection instead of replaying the stale search', () => {
  const base = automation_fixture()
  const searching: AppState = {
    ...base,
    automation: {
      ...base.automation,
      run: {
        ...base.automation.run!,
        step: {
          type: 'searching',
          target: { key, world: 'nauvis', x: 50_000, z: 50_000, kind: 'discover', previous_searched_at_ms: null },
        },
      },
    },
  }
  const retrying = reduce_automation(searching, { type: 'world/search_zone_failed', key, retry_at_ms: 1_500 })
  expect(retrying.automation.run?.step.type).toBe('retrying')
  const inspecting = reduce_automation(retrying, { ...tick(), monotonic_ms: 1_500 })
  expect(inspecting.automation.run?.step.type).toBe('inspecting')
  expect(automation_command(inspecting, retrying)).toBeNull()
})
