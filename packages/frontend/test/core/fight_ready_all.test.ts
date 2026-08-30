// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import fight_chain from '../../src/modules/fight_chain.ts'
import { initial_app_state, reduce_app_state, type AppInput, type AppState } from '../../src/store.ts'

const fighter = (character: string, owner: string, team: number, cell: number) => ({
  team,
  kind: { type: 'player', character, owner, level: 10n },
  cell,
  ready: false,
  dead: false,
  settled: false,
  forfeited: false,
  hp: 100,
  ap: 6,
  mp: 3,
  drops: [],
  effects: [],
  cooldowns: [],
})

test('Ready all submits every owned unready seat through one guarded action', async () => {
  const listeners = new Map<string, ((payload: never) => void)[]>()
  const calls: unknown[] = []
  const base = initial_app_state({ quality: 'medium', flat_mode: false, music_enabled: true, render_distance: null })
  const checkpoint = {
    contract: {
      id: '0xf',
      round: 0n,
      ended: false,
      wagered: false,
      fighters: [fighter('0xa', '0xme', 0, 1), fighter('0xb', '0xother', 1, 2), fighter('0xc', '0xme', 0, 3)],
    },
  }
  let state: AppState = {
    ...base,
    fight: { ...base.fight, mode: 'remote', checkpoint: checkpoint as never, cached: { '0xf': checkpoint as never } },
    session: {
      ...base.session,
      characters: [
        { id: '0xa', kiosk: '0xka' },
        { id: '0xc', kiosk: '0xkc' },
      ] as never,
      wallet: {
        address: '0xme',
        fight: {
          ready_many: async (
            args: Readonly<{
              fight: string
              fighter_indices: readonly bigint[]
              on_progress: (
                progress: Readonly<{
                  completed: number
                  total: number
                  fighter_idx: bigint
                  started: boolean
                }>
              ) => void
            }>
          ) => {
            calls.push({ fight: args.fight, fighter_indices: args.fighter_indices })
            args.on_progress({ completed: 1, total: 2, fighter_idx: 0n, started: false })
            args.on_progress({ completed: 2, total: 2, fighter_idx: 2n, started: true })
            return { digest: 'ready-all', started: false, turn_witnesses: [] }
          },
        },
      } as never,
    },
  }
  const emit = (input: AppInput): void => {
    state = reduce_app_state(state, input)
    for (const listener of listeners.get(input.type) ?? []) (listener as (payload: AppInput) => void)(input)
  }
  fight_chain.observe?.({
    events: {
      on: (name, listener) =>
        listeners.set(name, [...(listeners.get(name) ?? []), listener as unknown as (payload: never) => void]),
    },
    signal: new AbortController().signal,
    get_state: () => state,
    dispatch: emit,
  })

  emit({ type: 'fight/ready_all', fight: '0xf', fighters: [0n, 1n, 2n] })
  await Promise.resolve()
  await Promise.resolve()

  expect(calls).toEqual([{ fight: '0xf', fighter_indices: [0n, 2n] }])
  expect(state.fight.environments['0xf']?.ready_submitted_seats).toEqual([0, 2])
  expect(state.fight.environments['0xf']?.ready_all_progress).toEqual({
    completed: 2,
    total: 2,
    status: 'complete',
  })
})
