// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { execute_settlement_mode, fight_actions, last_settler_refusal } from '../src/fight.ts'

const id = (value: number) => `0x${String(value).padStart(64, '0')}`
const digest = '11111111111111111111111111111111'
const kiosk_cap = (kiosk: string, object_id: string) => ({
  objectId: object_id,
  kioskId: kiosk,
  isPersonal: true,
  version: '1',
  digest,
})

test('last-settler fallback accepts only a pre-submission 1729 refusal', () => {
  expect(last_settler_refusal(new Error('Transaction resolution failed: MoveAbort abort code: 1729'))).toBeTrue()
  expect(
    last_settler_refusal(new Error('[sdk] dry run failed — transaction NOT submitted: abort code: 1729'))
  ).toBeTrue()
  expect(last_settler_refusal(new Error('[sdk] transaction abc failed on-chain: abort code: 1729'))).toBeFalse()
  expect(last_settler_refusal(new Error('Transaction resolution failed: abort code: 1712'))).toBeFalse()
})

test('a known settlement mode executes once without probing the opposite door', async () => {
  const calls: boolean[] = []
  await execute_settlement_mode(false, async (last) => void calls.push(last))
  expect(calls).toEqual([false])
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
  await fight_actions(sdk as never, { kiosk_cap: async () => kiosk_cap(id(4), id(5)) }).join({
    fight: id(1),
    character_id: id(2),
    team: 0,
    party: id(3),
    custody: { kiosk: id(4), kiosk_cap: id(5) },
  })
  expect(hydrated).toEqual([[id(1)], [id(3)]])
  expect(calls[0]).toMatchObject({ character_id: id(2), shared_party: id(3), team: 0 })
})

test('owned party followers join through repeated grouped doors in one kiosk transaction', async () => {
  const calls: Record<string, unknown>[] = []
  let executions = 0
  const sdk = {
    tx: () => ({}),
    hydrate_unknown: async () => undefined,
    with_owner_kiosk: (_tx: unknown, _cap: unknown, compose: (kiosk: string, cap: string) => void) =>
      compose(id(40), id(41)),
    execute: async () => {
      executions += 1
      return { Transaction: { digest: 'joined' } }
    },
    doors: {
      join_fight_grouped: (_tx: unknown, args: Record<string, unknown>) => calls.push(args),
    },
  }
  await fight_actions(sdk as never, { kiosk_cap: async () => kiosk_cap(id(5), id(6)) }).join_many({
    fight: id(1),
    character_ids: [id(2), id(3)],
    team: 0,
    party: id(4),
    custody: { kiosk: id(5), kiosk_cap: id(6) },
  })

  expect(calls.map(({ character_id }) => character_id)).toEqual([id(2), id(3)])
  expect(executions).toBe(1)
})

test('ready many submits terminal ready doors sequentially and stops when the fight starts', async () => {
  const seats: unknown[] = []
  let executions = 0
  const sdk = {
    tx: () => ({}),
    hydrate_unknown: async () => undefined,
    execute: async () => {
      executions += 1
      return {
        Transaction: {
          digest: `ready-${executions}`,
          events:
            executions === 2
              ? [{ type: `${id(2)}::fight::FightStarted`, json: { fight: id(1), queue: ['0', '1'] } }]
              : [],
        },
      }
    },
    doors: {
      ready_and_start_fight: (_tx: unknown, { fighter_idx }: { fighter_idx: unknown }) => seats.push(fighter_idx),
    },
  }

  const progress: unknown[] = []
  const result = await fight_actions(sdk as never, { kiosk_cap: async () => null }).ready_many({
    fight: id(1),
    fighter_indices: [0n, 2n, 4n],
    on_progress: (row) => progress.push(row),
  })

  expect(seats).toEqual([0n, 2n])
  expect(executions).toBe(2)
  expect(result).toMatchObject({ digest: 'ready-2', started: true })
  expect(progress).toEqual([
    { completed: 1, total: 3, fighter_idx: 0n, started: false },
    { completed: 2, total: 3, fighter_idx: 2n, started: true },
  ])
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
      ready_and_start_fight: () => calls.push('ready_and_start'),
    },
  }
  const receipt = await fight_actions(sdk as never, { kiosk_cap: async () => null }).ready({
    fight: id(9),
    fighter_idx: 0n,
  })
  expect(calls).toEqual(['ready_and_start'])
  expect(receipt).toEqual({ digest: 'started', started: true, turn_witnesses: [{ fighter: 1n, seed: 77n }] })
})
