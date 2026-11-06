// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { create_character_source, create_fight, type HydratedFightCheckpoint } from '@aresrpg/fight'

import type { AuthSession } from '../../src/auth.ts'
import { create_app, initial_app_state, reduce_app_state, type AppInput } from '../../src/store.ts'
import { fight_environment } from '../../src/modules/fight.ts'
import { fight_cell_selection } from '../../src/game/fight/fight_cell_selection.ts'
import { placement_available } from '../../src/game/fight/PlacementGasWarning.tsx'

const placement = () =>
  create_fight({
    setup: {
      fight_id: 'swap',
      world: 'nauvis',
      board_seed: 17n,
      mobs: [],
      players: ['alice', 'ally', 'enemy'].map((character, index) => ({
        character,
        owner: index < 2 ? 'owner' : 'other',
        team: index < 2 ? 0n : 1n,
        hp: 55n,
        source: create_character_source({ classe: 'senshi', level: 1n }),
      })),
    },
  }).state()

const snapshot = (checkpoint: HydratedFightCheckpoint): AppInput =>
  ({
    type: 'server/packet',
    packet: {
      type: 'packet/fight_state',
      fight: checkpoint.contract.id,
      state: { contract: checkpoint.contract, players: checkpoint.sources.players },
      seat: 0,
    },
  }) as unknown as AppInput

test('clicking an owned occupied starting cell uses the ordinary placement action', () => {
  const checkpoint = placement()
  const { cell } = checkpoint.contract.fighters[1]!
  const input = {
    actions_locked: false,
    cell,
    checkpoint,
    owned_active_seat: null,
    owned_placement_seat: 0n,
    selected_action: null,
    targetable_cells: [],
  }
  expect(fight_cell_selection(input)).toEqual({ type: 'place', fighter: 0n, cell })
  expect(fight_cell_selection({ ...input, actions_locked: true })).toBeNull()
  checkpoint.contract.fighters[1]!.ready = true
  expect(fight_cell_selection(input)).toBeNull()
  checkpoint.contract.fighters[1]!.ready = false
  const target = checkpoint.contract.fighters[1]!
  if (target.kind.type === 'player') target.kind.owner = 'another'
  expect(fight_cell_selection(input)).toBeNull()
  expect(placement_available(checkpoint, 0n, checkpoint.contract.fighters[2]!.cell)).toBe(false)
})

test('both swapped fighters retain their placement-change warning state', () => {
  const initial = initial_app_state({ quality: 'medium', music_enabled: false, render_distance: null })
  const checkpoint = placement()
  const state = { ...initial, fight: { ...initial.fight, checkpoint, cached: { swap: checkpoint } } }
  const result = reduce_app_state(state, {
    type: 'fight/input',
    fight: 'swap',
    origin: 'local',
    input: { type: 'place', fighter: 0n, cell: checkpoint.contract.fighters[1]!.cell },
  })
  expect(fight_environment(result.fight, 'swap').placement_changed_seats).toEqual({ 0: true, 1: true })
})

test('a rejected swap restores both positions and does not retry the transaction', async () => {
  const app = create_app()
  const initial = placement()
  let reject!: (error: Error) => void
  let calls = 0
  const wallet = {
    address: 'owner',
    fight: {
      place: () => {
        calls += 1
        return new Promise((_resolve, refuse) => {
          reject = refuse
        })
      },
    },
  } as unknown as AuthSession
  app.dispatch({ type: 'auth/connecting' })
  app.dispatch({ type: 'auth/connected', session: wallet })
  app.dispatch({
    type: 'server/packet',
    packet: {
      type: 'packet/characters',
      characters: ['alice', 'ally'].map((id, seat) => ({
        id,
        name: id,
        classe: 'senshi',
        sex: 'male',
        level: 1,
        experience: '0',
        color_1: 0,
        color_2: 0,
        color_3: 0,
        vitality: 0,
        wisdom: 0,
        strength: 0,
        intelligence: 0,
        chance: 0,
        agility: 0,
        available_points: 0,
        available_spell_points: 0,
        spells: {},
        jobs: {},
        equipment: [],
        world: 'nauvis',
        kiosk: 'kiosk',
        custody: 'fight',
        active_fight: { id: 'swap', seat },
      })),
    },
  })
  const close = app.observe(['fight', 'fight_chain'])
  try {
    app.dispatch(snapshot(initial))
    app.dispatch({
      type: 'fight/input',
      fight: 'swap',
      origin: 'local',
      input: { type: 'place', fighter: 0n, cell: initial.contract.fighters[1]!.cell },
    })
    await Bun.sleep(0)
    expect(calls).toBe(1)
    reject(new Error('placement refused'))
    await Bun.sleep(0)
    expect(app.store.getState().fight.checkpoint!.contract.fighters.map(({ cell }) => cell)).toEqual(
      initial.contract.fighters.map(({ cell }) => cell)
    )
    expect(calls).toBe(1)
  } finally {
    close()
  }
})
