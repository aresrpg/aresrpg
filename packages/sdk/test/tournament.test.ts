// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { readFileSync } from 'node:fs'

import { expect, test } from 'bun:test'

import { tournament_actions } from '../src/tournament.ts'
import { tournament_admin_actions } from '../src/tournament_admin.ts'
import {
  TOURNAMENT_MOVE_PATH,
  TOURNAMENT_BRACKET_PATH,
  TOURNAMENT_RULES_OUT_PATH,
  generate_tournament_rules,
} from '../scripts/generate_doors.mjs'

const fixture = () => {
  const calls: { name: string; args: Record<string, unknown> }[] = []
  let executions = 0
  const doors = Object.fromEntries(
    [
      'start_tournament',
      'register_tournament',
      'create_tournament_team',
      'join_tournament_team',
      'tournament_leave_team',
      'tournament_donate_sui',
      'tournament_claim_sui',
      'tournament_claim_kares',
      'prepare_fight_loot',
      'claim_tournament_item',
      'settle_tournament_match',
      'close_tournament_match',
    ].map((name) => [
      name,
      (_tx: unknown, args: Record<string, unknown>) => {
        calls.push({ name, args })
        return 'plan'
      },
    ])
  )
  const sdk = {
    tx: () => ({}),
    hydrate_unknown: async () => {},
    doors,
    with_owner_kiosk: (_tx: unknown, _cap: unknown, compose: (kiosk: string, cap: string) => void) =>
      compose('kiosk', 'cap'),
    coin_of: (_tx: unknown, amount: bigint) => amount,
    execute: async () => {
      executions++
      return { Transaction: { digest: 'digest', events: [] } }
    },
  }
  const actions = tournament_actions(sdk as never, {
    kiosk_cap: async () => ({ objectId: 'cap', kioskId: 'kiosk', version: '1', digest: 'digest' }) as never,
  })
  return { actions, calls, executions: () => executions }
}

test('registration preserves the reviewed team revision and exact character identity', async () => {
  const { actions, calls } = fixture()
  await actions.join_team({ tournament: 'cup', team: 2, revision: '7', character_id: 'chosen' })
  expect(calls[0]).toEqual({
    name: 'register_tournament',
    args: {
      tournament: 'cup',
      team: 2,
      revision: '7',
      character_id: 'chosen',
      name: '',
      allowed: [],
      payment: 0n,
      kiosk: 'kiosk',
      cap: 'cap',
    },
  })
})

test('item preparation precedes the terminal claim and cannot substitute a reward index', async () => {
  const { actions, calls } = fixture()
  await actions.claim_item({ tournament: 'cup', team: 2, seat: 1, reward: 3, template: 'reviewed-template' })
  expect(calls.map(({ name }) => name)).toEqual(['prepare_fight_loot', 'claim_tournament_item'])
  expect(calls[0].args.template).toBe('reviewed-template')
  expect(calls[1].args.reward).toBe(3)
  expect(calls[1].args.plan).toBe('plan')
})

test('settlement records through the tournament door before optional cleanup', async () => {
  const { actions, calls } = fixture()
  await actions.settle({ tournament: 'cup', index: 5, fight: 'fight', fighter_idx: 0n, last: true })
  expect(calls.map(({ name }) => name)).toEqual(['settle_tournament_match', 'close_tournament_match'])
  expect(
    calls.every(({ args }) => args.tournament === 'cup' && args.index === 5 && args.fight_object === 'fight')
  ).toBeTrue()
})

test('nonpositive contributions never reach execution', async () => {
  const { actions, executions } = fixture()
  await expect(actions.donate('cup', 'sui', 0n)).rejects.toThrow('positive')
  expect(executions()).toBe(0)
})

test('the timeout UI constant is generated from its Move owner', async () => {
  expect(readFileSync(TOURNAMENT_RULES_OUT_PATH, 'utf8')).toBe(
    await generate_tournament_rules(
      readFileSync(TOURNAMENT_MOVE_PATH, 'utf8'),
      readFileSync(TOURNAMENT_BRACKET_PATH, 'utf8')
    )
  )
})

test('SUI-only claims do not resolve any token door or currency type', async () => {
  const { actions, calls, executions } = fixture()
  await actions.claim_coins('cup', 2, 1, { sui: true })
  expect(calls).toEqual([{ name: 'tournament_claim_sui', args: { t: 'cup', team: 2, seat: 1 } }])
  expect(executions()).toBe(1)
})

test('token recovery does not reclaim an already paid SUI entitlement', async () => {
  const { actions, calls } = fixture()
  await actions.claim_coins('cup', 2, 1, { sui: false, pool: 'pool' })
  expect(calls).toEqual([{ name: 'tournament_claim_kares', args: { t: 'cup', pool: 'pool', team: 2, seat: 1 } }])
})

test('Display uses the datatype defining ID even when the package origin table is absent', async () => {
  const types: string[] = []
  const sdk = {
    pins: { publisher: 'publisher', package: 'latest' },
    hydrate_unknown: async () => {},
    tx: () => ({
      pure: { string: (value: string) => value },
      moveCall: ({ typeArguments }: { typeArguments: string[] }) => {
        types.push(...typeArguments)
        return ['display', 'cap']
      },
      transferObjects: () => {},
    }),
    door_context: { obj: (_tx: unknown, id: string) => id },
    execute: async () => ({}),
  }
  const client = {
    movePackageService: {
      getDatatype: (request: unknown) => {
        expect(request).toEqual({ packageId: 'latest', moduleName: 'tournament', name: 'Tournament' })
        return { response: Promise.resolve({ datatype: { definingId: 'introducing-upgrade' } }) }
      },
    },
  }
  await tournament_admin_actions(sdk as never, 'owner', client as never).setup_display()
  expect(new Set(types)).toEqual(new Set(['introducing-upgrade::tournament::Tournament']))
})

test('public start needs only the tournament and submits exactly once', async () => {
  const { actions, calls, executions } = fixture()
  await actions.start('cup')
  expect(calls).toEqual([{ name: 'start_tournament', args: { tournament: 'cup' } }])
  expect(executions()).toBe(1)
})

test('paid registration composes the exact reviewed fee with the chosen character in one execution', async () => {
  const { actions, calls, executions } = fixture()
  await actions.create_team({
    tournament: 'cup',
    name: 'Team',
    allowed: [],
    character_id: 'chosen',
    entry_fee_mist: 123456789n,
  })
  expect(calls[0]).toMatchObject({
    name: 'register_tournament',
    args: { team: null, character_id: 'chosen', payment: 123456789n },
  })
  expect(executions()).toBe(1)
})
