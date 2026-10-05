// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { normalizeStructTag } from '@mysten/sui/utils'

import { blast_url, create_blast_reader, decode_blast_presale, project_blast_presale } from '../src/blast.ts'

import { id } from './helpers/transport.ts'

// JSON presentation projection, not a replacement Move/BCS codec. Enum JSON is decoded by Sui.
// Field/lifecycle owner: interest-protocol/blast-v2-contracts/sui/presale/sources/blast_presale.move.
const fields = { lifecycle: { '@variant': 'Open' }, total_commitments: '75', raise_target: '100', end_ms: '200' }

test('presale stages follow certified lifecycle, with an explicit wait after the clock expires', () => {
  expect(project_blast_presale(decode_blast_presale(fields), 199n, '3')).toMatchObject({
    phase: 'live',
    progress_bps: 7500,
  })
  expect(project_blast_presale(decode_blast_presale(fields), 200n, '3').phase).toBe('closing')
  for (const [lifecycle, phase] of [
    ['Pending', 'soon'],
    ['Funded', 'funded'],
    ['Migrated', 'complete'],
    ['Cancelled', 'cancelled'],
  ] as const)
    expect(
      project_blast_presale(decode_blast_presale({ ...fields, lifecycle: { '@variant': lifecycle } }), 300n, '4').phase
    ).toBe(phase)
})

test('funding progress stays bounded and preserves exact large integer amounts', () => {
  const sale = decode_blast_presale({
    ...fields,
    total_commitments: '1000000000000000001',
    raise_target: '1000000000000000000',
  })
  expect(project_blast_presale(sale, 0n, '4')).toMatchObject({ committed: 1000000000000000001n, progress_bps: 10000 })
  expect(() => decode_blast_presale({ ...fields, total_commitments: 100 })).toThrow('chain integer')
  expect(() => decode_blast_presale({ ...fields, total_commitments: '18446744073709551616' })).toThrow('chain integer')
  expect(() => decode_blast_presale({ ...fields, lifecycle: { '@variant': 'Guess' } })).toThrow('lifecycle')
  expect(() => project_blast_presale({ ...sale, raise_target: 0n }, 0n, '4')).toThrow('funding target')
})

test('sale links cannot impersonate Blast or carry URL credentials', () => {
  for (const url of [
    'https://blast.fun.evil.test/',
    'http://blast.fun/',
    'https://me@blast.fun/',
    'https://blast.fun:123/',
  ])
    expect(() => blast_url(url)).toThrow()
  expect(blast_url('https://www.blast.fun/presale/example')).toBe('https://www.blast.fun/presale/example')
})

test('an unconfigured sale stays upcoming without any network request', async () => {
  const reader = create_blast_reader({ network: 'testnet', pins: { network: 'testnet' } }, {
    network: 'testnet',
    core: {
      getObjects: () => {
        throw new Error('must not read')
      },
    },
  } as never)
  expect(reader.configured).toBe(false)
  expect(await reader.read()).toBeNull()
})

test('only the pinned standalone presale for the selected currency and SUI can supply progress', async () => {
  const coin_type = `${id(3)}::token::TOKEN`
  const pins = {
    network: 'testnet' as const,
    kares_coin_type: coin_type,
    blast_presale: { id: id(1), package_original: id(2), url: 'https://www.blast.fun/' },
  }
  const sale = {
    objectId: id(1),
    version: '4',
    owner: { $kind: 'Shared' },
    json: fields,
    type: normalizeStructTag(`${id(2)}::blast_presale::Presale<${coin_type},0x2::sui::SUI>`),
  }
  const clock = {
    objectId: id(6),
    owner: { $kind: 'Shared' },
    type: '0x2::clock::Clock',
    json: { timestamp_ms: '100' },
  }
  const transport = { network: 'testnet', core: { getObjects: async () => ({ objects: [sale, clock] }) } }
  const reader = create_blast_reader({ network: 'testnet', pins }, transport as never)
  expect(await reader.read()).toMatchObject({ phase: 'live', committed: 75n, target: 100n })
  sale.type = normalizeStructTag(`${id(9)}::blast_presale::Presale<${coin_type},0x2::sui::SUI>`)
  await expect(reader.read()).rejects.toThrow('Unexpected Blast presale')
  expect(() => create_blast_reader({ network: 'mainnet', pins })).toThrow('testnet')
})
