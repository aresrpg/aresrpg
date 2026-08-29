// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { create_character_source, create_fight_state } from '@aresrpg/fight'

import { apply_streamed_witness, streamed_witness_boundary } from '../../src/modules/fight_observer.ts'
import { create_fight_session } from '../../src/modules/fight_session.ts'

const mob = {
  mob_type: 'alley_bunny',
  level_min: 1n,
  level_max: 1n,
  hp: 100n,
  ap: 6n,
  mp: 3n,
  agility: 0n,
  wisdom: 0n,
  earth_res: 32_768n,
  fire_res: 32_768n,
  water_res: 32_768n,
  air_res: 32_768n,
  spells: [],
  xp: 1n,
  loot: [],
}

test('an independent client reconstructs player → mob before applying the streamed witness', () => {
  const source = create_character_source({ classe: 'senshi', level: 10n })
  const checkpoint = structuredClone(
    create_fight_state({
      fight_id: '0xcoop',
      players: [
        { character: 'sceat', owner: 'wallet-a', team: 0n, hp: 100n, source },
        { character: 'midas', owner: 'wallet-a', team: 0n, hp: 100n, source },
        { character: 'ares', owner: 'wallet-b', team: 0n, hp: 100n, source },
      ],
      mobs: [{ team: 1n, scalar: 50n, template: mob }],
    })
  )
  checkpoint.contract.round = 1n
  checkpoint.contract.queue = [0n, 3n, 1n, 2n]
  checkpoint.contract.turn_ptr = 0n
  checkpoint.contract.turn_started_ms = 0n
  const reconciled: ReturnType<ReturnType<typeof create_fight_session>['state']>[] = []
  const session = create_fight_session({ now: () => 99_000n, reconcile: (state) => void reconciled.push(state) })
  session.open({ mode: 'remote', state: checkpoint })
  const witness = { type: 'turn_seed' as const, fighter: 3n, seed: 42n }

  expect(streamed_witness_boundary(session.state()!.checkpoint, 99_000n)).toMatchObject({
    type: 'end_turn',
    fighter: 0n,
  })
  apply_streamed_witness(session, witness, 99_000n)

  expect(session.state()?.events.some((event) => event.type === 'turn_switched' && event.payload.to === 3n)).toBeTrue()
  expect(session.state()?.error).toBeNull()
})

test('an opening mob witness reconstructs Start rather than End Turn', () => {
  const source = create_character_source({ classe: 'senshi' })
  const checkpoint = create_fight_state({
    players: [{ character: 'player', owner: 'wallet', team: 0n, hp: 100n, source }],
    mobs: [{ team: 1n, scalar: 50n, template: mob }],
  })

  expect(streamed_witness_boundary(checkpoint, 5n)).toEqual({ type: 'start', observed_ms: 5n })
})
