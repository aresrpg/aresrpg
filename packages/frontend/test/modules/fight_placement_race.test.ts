// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { create_character_source, create_fight, movement_points_of, type HydratedFightCheckpoint } from '@aresrpg/fight'
import type { CharacterRow } from '@aresrpg/protocol'

import type { AuthSession } from '../../src/auth.ts'
import { create_app, type AppInput } from '../../src/store.ts'

const placement = () => {
  const source = create_character_source({ classe: 'senshi', level: 1n })
  return create_fight({
    mode: 'local',
    seed: 17n,
    setup: {
      fight_id: 'placement-race',
      world: 'nauvis',
      board_seed: 17n,
      players: [
        { character: 'alice', owner: 'owner', team: 0n, hp: 55n, source },
        { character: 'enemy', owner: 'other', team: 1n, hp: 55n, source },
      ],
      mobs: [],
    },
  })
}
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

test('placement refusal preserves a joining fighter with the real queued app dispatcher', async () => {
  const app = create_app()
  const chain = placement()
  const initial = chain.state()
  const destination = initial.contract.board.start_cells_a[1]!
  let refuse!: (error: Error) => void
  let placements = 0
  const wallet = {
    address: 'owner',
    fight: {
      place: () => {
        placements += 1
        return new Promise((_resolve, reject) => {
          refuse = reject
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
      characters: [
        {
          id: 'alice',
          name: 'Alice',
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
          active_fight: { id: initial.contract.id, seat: 0 },
        } satisfies CharacterRow,
      ],
    },
  })
  const close = app.observe(['fight', 'fight_chain'])
  try {
    app.dispatch(snapshot(initial))
    app.dispatch({
      type: 'fight/input',
      fight: initial.contract.id,
      origin: 'local',
      input: { type: 'place', fighter: 0n, cell: destination },
    })
    const joined = chain.apply({
      type: 'join',
      team: 0n,
      hp: 55n,
      character: 'ally',
      owner: 'owner',
      source: create_character_source({ classe: 'senshi', level: 1n }),
    })
    expect(joined.error).toBeNull()
    expect(joined.state.contract.fighters[2]?.cell).toBe(destination)
    app.dispatch(snapshot(joined.state))
    expect(app.store.getState().fight.checkpoint?.contract.fighters).toHaveLength(3)
    refuse(
      new Error(
        "[sdk] transaction resolution failed — NOT submitted: MoveAbort, abort code: 1709, in '0xgame::combat::place'"
      )
    )
    await Bun.sleep(0)
    const restored = app.store.getState().fight.checkpoint!
    expect(restored.contract.fighters).toHaveLength(3)
    expect(restored.contract.fighters[0]?.cell).toBe(initial.contract.fighters[0]!.cell)
    expect(() => movement_points_of(restored, 2n)).not.toThrow()
    expect(placements).toBe(1)
  } finally {
    close()
  }
})
