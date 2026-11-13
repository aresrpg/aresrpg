// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { parse_gameplay_action, validate_gameplay, execute_gameplay_actions } from '../src/gameplay.ts'
import { bind_action_baseline, action_projected, reconcile_action } from '../src/action_reconciliation.ts'
import { create_mcp_handler } from '../src/mcp.ts'
import { create_control_service, lane_key_for, type Lane } from '../src/control.ts'

import { character, profession_context } from './helpers/profession_fixture.ts'
import { runtime_fixture } from './helpers/runtime_fixture.ts'
import { put } from './helpers/control_fixture.ts'

test('spell upgrades use the canonical gameplay catalog', () => {
  const payload = { character_id: character.id, spell: 'Tricky Trap' }
  expect(parse_gameplay_action('raise_spell', payload)).toEqual(payload)
})

const context = () => {
  const base = profession_context()
  return {
    ...base,
    command: {
      ...base.command,
      kind: 'raise_spell' as const,
      payload: { character_id: character.id, spell: 'Tricky Trap' },
    },
    snapshot: { ...base.snapshot, characters: [{ ...character, classe: 'yajin', available_spell_points: 5 }] },
  }
}
test('spell admission rejects stale, foreign, fight-held, locked, capped and unaffordable upgrades', () => {
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
  expect(() => validate_gameplay(change({ classe: 'asobi' }))).toThrow('spell_not_learned')
  expect(() =>
    validate_gameplay({ ...f, command: { ...f.command, payload: { ...f.command.payload, spell: 'Lethal Trap' } } })
  ).toThrow('spell_not_learned')
  expect(() => validate_gameplay(change({ spells: { 'Tricky Trap': 6 } }))).toThrow('spell_rank_capped')
  expect(() => validate_gameplay(change({ spells: { 'Tricky Trap': 3 }, available_spell_points: 2 }))).toThrow(
    'insufficient_spell_points'
  )
  expect(() => validate_gameplay(change({ available_spell_points: NaN }))).toThrow('needs_resync')
  for (const payload of [
    { character_id: character.id, spell: '' },
    { character_id: character.id, spell: 'Tricky Trap', rank: 6 },
  ])
    expect(() => parse_gameplay_action('raise_spell', payload)).toThrow('invalid_gameplay_payload')
  expect(() => parse_gameplay_action('raise_spell', { character_id: character.id, spell: 'invented' })).toThrow(
    'unknown_combat_spell'
  )
})
test('spell upgrades reuse the SDK action with exact owned custody', async () => {
  const f = context()
  const plan = validate_gameplay(f)
  expect(plan).toMatchObject({
    kind: 'raise_spell',
    input: {
      character_id: character.id,
      spell: 'Tricky Trap',
      custody: { kiosk: character.kiosk, kiosk_cap: character.kiosk_cap },
    },
  })
  const inputs: unknown[] = []
  await execute_gameplay_actions(f, {
    raise_spell: async (input: unknown) => {
      inputs.push(input)
      return { digest: 'synthetic' }
    },
  } as never)
  expect(inputs).toEqual([plan.input])
})

for (const current_rank of [1, 3]) {
  test(`spell rank ${current_rank} completion waits for the completed native projection, never uncertainty`, () => {
    const base = context()
    const f = {
      ...base,
      snapshot: {
        ...base.snapshot,
        characters: [{ ...base.snapshot.characters[0]!, spells: { 'Tricky Trap': current_rank } }],
      },
    }
    const command = bind_action_baseline({ ...f.command, status: 'completed', result: { digest: 'D' } }, f)
    const receipt = {
      Transaction: {
        digest: 'D',
        effects: {
          changedObjects: [{ objectId: character.id, outputState: 'ObjectWrite', outputVersion: '9007199254740993' }],
        },
      },
    }
    const observed = (rank: number, points: number, version?: string) => ({
      ...f,
      snapshot: {
        ...f.snapshot,
        characters: [
          { ...f.snapshot.characters[0]!, spells: { 'Tricky Trap': rank }, available_spell_points: points, version },
        ],
      },
    })
    const next_rank = current_rank + 1
    const remaining = 5 - current_rank
    expect(action_projected(command, receipt, f)).toBe(false)
    expect(action_projected(command, receipt, observed(next_rank, 5))).toBe(false)
    expect(action_projected(command, receipt, observed(current_rank, remaining))).toBe(false)
    expect(action_projected(command, receipt, observed(next_rank, remaining))).toBe(false)
    expect(action_projected(command, receipt, observed(next_rank, remaining, '9007199254740992'))).toBe(false)
    expect(action_projected(command, receipt, observed(next_rank, remaining, '9007199254740993'))).toBe(true)
    expect(action_projected(command, receipt, observed(next_rank + 1, 0, '9007199254740994'))).toBe(true)
    expect(action_projected(command, receipt, observed(1, 5, '9007199254740994'))).toBe(true)
    expect(
      action_projected(
        command,
        { Transaction: { ...receipt.Transaction, digest: 'other' } },
        observed(next_rank, remaining, '9007199254740993')
      )
    ).toBe(false)
    expect(
      action_projected({ ...command, status: 'uncertain' }, receipt, observed(next_rank, remaining, '9007199254740993'))
    ).toBe(false)
  })
}
test('MCP exposes spell upgrades through the existing mutation lane, scope and idempotency owner', async () => {
  const f = await runtime_fixture()
  const control = create_control_service(f.store, f.options.config, 60000, () => f.clock.now)
  const lease = await control.acquire(f.bot, 'spell-test', 10000)
  const key = lane_key_for(f.bot)
  await control.observed(key, 'spell-test', lease.fence, true)
  const lane = (await f.store.read<Lane>(key))!
  const mcp = create_mcp_handler(control, true, 'https://fixture/.well-known/oauth-protected-resource')
  try {
    const tools = await mcp(f.grant, { jsonrpc: '2.0', id: 1, method: 'tools/list' })
    expect(JSON.stringify(tools)).toContain('bot_raise_spell')
    const args = {
      idempotency_key: 'spell',
      decision_revision: lane.decision_revision,
      observation_revision: lane.observation_revision,
      action: context().command.payload,
    }
    const call = { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'bot_raise_spell', arguments: args } }
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
    ).not.toContain('bot_raise_spell')
  } finally {
    await f.runtime.stop()
  }
})

test('spell allocation composes the real SDK raise_spell door and stops before any signature or submission', async () => {
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
    pins: { ...pins, seed_package_original: id(60), content_root: { id: id(61), shared_version: '1' } },
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
  expect(calls.filter((method) => method === 'raise_spell')).toHaveLength(1)
  expect(calls).not.toContain('raise_stat')
  expect(chain.calls.executions).toBe(0)
  expect(chain.calls.simulations).toBeGreaterThan(0)
})

test('reconnect reconciles a completed spell receipt after later upgrades or resets, never partial projection', async () => {
  const f = await runtime_fixture()
  const control = create_control_service(f.store, f.options.config, 60000, () => f.clock.now)
  const lease = await control.acquire(f.bot, 'actor', 10000)
  const key = lane_key_for(f.bot)
  await control.observed(key, 'actor', lease.fence, true)
  const base = context()
  const command = bind_action_baseline(
    { ...base.command, id: 'upgrade', lane_key: key, status: 'completed', result: { digest: 'fixture-upgrade' } },
    base
  )
  const receipt = {
    Transaction: {
      digest: 'fixture-upgrade',
      effects: { changedObjects: [{ objectId: character.id, outputState: 'ObjectWrite', outputVersion: '101' }] },
    },
  }
  await put(f.store, 'command:upgrade', command)
  await put(f.store, 'receipt:fixture-upgrade', { receipt })
  const lane = (await f.store.read<Lane>(key))!
  try {
    for (const [rank, points, version, complete] of [
      [2, 4, undefined, false], // Root and book values visible, final publication not yet applied.
      [3, 2, '100', false], // A stale completed snapshot cannot acknowledge this receipt.
      [3, 2, '102', true], // First reconnect already includes another upgrade.
      [1, 5, '103', true], // First reconnect already includes a reset.
    ] as const) {
      await put(f.store, key, { ...lane, needs_resync: true, reconciliation_command: command.id })
      const observed = {
        ...base,
        snapshot: {
          ...base.snapshot,
          characters: [
            {
              ...base.snapshot.characters[0]!,
              spells: { 'Tricky Trap': rank },
              available_spell_points: points,
              version,
            },
          ],
        },
      }
      await reconcile_action(f.store, key, 'actor', lease.fence, observed, f.clock.now)
      expect(await f.store.read<Lane>(key)).toMatchObject({
        needs_resync: !complete,
        reconciliation_command: complete ? null : command.id,
      })
    }
    const projected = {
      ...base,
      snapshot: { ...base.snapshot, characters: [{ ...base.snapshot.characters[0]!, version: '103' }] },
    }
    expect(action_projected(command, { FailedTransaction: receipt.Transaction }, projected)).toBe(false)
    expect(
      action_projected(
        command,
        {
          Transaction: {
            ...receipt.Transaction,
            effects: { changedObjects: [{ objectId: 'other', outputState: 'ObjectWrite', outputVersion: '101' }] },
          },
        },
        projected
      )
    ).toBe(false)
  } finally {
    await f.runtime.stop()
  }
})
