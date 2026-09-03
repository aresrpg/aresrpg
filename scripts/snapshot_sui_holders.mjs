// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Read-only Mainnet collection snapshot: live typed objects → exact-checkpoint ownership chain
// → direct wallet or shared Kiosk's stored owner. No private key and no transaction surface.

import { writeFile } from 'node:fs/promises'

const DEFAULT_ENDPOINT = 'https://graphql.mainnet.sui.io/graphql'
const PAGE_SIZE = 50
// 35 fixed-width ObjectKeys stay below Sui GraphQL's 5 KB request-body ceiling.
const LOOKUP_BATCH_SIZE = 35
const MAX_OWNER_DEPTH = 12
const SUI_ADDRESS = /^0x[\da-f]{64}$/iu
const MOVE_TYPE = /^0x[\da-f]{64}::[a-zA-Z_][\w]*::[a-zA-Z_][\w]*(?:<.*>)?$/u
const OWNER_FIELDS = `
  __typename
  ... on AddressOwner { address { address } }
  ... on ConsensusAddressOwner { address { address } }
  ... on ObjectOwner { address { address } }
  ... on Shared { initialSharedVersion }
`
const EXACT_OBJECT_FRAGMENT = `fragment SnapshotObject on Object {
  address
  owner { ${OWNER_FIELDS} }
  asMoveObject { contents { type { repr } json } }
}`

const usage = `Usage:
  bun scripts/snapshot_sui_holders.mjs --type <MOVE_TYPE> [--type <MOVE_TYPE>...] [--output <FILE>]

Options:
  --type      One collection object type. Repeat to merge related collections into one whitelist.
  --endpoint  Sui GraphQL endpoint (default: Mainnet).
  --output    Write the JSON snapshot to a file instead of stdout.
  --help      Show this help.`

export const parse_snapshot_args = (argv) => {
  if (argv.includes('--help'))
    return Object.freeze({ help: true, types: Object.freeze([]), endpoint: DEFAULT_ENDPOINT, output: null })
  if (argv.length % 2 !== 0) throw new TypeError(`every option needs a value\n${usage}`)
  const entries = Array.from({ length: argv.length / 2 }, (_, index) => [argv[index * 2], argv[index * 2 + 1]])
  const unknown = entries.find(([option]) => !['--type', '--endpoint', '--output'].includes(option))
  if (unknown) throw new TypeError(`unknown option ${unknown[0]}\n${usage}`)
  const values = (option) => entries.filter(([key]) => key === option).map(([, value]) => value)
  const types = values('--type')
  const endpoint = values('--endpoint').at(-1) ?? DEFAULT_ENDPOINT
  const output = values('--output').at(-1) ?? null
  if (types.length === 0) throw new TypeError(`at least one --type is required\n${usage}`)
  if (types.some((type) => !MOVE_TYPE.test(type)))
    throw new TypeError('every --type must be a fully qualified Move type')
  return Object.freeze({ help: false, types: Object.freeze([...new Set(types)]), endpoint, output })
}

const graphql = async (fetch_fn, endpoint, query, variables = {}) => {
  const response = await fetch_fn(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })
  if (!response.ok) throw new Error(`Sui GraphQL returned HTTP ${response.status}`)
  const payload = await response.json()
  if (payload.errors?.length) throw new Error(payload.errors.map(({ message }) => message).join('; '))
  if (!payload.data) throw new Error('Sui GraphQL returned no data')
  return payload.data
}

const list_type_objects = async (fetch_fn, endpoint, type) => {
  const objects = []
  let cursor = null
  let checkpoint
  let checkpoint_timestamp
  do {
    const data = await graphql(
      fetch_fn,
      endpoint,
      `query CollectionObjects($type: String!, $after: String) {
        checkpoint { sequenceNumber timestamp }
        objects(first: ${PAGE_SIZE}, after: $after, filter: { type: $type }) {
          pageInfo { hasNextPage endCursor }
          nodes { address }
        }
      }`,
      { type, after: cursor }
    )
    objects.push(...data.objects.nodes.map(({ address }) => address.toLowerCase()))
    checkpoint = data.checkpoint.sequenceNumber
    checkpoint_timestamp = data.checkpoint.timestamp
    cursor = data.objects.pageInfo.hasNextPage ? data.objects.pageInfo.endCursor : null
  } while (cursor)
  return Object.freeze({ type, objects: Object.freeze(objects), checkpoint, checkpoint_timestamp })
}

const exact_objects = async (fetch_fn, endpoint, ids, checkpoint, cache) => {
  const missing = [...new Set(ids)].filter((id) => !cache.has(id))
  for (let offset = 0; offset < missing.length; offset += LOOKUP_BATCH_SIZE) {
    const batch = missing.slice(offset, offset + LOOKUP_BATCH_SIZE)
    const keys = batch.map((address) => ({ address, atCheckpoint: checkpoint }))
    const data = await graphql(
      fetch_fn,
      endpoint,
      `
        ${EXACT_OBJECT_FRAGMENT}
        query ExactObjects($keys: [ObjectKey!]!) {
          multiGetObjects(keys: $keys) {
            ...SnapshotObject
          }
        }
      `,
      { keys }
    )
    batch.forEach((id, index) => cache.set(id, data.multiGetObjects[index] ?? null))
  }
}

const object_owner_id = (object) =>
  object?.owner?.__typename === 'ObjectOwner' ? object.owner.address.address.toLowerCase() : null

const populate_owner_chain = async (fetch_fn, endpoint, target_ids, checkpoint, cache) => {
  await exact_objects(fetch_fn, endpoint, target_ids, checkpoint, cache)
  let frontier = target_ids.flatMap((id) => {
    const parent = object_owner_id(cache.get(id))
    return parent ? [parent] : []
  })
  for (let depth = 0; frontier.length > 0 && depth < MAX_OWNER_DEPTH; depth += 1) {
    await exact_objects(fetch_fn, endpoint, frontier, checkpoint, cache)
    frontier = frontier.flatMap((id) => {
      const parent = object_owner_id(cache.get(id))
      return parent && !cache.has(parent) ? [parent] : []
    })
  }
  if (frontier.length > 0) throw new Error(`ownership chain exceeded ${MAX_OWNER_DEPTH} objects`)
}

const direct_owner = (owner) => {
  if (owner?.__typename !== 'AddressOwner' && owner?.__typename !== 'ConsensusAddressOwner') return null
  return owner.address.address.toLowerCase()
}

const record = (value) => (typeof value === 'object' && value !== null ? value : {})
const field = (value, key) => Reflect.get(record(value), key)

const kiosk_owner = (object) => {
  const contents = field(field(object, 'asMoveObject'), 'contents')
  const type = field(field(contents, 'type'), 'repr')
  if (typeof type !== 'string' || !type.endsWith('::kiosk::Kiosk')) return null
  const owner = field(field(contents, 'json'), 'owner')
  if (typeof owner !== 'string' || !SUI_ADDRESS.test(owner)) return null
  return owner.toLowerCase()
}

const resolve_holder = (id, cache) => {
  let object = cache.get(id)
  const trail = [id]
  for (let depth = 0; object && depth < MAX_OWNER_DEPTH; depth += 1) {
    const kiosk = kiosk_owner(object)
    if (kiosk) return kiosk
    const address = direct_owner(object.owner)
    if (address) return address
    const parent = object_owner_id(object)
    if (!parent || trail.includes(parent)) break
    trail.push(parent)
    object = cache.get(parent)
  }
  throw new Error(`cannot resolve wallet holder for ${id}; ownership trail: ${trail.join(' -> ')}`)
}

const same_ids = (left, right) =>
  left.length === right.length && [...left].sort().every((id, index) => id === [...right].sort()[index])

export const snapshot_sui_holders = async ({ types, endpoint = DEFAULT_ENDPOINT, fetch_fn = fetch }) => {
  const listed = []
  for (const type of types) listed.push(await list_type_objects(fetch_fn, endpoint, type))
  const checkpoint = Math.max(...listed.map(({ checkpoint: value }) => value))
  const checkpoint_timestamp =
    listed.find(({ checkpoint: value }) => value === checkpoint)?.checkpoint_timestamp ?? null
  const object_ids = [...new Set(listed.flatMap(({ objects }) => objects))]
  const cache = new Map()
  await populate_owner_chain(fetch_fn, endpoint, object_ids, checkpoint, cache)
  const verification = []
  for (const type of types) verification.push(await list_type_objects(fetch_fn, endpoint, type))
  const verified_ids = [...new Set(verification.flatMap(({ objects }) => objects))]
  if (!same_ids(object_ids, verified_ids)) throw new Error('collection membership changed during snapshot; rerun it')
  const whitelist = [...new Set(object_ids.map((id) => resolve_holder(id, cache)))].sort()
  return Object.freeze({
    endpoint,
    types: Object.freeze([...types]),
    checkpoint,
    checkpoint_timestamp,
    object_count: object_ids.length,
    unique_holder_count: whitelist.length,
    whitelist: Object.freeze(whitelist),
  })
}

if (import.meta.main) {
  const options = parse_snapshot_args(process.argv.slice(2))
  if (options.help) console.log(usage)
  else {
    const snapshot = await snapshot_sui_holders(options)
    const json = `${JSON.stringify(snapshot, null, 2)}\n`
    if (options.output) await writeFile(options.output, json, 'utf8')
    else process.stdout.write(json)
  }
}
