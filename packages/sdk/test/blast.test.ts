// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { normalizeStructTag } from '@mysten/sui/utils'
import { ObjectError } from '@mysten/sui/client'

import {
  blast_claim_preview,
  blast_tokens_for,
  blast_url,
  create_blast_reader,
  decode_blast_commitment,
  decode_blast_presale,
  project_blast_presale,
} from '../src/blast.ts'
import { blast_purchase_config } from '../src/blast_purchase.ts'

import { id } from './helpers/transport.ts'
import captured from './fixtures/blast_presale.mainnet.json' with { type: 'json' }
import live from './fixtures/blast_presale_live.mainnet.json' with { type: 'json' }
import kares from './fixtures/kares_presale.mainnet.json' with { type: 'json' }

// Mainnet object 0x091759…facba, version 1056407653, captured 2026-10-21 via gRPC.
test('deployed Blast derives its commitment window from start and duration', () => {
  const fields = captured.objects[0].json
  const sale = decode_blast_presale(fields)
  expect(sale.end_ms).toBe(1792535060924n)
  expect(sale.token_allocation).toBe(495000000000000n)
  const scheduled = { ...sale, lifecycle: 'Open' as const }
  expect(project_blast_presale(scheduled, 1792535046201n, '1056407653').phase).toBe('soon')
  expect(project_blast_presale(scheduled, 1792535046202n, '1056407653').phase).toBe('live')
  expect(project_blast_presale(scheduled, 1792535060924n, '1056407653').phase).toBe('closing')
})

// JSON presentation projection, not a replacement Move/BCS codec. Enum JSON is decoded by Sui.
// Field/lifecycle owner: interest-protocol/blast-v2-contracts/sui/presale/sources/blast_presale.move.
const fields = {
  lifecycle: { '@variant': 'Open' },
  total_commitments: '75',
  raise_target: '100',
  start_ms: '0',
  duration_ms: '200',
  token_allocation: '1000',
}

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

// Blast's published worked example: A = 10,001 tokens, R = 1,000, Alice 1,000 of T = 4,000.
test('estimates and claim previews follow Blast economics', () => {
  const base = project_blast_presale(
    {
      lifecycle: 'Migrated',
      total_commitments: 4000n,
      raise_target: 1000n,
      start_ms: 0n,
      end_ms: 1n,
      token_allocation: 10001n,
      public_ms: null,
    },
    2n,
    '7'
  )
  expect(blast_tokens_for(base, 100n)).toBe(1000n)
  expect(blast_claim_preview(base, 1000n)).toEqual({ tokens: 2500n, refund: 750n })
  expect(blast_claim_preview({ ...base, phase: 'cancelled' }, 1000n)).toEqual({ tokens: 0n, refund: 1000n })
  expect(blast_claim_preview({ ...base, phase: 'funded' }, 1000n)).toBeNull()
})

test('a commitment is two little-endian u64 values and a missing field means nothing to claim', async () => {
  const bytes = new Uint8Array(16)
  bytes.set([0x00, 0xe8, 0x76, 0x48, 0x17], 0)
  bytes.set([0x00, 0x74, 0x3b, 0xa4, 0x0b], 8)
  expect(decode_blast_commitment(bytes)).toEqual({ quote: 100000000000n, wallet_cap: 50000000000n })
  const coin_type = `${id(3)}::token::TOKEN`
  const pins = {
    network: 'testnet' as const,
    kares_coin_type: coin_type,
    blast_presale: { id: id(1), package_original: id(2), url: 'https://www.blast.fun/' },
  }
  const names: unknown[] = []
  let failure: Error | null = null
  const transport = {
    network: 'testnet',
    core: {
      getDynamicField: async (input: { parentId: string; name: unknown }) => {
        names.push(input)
        if (failure) throw failure
        return { dynamicField: { value: { bcs: bytes } } }
      },
    },
  }
  const reader = create_blast_reader({ network: 'testnet', pins }, transport as never)
  expect(await reader.commitment(id(5))).toEqual({ quote: 100000000000n, wallet_cap: 50000000000n })
  expect(names[0]).toMatchObject({ parentId: id(1), name: { type: `${id(2)}::blast_presale::CommitmentKey` } })
  failure = new ObjectError('notExists', 'missing', { reason: 'notFound' })
  expect(await reader.commitment(id(5))).toBeNull()
  failure = new Error('rpc down')
  await expect(reader.commitment(id(5))).rejects.toThrow('rpc down')
})

// Mainnet object 0x247165…2b57e, version 1099635701, captured 2026-11-20 via gRPC: Blast's live deployment.
test('a sale of the live Blast deployment decodes with the same fields', () => {
  const sale = decode_blast_presale(live.objects[0]!.json)
  expect(sale).toEqual({
    lifecycle: 'Migrated',
    total_commitments: 3000000000000n,
    raise_target: 3000000000000n,
    start_ms: 1795164360000n,
    end_ms: 1795164432939n,
    token_allocation: 450000000000000n,
    public_ms: null,
  })
  expect(project_blast_presale(sale, 1795164432939n, '1099635701').phase).toBe('complete')
})

// Same captured KARES sale: allowlisted for four days, then open to any wallet for the last one.
test('the captured KARES sale opens to everyone four days after its start', () => {
  const fields = kares.objects[0]!.json
  const sale = decode_blast_presale(fields)
  expect(sale.public_ms).toBe(1795205043334n + 345600000n)
  expect(project_blast_presale(sale, 1795205043335n, '1101083029').public_ms).toBe(1795550643334n)
  // A phase reserved to eligible wallets, one that would start after the close, or an older layout: none.
  const { uncapped } = fields
  for (const none of [
    { ...fields, uncapped: { ...uncapped, access: { '@variant': 'Eligible' } } },
    { ...fields, uncapped: { ...uncapped, starts_after_ms: fields.duration_ms } },
    { ...fields, uncapped: undefined },
  ])
    expect(decode_blast_presale(none).public_ms).toBeNull()
  // Mainnet object 0x091759…facba (captured 2026-10-21) has no uncapped phase at all.
  expect(decode_blast_presale(captured.objects[0].json).public_ms).toBeNull()
})

// Mainnet object 0x2d8a59…f9b7b, version 1101083029, captured 2026-11-21 via gRPC: the KARES sale itself.
test('the KARES sale reads as live and exposes its purchase configuration', async () => {
  const [sale] = kares.objects
  const [sale_package, coin_type] = [
    sale!.type.slice(0, 66),
    sale!.type.slice(sale!.type.indexOf('<') + 1).split(',')[0],
  ]
  const pins = {
    network: 'mainnet' as const,
    kares_coin_type: coin_type,
    blast_presale: {
      id: sale!.objectId,
      package_original: sale_package,
      package: sale_package,
      package_version: live.objects[1]!.objectId,
      url: `https://www.blast.fun/presale/${sale!.objectId}`,
    },
  }
  const clock = {
    objectId: id(6),
    owner: { $kind: 'Shared' },
    type: '0x2::clock::Clock',
    json: { timestamp_ms: '1795300000000' },
  }
  const transport = { network: 'mainnet', core: { getObjects: async () => ({ objects: [sale, clock] }) } }
  const reader = create_blast_reader({ network: 'mainnet', pins }, transport as never)
  expect(await reader.read()).toMatchObject({
    phase: 'live',
    committed: 1075033011533n,
    target: 60_000_000_000_000n,
    start_ms: 1795205043334n,
    end_ms: 1795637043334n,
    token_allocation: 400_000_000_000_000_000n,
  })
  expect(blast_purchase_config(pins)).toMatchObject({ id: sale!.objectId, package: sale_package })
})
