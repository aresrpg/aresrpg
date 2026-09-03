// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { parse_snapshot_args, snapshot_sui_holders } from './snapshot_sui_holders.mjs'

const address = (digit) => `0x${digit.repeat(64)}`
const collection = `${address('1')}::pets::Pet`

const response = (data) =>
  Promise.resolve(
    new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } })
  )

describe('Sui holder snapshots', () => {
  test('parses repeated collection types without duplicating them', () => {
    expect(parse_snapshot_args(['--type', collection, '--type', collection])).toEqual({
      help: false,
      types: [collection],
      endpoint: 'https://graphql.mainnet.sui.io/graphql',
      output: null,
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
            asMoveObject: { contents: { type: { repr: `${address('0')}::kiosk::Kiosk` }, json: { owner: holder } } },
          },
        ],
      ],
    ])
    const fetch_fn = async (_url, init) => {
      const { query, variables } = JSON.parse(init.body)
      calls.push(query)
      if (query.includes('CollectionObjects'))
        return response({
          checkpoint: { sequenceNumber: 42, timestamp: '2026-09-03T12:00:00Z' },
          objects: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [{ address: nft_direct }, { address: nft_locked }],
          },
        })
      const key = variables.keys[0].address
      const rows = exact_rows.get(key)
      if (!rows) throw new Error(`unexpected exact-object key: ${key}`)
      return response({ multiGetObjects: rows })
    }

    await expect(snapshot_sui_holders({ types: [collection], fetch_fn })).resolves.toMatchObject({
      checkpoint: 42,
      object_count: 2,
      unique_holder_count: 1,
      whitelist: [holder],
    })
    expect(calls.every((query) => !query.includes('mutation'))).toBeTrue()
  })
})
