// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import {
  GAMEPLAY_ACTIONS,
  parse_gameplay_action,
  validate_gameplay,
  execute_gameplay_actions,
} from '../src/gameplay.ts'
import { bind_action_baseline, action_projected } from '../src/action_reconciliation.ts'
import { create_mcp_handler } from '../src/mcp.ts'
import { create_control_service, lane_key_for, type Lane } from '../src/control.ts'

import { runtime_fixture } from './helpers/runtime_fixture.ts'
import { profession_context, character } from './helpers/profession_fixture.ts'

const context = () => {
  const base = profession_context()
  return {
    ...base,
    command: {
      ...base.command,
      kind: 'raise_stats' as const,
      payload: { character_id: character.id, spending: { vitality: 5 } },
    },
    snapshot: { ...base.snapshot, characters: [{ ...character, classe: 'ikari', available_points: 5 }] },
  }
}
test('the stat tool parses a constrained positive spending map and uses the existing SDK action', async () => {
  const f = context()
  expect(parse_gameplay_action('raise_stats', f.command.payload)).toEqual(f.command.payload)
  expect(Object.keys(GAMEPLAY_ACTIONS)).toContain('raise_stats')
  const plan = validate_gameplay(f)
  expect(plan).toMatchObject({
    kind: 'raise_stats',
    input: {
      character_id: character.id,
      spending: { vitality: 5 },
      custody: { kiosk: character.kiosk, kiosk_cap: character.kiosk_cap },
    },
  })
  const inputs: unknown[] = []
  await execute_gameplay_actions(f, {
    raise_stats: async (input: unknown) => {
      inputs.push(input)
      return { digest: 'synthetic' }
    },
  } as never)
  expect(inputs).toEqual([plan.input])
})

for (const spending of [
  {},
  { vitality: 0 },
  { vitality: -1 },
  { vitality: 1.5 },
  { vitality: 65536 },
  { spells: 1 },
  { vitality: '1' },
]) {
  test(`stat payload rejects ${JSON.stringify(spending)} without accepting a command`, () => {
    expect(() => parse_gameplay_action('raise_stats', { character_id: character.id, spending })).toThrow(
      'invalid_gameplay_payload'
    )
  })
}
test('stat admission rejects stale observations, foreign/fight custody, unavailable points and unusable class-cost remainders', () => {
  const f = context()
  expect(() => validate_gameplay({ ...f, snapshot: { ...f.snapshot, ready: false } })).toThrow('needs_resync')
  expect(() => validate_gameplay({ ...f, command: { ...f.command, observation_revision: 0 } })).toThrow('needs_resync')
  expect(() => validate_gameplay({ ...f, snapshot: { ...f.snapshot, characters: [] } })).toThrow('authority')
  const change = (row: Partial<typeof character>) => ({
    ...f,
    snapshot: { ...f.snapshot, characters: [{ ...f.snapshot.characters[0]!, ...row }] },
  })
  expect(() => validate_gameplay(change({ custody: 'fight' }))).toThrow('not_available')
  expect(() => validate_gameplay(change({ kiosk_cap: undefined }))).toThrow('custody_resync')
  expect(() => validate_gameplay(change({ available_points: 4 }))).toThrow('insufficient_character_points')
  expect(() => validate_gameplay(change({ vitality: 65530 }))).toThrow('invalid_stat_spending')
  expect(() =>
    validate_gameplay({
      ...f,
      command: { ...f.command, payload: { character_id: character.id, spending: { wisdom: 5 } } },
    })
  ).toThrow('invalid_stat_spending')
})
test('receipt completion waits for the exact indexed natural stats and spent capital, including Ikari double vitality', () => {
  const f = context()
  const command = bind_action_baseline({ ...f.command, status: 'completed', result: { digest: 'D' } }, f)
  const receipt = { Transaction: { digest: 'D' } }
  expect(action_projected(command, receipt, f)).toBe(false)
  const observed = (vitality: number, available_points: number) => ({
    ...f,
    snapshot: { ...f.snapshot, characters: [{ ...f.snapshot.characters[0]!, vitality, available_points }] },
  })
  expect(action_projected(command, receipt, observed(5, 0))).toBe(false)
  expect(action_projected(command, receipt, observed(10, 5))).toBe(false)
  expect(action_projected(command, receipt, observed(10, 0))).toBe(true)
  expect(action_projected(command, { Transaction: { digest: 'other' } }, observed(10, 0))).toBe(false)
  expect(action_projected({ ...command, status: 'uncertain' }, receipt, observed(10, 0))).toBe(false)
  expect(observed(10, 0).snapshot.characters[0]!.spells).toEqual(f.snapshot.characters[0]!.spells)
})
test('MCP exposes stat spending through the existing mutation lane, scope and idempotency owner', async () => {
  const f = await runtime_fixture()
  const control = create_control_service(f.store, f.options.config, 60000, () => f.clock.now)
  const lease = await control.acquire(f.bot, 'stat-test', 10000)
  const key = lane_key_for(f.bot)
  await control.observed(key, 'stat-test', lease.fence, true)
  const lane = (await f.store.read<Lane>(key))!
  const mcp = create_mcp_handler(control, true, 'https://fixture/.well-known/oauth-protected-resource')
  try {
    const tools = await mcp(f.grant, { jsonrpc: '2.0', id: 1, method: 'tools/list' })
    expect(JSON.stringify(tools)).toContain('bot_raise_stats')
    const args = {
      idempotency_key: 'stats',
      decision_revision: lane.decision_revision,
      observation_revision: lane.observation_revision,
      action: context().command.payload,
    }
    const call = { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'bot_raise_stats', arguments: args } }
    const accepted = await mcp(f.grant, call)
    expect(JSON.stringify(accepted)).toContain('accepted')
    await mcp(f.grant, call)
    expect(await f.store.scan_keys('command:', 100)).toHaveLength(1)
    const readonly = await mcp({ ...f.grant, scopes: ['bot:observe'] }, call)
    expect(JSON.stringify(readonly)).toContain('insufficient_scope')
    expect(
      JSON.stringify(
        await create_mcp_handler(
          control,
          false,
          'https://fixture'
        )(f.grant, { jsonrpc: '2.0', id: 3, method: 'tools/list' })
      )
    ).not.toContain('bot_raise_stats')
  } finally {
    await f.runtime.stop()
  }
})

test('stat allocation composes the real SDK raise_stat door and stops before any signature or submission', async () => {
  const { SDK } = await import('../../sdk/src/client.ts')
  const { Inputs } = await import('@mysten/sui/transactions')
  const { id, pins, digest, fake_client } = await import('../../sdk/test/helpers/transport.ts')
  const { execute_gameplay } = await import('../src/gameplay.ts')
  const f = context(),
    chain = fake_client({ simulate_ok: true })
  const resolve = chain.core.resolveTransactionPlugin()
  chain.core.resolveTransactionPlugin = () => async (data, options, next) => {
    data.inputs.forEach((input, index) => {
      if (input.UnresolvedObject)
        data.inputs[index] = Inputs.ObjectRef({ objectId: input.UnresolvedObject.objectId, version: '1', digest })
    })
    await resolve(data, options, next)
  }
  const calls: string[] = []
  const sdk = SDK({
    client: chain,
    address: f.address,
    pins,
    transaction_storage: null,
    sign_transaction: async (tx) => {
      calls.push(...tx.getData().commands.flatMap((command) => (command.MoveCall ? [command.MoveCall.function] : [])))
      throw new Error('fixture signing boundary: no signature created')
    },
  })
  await expect(
    execute_gameplay({
      ...f,
      sdk: {
        ...sdk,
        get_owned_kiosks: async () => ({
          kioskOwnerCaps: [
            { objectId: character.kiosk_cap!, kioskId: character.kiosk, isPersonal: true, version: '1', digest },
          ],
          kioskIds: [character.kiosk],
          hasNextPage: false,
          nextCursor: null,
        }),
      },
    })
  ).rejects.toThrow('fixture signing boundary')
  expect(calls.filter((method) => method === 'raise_stat')).toHaveLength(1)
  expect(calls).not.toContain('raise_spell')
  expect(chain.calls.executions).toBe(0)
  expect(chain.calls.simulations).toBeGreaterThan(0)
})
