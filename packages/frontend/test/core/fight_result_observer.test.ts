// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import fight_result_module, { type FightResult, type ResultParticipant } from '../../src/modules/fight_result.ts'
import { create_fight_result_observer, settlement_is_final } from '../../src/modules/fight_result_observer.ts'
import session_module from '../../src/modules/session.ts'
import { initial_app_state, type AppState } from '../../src/store.ts'

const participant = (seat: number, character_id: string): ResultParticipant =>
  Object.freeze({
    seat,
    team: 0,
    character_id,
    name: character_id,
    level_before: 1,
    level_after: 1,
    experience_before: 0,
    experience_after: 0,
    hp: 10,
    max_hp: 10,
    dead: false,
    forfeited: false,
    settled: false,
    xp_awarded: 0,
    loot: [],
  })

const fight_result = (own_seat: number, participants: readonly ResultParticipant[]): FightResult =>
  Object.freeze({
    fight: '0xf1',
    dungeon: null,
    kolizeum: null,
    kolizeum_wager: null,
    winner: 0,
    duration_ms: 1,
    gas_spent_mist: 0n,
    participants,
    own_seat,
    loot_types: ['amber'],
    settlement_confirmed: false,
    progression_synced: false,
    error: null,
    result_open: true,
    level_up_open: false,
    level_up_acknowledged: false,
  })

test('a solo PvM settlement is final while another unsettled player is not', () => {
  const own = participant(0, '0xc1')
  const mob = { ...participant(1, 'mob'), character_id: null, settled: true }

  expect(settlement_is_final(fight_result(0, [own, mob]), new Set([0]))).toBeTrue()
  expect(settlement_is_final(fight_result(0, [own, participant(1, '0xc2')]), new Set([0]))).toBeFalse()
})

test('owned fighters sharing one kiosk merge duplicate stacks after settlement projection', async () => {
  const listeners = new Map<string, ((...args: never[]) => void)[]>()
  const settlement_batches: unknown[] = []
  const merge_calls: unknown[] = []
  const base = initial_app_state({ quality: 'medium', flat_mode: false, music_enabled: true, render_distance: null })
  const participants = Object.freeze([participant(0, '0xc1'), participant(1, '0xc2')])
  let state: AppState = {
    ...base,
    session: {
      ...base.session,
      link_status: 'ready',
      characters: [
        { id: '0xc1', kiosk: '0xk', kiosk_cap: '0xcap', custody: 'fight' },
        { id: '0xc2', kiosk: '0xk', kiosk_cap: '0xcap', custody: 'fight' },
      ] as never,
      wallet: {
        fight: {
          settle: async ({ settlements, last }: { settlements: unknown; last: boolean }) => {
            settlement_batches.push({ settlements, last })
            return { digest: `settled-${settlement_batches.length}` }
          },
          gas_spent: () => 0n,
        },
        stacks: {
          merge_many: async (groups: unknown) => {
            merge_calls.push(groups)
            return { digest: 'merged' }
          },
        },
      } as never,
    },
    fight_result: {
      ...base.fight_result,
      current_by_character: { '0xc1': fight_result(0, participants), '0xc2': fight_result(1, participants) },
    },
  }
  const emit_state = (previous: AppState): void =>
    listeners.get('STATE_UPDATED')?.forEach((listener) => listener(state as never, previous as never))
  create_fight_result_observer(async () => undefined)({
    events: {
      on: (name, listener) =>
        listeners.set(name, [...(listeners.get(name) ?? []), listener as unknown as (...args: never[]) => void]),
    },
    signal: new AbortController().signal,
    get_state: () => state,
    dispatch: (input) => {
      const previous = state
      state = session_module.reduce!(fight_result_module.reduce!(state, input), input)
      if (state !== previous) emit_state(previous)
    },
  })

  emit_state({ ...state, fight_result: { ...state.fight_result, current_by_character: {} } })
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(settlement_batches).toEqual([
    {
      settlements: [
        { fighter_idx: 0n, loot: [{ item_type: 'amber', existing: null }] },
        { fighter_idx: 1n, loot: [{ item_type: 'amber', existing: null }] },
      ],
      last: true,
    },
  ])

  const previous = state
  state = {
    ...state,
    session: {
      ...state.session,
      inventory: [
        { id: '0xamber-a', item_type: 'amber', category: 'resource', amount: 2, kiosk: '0xk' },
        { id: '0xamber-b', item_type: 'amber', category: 'resource', amount: 3, kiosk: '0xk' },
      ] as never,
    },
  }
  emit_state(previous)
  await new Promise((resolve) => setTimeout(resolve, 0))

  expect(merge_calls).toEqual([[{ kiosk: '0xk', target_id: '0xamber-b', source_ids: ['0xamber-a'] }]])
})
