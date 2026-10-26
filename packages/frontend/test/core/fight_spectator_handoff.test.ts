// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { observe_fights } from '../../src/modules/fight_observer.ts'
import { initial_app_state, reduce_app_state, type AppInput, type AppState } from '../../src/store.ts'

for (const participant of ['viewer', 'teammate']) {
  test(`confirmed placement for ${participant} ends spectating even with automatic turn switching disabled`, () => {
    const base = initial_app_state({ quality: 'medium', music_enabled: false, render_distance: null })
    let state: AppState = {
      ...base,
      settings: { ...base.settings, auto_switch_fighter: false },
      session: {
        ...base.session,
        wallet: { address: 'owner' } as never,
        selected_character_id: 'viewer',
        characters: ['viewer', 'teammate'].map((id) => ({ id, name: id, custody: 'kiosk' })) as never,
      },
      fight: { ...base.fight, spectating_by_character: { teammate: 'watched', viewer: 'watched' } },
    }
    const listeners = new Map<string, ((...values: unknown[]) => void)[]>()
    const inputs: AppInput[] = []
    const publish = (previous: AppState) =>
      listeners.get('STATE_UPDATED')?.forEach((listener) => listener(state, previous))
    const dispatch = (input: AppInput): void => {
      inputs.push(input)
      const previous = state
      state = reduce_app_state(state, input)
      listeners.get(input.type)?.forEach((listener) => listener(input))
      publish(previous)
    }
    observe_fights({
      dispatch,
      get_state: () => state,
      events: {
        on: (name: string, listener: (...values: unknown[]) => void) =>
          listeners.set(name, [...(listeners.get(name) ?? []), listener]),
      },
    } as never)
    publish(state)
    expect(inputs).toEqual([])
    const previous = state
    state = {
      ...state,
      session: {
        ...state.session,
        characters: state.session.characters.map((row) =>
          row.id === participant ? { ...row, custody: 'fight', active_fight: { id: 'own-fight', seat: 0 } } : row
        ),
      },
    }
    publish(previous)
    expect(state.fight.spectating_by_character).toEqual({})
    expect(state.session.selected_character_id).toBe(participant)
    expect(inputs.at(-1)).toEqual({ type: 'character/select', character_id: participant })
    expect(inputs.filter((input) => input.type === 'character/select')).toHaveLength(1)
    const count = inputs.length
    publish(state)
    expect(inputs).toHaveLength(count)
  })
}
