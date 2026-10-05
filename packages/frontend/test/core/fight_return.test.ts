// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import fight from '../../src/modules/fight.ts'
import { returning_fight_character } from '../../src/modules/fight_observer.ts'
import { initial_app_state, type AppState } from '../../src/store.ts'

const base = () => {
  const state = initial_app_state({ quality: 'medium', music_enabled: true, render_distance: null })
  return {
    ...state,
    session: {
      ...state.session,
      selected_character_id: 'a',
      wallet: { address: 'me' },
      characters: [
        { id: 'a', custody: 'fight' },
        { id: 'b', custody: 'fight' },
      ],
    },
  } as unknown as AppState
}
const checkpoint = {
  contract: {
    id: 'fight',
    round: 1n,
    turn_ptr: 0n,
    turn_started_ms: 0n,
    started_ms: 0n,
    ended: false,
    fighters: ['a', 'b'].map((character) => ({ kind: { type: 'player', character, owner: 'me' }, settled: false })),
  },
} as never
const reconcile = (state: AppState) =>
  fight.reduce!(state, {
    type: 'fight/reconciled',
    mode: 'remote',
    checkpoint,
    zone_ids: [],
    events: [],
    presentation_batch: 0,
    error: null,
    awaiting_turn_witness: false,
  })

test('a fight retains its entry character across automatic turns and restores it on close', () => {
  const entered = reconcile(base())
  const switched = reconcile({ ...entered, session: { ...entered.session, selected_character_id: 'b' } })
  expect(switched.fight.environments.fight?.return_character_id).toBe('a')
  const ended = { ...switched, fight: { ...switched.fight, canonical_ended: true } }
  const closed = fight.reduce!(ended, { type: 'fight/closed', fight: 'fight' })
  expect(returning_fight_character(closed, ended)).toBe('a')
  expect(returning_fight_character(closed, closed)).toBeNull()
})

test('leaving a live fight, selecting an outsider, and losing ownership never steal selection', () => {
  const entered = reconcile(base())
  const closed = fight.reduce!(entered, { type: 'fight/closed', fight: 'fight' })
  expect(returning_fight_character(closed, entered)).toBeNull()
  const ended = { ...entered, fight: { ...entered.fight, canonical_ended: true } }
  expect(
    returning_fight_character({ ...closed, session: { ...closed.session, selected_character_id: 'outside' } }, ended)
  ).toBeNull()
  expect(
    returning_fight_character(
      { ...closed, session: { ...closed.session, selected_character_id: 'b', characters: [] } },
      ended
    )
  ).toBeNull()
})
