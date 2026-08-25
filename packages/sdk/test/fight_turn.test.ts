// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { fight_actions } from '../src/fight.ts'

const id = (value: number) => `0x${String(value).padStart(64, '0')}`

test('a drafted turn executes in order inside one transaction', async () => {
  const calls: string[] = []
  const gas_scopes: (string | undefined)[] = []
  let executions = 0
  const sdk = {
    pins: { template_registry: id(1), seed_package_original: id(3), content_root: { id: id(4), shared_version: '1' } },
    game_type_package: id(2),
    tx: () => ({}),
    hydrate_unknown: async () => undefined,
    execute: async (_transaction: unknown, options?: { gas_scope?: string }) => {
      executions += 1
      gas_scopes.push(options?.gas_scope)
      return {
        Transaction: {
          digest: 'turn',
          events: [
            { type: `${id(2)}::fight::TurnSeedUsed`, json: { fight: id(3), seat: '1', seed: '42' } },
            { type: `${id(2)}::fight::TurnSeedUsed`, json: { fight: id(3), seat: '2', seed: '84' } },
          ],
        },
      }
    },
    doors: {
      move_fighter: () => calls.push('move'),
      cast_spell: () => calls.push('cast'),
      weapon_strike: () => calls.push('strike'),
      end_fight_turn: () => calls.push('end'),
    },
  }
  const actions = fight_actions(sdk as never, { kiosk_cap: async () => null })

  const receipt = await actions.commit_turn({
    fight: id(3),
    actions: [
      { type: 'move', path: [2n, 3n] },
      { type: 'cast', fighter_idx: 0n, spell: 'slash', target_cell: 5n },
      { type: 'strike', fighter_idx: 0n, target_cell: 6n },
    ],
  })

  expect(calls).toEqual(['move', 'cast', 'strike', 'end'])
  expect(executions).toBe(1)
  expect(gas_scopes).toEqual([`fight:${id(3)}`])
  expect(receipt).toEqual({
    digest: 'turn',
    turn_witnesses: [
      { fighter: 1n, seed: 42n },
      { fighter: 2n, seed: 84n },
    ],
  })

  calls.length = 0
  await actions.commit_turn({
    fight: id(3),
    actions: [{ type: 'cast', fighter_idx: 0n, spell: 'slash', target_cell: 5n }],
    ended: true,
  })
  expect(calls).toEqual(['cast'])
})
