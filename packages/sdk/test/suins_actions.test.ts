// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import type { Transaction } from '@mysten/sui/transactions'

import { suins_actions } from '../src/suins_actions.ts'

import registration from './fixtures/suins_registration.json'

// Captured via mainnet Core.getObject on 2026-09-11:
// SuinsRegistration 0xaa51f76346f51fb79295454d9f6f47b394bb7f288cd70c0ae6b98fd5e517c1da, version 996277083.
const owner = registration.owner.AddressOwner
// GetDatatype on the current mainnet SuiNS package identifies this original defining package.
const subname_package = '0x00c2f85e07181b90c140b15c5ce27d863f93c4d9159d2a4e7bdaeb40e286d6f5'
const setup = () => {
  const client = new SuiGrpcClient({ network: 'mainnet', baseUrl: 'https://unused.invalid' })
  const state = {
    target: owner as string | null,
    default_name: null as string | null,
    reads: 0,
    executions: [] as Transaction[],
  }
  client.core.defaultNameServiceName = async () => ({ data: { name: state.default_name } })
  client.core.resolveNameServiceAddress = async () => ({ address: state.target })
  client.movePackageService.getDatatype = (async () => ({
    response: { datatype: { definingId: subname_package } },
  })) as never
  client.core.listOwnedObjects = async ({ type, cursor }) => {
    state.reads += 1
    if (type?.includes('::subdomain_registration::')) return { objects: [], hasNextPage: false, cursor: null }
    return { objects: cursor ? [] : [registration], hasNextPage: !cursor, cursor: cursor ? null : 'next' } as never
  }
  const actions = suins_actions({
    client,
    address: owner,
    now: () => 1_789_100_000_000,
    sdk: {
      execute: async (transaction) => {
        state.executions.push(transaction)
        return { Transaction: { digest: 'confirmed' } } as never
      },
    },
  })
  return { actions, client, state }
}

test('owned-name discovery decodes a captured registration and follows pagination', async () => {
  const { actions, state } = setup()
  expect(await actions.snapshot()).toEqual({
    default_name: null,
    names: [{ name: 'sceat.sui', object_id: registration.objectId, subname: false }],
  })
  expect(state.reads).toBe(3)
})

test('a target-only subname sets the default without NFT ownership or transfer', async () => {
  const { actions, state } = setup()
  expect(await actions.set_default('sceat@sceat')).toEqual({ ok: true, name: 'sceat.sceat.sui', digest: 'confirmed' })
  expect(state.reads).toBe(0)
  expect(state.executions).toHaveLength(1)
  expect(state.executions[0]!.getData().commands).toMatchObject([
    { MoveCall: { module: 'controller', function: 'set_reverse_lookup' } },
  ])
})

test('an owned name can update its target and default in one transaction', async () => {
  const { actions, state } = setup()
  state.target = null
  expect((await actions.set_default('@sceat')).ok).toBe(true)
  expect(state.executions).toHaveLength(1)
  expect(state.executions[0]!.getData().commands).toMatchObject([
    { MoveCall: { module: 'controller', function: 'set_target_address' } },
    { MoveCall: { module: 'controller', function: 'set_reverse_lookup' } },
  ])
})

test('invalid and foreign names are refused without signing', async () => {
  const { actions, state } = setup()
  expect(await actions.set_default('not a name')).toEqual({ ok: false, reason: 'invalid_name' })
  state.target = '0x1'
  expect(await actions.set_default('other.sui')).toEqual({ ok: false, reason: 'not_targeted' })
  expect(state.executions).toHaveLength(0)
})

test('a missing reverse record is empty data; transport errors remain errors', async () => {
  const { actions, client } = setup()
  client.core.defaultNameServiceName = async () => {
    throw Object.assign(new Error('missing'), { code: 'NOT_FOUND' })
  }
  expect((await actions.snapshot()).default_name).toBeNull()
  client.core.defaultNameServiceName = async () => {
    throw new Error('offline')
  }
  await expect(actions.snapshot()).rejects.toThrow('offline')
})

test('owned subnames use their canonical defining type and wrapper NFT when changing a target', async () => {
  const { actions, client, state } = setup()
  const type = `${subname_package}::subdomain_registration::SubDomainRegistration`
  client.core.listOwnedObjects = async (input) =>
    ({
      objects:
        input.type === type
          ? [
              {
                ...registration,
                objectId: '0x000000000000000000000000000000000000000000000000000000000000000c',
                type,
                json: {
                  nft: { ...registration.json, domain_name: 'child.sceat.sui' },
                },
              },
            ]
          : [],
      cursor: null,
      hasNextPage: false,
    }) as never
  state.target = null
  expect((await actions.snapshot()).names).toEqual([
    {
      name: 'child.sceat.sui',
      object_id: '0x000000000000000000000000000000000000000000000000000000000000000c',
      subname: true,
    },
  ])
  expect((await actions.set_default('child@sceat')).ok).toBe(true)
  expect(state.executions[0]!.getData().commands).toMatchObject([
    { MoveCall: { module: 'subdomain_proxy', function: 'set_target_address' } },
    { MoveCall: { module: 'controller', function: 'set_reverse_lookup' } },
  ])
})

test('expired registrations and changed owners cannot authorize a target change', async () => {
  const { actions, client, state } = setup()
  state.target = null
  client.core.listOwnedObjects = async ({ type }) =>
    ({
      objects:
        type === registration.type
          ? [{ ...registration, json: { ...registration.json, expiration_timestamp_ms: '1' } }]
          : [],
      cursor: null,
      hasNextPage: false,
    }) as never
  expect((await actions.snapshot()).names).toEqual([])
  expect(await actions.set_default('sceat.sui')).toEqual({ ok: false, reason: 'not_targeted' })
  client.core.listOwnedObjects = async () =>
    ({
      objects: [{ ...registration, owner: { $kind: 'AddressOwner', AddressOwner: '0x1' } }],
      cursor: null,
      hasNextPage: false,
    }) as never
  await expect(actions.set_default('sceat.sui')).rejects.toThrow('ownership changed')
  expect(state.executions).toHaveLength(0)
})
