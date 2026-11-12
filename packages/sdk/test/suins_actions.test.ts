// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { afterEach, expect, mock, spyOn, test } from 'bun:test'
import { ObjectError } from '@mysten/sui/client'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { SuinsClient } from '@mysten/suins'
import type { Transaction } from '@mysten/sui/transactions'
import { normalizeSuiAddress } from '@mysten/sui/utils'

import { leaf_change, set_agent_suins_default, subdomain_config, suins_actions } from '../src/suins_actions.ts'

import registration from './fixtures/suins_registration.json'

// Mainnet SuinsRegistration 0xaa51f76346f51fb79295454d9f6f47b394bb7f288cd70c0ae6b98fd5e517c1da,
// version 996277083, captured 2026-09-11 by Core.getObject.
const owner = registration.owner.AddressOwner
const agent = normalizeSuiAddress('0xa')
const subname_package = '0x00c2f85e07181b90c140b15c5ce27d863f93c4d9159d2a4e7bdaeb40e286d6f5'
const timestamp = 1_789_100_000_000
// Mainnet SuiNS ConfigKey<SubDomainConfig> field
// 0x3a02f9a7c77b13c91532613bd4b3345bce226cbf51f0604e857bb9b37f5d0e37,
// version 108677241, captured 2026-11-11 from gRPC listDynamicFields; checkpoint 343956030.
// Digest HGKXaNAXUoJ1pPSUjG447HE9ZjHNJYkyXEfbQvs5RpSA.
const config_bytes = new Uint8Array([1, 3, 115, 117, 105, 10, 3, 0, 92, 38, 5, 0, 0, 0, 0])
type RecordValue = NonNullable<Awaited<ReturnType<SuinsClient['getNameRecord']>>>
const node = (name = 'sceat.sui', data: Record<string, string> = {}): RecordValue => ({
  name,
  nftId: registration.objectId,
  targetAddress: owner,
  expirationTimestampMs: Number(registration.json.expiration_timestamp_ms),
  data,
})
const leaf = (target = owner, data: Record<string, string> = {}): RecordValue => ({
  ...node('aresrpg.sceat.sui', data),
  targetAddress: target,
  expirationTimestampMs: 0,
})
afterEach(() => mock.restore())
const setup = (managed = true) => {
  const client = new SuiGrpcClient({ network: 'mainnet', baseUrl: 'https://unused.invalid' })
  const state = {
    records: new Map<string, RecordValue>([['sceat.sui', node()]]),
    defaults: new Map<string, string>(),
    targets: new Map<string, string>(),
    reads: 0,
    executions: [] as Transaction[],
    before_execute: () => {},
    owned: [registration] as unknown[],
  }
  spyOn(SuinsClient.prototype, 'getNameRecord').mockImplementation(async (name) => state.records.get(name) ?? null)
  client.core.defaultNameServiceName = async ({ address }) => ({ data: { name: state.defaults.get(address) ?? null } })
  client.core.resolveNameServiceAddress = async ({ name }) => ({
    address: state.targets.get(name) ?? state.records.get(name)?.targetAddress ?? null,
  })
  client.core.getDynamicField = async () => ({ dynamicField: { value: { bcs: config_bytes } } }) as never
  client.movePackageService.getDatatype = (async () => ({
    response: { datatype: { definingId: subname_package } },
  })) as never
  client.core.listOwnedObjects = async ({ type, cursor }) => {
    state.reads++
    const objects = state.owned.filter((object) => (object as { type: string }).type === type)
    return { objects: cursor ? [] : objects, hasNextPage: !cursor, cursor: cursor ? null : 'next' } as never
  }
  const sdk = {
    execute: async (transaction: Transaction, options?: { before_sign?: () => void }) => {
      state.before_execute()
      options?.before_sign?.()
      state.executions.push(transaction)
      return { Transaction: { digest: 'confirmed' } } as never
    },
  }
  const actions = suins_actions({ client, sdk, address: owner, managed, now: () => timestamp })
  return { actions, client, state, sdk }
}
const current = () => {}
const commands = (transaction: Transaction) =>
  transaction.getData().commands.map((command) => command.MoveCall?.function)

test('captured config bytes pin deployed mutable child constraints', () => {
  expect(subdomain_config.parse(config_bytes)).toEqual({
    allowed_tlds: ['sui'],
    max_depth: 10,
    min_label_size: 3,
    minimum_duration: '86400000',
  })
})
test('owned discovery retains captured registration identity and follows pagination', async () => {
  const { actions, state } = setup()
  expect(await actions.snapshot()).toEqual({
    default_name: null,
    names: [{ name: 'sceat.sui', object_id: registration.objectId, nft_id: registration.objectId, subname: false }],
  })
  expect(state.reads).toBe(4)
})
test('external wallet verifies its default and requires an explicit player target for leaf writes', async () => {
  const { actions, state } = setup(false)
  state.defaults.set(owner, 'deep.other.sui')
  state.targets.set('deep.other.sui', owner)
  expect((await actions.snapshot()).default_name).toBe('deep.other.sui')
  await expect(actions.validate_parent('sceat.sui', current)).rejects.toThrow('unsupported')
  await expect(actions.apply_parent('sceat.sui', agent, current)).rejects.toThrow('unsupported')
  expect(state.reads).toBe(4)
  expect(state.executions).toHaveLength(0)
  state.targets.set('deep.other.sui', agent)
  expect((await actions.snapshot()).default_name).toBeNull()
})
test('preflight refuses live nodes, invalid lineage metadata, expired parents and changed ownership', async () => {
  const { actions, state } = setup()
  state.records.set('aresrpgagent.sceat.sui', node())
  await expect(actions.validate_parent('sceat.sui', current)).rejects.toThrow('collision')
  state.records.set('aresrpgagent.sceat.sui', {
    ...leaf(agent, { unknown: 'retain' }),
    nftId: normalizeSuiAddress('0xb'),
  })
  await expect(actions.validate_parent('sceat.sui', current)).rejects.toThrow('metadata')
  state.records.delete('aresrpgagent.sceat.sui')
  state.records.set('sceat.sui', { ...node(), expirationTimestampMs: 1 })
  await expect(actions.validate_parent('sceat.sui', current)).rejects.toThrow('invalid_parent')
  state.records.set('sceat.sui', node())
  state.owned = [{ ...registration, owner: { $kind: 'AddressOwner', AddressOwner: agent } }]
  await expect(actions.validate_parent('sceat.sui', current)).rejects.toThrow('ownership changed')
  expect(state.executions).toHaveLength(0)
})
test('root application creates two final-target leaves and only the human default', async () => {
  const { actions, state } = setup()
  await actions.validate_parent('sceat.sui', current)
  expect(state.executions).toHaveLength(0)
  expect(await actions.apply_parent('sceat.sui', agent, current)).toEqual({
    name: 'aresrpg.sceat.sui',
    digest: 'confirmed',
  })
  expect(commands(state.executions[0]!)).toEqual(['new_leaf', 'new_leaf', 'set_reverse_lookup'])
})
test('identical application performs no write and preserves arbitrary existing metadata', async () => {
  const { actions, state } = setup()
  state.records.set('aresrpg.sceat.sui', leaf(owner, { unknown: 'keep' }))
  state.records.set('aresrpgagent.sceat.sui', leaf(agent, { avatar: 'keep' }))
  state.defaults.set(owner, 'aresrpg.sceat.sui')
  expect(await actions.apply_parent('sceat.sui', agent, current)).toEqual({ name: 'aresrpg.sceat.sui' })
  expect(state.executions).toHaveLength(0)
})
test('retargeting recreates a same-lineage leaf; stale lineage and expired nodes use direct creation', () => {
  expect(leaf_change(leaf(owner), registration.objectId, agent, timestamp)).toBe('replace')
  expect(leaf_change({ ...leaf(), nftId: agent }, registration.objectId, agent, timestamp)).toBe('create')
  expect(
    leaf_change({ ...node(), expirationTimestampMs: timestamp - 1 }, registration.objectId, agent, timestamp)
  ).toBe('create')
  expect(() =>
    leaf_change({ ...node(), expirationTimestampMs: timestamp }, registration.objectId, agent, timestamp)
  ).toThrow('collision')
  expect(() => leaf_change(leaf(owner, { unknown: 'keep' }), registration.objectId, agent, timestamp)).toThrow(
    'metadata'
  )
  expect(() =>
    leaf_change({ ...leaf(owner, { unknown: 'keep' }), nftId: agent }, registration.objectId, undefined, timestamp)
  ).toThrow('metadata')
})
test('wrong target with metadata is refused after final multisig identity becomes known', async () => {
  const { actions, state } = setup()
  state.records.set('aresrpgagent.sceat.sui', leaf(owner, { unknown: 'keep' }))
  await actions.validate_parent('sceat.sui', current)
  await expect(actions.apply_parent('sceat.sui', agent, current)).rejects.toThrow('metadata')
  expect(state.executions).toHaveLength(0)
})
test('nested parent passes wrapper to proxy while registry lineage uses embedded NFT', async () => {
  const { actions, state } = setup()
  const wrapper = normalizeSuiAddress('0xc')
  state.owned = [
    {
      ...registration,
      objectId: wrapper,
      type: `${subname_package}::subdomain_registration::SubDomainRegistration`,
      json: { nft: { ...registration.json, domain_name: 'child.sceat.sui' } },
    },
  ]
  state.records.set('child.sceat.sui', node('child.sceat.sui', { S_AC: '' }))
  const snapshot = await actions.snapshot()
  expect(snapshot.names[0]).toMatchObject({ object_id: wrapper, nft_id: registration.objectId })
  await actions.apply_parent('child.sceat.sui', agent, current)
  const data = state.executions[0]!.getData()
  expect(data.commands[0]!.MoveCall?.module).toBe('subdomain_proxy')
  expect(data.inputs.some((input) => input.UnresolvedObject?.objectId === wrapper)).toBe(true)
  state.records.set('child.sceat.sui', node('child.sceat.sui'))
  expect((await actions.snapshot()).names).toEqual([])
})
test('fresh apply refuses a parent changed since preflight and SDK before_sign cancels queued work', async () => {
  const { actions, state } = setup()
  await actions.validate_parent('sceat.sui', current)
  state.records.set('sceat.sui', { ...node(), nftId: agent })
  await expect(actions.apply_parent('sceat.sui', agent, current)).rejects.toThrow('invalid_parent')
  state.records.set('sceat.sui', node())
  let active = true
  state.before_execute = () => {
    active = false
  }
  await expect(
    actions.apply_parent('sceat.sui', agent, () => {
      if (!active) throw new Error('cancelled')
    })
  ).rejects.toThrow('cancelled')
  expect(state.executions).toHaveLength(0)
})
test('agent default is a separate sender execution, idempotent and lifetime guarded', async () => {
  const { client, sdk, state } = setup()
  const name = 'aresrpgagent.sceat.sui'
  state.targets.set(name, agent)
  await set_agent_suins_default(client, sdk, agent, name, current)
  expect(commands(state.executions[0]!)).toEqual(['set_reverse_lookup'])
  state.defaults.set(agent, name)
  await set_agent_suins_default(client, sdk, agent, name, current)
  expect(state.executions).toHaveLength(1)
  state.defaults.delete(agent)
  let active = true
  state.before_execute = () => {
    active = false
  }
  await expect(
    set_agent_suins_default(client, sdk, agent, name, () => {
      if (!active) throw new Error('cancelled')
    })
  ).rejects.toThrow('cancelled')
  expect(state.executions).toHaveLength(1)
})
test('failed and uncertain submissions are not retried by either naming operation', async () => {
  const { client, state, sdk } = setup()
  let attempts = 0
  sdk.execute = async () => {
    attempts++
    throw new Error('uncertain receipt')
  }
  const actions = suins_actions({ client, sdk, address: owner, managed: true, now: () => timestamp })
  await expect(actions.apply_parent('sceat.sui', agent, current)).rejects.toThrow('uncertain receipt')
  state.targets.set('aresrpgagent.sceat.sui', agent)
  await expect(set_agent_suins_default(client, sdk, agent, 'aresrpgagent.sceat.sui', current)).rejects.toThrow(
    'uncertain receipt'
  )
  expect(attempts).toBe(2)
})

// Mainnet getNameRecord("aresrpg.sceat.sui"), 2026-11-11. This existing expired node's
// avatar is a real reason the reviewed preservation policy must refuse replacement.
test('captured expired application node cannot lose its avatar during replacement', () => {
  const captured: RecordValue = {
    name: 'aresrpg.sceat.sui',
    nftId: '0x0ca9dac0e81fabdf0d750a571c1dd81420f040eea5fbf197455473f0bfdf5091',
    targetAddress: '0x3d1342fb7de99c69ce821183bcfc5b6374d81453bf5ca9bf7e383e75b3722983',
    expirationTimestampMs: 1736548310642,
    data: { avatar: '0x71465c22cf9ccb25e60e1a3f6bc5381899825a3bde0e7ab1e067145ba8c01509' },
  }
  expect(() => leaf_change(captured, registration.objectId, owner, timestamp)).toThrow('metadata')
})

test('external parent signer creates player-targeted leaves without changing its own default', async () => {
  const { actions, state } = setup(false)
  const player = normalizeSuiAddress('0xb')
  expect((await actions.snapshot()).names.map(({ name }) => name)).toEqual(['sceat.sui'])
  await actions.validate_parent('sceat.sui', current, player)
  await actions.apply_parent('sceat.sui', agent, current, player)
  expect(commands(state.executions[0]!)).toEqual(['new_leaf', 'new_leaf'])
  const { inputs } = state.executions[0]!.getData()
  expect(inputs.some((input) => input.Pure?.bytes === Buffer.from(player.slice(2), 'hex').toString('base64'))).toBe(
    true
  )
})

test('player reverse record is signed separately and refuses a foreign target', async () => {
  const { actions, state } = setup()
  await expect(actions.set_default('aresrpg.sceat.sui', current)).rejects.toThrow('invalid_parent')
  state.targets.set('aresrpg.sceat.sui', owner)
  await actions.set_default('aresrpg.sceat.sui', current)
  expect(commands(state.executions[0]!)).toEqual(['set_reverse_lookup'])
  await expect(actions.set_default('aresrpgagent.sceat.sui', current)).rejects.toThrow('invalid_parent')
})

test('external parent keeps ownership, collision and cancellation checks', async () => {
  const { actions, state } = setup(false)
  const player = normalizeSuiAddress('0xb')
  state.records.set('aresrpg.sceat.sui', leaf(owner, { avatar: 'keep' }))
  await expect(actions.validate_parent('sceat.sui', current, player)).rejects.toThrow('metadata')
  state.records.delete('aresrpg.sceat.sui')
  await actions.validate_parent('sceat.sui', current, player)
  state.owned = []
  await expect(actions.apply_parent('sceat.sui', agent, current, player)).rejects.toThrow('invalid_parent')
  state.owned = [registration]
  let active = true
  state.before_execute = () => {
    active = false
  }
  await expect(
    actions.apply_parent(
      'sceat.sui',
      agent,
      () => {
        if (!active) throw new Error('cancelled')
      },
      player
    )
  ).rejects.toThrow('cancelled')
  expect(state.executions).toHaveLength(0)
})

// Exercise the installed SuiNS reader: Core throws for a missing dynamic field,
// rather than returning the null record that the earlier fixture simulated.
test('missing application leaves are creatable through the real SuiNS reader', async () => {
  const reader_client = new SuiGrpcClient({ network: 'mainnet', baseUrl: 'https://unused.invalid' })
  const reader = new SuinsClient({ client: reader_client })
  const read = reader.getNameRecord.bind(reader)
  reader_client.core.getObjects = async () => ({
    objects: [new ObjectError('notExists', 'Missing application leaf', { reason: 'notFound' })],
  })
  const { actions, state } = setup()
  spyOn(SuinsClient.prototype, 'getNameRecord').mockImplementation(
    async (name) => state.records.get(name) ?? read(name)
  )
  await actions.validate_parent('sceat.sui', current)
  expect(state.executions).toHaveLength(0)
  await actions.apply_parent('sceat.sui', agent, current)
  expect(commands(state.executions[0]!)).toEqual(['new_leaf', 'new_leaf', 'set_reverse_lookup'])
  state.records.set('aresrpg.sceat.sui', leaf())
  state.records.set('aresrpgagent.sceat.sui', leaf(agent))
  state.defaults.set(owner, 'aresrpg.sceat.sui')
  await actions.apply_parent('sceat.sui', agent, current)
  expect(state.executions).toHaveLength(1)
})

test.each([new ObjectError('unknown', 'Unavailable record', { reason: 'unknown' }), new Error('Network unavailable')])(
  'record lookup failures never authorize leaf creation: %s',
  async (failure) => {
    const { actions, state } = setup()
    spyOn(SuinsClient.prototype, 'getNameRecord').mockRejectedValue(failure)
    await expect(actions.apply_parent('sceat.sui', agent, current)).rejects.toThrow(failure)
    expect(state.executions).toHaveLength(0)
  }
)

test('a missing parent record is invalid authority, not an available leaf', async () => {
  const { actions, state } = setup()
  spyOn(SuinsClient.prototype, 'getNameRecord').mockRejectedValue(
    new ObjectError('notExists', 'Missing parent', { reason: 'notFound' })
  )
  await expect(actions.validate_parent('sceat.sui', current)).rejects.toThrow('invalid_parent')
  expect(state.executions).toHaveLength(0)
})
