// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test, spyOn } from 'bun:test'
import { create_fight, create_fight_state, create_character_source } from '@aresrpg/fight'

import { mix } from '../../../fight/src/prng.ts'
import { content_catalog } from '../../src/content/catalog.ts'
import { to_mob_template } from '../../src/content/fight_sources.ts'
import { create_fight_session } from '../../src/modules/fight_session.ts'
import { apply_streamed_witness } from '../../src/modules/fight_observer.ts'
import { queued_end_turn } from '../../src/modules/fight_chain.ts'
import { create_app, initial_app_state, type AppState } from '../../src/store.ts'

const tinker_turn = () => {
  const state = structuredClone(
    create_fight_state({
      fight_id: 'clock-fight',
      board_seed: 1n,
      players: [
        {
          character: 'player',
          owner: 'wallet',
          team: 0n,
          hp: 100n,
          ready: true,
          source: create_character_source({ classe: 'senshi', level: 10n }),
        },
      ],
      mobs: [{ team: 1n, scalar: 50n, template: to_mob_template(content_catalog.mob('tinker')!.mob) }],
    })
  )
  // Place the actors in range on an unobstructed board, retaining the authored Tinker kit.
  state.contract.board.obstacles = []
  state.contract.board.holes = []
  state.contract.fighters[1]!.cell = state.contract.fighters[0]!.cell + 1n
  const local = create_fight({ state, mode: 'local', seed: 91n })
  const before = local.apply({ type: 'start', observed_ms: 60_000n }).state
  const after = local.simulate_turn({ observed_ms: 63_000n })
  return { before, after, seed: (mix(91n, 2n) << 32n) | mix(91n, 3n) }
}

for (const device_ms of [53_000n, 73_000n]) {
  test(`Tinker replay retains attack and damage events with device time ${device_ms}`, () => {
    const { before, after, seed } = tinker_turn()
    expect(after.events.some((event) => event.type === 'damage_number')).toBe(true)
    const events: string[] = []
    const session = create_fight_session({
      now: () => device_ms,
      reconcile: (state) => events.push(...state.events.map((event) => event.type)),
    })
    session.open({ mode: 'remote', state: before })
    apply_streamed_witness(session, { type: 'turn_seed', fighter: 1n, seed })
    session.replace(after.state)
    expect(events).toContain('spell_cast')
    expect(events).toContain('damage_number')
    expect(session.state()!.checkpoint.contract.fighters[0]!.hp).toBe(after.state.contract.fighters[0]!.hp)
  })
}

const queued_state = (): AppState => {
  const base = initial_app_state({ quality: 'medium', flat_mode: false, music_enabled: true, render_distance: null })
  return {
    ...base,
    chain_clock: { chain_ms: 63_500, received_ms: 500 },
    session: { ...base.session, wallet: { address: 'wallet' } as never, characters: [{ id: 'player' }] as never },
    fight: {
      ...base.fight,
      cached: { 'clock-fight': tinker_turn().before },
      environments: { 'clock-fight': { end_turn_queued: true } as never },
    },
  }
}

test('queued turns use chain time, and stop when its sample is absent or stale', () => {
  const state = queued_state()
  expect(queued_end_turn(state, 'clock-fight', 500)).toEqual({ fighter: 0n, delay_ms: 0 })
  expect(queued_end_turn({ ...state, chain_clock: null }, 'clock-fight', 500)).toBeNull()
  expect(queued_end_turn(state, 'clock-fight', 16_000)).toBeNull()
})

test('a lethal draft seals immediately without waiting for the live-turn deadline', () => {
  const state = queued_state()
  const checkpoint = state.fight.cached['clock-fight']!
  const ended = {
    ...state,
    chain_clock: null,
    fight: {
      ...state.fight,
      cached: { 'clock-fight': { ...checkpoint, contract: { ...checkpoint.contract, ended: true } } },
    },
  }
  expect(queued_end_turn(ended, 'clock-fight', 500)).toEqual({ fighter: 0n, delay_ms: 0 })
})

for (const device_ms of [1_000, 9_000_000_000_000]) {
  test(`streamed Tinker attacks reach combat chat with wall clock ${device_ms} and no heartbeat`, () => {
    const { before, after, seed } = tinker_turn()
    const wall_clock = spyOn(Date, 'now').mockReturnValue(device_ms)
    const app = create_app()
    const stop = app.observe(['fight'])
    try {
      app.dispatch({ type: 'auth/connecting' })
      app.dispatch({ type: 'auth/connected', session: { address: 'wallet' } as never })
      app.dispatch({
        type: 'server/packet',
        packet: {
          type: 'packet/characters',
          characters: [
            { id: 'player', name: 'Player', custody: 'fight', active_fight: { id: 'clock-fight', seat: 0 } },
          ],
        } as never,
      })
      app.dispatch({ type: 'character/select', character_id: 'player' })
      app.dispatch({ type: 'page/open', page: 'world' })
      app.dispatch({
        type: 'server/packet',
        packet: {
          type: 'packet/fight_state',
          fight: 'clock-fight',
          state: { contract: before.contract, players: before.sources.players },
        },
      } as never)
      const witness = {
        type: 'server/packet',
        packet: { type: 'packet/turn_seed', fight: 'clock-fight', seat: '1', seed: String(seed) },
      } as const
      wall_clock.mockReturnValue(-device_ms)
      app.dispatch(witness)
      const presentation = app.store.getState().fight.presentations.at(-1)!
      expect(presentation.events.some((event) => event.type === 'spell_cast')).toBe(true)
      app.dispatch({ type: 'fight/presented', presentation })
      const { lines } = app.store.getState().chat
      expect(lines.some((line) => line.channel === 'combat')).toBe(true)
      app.dispatch(witness)
      app.dispatch({ type: 'fight/presented', presentation })
      expect(app.store.getState().chat.lines).toEqual(lines)
      app.dispatch({
        type: 'server/packet',
        packet: {
          type: 'packet/fight_state',
          fight: 'clock-fight',
          state: { contract: after.state.contract, players: after.state.sources.players },
        },
      } as never)
      expect(app.store.getState().fight.checkpoint!.contract.fighters[0]!.hp).toBe(after.state.contract.fighters[0]!.hp)
    } finally {
      stop()
      wall_clock.mockRestore()
    }
  })
}

for (const type of ['end_turn', 'crank'] as const) {
  test(`remote ${type} replay ignores a caller's wall-clock timestamp`, () => {
    const { before } = tinker_turn()
    const session = create_fight_session({ now: () => 0n, reconcile: () => {} })
    session.open({ mode: 'remote', state: before })
    session.apply({ type, fighter: 0n, observed_ms: -9_000_000n })
    expect(session.state()?.error).toBeNull()
    expect(session.state()?.awaiting_turn_witness).toBe(true)
  })
}
