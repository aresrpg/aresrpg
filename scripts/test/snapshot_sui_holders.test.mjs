// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import {
  parse_snapshot_args,
  resolve_holder,
  snapshot_sui_holders,
  staked_inputs,
  staking_sender,
} from '../snapshot_sui_holders.mjs'

import avatar_fixture from './fixtures/snapshot_avatar.mainnet.json'
import listing_fixture from './fixtures/snapshot_listing.mainnet.json'
import staking_fixture from './fixtures/snapshot_staking.mainnet.json'
import staking_upgrade_fixture from './fixtures/snapshot_staking_upgrade.mainnet.json'

const address = (digit) => `0x${digit.repeat(64)}`
const collection = `${address('1')}::pets::Pet`

const response = (data) =>
  Promise.resolve(
    new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } })
  )

const collection_response = (nodes, has_next = false, cursor = null) =>
  response({
    checkpoint: { query: { objects: { pageInfo: { hasNextPage: has_next, endCursor: cursor }, nodes } } },
  })

describe('Sui holder snapshots', () => {
  test('parses repeated collection types without duplicating them', () => {
    expect(parse_snapshot_args(['--type', collection, '--type', collection])).toEqual({
      help: false,
      types: [collection],
      endpoint: 'https://graphql.mainnet.sui.io/graphql',
      output: null,
      recipient: 'wallet',
    })
  })

  test('deduplicates direct and kiosk-wrapped holders at one checkpoint', async () => {
    const nft_direct = address('2')
    const nft_locked = address('3')
    const wrapper = address('4')
    const kiosk = address('5')
    const holder = address('6')
    const calls = []
    const exact_rows = new Map([
      [
        nft_direct,
        [
          { address: nft_direct, owner: { __typename: 'AddressOwner', address: { address: holder } } },
          { address: nft_locked, owner: { __typename: 'ObjectOwner', address: { address: wrapper } } },
        ],
      ],
      [wrapper, [{ address: wrapper, owner: { __typename: 'ObjectOwner', address: { address: kiosk } } }]],
      [
        kiosk,
        [
          {
            address: kiosk,
            owner: { __typename: 'Shared' },
            asMoveObject: {
              contents: {
                type: { repr: '0x0000000000000000000000000000000000000000000000000000000000000002::kiosk::Kiosk' },
                json: { owner: holder },
              },
            },
          },
        ],
      ],
    ])
    const fetch_fn = async (_url, init) => {
      const { query, variables } = JSON.parse(init.body)
      calls.push(query)
      if (query.includes('SnapshotCheckpoint'))
        return response({ checkpoint: { sequenceNumber: 42, timestamp: '2026-09-03T12:00:00Z' } })
      if (query.includes('CollectionObjects')) {
        expect(variables.checkpoint).toBe(42)
        return collection_response([{ address: nft_direct }, { address: nft_locked }])
      }
      const key = variables.keys[0].address
      const rows = exact_rows.get(key)
      if (!rows) throw new Error(`unexpected exact-object key: ${key}`)
      return response({ multiGetObjects: rows })
    }

    await expect(snapshot_sui_holders({ types: [collection], fetch_fn })).resolves.toMatchObject({
      checkpoint: 42,
      object_count: 2,
      recipient: 'wallet',
      recipients: [holder],
    })
    expect(calls.every((query) => !query.includes('mutation'))).toBeTrue()
  })
})

test('NFT recipients require no ownership resolution or runtime indexing', async () => {
  const nft = address('2')
  const fetch_fn = async (_url, init) => {
    const { query } = JSON.parse(init.body)
    if (query.includes('SnapshotCheckpoint'))
      return response({ checkpoint: { sequenceNumber: 42, timestamp: '2026-09-05T00:00:00Z' } })
    expect(query).toContain('CollectionObjects')
    return collection_response([{ address: nft }])
  }
  await expect(snapshot_sui_holders({ types: [collection], recipient: 'object', fetch_fn })).resolves.toMatchObject({
    recipient: 'object',
    recipients: [nft],
  })
})

const snapshot_avatar = async (avatar = avatar_fixture.object) => {
  const nft = avatar.asMoveObject.contents.json.nft_id
  const rows = new Map([
    [nft, { address: nft, owner: { __typename: 'ObjectOwner', address: { address: avatar.address } } }],
    [avatar.address, avatar],
    [avatar.owner.address.address, { address: avatar.owner.address.address, owner: { __typename: 'Shared' } }],
  ])
  const fetch_fn = async (_url, init) => {
    const { query, variables } = JSON.parse(init.body)
    if (query.includes('SnapshotCheckpoint')) return response({ checkpoint: avatar_fixture.checkpoint })
    if (query.includes('CollectionObjects')) return collection_response([{ address: nft }])
    return response({ multiGetObjects: variables.keys.map(({ address: id }) => rows.get(id)) })
  }
  return snapshot_sui_holders({ types: [collection], fetch_fn })
}

test('resolves an egg deposited in the captured avatar contract to its withdrawer', async () => {
  await expect(snapshot_avatar()).resolves.toMatchObject({
    recipients: [avatar_fixture.object.asMoveObject.contents.json.owner],
  })
})

test('does not trust an owner field in an unrelated custodian contract', async () => {
  const avatar = avatar_fixture.object
  await expect(
    snapshot_avatar({
      ...avatar,
      asMoveObject: {
        contents: { ...avatar.asMoveObject.contents, type: { repr: `${address('1')}::kiosk::Kiosk` } },
      },
    })
  ).rejects.toThrow('cannot resolve wallet holder')
})

test('credits the seller of a captured Capy held in a legacy marketplace listing', () => {
  const [nft, , listing] = listing_fixture.objects
  const rows = new Map(listing_fixture.objects.map((row) => [row.address, row]))
  expect(resolve_holder(nft.address, rows, new Map())).toBe(listing.asMoveObject.contents.json.owner)
})

const snapshot_staked_capy = async (transaction = staking_fixture.objects[0].previousTransaction) => {
  const [nft] = staking_fixture.objects
  const rows = new Map(staking_fixture.objects.map((row) => [row.address, row]))
  const fetch_fn = async (_url, init) => {
    const { query, variables } = JSON.parse(init.body)
    if (query.includes('SnapshotCheckpoint')) return response({ checkpoint: staking_fixture.checkpoint })
    if (query.includes('CollectionObjects')) return collection_response([{ address: nft.address }])
    if (query.includes('StakedOwners'))
      return response({ multiGetObjects: [{ address: nft.address, previousTransaction: transaction }] })
    return response({ multiGetObjects: variables.keys.map(({ address: id }) => rows.get(id) ?? null) })
  }
  return snapshot_sui_holders({ types: [nft.asMoveObject.contents.type.repr], fetch_fn })
}

test('credits the holder of the nontransferable staking ticket, not the pool', async () => {
  await expect(snapshot_staked_capy()).resolves.toMatchObject({
    object_count: 1,
    recipients: [staking_fixture.objects[0].previousTransaction.sender.address],
  })
})

test('a staking sender is not trusted without the exact NFT and pool inputs', async () => {
  const transaction = structuredClone(staking_fixture.objects[0].previousTransaction)
  transaction.transactionJson.kind.programmableTransaction.inputs[3].objectId = address('9')
  await expect(snapshot_staked_capy(transaction)).rejects.toThrow('Cannot prove staking holder')
})

test('a pool reference cannot override an NFT that is actually wallet-owned', () => {
  const [nft, ...parents] = staking_fixture.objects
  const owned = { ...nft, owner: { __typename: 'AddressOwner', address: { address: address('9') } } }
  const cache = new Map([owned, ...parents].map((row) => [row.address, row]))
  expect(staked_inputs([nft.address], cache).size).toBe(0)
})

test('capped preparation can report unresolved custody without treating it as a wallet', async () => {
  const owned = address('2')
  const unknown = address('3')
  const holder = address('4')
  const fetch_fn = async (_url, init) => {
    const { query } = JSON.parse(init.body)
    if (query.includes('SnapshotCheckpoint'))
      return response({ checkpoint: { sequenceNumber: 42, timestamp: '2026-09-08T00:00:00Z' } })
    if (query.includes('CollectionObjects')) return collection_response([{ address: owned }, { address: unknown }])
    return response({
      multiGetObjects: [
        { address: owned, owner: { __typename: 'AddressOwner', address: { address: holder } } },
        { address: unknown, owner: { __typename: 'Shared' } },
      ],
    })
  }
  await expect(snapshot_sui_holders({ types: [collection], fetch_fn, allow_unresolved: true })).resolves.toMatchObject({
    recipients: [holder],
    unresolved: [unknown],
    object_count: 2,
  })
  await expect(snapshot_sui_holders({ types: [collection], fetch_fn })).rejects.toThrow('cannot resolve wallet holder')
})

test('accepts the captured staking upgrade with identical verified ticket custody', () => {
  const { object } = staking_upgrade_fixture
  const [, , { address: pool }] = staking_fixture.objects
  expect(staking_sender(object, object.address, pool)).toBe(object.previousTransaction.sender.address)
  const forged = structuredClone(object)
  for (const command of forged.previousTransaction.transactionJson.kind.programmableTransaction.commands)
    if (command.moveCall) command.moveCall.package = address('9')
  expect(() => staking_sender(forged, object.address, pool)).toThrow('Cannot prove staking holder')
})

test('recovers a transient public API failure without losing the snapshot', async () => {
  const nft = address('2')
  let unavailable = true
  const fetch_fn = async (_url, init) => {
    if (unavailable) {
      unavailable = false
      return new Response('temporarily unavailable', { status: 503 })
    }
    const { query } = JSON.parse(init.body)
    if (query.includes('SnapshotCheckpoint'))
      return response({ checkpoint: { sequenceNumber: 42, timestamp: '2026-09-08T00:00:00Z' } })
    return collection_response([{ address: nft }])
  }
  await expect(snapshot_sui_holders({ types: [collection], recipient: 'object', fetch_fn })).resolves.toMatchObject({
    recipients: [nft],
  })
})

test('pins every collection page and ownership lookup to the initial checkpoint', async () => {
  const second_type = `${address('1')}::pets::OtherPet`
  const holder = address('9')
  let point_reads = 0
  const fetch_fn = async (_url, init) => {
    const { query, variables } = JSON.parse(init.body)
    if (query.includes('SnapshotCheckpoint')) {
      point_reads += 1
      return response({ checkpoint: { sequenceNumber: 42, timestamp: '2026-09-08T00:00:00Z' } })
    }
    if (query.includes('CollectionObjects')) {
      expect(query).toContain('checkpoint(sequenceNumber: $checkpoint)')
      expect(variables.checkpoint).toBe(42)
      if (variables.type === second_type) return collection_response([{ address: address('4') }])
      return variables.after
        ? collection_response([{ address: address('3') }])
        : collection_response([{ address: address('2') }], true, 'next')
    }
    expect(variables.keys.every(({ atCheckpoint }) => atCheckpoint === 42)).toBeTrue()
    return response({
      multiGetObjects: variables.keys.map(({ address: id }) => ({
        address: id,
        owner: { __typename: 'AddressOwner', address: { address: holder } },
      })),
    })
  }
  await expect(snapshot_sui_holders({ types: [collection, second_type], fetch_fn })).resolves.toMatchObject({
    checkpoint: 42,
    object_count: 3,
    recipients: [holder],
  })
  expect(point_reads).toBe(1)
})
