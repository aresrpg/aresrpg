// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { fight_actions, last_settler_refusal } from '../src/fight.ts'

const id = (value: number) => `0x${String(value).padStart(64, '0')}`

test('last-settler fallback accepts only a pre-submission 1729 refusal', () => {
  expect(last_settler_refusal(new Error('Transaction resolution failed: MoveAbort abort code: 1729'))).toBeTrue()
  expect(
    last_settler_refusal(new Error('[sdk] dry run failed — transaction NOT submitted: abort code: 1729'))
  ).toBeTrue()
  expect(last_settler_refusal(new Error('[sdk] transaction abc failed on-chain: abort code: 1729'))).toBeFalse()
  expect(last_settler_refusal(new Error('Transaction resolution failed: abort code: 1712'))).toBeFalse()
})

test('a group-gated fight join presents the selected Party to the grouped chain door', async () => {
  const calls: Record<string, unknown>[] = []
  const hydrated: string[][] = []
  const sdk = {
    tx: () => ({}),
    hydrate_unknown: async (ids: string[]) => hydrated.push(ids),
    with_owner_kiosk: (_tx: unknown, _cap: unknown, compose: (kiosk: string, cap: string) => void) =>
      compose(id(40), id(41)),
    execute: async () => ({ Transaction: { digest: 'joined' } }),
    doors: {
      join_fight_grouped: (_tx: unknown, args: Record<string, unknown>) => calls.push(args),
    },
  }
  await fight_actions(sdk as never, { kiosk_cap: async () => null }).join({
    fight: id(1),
    character_id: id(2),
    team: 0,
    party: id(3),
    custody: { kiosk: id(4), kiosk_cap: id(5) },
  })
  expect(hydrated).toEqual([[id(1)], [id(3)]])
  expect(calls[0]).toMatchObject({ character_id: id(2), shared_party: id(3), team: 0 })
})

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

test('Ready plus Start projects its receipt phase and turn witnesses immediately', async () => {
  const calls: string[] = []
  const sdk = {
    pins: { content_root: { id: id(4), shared_version: '1' }, seed_package_original: id(3) },
    game_type_package: id(2),
    tx: () => ({}),
    hydrate_unknown: async () => undefined,
    execute: async () => ({
      Transaction: {
        digest: 'started',
        events: [
          { type: `${id(2)}::fight::FightStarted`, json: { fight: id(9), queue: ['0', '1'] } },
          { type: `${id(2)}::fight::TurnSeedUsed`, json: { fight: id(9), seat: '1', seed: '77' } },
        ],
      },
    }),
    doors: {
      ready_fighter: () => calls.push('ready'),
      start_fight: () => calls.push('start'),
    },
  }
  const receipt = await fight_actions(sdk as never, { kiosk_cap: async () => null }).ready({
    fight: id(9),
    fighter_idx: 0n,
    and_start: true,
  })
  expect(calls).toEqual(['ready', 'start'])
  expect(receipt).toEqual({ digest: 'started', started: true, turn_witnesses: [{ fighter: 1n, seed: 77n }] })
})
