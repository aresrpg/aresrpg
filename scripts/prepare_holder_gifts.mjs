// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Local preparation only. Content synchronization owns minting and delivery.

import { createHash, randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'

import { MAINNET_GRAPHQL, parse_snapshot_args, snapshot_sui_holders } from './snapshot_sui_holders.mjs'

const ADDRESS = /^0x[\da-f]{64}$/u

export const validate_holder_snapshot = (collection, snapshot) => {
  assert.equal(snapshot.endpoint, MAINNET_GRAPHQL, 'Holder snapshots must come from mainnet')
  assert.equal(snapshot.recipient, collection.recipient, 'Snapshot recipient mode changed')
  assert.deepEqual(snapshot.types, collection.types, 'Snapshot collection type changed')
  assert(Number.isSafeInteger(snapshot.checkpoint) && snapshot.checkpoint > 0, 'Invalid snapshot checkpoint')
  assert(Number.isFinite(Date.parse(snapshot.checkpoint_timestamp)), 'Invalid checkpoint timestamp')
  assert(Number.isSafeInteger(snapshot.object_count) && snapshot.object_count > 0, 'Invalid snapshot object count')
  assert(Array.isArray(snapshot.recipients), 'Snapshot recipients must be an array')
  assert(snapshot.recipients.length > 0, 'Snapshot has no recipients')
  const unresolved = snapshot.unresolved ?? []
  assert(Array.isArray(unresolved), 'Unresolved custody must be an NFT ID list')
  assert(
    unresolved.every((id) => typeof id === 'string' && ADDRESS.test(id)),
    'Invalid unresolved NFT ID'
  )
  assert(
    unresolved.length === 0 || collection.limit !== undefined,
    'Uncapped distributions require every holder to be resolved'
  )
  assert(
    snapshot.recipients.every((address) => typeof address === 'string' && ADDRESS.test(address)),
    'Invalid recipient address'
  )
  assert.equal(new Set(snapshot.recipients).size, snapshot.recipients.length, 'Duplicate snapshot recipient')
  assert(
    snapshot.recipients.length + unresolved.length <= snapshot.object_count,
    'More recipients than resolved collection objects'
  )
  assert(
    collection.recipient !== 'object' || snapshot.recipients.length === snapshot.object_count,
    'Missing NFT object recipients'
  )
  return snapshot
}

export const holder_giftcard_batch = (date, collection, snapshot) => {
  validate_holder_snapshot(collection, snapshot)
  const id = `${collection.item_type}_holders_${date.replaceAll('-', '')}`
  const ranked = snapshot.recipients
    .map((address) => ({
      address,
      score: createHash('sha256').update(`${id}:${address}`).digest('hex'),
    }))
    .sort((left, right) => left.score.localeCompare(right.score) || left.address.localeCompare(right.address))
  return {
    id,
    item_type: collection.item_type,
    campaign: collection.item_type,
    amount: 1,
    network: 'mainnet',
    recipients: ranked
      .slice(0, collection.limit ?? ranked.length)
      .map(({ address }) => address)
      .sort(),
  }
}

export const append_holder_gifts = (airdrop, gifts) => {
  const batches = airdrop.giftcard_batches ?? []
  const existing = new Map(batches.map((batch) => [batch.id, batch]))
  assert.equal(existing.size, batches.length, 'Existing giftcard batch identities are duplicated')
  const added = []
  for (const card of gifts) {
    const previous = existing.get(card.id)
    if (previous) {
      if (!isDeepStrictEqual({ ...previous, recipients: [...previous.recipients].sort() }, card))
        throw new Error(`Giftcard ${card.id} already has another allocation; refusing to rewrite supply`)
    } else {
      added.push(card)
      existing.set(card.id, card)
    }
  }
  return added.length ? { ...airdrop, giftcard_batches: [...batches, ...added] } : airdrop
}

const read_snapshot = async (path) => {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

const load_holder_snapshot = async (directory, collection, snapshot_fn, progress) => {
  const path = resolve(directory, `${collection.item_type}.json`)
  const saved = await read_snapshot(path)
  if (saved) return validate_holder_snapshot(collection, saved)
  progress(`Snapshotting mainnet ${collection.item_type}…`)
  let reads = 0
  const fetch_fn = (...args) => {
    reads += 1
    if (reads % 25 === 0) progress(`${collection.item_type}: ${reads} public API reads…`)
    return fetch(...args)
  }
  const snapshot = validate_holder_snapshot(
    collection,
    await snapshot_fn({
      ...collection,
      allow_unresolved: collection.limit !== undefined,
      fetch_fn,
    })
  )
  await writeFile(path, `${JSON.stringify({ ...snapshot, item_type: collection.item_type }, null, 2)}\n`, {
    flag: 'wx',
  })
  return snapshot
}

const validate_collections = (config) => {
  assert(/^\d{4}-\d{2}-\d{2}$/u.test(config.date), 'Holder snapshot configuration needs a date')
  assert(Array.isArray(config.collections), 'Holder snapshot collections must be an array')
  assert(config.collections.length > 0, 'Holder snapshot configuration needs collections')
  for (const collection of config.collections) {
    if (!/^[a-z][a-z0-9_]*$/u.test(collection.item_type)) throw new Error('Invalid holder gift item type')
    parse_snapshot_args([...collection.types.flatMap((type) => ['--type', type]), '--recipient', collection.recipient])
    if (collection.limit !== undefined)
      assert(
        Number.isSafeInteger(collection.limit) && collection.limit > 0,
        'Recipient limit must be a positive integer'
      )
  }
  if (new Set(config.collections.map(({ item_type }) => item_type)).size !== config.collections.length)
    throw new Error('Each holder gift item type must have one configured collection')
}

const write_airdrop = async (path, source, airdrop) => {
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(airdrop, null, 2)}\n`, { flag: 'wx' })
    if ((await readFile(path, 'utf8')) !== source) throw new Error('Airdrop content changed during preparation; rerun')
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true })
  }
}

export const prepare_holder_gifts = async ({
  root = resolve(import.meta.dirname, '..'),
  snapshot_fn = snapshot_sui_holders,
  progress = console.error,
} = {}) => {
  const config = JSON.parse(await readFile(resolve(root, 'seed/content/snapshots/collections.json'), 'utf8'))
  validate_collections(config)
  const directory = resolve(root, 'seed/content/snapshots', config.date)
  await mkdir(directory, { recursive: true })
  const gifts = []
  for (const collection of config.collections) {
    const snapshot = await load_holder_snapshot(directory, collection, snapshot_fn, progress)
    const batch = holder_giftcard_batch(config.date, collection, snapshot)
    gifts.push(batch)
    progress(
      `${collection.item_type}: ${batch.recipients.length} gifts from ${snapshot.recipients.length} verified ${collection.recipient} recipients · checkpoint ${snapshot.checkpoint}`
    )
  }
  const path = resolve(root, 'seed/content/airdrop.json')
  const source = await readFile(path, 'utf8')
  const before = JSON.parse(source)
  const after = append_holder_gifts(before, gifts)
  if (after !== before) await write_airdrop(path, source, after)
  return `Prepared ${gifts.reduce((sum, batch) => sum + batch.recipients.length, 0)} mainnet holder giftcards in ${gifts.length} batches. Content sync will mint and send them. No chain writes ran.`
}

if (import.meta.main) console.log(await prepare_holder_gifts())
