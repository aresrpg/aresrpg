// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { create_fight, encode_fight_action, type HydratedFightCheckpoint, type PlayerFighter } from '@aresrpg/fight'

import { create_fixture } from '../../../fight/test/helpers.ts'
import fight_chain from '../../src/modules/fight_chain.ts'
import { observe_fights } from '../../src/modules/fight_observer.ts'
import { initial_app_state, reduce_app_state, type AppInput, type AppState } from '../../src/store.ts'
import { terminal_remote_draft_needs_commit } from '../../src/modules/fight_lifecycle.ts'

test('an active death queues the existing terminal commit exactly once', () => {
  const fight = {
    mode: 'remote' as const,
    presentations: [],
    canonical_ended: false,
    end_turn_queued: false,
    end_turn_submitted: false,
    transaction_pending: false,
    checkpoint: {
      contract: { round: 1n, ended: false, queue: [0n, 1n], turn_ptr: 0n, fighters: [{ dead: true }, { dead: false }] },
    } as HydratedFightCheckpoint,
  }
  expect(terminal_remote_draft_needs_commit(fight)).toBeTrue()
  expect(terminal_remote_draft_needs_commit({ ...fight, end_turn_queued: true })).toBeFalse()
  expect(terminal_remote_draft_needs_commit({ ...fight, end_turn_submitted: true })).toBeFalse()
  expect(terminal_remote_draft_needs_commit({ ...fight, transaction_pending: true })).toBeFalse()
  expect(terminal_remote_draft_needs_commit({ ...fight, mode: 'local' })).toBeFalse()
  const alive = { ...fight.checkpoint, contract: { ...fight.checkpoint.contract, turn_ptr: 1n } }
  expect(terminal_remote_draft_needs_commit({ ...fight, checkpoint: alive })).toBeFalse()
})

for (const action of ['cast_spell', 'forfeit'] as const) {
  test(`the local observer advances ${action} death once and ignores unrelated dead seats`, () => {
    const checkpoint = structuredClone(create_fixture().checkpoint)
    const player = checkpoint.contract.fighters[0]!
    const ally = structuredClone(player) as PlayerFighter
    ally.kind.character = '0xc2'
    ally.cell = checkpoint.contract.board.start_cells_a[1]!
    checkpoint.contract.fighters.push(ally)
    checkpoint.sources.players['0xc2'] = structuredClone(checkpoint.sources.players['0xc1']!)
    const level = checkpoint.sources.spells.slash!.levels[0]!
    level.effects = [{ ...level.effects[0]!, kind: 2n, value: 100n, value_max: 100n, target_filter: 4n }]
    const listeners = new Map<string, ((...values: unknown[]) => void)[]>()
    let state = initial_app_state({ quality: 'medium', flat_mode: false, music_enabled: true, render_distance: null })
    const dispatch = (input: AppInput): void => {
      const previous = state
      state = reduce_app_state(state, input)
      listeners.get(input.type)?.forEach((listener) => listener(input))
      listeners.get('STATE_UPDATED')?.forEach((listener) => listener(state, previous))
    }
    observe_fights({
      dispatch,
      get_state: () => state,
      events: {
        on: (name: string, listener: (...values: unknown[]) => void) =>
          listeners.set(name, [...(listeners.get(name) ?? []), listener]),
      },
    } as never)
    dispatch({ type: 'fight/opened', mode: 'local', state: checkpoint, seed: 91n })
    dispatch({ type: 'fight/input', fight: null, origin: 'local', input: { type: 'start' } })
    dispatch({
      type: 'fight/input',
      fight: null,
      origin: 'local',
      input:
        action === 'forfeit'
          ? { type: 'forfeit', fighter: 0n }
          : { type: 'cast_spell', fighter: 0n, spell: 'slash', target_cell: checkpoint.contract.fighters[1]!.cell },
    })
    const completed = state.fight.checkpoint!.contract
    expect(completed.fighters[0]!.dead).toBeTrue()
    expect(completed.queue[Number(completed.turn_ptr)]).toBe(2n)
    expect(state.fight.error).toBeNull()
    listeners.get('STATE_UPDATED')?.forEach((listener) => listener({ ...state, fight: { ...state.fight } }, state))
    expect(state.fight.checkpoint!.contract).toBe(completed)
  })
}

for (const origin of ['streamed', 'local'] as const) {
  test(`${origin} death commits only the originating tab's complete local draft`, () => {
    const checkpoint = structuredClone(create_fixture().checkpoint)
    const ally = structuredClone(checkpoint.contract.fighters[0]!) as PlayerFighter
    ally.kind.character = '0xc2'
    ally.cell = checkpoint.contract.board.start_cells_a[1]!
    checkpoint.contract.fighters.push(ally)
    checkpoint.sources.players['0xc2'] = structuredClone(checkpoint.sources.players['0xc1']!)
    const level = checkpoint.sources.spells.slash!.levels[0]!
    level.effects = [{ ...level.effects[0]!, kind: 2n, value: 100n, value_max: 100n, target_filter: 4n }]
    const local = create_fight({ state: checkpoint, mode: 'local', seed: 91n })
    const active = local.apply({ type: 'start', observed_ms: 1n }).state
    const commits: unknown[] = []
    const controller = new AbortController()
    const listeners = new Map<string, ((...values: unknown[]) => void)[]>()
    const base = initial_app_state({ quality: 'medium', flat_mode: false, music_enabled: true, render_distance: null })
    let state: AppState = {
      ...base,
      session: {
        ...base.session,
        selected_character_id: '0xc1',
        characters: [{ id: '0xc1', active_fight: { id: '0xf1' } }] as never,
        wallet: {
          address: '0xa1',
          fight: {
            commit_turn: (input: unknown) => {
              commits.push(input)
              return new Promise(() => {})
            },
          },
        } as never,
      },
    }
    const queue: AppInput[] = []
    let reducing = false
    const dispatch = (input: AppInput): void => {
      queue.push(input)
      if (reducing) return
      reducing = true
      while (queue.length) {
        const next = queue.shift()!
        const previous = state
        state = reduce_app_state(state, next)
        listeners.get(next.type)?.forEach((listener) => listener(next))
        listeners.get('STATE_UPDATED')?.forEach((listener) => listener(state, previous))
      }
      reducing = false
    }
    const context = {
      dispatch,
      get_state: () => state,
      signal: controller.signal,
      events: {
        on: (name: string, listener: (...values: unknown[]) => void) =>
          listeners.set(name, [...(listeners.get(name) ?? []), listener]),
      },
    }
    observe_fights(context as never)
    fight_chain.observe?.(context as never)
    dispatch({ type: 'fight/opened', mode: 'remote', state: active })
    const input = {
      type: 'cast_spell' as const,
      fighter: 0n,
      spell: 'slash',
      target_cell: active.contract.fighters[1]!.cell,
    }
    if (origin === 'local') dispatch({ type: 'fight/input', fight: '0xf1', origin, input })
    else
      dispatch({
        type: 'server/packet',
        packet: { type: 'packet/fight_action', fight: '0xf1', action: encode_fight_action(input) } as never,
      })
    expect(state.fight.checkpoint!.contract.fighters[0]!.dead).toBeTrue()
    expect(commits).toEqual(
      origin === 'local'
        ? [
            {
              fight: '0xf1',
              actions: [{ type: 'cast', fighter_idx: 0n, spell: 'slash', target_cell: input.target_cell }],
            },
          ]
        : []
    )
    controller.abort()
  })
}
