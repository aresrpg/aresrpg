// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import {
  aggregate_result_loot,
  fight_duration,
  fight_resolution_dungeon,
  fight_result_available,
  fight_result_surface,
  fight_result_complete,
  fight_experience_after,
  format_fight_duration,
  merge_result_loot,
  next_fight_resolution_step,
  type FightResult,
  type FightResultState,
} from '../../src/modules/fight_result.ts'
import fight_result_module from '../../src/modules/fight_result.ts'
import { create_fight_result_observer, settlement_needs_close } from '../../src/modules/fight_result_observer.ts'
import { initial_app_state, type AppState } from '../../src/store.ts'
import { toast, type Toast } from '../../src/toast.ts'
import { pre_submission_version_race, retry_after_version_race } from '../../src/transaction_guard.ts'

const observe_fight_results = create_fight_result_observer(async () => undefined)

test('only a certified newly-closable settlement needs a follow-up close', () => {
  expect(settlement_needs_close({ closable: true, closed: false })).toBeTrue()
  expect(settlement_needs_close({ closable: true, closed: true })).toBeFalse()
  expect(settlement_needs_close({ closable: false, closed: false })).toBeFalse()
})

test('settlement retries one zero-gas object-version race without delaying the normal path', async () => {
  const waits: number[] = []
  let attempts = 0
  const settled = await retry_after_version_race(
    async () => {
      attempts += 1
      if (attempts === 1) throw new Error("provided version doesn't match for object 0x1")
      return 'settled'
    },
    async (milliseconds) => void waits.push(milliseconds)
  )
  expect({ attempts, settled, waits }).toEqual({ attempts: 2, settled: 'settled', waits: [250] })
  expect(pre_submission_version_race(new Error('[sdk] transaction abc failed on-chain: version'))).toBeFalse()
})

test('an ended fight keeps its result and settlement behind the terminal presentation', () => {
  expect(fight_result_available({ checkpoint: { contract: { id: '0xf1' } } } as never, '0xf1')).toBeFalse()
  expect(fight_result_available({ checkpoint: null } as never, '0xf1')).toBeTrue()
  expect(fight_result_available({ checkpoint: { contract: { id: '0xf2' } } } as never, '0xf1')).toBeTrue()
})

test('the result card owns the surface until Continue reveals level-up', () => {
  expect(fight_result_surface({ result_open: true, level_up_open: true } as never)).toBe('result')
  expect(fight_result_surface({ result_open: false, level_up_open: true } as never)).toBe('level_up')
  expect(fight_result_surface({ result_open: false, level_up_open: false } as never)).toBeNull()
})

test('fight duration is the nonnegative wall time between start and terminal observation', () => {
  expect(fight_duration(1_000, 126_900)).toBe(125_900)
  expect(fight_duration(1_000n, 126_900n)).toBe(125_900)
  expect(format_fight_duration(125_900)).toBe('2:05')
  expect(fight_duration(null, 126_900)).toBeNull()
  expect(fight_duration(2_000, 1_000)).toBe(0)
})

test('the result receipt aggregates declarations once and never shrinks when claims remove chain rows', () => {
  const declared = aggregate_result_loot([
    { item_type: 'silk', qty: 2 },
    { item_type: 'silk', qty: 3 },
    { item_type: 'fang', qty: 1 },
  ])
  expect(declared).toEqual([
    { item_type: 'silk', qty: 5 },
    { item_type: 'fang', qty: 1 },
  ])
  expect(merge_result_loot(declared, [])).toEqual(declared)
  expect(merge_result_loot(declared, [{ item_type: 'silk', qty: 2 }])).toEqual(declared)
})

test('a settled fighter source already includes its certified XP award', () => {
  expect(fight_experience_after(800, 577, false)).toBe(1_377)
  expect(fight_experience_after(1_377, 577, true)).toBe(1_377)
})

test('durable recovery collects settlement and every loot type through one transaction', () => {
  const row = {
    settled: false,
    loot_types: ['silk', 'fang'],
    drops: [{ item_type: 'silk', qty: 3 }],
  } as unknown as FightResultState['resolutions'][number]
  expect(next_fight_resolution_step(row)).toEqual({ type: 'settle' })
  expect(next_fight_resolution_step({ ...row, settled: true })).toEqual({ type: 'settle' })
})

test('an ordinary resolution with pre-migration dungeon fields never enters dungeon settlement', () => {
  expect(fight_resolution_dungeon({ dungeon: undefined, world: undefined })).toBeNull()
  expect(fight_resolution_dungeon({ dungeon: null, world: 'nauvis' })).toBeNull()
  expect(() => fight_resolution_dungeon({ dungeon: 2, world: undefined })).toThrow('incomplete dungeon identity')
  expect(fight_resolution_dungeon({ dungeon: 2, world: 'nauvis' })).toEqual({ room: 2, world: 'nauvis' })
})

const result = (overrides: Partial<FightResult> = {}): FightResult =>
  ({
    fight: '0xf1',
    dungeon: null,
    kolizeum: null,
    kolizeum_wager: null,
    winner: 0,
    duration_ms: 125_000,
    gas_spent_mist: 42n,
    own_seat: 0,
    loot_types: [],
    settlement_confirmed: false,
    progression_synced: false,
    error: null,
    result_open: true,
    level_up_open: false,
    level_up_acknowledged: false,
    participants: Object.freeze([
      {
        seat: 0,
        team: 0,
        character_id: '0xc1',
        name: 'Aiden',
        level_before: 1,
        level_after: 2,
        experience_before: 20,
        experience_after: 130,
        hp: 10,
        max_hp: 10,
        dead: false,
        forfeited: false,
        settled: false,
        xp_awarded: 110,
        loot: [{ item_type: 'silk', qty: 2 }],
      },
      {
        seat: 1,
        team: 1,
        character_id: '0xc2',
        name: 'Opponent',
        level_before: 1,
        level_after: 1,
        experience_before: 0,
        experience_after: 0,
        hp: 0,
        max_hp: 10,
        dead: true,
        forfeited: false,
        settled: false,
        xp_awarded: 0,
        loot: [],
      },
    ]),
    ...overrides,
  }) as FightResult

test('a certified settlement receipt releases Continue without waiting for graph reconciliation', () => {
  expect(fight_result_complete(result())).toBeFalse()
  expect(fight_result_complete(result({ settlement_confirmed: true }))).toBeTrue()
})

test('an empty durable-resolution snapshot proves the own settlement completed', () => {
  const base = initial_app_state({ quality: 'medium', flat_mode: false, music_enabled: true, render_distance: null })
  const current = result()
  const pending = {
    fight: '0xf1',
    world: 'nauvis',
    dungeon: null,
    kolizeum: null,
    fighter: 0,
    character: '0xc1',
    team: 0,
    winner: 0,
    dead: false,
    settled: false,
    loot_types: [],
    drops: [],
  } satisfies FightResultState['resolutions'][number]
  const state = fight_result_module.reduce!(
    {
      ...base,
      session: { ...base.session, selected_character_id: '0xc1' },
      fight_result: { current_by_character: { '0xc1': current }, resolutions: [pending], closable_fights: [] },
    },
    { type: 'server/packet', packet: { type: 'packet/fight_resolutions', resolutions: [] } }
  )
  const projected = state.fight_result.current_by_character['0xc1']!
  expect(projected.participants[0]?.settled).toBeTrue()
  expect(fight_result_complete(projected)).toBeTrue()
})

test('an unrelated empty recovery snapshot cannot certify a newly ended fight', () => {
  const base = initial_app_state({ quality: 'medium', flat_mode: false, music_enabled: true, render_distance: null })
  const current = result()
  const state = fight_result_module.reduce!(
    {
      ...base,
      fight_result: { current_by_character: { '0xc1': current }, resolutions: [], closable_fights: [] },
    },
    { type: 'server/packet', packet: { type: 'packet/fight_resolutions', resolutions: [] } }
  )
  expect(state.fight_result.current_by_character['0xc1']?.settlement_confirmed).toBeFalse()
})

test('a durable resolution received before the roster becomes visible when the Character row arrives', () => {
  const base = initial_app_state({ quality: 'medium', flat_mode: false, music_enabled: true, render_distance: null })
  const resolution = {
    fight: '0xf1',
    world: 'nauvis',
    dungeon: null,
    kolizeum: null,
    fighter: 0,
    character: '0xc1',
    team: 0,
    winner: 0,
    dead: false,
    settled: false,
    loot_types: ['silk'],
    drops: [],
  } satisfies FightResultState['resolutions'][number]
  const pending = fight_result_module.reduce!(base, {
    type: 'server/packet',
    packet: { type: 'packet/fight_resolutions', resolutions: [resolution] },
  })
  expect(pending.fight_result.current_by_character).toEqual({})
  const character = {
    id: '0xc1',
    name: 'Aiden',
    classe: 'senshi',
    level: 1,
    experience: '20',
    hp: '10',
    jobs: {},
    spells: {},
    available_stat_points: 0,
    available_spell_points: 0,
    kiosk: '0xk',
    equipment: [],
  } as const
  const loaded = fight_result_module.reduce!(
    { ...pending, session: { ...pending.session, characters: [character] as never, selected_character_id: '0xc1' } },
    { type: 'server/packet', packet: { type: 'packet/characters', characters: [character] as never } }
  )
  expect(loaded.fight_result.current_by_character['0xc1']).toMatchObject({ fight: '0xf1', loot_types: ['silk'] })
})

test('nonzero-seat recovery keeps array position separate from the chain fighter index', () => {
  const base = initial_app_state({ quality: 'medium', flat_mode: false, music_enabled: true, render_distance: null })
  const resolution = {
    fight: '0xf1',
    world: 'nauvis',
    dungeon: null,
    kolizeum: null,
    fighter: 2,
    character: '0xc1',
    team: 0,
    winner: 0,
    dead: false,
    settled: false,
    loot_types: [],
    drops: [],
  } satisfies FightResultState['resolutions'][number]
  const character = {
    id: '0xc1',
    name: 'Aiden',
    classe: 'senshi',
    level: 1,
    experience: '20',
    hp: '10',
    jobs: {},
    spells: {},
    available_stat_points: 0,
    available_spell_points: 0,
    kiosk: '0xk',
    equipment: [],
  } as const
  const pending = fight_result_module.reduce!(
    { ...base, session: { ...base.session, characters: [character] as never } },
    { type: 'server/packet', packet: { type: 'packet/fight_resolutions', resolutions: [resolution] } }
  )
  const leveled = { ...character, level: 2, experience: '130' }
  const projected = fight_result_module.reduce!(
    { ...pending, session: { ...pending.session, characters: [leveled] as never } },
    { type: 'server/packet', packet: { type: 'packet/characters', characters: [leveled] as never } }
  )
  const recovered = projected.fight_result.current_by_character['0xc1']!
  expect(recovered).toMatchObject({ own_seat: 0, participants: [{ seat: 2, level_after: 2 }] })
  const settled = fight_result_module.reduce!(projected, {
    type: 'fight_result/settled',
    character_id: '0xc1',
    fight: '0xf1',
    paid_mist: null,
  })
  expect(settled.fight_result.current_by_character['0xc1']?.participants[0]?.settled).toBeTrue()
})

test('a forfeiter has no durable loot work and may leave the result immediately', () => {
  const current = result({
    winner: 1,
    participants: Object.freeze([
      { ...result().participants[0]!, dead: true, forfeited: true, settled: true },
      result().participants[1]!,
    ]),
  })
  expect(fight_result_complete(current)).toBeTrue()
})

test('the projected level-up overlays the still-retained fight result', () => {
  const base = initial_app_state({ quality: 'medium', flat_mode: false, music_enabled: true, render_distance: null })
  const current = result({ settlement_confirmed: true })
  const before: AppState = {
    ...base,
    session: { ...base.session, selected_character_id: '0xc1' },
    fight_result: { current_by_character: { '0xc1': current }, resolutions: [], closable_fights: [] },
  }
  const roster = {
    id: '0xc1',
    name: 'Aiden',
    classe: 'senshi',
    level: 2,
    experience: '130',
    hp: '10',
    jobs: {},
    spells: {},
    available_stat_points: 5,
    available_spell_points: 1,
    kiosk: '0xk',
    equipment: [],
  } as const
  const projected = fight_result_module.reduce!(
    {
      ...before,
      session: { ...before.session, characters: [roster] as never },
    },
    { type: 'server/packet', packet: { type: 'packet/characters', characters: [roster] as never } }
  )
  const leveled = projected.fight_result.current_by_character['0xc1']!
  expect(leveled).toMatchObject({
    result_open: true,
    level_up_open: true,
    progression_synced: true,
  })
  expect(leveled.participants[0]).toMatchObject({ level_before: 1, level_after: 2, experience_after: 130 })
  const acknowledged = fight_result_module.reduce!(projected, {
    type: 'fight_result/level_acknowledged',
    character_id: '0xc1',
  })
  expect(acknowledged.fight_result.current_by_character['0xc1']).toMatchObject({
    result_open: true,
    level_up_open: false,
    level_up_acknowledged: true,
  })
  const continued = fight_result_module.reduce!(projected, { type: 'fight_result/closed', character_id: '0xc1' })
  expect(fight_result_surface(continued.fight_result.current_by_character['0xc1']!)).toBe('level_up')
})

test('a failed settlement result may close without discarding its durable recovery row', () => {
  const base = initial_app_state({ quality: 'medium', flat_mode: false, music_enabled: true, render_distance: null })
  const result = {
    fight: '0xf1',
    error: 'settlement unavailable',
    result_open: true,
    level_up_open: false,
    progression_synced: true,
  } as unknown as FightResult
  const resolution = { fight: '0xf1', character: '0xc1' } as FightResultState['resolutions'][number]
  const state = fight_result_module.reduce!(
    {
      ...base,
      session: { ...base.session, selected_character_id: '0xc1' },
      fight_result: {
        current_by_character: { '0xc1': result },
        resolutions: [resolution],
        closable_fights: [],
      },
    },
    { type: 'fight_result/closed', character_id: '0xc1' }
  )

  expect(state.fight_result.current_by_character['0xc1']).toBeUndefined()
  expect(state.fight_result.resolutions).toEqual([resolution])
})

test('durable closable recovery closes automatically without a routine finalize toast', async () => {
  const listeners = new Map<string, ((input: never) => void)[]>()
  const close_calls: string[] = []
  const base = initial_app_state({ quality: 'medium', flat_mode: false, music_enabled: true, render_distance: null })
  const state = {
    ...base,
    copy: { fight_hud: { fight_finalize_pending: 'Cleanup ready', fight_finalize_button: 'Finalize' } } as never,
    session: {
      ...base.session,
      wallet: { fight: { close: async ({ fight }: { fight: string }) => void close_calls.push(fight) } } as never,
    },
  }
  let notice: Toast | null = null
  const unsubscribe = toast.subscribe((event) => {
    if (event.type === 'show' && event.toast.actions?.length) notice = event.toast
  })
  observe_fight_results({
    events: {
      on: (name, listener) =>
        listeners.set(name, [...(listeners.get(name) ?? []), listener as unknown as (input: never) => void]),
    },
    signal: new AbortController().signal,
    get_state: () => state,
    dispatch: () => undefined,
  })
  const with_closable = fight_result_module.reduce!(state, {
    type: 'server/packet',
    packet: { type: 'packet/closable_fights', fights: [{ fight: '0xf1', kolizeum: null }] },
  })
  const cleared = fight_result_module.reduce!(with_closable, {
    type: 'server/packet',
    packet: { type: 'packet/closable_fights', fights: [] },
  })
  expect(cleared.fight_result.closable_fights).toEqual([])
  listeners
    .get('STATE_UPDATED')
    ?.forEach((listener) => (listener as unknown as (next: AppState, previous: AppState) => void)(with_closable, state))
  await Promise.resolve()
  expect(close_calls).toEqual(['0xf1'])
  expect(notice).toBeNull()
  unsubscribe()
})

test('a successful final ordinary settlement closes its newly drained fight', async () => {
  const listeners = new Map<string, ((input: never) => void)[]>()
  const settlement_calls: string[] = []
  const close_calls: string[] = []
  const dispatched: unknown[] = []
  const base = initial_app_state({ quality: 'medium', flat_mode: false, music_enabled: true, render_distance: null })
  const current = result({ loot_types: ['silk'] })
  const state: AppState = {
    ...base,
    session: {
      ...base.session,
      link_status: 'ready',
      characters: [{ id: '0xc1', kiosk: '0xk', custody: 'kiosk' }] as never,
      wallet: {
        fight: {
          settle: async () => {
            settlement_calls.push('settle')
            return { digest: 'settled', closable: true, closed: false }
          },
          close: async () => {
            close_calls.push('close')
            return { digest: 'closed' }
          },
          gas_spent: () => 0n,
        },
      } as never,
    },
    fight_result: { ...base.fight_result, current_by_character: { '0xc1': current } },
  }
  observe_fight_results({
    events: {
      on: (name, listener) =>
        listeners.set(name, [...(listeners.get(name) ?? []), listener as unknown as (input: never) => void]),
    },
    signal: new AbortController().signal,
    get_state: () => state,
    dispatch: (input) => void dispatched.push(input),
  })
  const previous = { ...state, fight_result: { ...state.fight_result, current_by_character: {} } }
  listeners
    .get('STATE_UPDATED')
    ?.forEach((listener) => (listener as unknown as (next: AppState, before: AppState) => void)(state, previous))
  await new Promise((resolve) => setTimeout(resolve, 0))

  expect(settlement_calls).toEqual(['settle'])
  expect(close_calls).toEqual(['close'])
  expect(dispatched).toContainEqual({
    type: 'fight_result/settled',
    character_id: '0xc1',
    fight: '0xf1',
    paid_mist: null,
  })
})

test('a wagered result settles through the Kolizeum escrow manager', async () => {
  const listeners = new Map<string, ((input: never) => void)[]>()
  const calls: unknown[] = []
  const dispatched: unknown[] = []
  const base = initial_app_state({ quality: 'medium', flat_mode: false, music_enabled: true, render_distance: null })
  const current = result({ kolizeum: '0xk1', loot_types: [] })
  const state: AppState = {
    ...base,
    session: {
      ...base.session,
      link_status: 'ready',
      characters: [{ id: '0xc1', kiosk: '0xk', kiosk_cap: '0xcap', custody: 'kiosk' }] as never,
      wallet: {
        fight: {
          settle: async () => Promise.reject(new Error('generic wagered settlement must not run')),
          gas_spent: () => 0n,
        },
        kolizeum: {
          settle: async (args: unknown) => {
            calls.push(args)
            return { digest: 'settled', paid_mist: 9n, closed: true }
          },
        },
      } as never,
    },
    fight_result: { ...base.fight_result, current_by_character: { '0xc1': current } },
  }
  observe_fight_results({
    events: {
      on: (name, listener) =>
        listeners.set(name, [...(listeners.get(name) ?? []), listener as unknown as (input: never) => void]),
    },
    signal: new AbortController().signal,
    get_state: () => state,
    dispatch: (input) => void dispatched.push(input),
  })
  const previous = { ...state, fight_result: { ...state.fight_result, current_by_character: {} } }
  listeners
    .get('STATE_UPDATED')
    ?.forEach((listener) => (listener as unknown as (next: AppState, before: AppState) => void)(state, previous))
  await new Promise((resolve) => setTimeout(resolve, 0))

  expect(calls).toEqual([
    { kolizeum: '0xk1', fight: '0xf1', fighter_idx: 0n, custody: { kiosk: '0xk', kiosk_cap: '0xcap' } },
  ])
  expect(dispatched).toContainEqual({
    type: 'fight_result/settled',
    character_id: '0xc1',
    fight: '0xf1',
    paid_mist: 9n,
  })
})

test('a refused settlement waits for explicit Retry instead of reopening signing', async () => {
  const listeners = new Map<string, ((input: never) => void)[]>()
  let settlement_calls = 0
  const base = initial_app_state({ quality: 'medium', flat_mode: false, music_enabled: true, render_distance: null })
  const current = result()
  const state: AppState = {
    ...base,
    session: {
      ...base.session,
      link_status: 'ready',
      characters: [{ id: '0xc1', kiosk: '0xk' }] as never,
      wallet: {
        fight: {
          settle: async () => {
            settlement_calls += 1
            throw new Error('wallet cancelled')
          },
          gas_spent: () => 0n,
        },
      } as never,
    },
    fight_result: { ...base.fight_result, current_by_character: { '0xc1': current } },
  }
  observe_fight_results({
    events: {
      on: (name, listener) =>
        listeners.set(name, [...(listeners.get(name) ?? []), listener as unknown as (input: never) => void]),
    },
    signal: new AbortController().signal,
    get_state: () => state,
    dispatch: () => undefined,
  })
  const previous = { ...state, fight_result: { ...state.fight_result, current_by_character: {} } }
  listeners
    .get('STATE_UPDATED')
    ?.forEach((listener) => (listener as unknown as (next: AppState, before: AppState) => void)(state, previous))
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(settlement_calls).toBe(1)
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(settlement_calls).toBe(1)
  listeners
    .get('fight_result/retry')
    ?.forEach((listener) =>
      (listener as unknown as (input: { character_id: string }) => void)({ character_id: '0xc1' })
    )
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(settlement_calls).toBe(2)
})
