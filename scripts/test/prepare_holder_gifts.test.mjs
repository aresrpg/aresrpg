// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from 'bun:test'

import {
  append_holder_gifts,
  holder_giftcard_batch,
  prepare_holder_gifts,
  validate_holder_snapshot,
} from '../prepare_holder_gifts.mjs'

const address = (digit) => `0x${digit.repeat(64)}`
const collection = { item_type: 'primemachin', types: [`${address('1')}::factory::PrimeMachin`], recipient: 'object' }
const snapshot = {
  endpoint: 'https://graphql.mainnet.sui.io/graphql',
  types: collection.types,
  recipient: 'object',
  checkpoint: 42,
  checkpoint_timestamp: '2026-09-08T00:00:00Z',
  object_count: 2,
  recipients: [address('3'), address('2')],
}

test('object gifts keep NFT IDs as mainnet custody without resolving holders', () => {
  const batch = holder_giftcard_batch('2026-09-08', collection, snapshot)
  expect(batch.recipients).toEqual([address('2'), address('3')])
  expect(batch).toMatchObject({ network: 'mainnet', amount: 1 })
})

test('an archived snapshot cannot silently change network, type, or recipient mode', () => {
  for (const changed of [
    { endpoint: 'https://graphql.testnet.sui.io/graphql' },
    { types: [`${address('4')}::fake::NFT`] },
    { recipient: 'wallet' },
    { recipients: [address('2'), address('2')] },
    { recipients: [address('2')] },
  ])
    expect(() => validate_holder_snapshot(collection, { ...snapshot, ...changed })).toThrow()
})

test('capped Suifren selection is reproducible, unique, and limited to 500 verified holders', () => {
  const recipients = Array.from({ length: 700 }, (_, index) => `0x${index.toString(16).padStart(64, '0')}`)
  const capped = { ...collection, item_type: 'suifren_capy', recipient: 'wallet', limit: 500 }
  const holders = { ...snapshot, recipient: 'wallet', object_count: 701, recipients, unresolved: [address('a')] }
  const first = holder_giftcard_batch('2026-09-08', capped, holders)
  const second = holder_giftcard_batch('2026-09-08', capped, { ...holders, recipients: [...recipients].reverse() })
  expect(first.recipients).toHaveLength(500)
  expect(new Set(first.recipients).size).toBe(500)
  expect(first).toEqual(second)
  expect(() => holder_giftcard_batch('2026-09-08', { ...capped, limit: undefined }, holders)).toThrow('every holder')
})

test('rerunning preparation preserves exact supply and refuses changed allocations', () => {
  const batch = holder_giftcard_batch('2026-09-08', collection, snapshot)
  const before = { campaigns: [], giftcards: [], giftcard_batches: [batch] }
  expect(append_holder_gifts(before, [batch])).toBe(before)
  expect(() => append_holder_gifts(before, [{ ...batch, recipients: [address('9')] }])).toThrow(
    'refusing to rewrite supply'
  )
})

test('preparation saves snapshots once and appends only missing seed giftcards', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ares-holder-gifts-'))
  try {
    await mkdir(join(root, 'seed/content/snapshots'), { recursive: true })
    await mkdir(join(root, 'seed/content'), { recursive: true })
    await writeFile(
      join(root, 'seed/content/snapshots/collections.json'),
      JSON.stringify({ date: '2026-09-08', collections: [collection] })
    )
    const old = { id: 'old', item_type: 'sui_crate', amount: 1, custody: address('9') }
    await writeFile(join(root, 'seed/content/airdrop.json'), JSON.stringify({ campaigns: [], giftcards: [old] }))
    await prepare_holder_gifts({ root, snapshot_fn: async () => snapshot, progress: () => undefined })
    const first = await readFile(join(root, 'seed/content/airdrop.json'), 'utf8')
    expect(JSON.parse(first).giftcards).toHaveLength(1)
    expect(JSON.parse(first).giftcards[0]).toEqual(old)
    expect(JSON.parse(first).giftcard_batches[0].recipients).toEqual([address('2'), address('3')])
    await prepare_holder_gifts({
      root,
      snapshot_fn: async () => {
        throw new Error('must reuse saved snapshot')
      },
      progress: () => undefined,
    })
    expect(await readFile(join(root, 'seed/content/airdrop.json'), 'utf8')).toBe(first)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a failed collection read never partially changes the airdrop supply', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ares-holder-failure-'))
  try {
    await mkdir(join(root, 'seed/content/snapshots'), { recursive: true })
    await mkdir(join(root, 'seed/content'), { recursive: true })
    await writeFile(
      join(root, 'seed/content/snapshots/collections.json'),
      JSON.stringify({ date: '2026-09-08', collections: [collection] })
    )
    const path = join(root, 'seed/content/airdrop.json')
    const source = '{"campaigns":[],"giftcards":[]}\n'
    await writeFile(path, source)
    await expect(
      prepare_holder_gifts({
        root,
        snapshot_fn: async () => {
          throw new Error('API unavailable')
        },
        progress: () => undefined,
      })
    ).rejects.toThrow('API unavailable')
    expect(await readFile(path, 'utf8')).toBe(source)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
