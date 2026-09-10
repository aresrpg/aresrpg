// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import type { HydratedFightCheckpoint } from '@aresrpg/fight'

import { selected_spectator } from '../../src/game/fight/FightSpectatorExit.tsx'
import { create_app } from '../../src/store.ts'

test('a forfeiter can watch the same ongoing fight until stopping or its canonical end', () => {
  const app = create_app()
  app.initialize({ quality: 'medium', flat_mode: false, music_enabled: true, render_distance: null })
  const stop = app.observe(['fight'])
  // Lifecycle projection fixture: no wire decoding or combat simulation occurs here.
  const checkpoint = {
    contract: {
      id: '0xf1',
      round: 1n,
      turn_ptr: 0n,
      turn_started_ms: 0n,
      started_ms: 0n,
      ended: false,
      fighters: [
        { kind: { type: 'player', character: '0xa', owner: '0xme' }, settled: true, forfeited: true },
        { kind: { type: 'player', character: '0xb', owner: '0xother' }, settled: false, forfeited: false },
      ],
    },
  } as HydratedFightCheckpoint
  const reconcile = (ended = false): void =>
    app.dispatch({
      type: 'fight/reconciled',
      mode: 'remote',
      checkpoint: { ...checkpoint, contract: { ...checkpoint.contract, ended } },
      zone_ids: [],
      events: [],
      presentation_batch: 0,
      error: null,
      awaiting_turn_witness: false,
    })
  try {
    app.dispatch({
      type: 'server/packet',
      packet: { type: 'packet/characters', characters: [{ id: '0xa', custody: 'kiosk' }] } as never,
    })
    app.dispatch({ type: 'character/select', character_id: '0xa' })
    app.dispatch({ type: 'fight/watch', character_id: '0xa', fight: '0xf1' })
    reconcile()
    expect(app.store.getState().fight.mounted).toBeFalse()

    app.dispatch({ type: 'fight/spectating', character_id: '0xa', fight: '0xf1' })
    app.dispatch({ type: 'fight/watch', character_id: '0xa', fight: null })
    expect(app.store.getState().fight.mounted).toBeTrue()
    expect(selected_spectator(app.store.getState())).toBe('0xa')
    reconcile()
    expect(app.store.getState().fight.mounted).toBeTrue()

    app.dispatch({ type: 'fight/spectating', character_id: '0xa', fight: null })
    expect(app.store.getState().fight.mounted).toBeFalse()
    expect(app.store.getState().fight.cached['0xf1']).toBeUndefined()

    app.dispatch({ type: 'fight/spectating', character_id: '0xa', fight: '0xf1' })
    reconcile()
    expect(app.store.getState().fight.mounted).toBeTrue()
    reconcile(true)
    app.dispatch({ type: 'fight/canonical_ended', fight: '0xf1', ended: true })
    expect(app.store.getState().fight.mounted).toBeFalse()
    expect(app.store.getState().fight.spectating_by_character['0xa']).toBeUndefined()
  } finally {
    stop()
  }
})
