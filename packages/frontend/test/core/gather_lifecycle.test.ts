// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test, spyOn } from 'bun:test'

import { reduce_gatherings, observe_world_gather, type PendingGather } from '../../src/modules/world_gather.ts'
import { initial_app_state, type AppContext, type AppState } from '../../src/store.ts'
import { toast } from '../../src/toast.ts'

const gather = (character_id: string, attempt_id = 'first'): PendingGather => ({
  character_id,
  attempt_id,
  item_type: 'wheat',
  protector: 'protector_wheat_bricheton',
  started_at_ms: 1,
  duration_ms: 12,
  ends_at_ms: 13,
  confirmed: true,
  authoritative: true,
  ambushed: false,
  quantity: 2,
})

test('gathering is per character and late callbacks cannot settle a newer attempt', () => {
  let rows = reduce_gatherings({}, { type: 'world/gather_started', gathering: gather('alice') })
  rows = reduce_gatherings(rows, { type: 'world/gather_started', gathering: gather('bob') })
  expect(Object.keys(rows)).toEqual(['alice', 'bob'])
  expect(reduce_gatherings(rows, { type: 'world/gather_failed', character_id: 'alice', attempt_id: 'old' })).toBe(rows)
  rows = reduce_gatherings(rows, {
    type: 'world/gather_finished',
    character_id: 'alice',
    attempt_id: 'first',
    ends_at_ms: 13,
  })
  expect(Object.keys(rows)).toEqual(['bob'])
})

test('observer restart finishes an elapsed gather without a retained toast', () => {
  const base = initial_app_state({ quality: 'medium', flat_mode: false, music_enabled: false, render_distance: null })
  let state: AppState = { ...base, world: { ...base.world, gathering: { alice: gather('alice') } } }
  const controller = new AbortController()
  const inputs: unknown[] = []
  observe_world_gather({
    events: { on: () => {} } as unknown as AppContext['events'],
    get_state: () => state,
    dispatch: (input) => {
      inputs.push(input)
      if (input.type === 'world/gather_finished')
        state = {
          ...state,
          world: { ...state.world, gathering: reduce_gatherings(state.world.gathering, input) },
        }
    },
    signal: controller.signal,
  })
  expect(inputs).toContainEqual({
    type: 'world/gather_finished',
    character_id: 'alice',
    attempt_id: 'first',
    ends_at_ms: 13,
  })
  expect(state.world.gathering).toEqual({})
  controller.abort()
})

test('an early timer reschedules until the authoritative deadline', async () => {
  const clock = spyOn(Date, 'now').mockReturnValue(1)
  const base = initial_app_state({ quality: 'medium', flat_mode: false, music_enabled: false, render_distance: null })
  let state: AppState = { ...base, world: { ...base.world, gathering: { alice: gather('alice') } } }
  const controller = new AbortController()
  try {
    observe_world_gather({
      events: { on: () => {} } as unknown as AppContext['events'],
      get_state: () => state,
      dispatch: (input) => {
        if (input.type === 'world/gather_finished')
          state = {
            ...state,
            world: { ...state.world, gathering: reduce_gatherings(state.world.gathering, input) },
          }
      },
      signal: controller.signal,
    })
    await Bun.sleep(30)
    expect(state.world.gathering.alice).toBeDefined()
    clock.mockReturnValue(13)
    await Bun.sleep(30)
    expect(state.world.gathering).toEqual({})
  } finally {
    controller.abort()
    clock.mockRestore()
  }
})

test('a projected protector resolves for its character despite an unconfirmed local gather', async () => {
  const calls: unknown[] = []
  const listeners = new Map<string, (input: unknown) => void>()
  const controller = new AbortController()
  const base = initial_app_state({ quality: 'medium', flat_mode: false, music_enabled: false, render_distance: null })
  const state = {
    ...base,
    session: {
      ...base.session,
      selected_character_id: 'bob',
      wallet: {
        character: {
          resolve_ambush: async (input: unknown) => {
            calls.push(input)
            return { fight: 'fight' }
          },
        },
      },
      characters: [{ id: 'alice', kiosk: 'kiosk', ambush: { protector: 'protector_wheat_bricheton' } }],
    },
    world: { ...base.world, gathering: { alice: { ...gather('alice'), confirmed: false, quantity: null } } },
  } as unknown as AppState
  observe_world_gather({
    events: {
      on: (type: string, listener: (input: unknown) => void) => listeners.set(type, listener),
    } as unknown as AppContext['events'],
    get_state: () => state,
    dispatch: (input) => listeners.get(input.type)?.(input),
    signal: controller.signal,
  })
  await Promise.resolve()
  expect(calls).toEqual([
    { character_id: 'alice', protector_mob_type: 'protector_wheat_bricheton', custody: { kiosk: 'kiosk' } },
  ])
  controller.abort()
})

test('a gather removed by the roster dismisses its loading notice when its reply arrives', async () => {
  const shown: string[] = []
  const removed: string[] = []
  const unsubscribe = toast.subscribe((event) => {
    if (event.type === 'show') shown.push(event.toast.id)
    else removed.push(event.id)
  })
  const controller = new AbortController()
  const listeners = new Map<string, (input: unknown) => void>()
  let finish!: (value: { quantity: number; ambushed: boolean }) => void
  const base = initial_app_state({ quality: 'medium', flat_mode: false, music_enabled: false, render_distance: null })
  let state = {
    ...base,
    session: {
      ...base.session,
      selected_character_id: 'alice',
      wallet: {
        character: {
          gather: () =>
            new Promise((resolve) => {
              finish = resolve
            }),
        },
      },
      characters: [
        {
          id: 'alice',
          world: 'nauvis',
          kiosk: 'kiosk',
          jobs: {},
          equipment: [{ slot: 'tool', category: 'tool_farmer' }],
        },
      ],
    },
    world: {
      ...base.world,
      zones: { 'nauvis:97:97': { res_taken: [], mob_taken: '0' } },
      spawns: { 'nauvis:97:97': { mobs: [], resources: [{ index: 0, item_type: 'wheat', nodes: 2 }] } },
    },
  } as unknown as AppState
  try {
    observe_world_gather({
      events: {
        on: (type: string, listener: (input: unknown) => void) => listeners.set(type, listener),
      } as unknown as AppContext['events'],
      get_state: () => state,
      dispatch: (input) => {
        if (input.type === 'world/gather_started')
          state = {
            ...state,
            world: { ...state.world, gathering: reduce_gatherings(state.world.gathering, input) },
          }
      },
      signal: controller.signal,
    })
    listeners.get('world/gather')!({ node: 'nauvis:97:97:s1:r0:n0' })
    expect(shown).toHaveLength(1)
    state = { ...state, world: { ...state.world, gathering: {} } }
    finish({ quantity: 2, ambushed: false })
    await Bun.sleep(0)
    expect(removed).toContain(shown[0]!)
    expect(state.world.gathering).toEqual({})
  } finally {
    controller.abort()
    unsubscribe()
  }
})
