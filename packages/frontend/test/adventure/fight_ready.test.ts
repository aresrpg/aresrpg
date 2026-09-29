// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { create_app } from '../../src/store.ts'

test('a reducer-opened demo fight remains placeable and Ready starts the shared combat runtime', () => {
  const app = create_app()
  const stop = app.observe(['adventure', 'fight'])
  try {
    app.dispatch({ type: 'adventure/entered' })
    app.dispatch({ type: 'adventure/challenge' })
    const placement = app.store.getState().fight.checkpoint!
    expect(placement.contract.round).toBe(0n)
    expect(placement.contract.fighters[0]!.ready).toBeFalse()
    expect(placement.contract.fighters).toHaveLength(4)
    app.dispatch({ type: 'fight/input', fight: null, origin: 'local', input: { type: 'ready', fighter: 0n } })
    const active = app.store.getState().fight.checkpoint!
    expect(active.contract.round).toBeGreaterThan(0n)
    expect(active.contract.fighters[0]!.ap).toBeGreaterThan(0n)
    expect(active.sources.players.adventure_senshi!.spell_levels['Pressure']).toBe(6n)
    expect(app.store.getState().session.wallet).toBeNull()
  } finally {
    stop()
  }
})

test('Ready all starts a local party without a wallet or chain observer', async () => {
  const { adventure_character, adventure_companion } = await import('../../src/adventure/character.ts')
  const { adventure_fight_setup } = await import('../../src/adventure/fight_setup.ts')
  const { placement_readiness, ready_all_inputs } = await import('../../src/game/fight/FightHud.tsx')
  const app = create_app()
  const stop = app.observe(['fight'])
  try {
    app.dispatch({
      type: 'fight/opened',
      mode: 'local',
      setup: adventure_fight_setup(adventure_character(200), 1, adventure_companion()),
      seed: 42n,
    })
    const state = app.store.getState()
    const readiness = placement_readiness(state.fight.checkpoint!, state.session, [], false)
    expect(readiness.show_all).toBe(true)
    expect(readiness.unready_seats).toEqual([0n, 1n])
    ready_all_inputs(false, state.fight.checkpoint!.contract.id, readiness.unready_seats).forEach(app.dispatch)
    expect(app.store.getState().fight.checkpoint!.contract.round).toBeGreaterThan(0n)
    expect(app.store.getState().session.wallet).toBeNull()
  } finally {
    stop()
  }
})
