// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Read-only mainnet snapshot at one checkpoint: resolve wallet custody or keep NFT IDs.
// No private key and no transaction surface.

import { writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'

export const MAINNET_GRAPHQL = 'https://graphql.mainnet.sui.io/graphql'
const PAGE_SIZE = 50
// 35 fixed-width ObjectKeys stay below Sui GraphQL's 5 KB request-body ceiling.
const LOOKUP_BATCH_SIZE = 35
const LOOKUP_CONCURRENCY = 4
const MAX_OWNER_DEPTH = 12
const SUI_ADDRESS = /^0x[\da-f]{64}$/iu
const STORED_OWNER_TYPES = Object.freeze([
  '0x0000000000000000000000000000000000000000000000000000000000000002::kiosk::Kiosk',
  '0xd5dd28cc24009752905689b2ba2bf90bfc8de4549b9123f93519bb8ba9bf9981::marketplace::Listing',
])
const AVATAR_ITEM_TYPE = '0x193a33b36a30444128353f8cefe2fab8fefac3f918f4c267c763f6adb44ead35::avatar::AvatarItem'
const STAKING_PACKAGE = '0x3412f5d7819fddb9d504a422177e3cc62c029f08002a0d51c0f7cfd93cfdfbcc'
// Both inspected versions issue key-only tickets to the sender, with no transfer door.
const STAKING_TARGETS = Object.freeze([
  STAKING_PACKAGE,
  '0xeebdb577b6e4505caaf2b1235a0243e3314082a634218f2192d4aaba89bcb180',
])
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
  --type      One collection object type. Repeat to merge related collections into one recipient list.
  --recipient wallet (default) or object (send to NFTs without resolving holders).
  --endpoint  Sui GraphQL endpoint (default: Mainnet).
  --output    Write the JSON snapshot to a file instead of stdout.
  --help      Show this help.`

export const parse_snapshot_args = (argv) => {
  if (argv.includes('--help'))
    return Object.freeze({
      help: true,
      types: Object.freeze([]),
      endpoint: MAINNET_GRAPHQL,
      output: null,
      recipient: 'wallet',
    })
  if (argv.length % 2 !== 0) throw new TypeError(`every option needs a value\n${usage}`)
  const entries = Array.from({ length: argv.length / 2 }, (_, index) => [argv[index * 2], argv[index * 2 + 1]])
  const unknown = entries.find(([option]) => !['--type', '--endpoint', '--output', '--recipient'].includes(option))
  if (unknown) throw new TypeError(`unknown option ${unknown[0]}\n${usage}`)
  const values = (option) => entries.filter(([key]) => key === option).map(([, value]) => value)
  const types = values('--type')
  const endpoint = values('--endpoint').at(-1) ?? MAINNET_GRAPHQL
  const output = values('--output').at(-1) ?? null
  const recipient = values('--recipient').at(-1) ?? 'wallet'
  if (!['wallet', 'object'].includes(recipient)) throw new TypeError('recipient must be wallet or object')
  if (types.length === 0) throw new TypeError(`at least one --type is required\n${usage}`)
  if (types.some((type) => !MOVE_TYPE.test(type)))
    throw new TypeError('every --type must be a fully qualified Move type')
  return Object.freeze({ help: false, types: Object.freeze([...new Set(types)]), endpoint, output, recipient })
}

const graphql = async (fetch_fn, endpoint, query, variables) => {
  // These are read-only requests. Bounded retries never submit or repeat a transaction.
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await fetch_fn(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(20_000),
      })
      const { data, errors = [] } = await response.json()
      if (!response.ok || errors.length || !data)
        throw new Error(
          `Sui GraphQL rejected the read (HTTP ${response.status}): ${errors.map(({ message }) => message).join('; ')}`
        )
      return data
    } catch (error) {
      if (attempt === 2) throw error
      await delay(500 * 2 ** attempt)
    }
  }
}

const list_type_objects = async (fetch_fn, endpoint, type, checkpoint) => {
  const objects = []
  let cursor = null
  do {
    const data = await graphql(
      fetch_fn,
      endpoint,
      `query CollectionObjects($type: String!, $after: String, $checkpoint: UInt53!) {
        checkpoint(sequenceNumber: $checkpoint) {
          query {
            objects(first: ${PAGE_SIZE}, after: $after, filter: { type: $type }) {
              pageInfo { hasNextPage endCursor }
              nodes { address }
            }
          }
        }
      }`,
      { type, after: cursor, checkpoint }
    )
    const page = data.checkpoint.query.objects
    objects.push(...page.nodes.map(({ address }) => address.toLowerCase()))
    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null
  } while (cursor)
  return objects
}

const exact_objects = async (fetch_fn, endpoint, ids, checkpoint, cache) => {
  const missing = [...new Set(ids)].filter((id) => !cache.has(id))
  const batches = Array.from({ length: Math.ceil(missing.length / LOOKUP_BATCH_SIZE) }, (_, index) =>
    missing.slice(index * LOOKUP_BATCH_SIZE, (index + 1) * LOOKUP_BATCH_SIZE)
  )
  for (let offset = 0; offset < batches.length; offset += LOOKUP_CONCURRENCY) {
    await Promise.all(
      batches.slice(offset, offset + LOOKUP_CONCURRENCY).map(async (batch) => {
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
      })
    )
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
const object_contents = (object) => field(field(object, 'asMoveObject'), 'contents')
const object_type = (object) => field(field(object_contents(object), 'type'), 'repr')

const is_staking_pool = (object) => {
  const type = object_type(object)
  return typeof type === 'string' && type.startsWith(`${STAKING_PACKAGE}::staking::StakingPool<`)
}

export const staked_inputs = (object_ids, cache) => {
  const wanted = new Set(object_ids)
  const pools = new Set([...cache.values()].filter(is_staking_pool).map(({ address }) => address))
  const staked = new Map()
  for (const object of cache.values()) {
    const pool = object_owner_id(object)
    if (!pools.has(pool)) continue
    const nft = field(field(object_contents(object), 'json'), 'value')
    if (wanted.has(nft) && object_owner_id(cache.get(nft)) === object.address) staked.set(nft, pool)
  }
  return staked
}

const input_object_id = (body, argument) => (argument?.kind === 'INPUT' ? body.inputs[argument.input]?.objectId : null)

export const staking_sender = (object, nft, pool) => {
  const transaction = object.previousTransaction
  const body = transaction.transactionJson.kind.programmableTransaction
  const sender = transaction.sender.address
  const proved = body?.commands.some(({ moveCall: call }) => {
    if (!call || !STAKING_TARGETS.includes(call.package) || call.module !== 'staking' || call.function !== 'stake')
      return false
    return input_object_id(body, call.arguments[0]) === nft && input_object_id(body, call.arguments[2]) === pool
  })
  if (!proved || !SUI_ADDRESS.test(sender)) throw new Error(`Cannot prove staking holder for ${nft}`)
  return sender.toLowerCase()
}

const read_staking_owners = async (fetch_fn, endpoint, object_ids, checkpoint, cache) => {
  const staked = staked_inputs(object_ids, cache)
  const ids = [...staked.keys()].sort()
  const owners = new Map()
  // This verified pool sends a key-only ticket to the staker and exposes no ticket transfer.
  // Proving the exact NFT/pool stake call also works after old ticket enumeration has expired.
  for (let offset = 0; offset < ids.length; offset += LOOKUP_BATCH_SIZE) {
    const batch = ids.slice(offset, offset + LOOKUP_BATCH_SIZE)
    const data = await graphql(
      fetch_fn,
      endpoint,
      `
        query StakedOwners($keys: [ObjectKey!]!) {
          multiGetObjects(keys: $keys) {
            address
            previousTransaction {
              digest
              sender {
                address
              }
              transactionJson
            }
          }
        }
      `,
      { keys: batch.map((address) => ({ address, atCheckpoint: checkpoint })) }
    )
    batch.forEach((nft, index) => {
      const object = data.multiGetObjects[index]
      if (object?.address !== nft) throw new Error(`Missing staking transaction for ${nft}`)
      owners.set(nft, staking_sender(object, nft, staked.get(nft)))
    })
  }
  return owners
}

const custodian_owner = (object, nft, staking_owners) => {
  if (is_staking_pool(object)) return staking_owners.get(nft)
  const contents = object_contents(object)
  const type = object_type(object)
  const json = field(contents, 'json')
  // The deployed avatar contract keys deposits by the sender and only lets that sender withdraw.
  const avatar = type === AVATAR_ITEM_TYPE && field(json, 'nft_id') === nft
  // The legacy listing's delist door authenticates its stored seller; unrelated owner fields are not trusted.
  if (!STORED_OWNER_TYPES.includes(type) && !avatar) return null
  const owner = field(json, 'owner')
  if (typeof owner !== 'string' || !SUI_ADDRESS.test(owner)) return null
  return owner.toLowerCase()
}

export const resolve_holder = (id, cache, staking_owners) => {
  let object = cache.get(id)
  const trail = [id]
  for (let depth = 0; object && depth < MAX_OWNER_DEPTH; depth += 1) {
    const custodian = custodian_owner(object, id, staking_owners)
    if (custodian) return custodian
    const address = direct_owner(object.owner)
    if (address) return address
    const parent = object_owner_id(object)
    if (!parent || trail.includes(parent)) break
    trail.push(parent)
    object = cache.get(parent)
  }
  return null
}

const snapshot_recipients = (object_ids, cache, staking_owners, recipient, allow_unresolved) => {
  const holders =
    recipient === 'object' ? object_ids : object_ids.map((id) => resolve_holder(id, cache, staking_owners))
  const unresolved = object_ids.filter((_id, index) => !holders[index])
  if (unresolved.length && !allow_unresolved)
    throw new Error(`cannot resolve wallet holder for ${unresolved.length} NFTs: ${unresolved.slice(0, 5).join(', ')}`)
  return {
    recipients: Object.freeze([...new Set(holders.filter(Boolean))].sort()),
    unresolved: Object.freeze(unresolved),
  }
}

export const snapshot_sui_holders = async ({
  types,
  endpoint = MAINNET_GRAPHQL,
  fetch_fn = fetch,
  recipient = 'wallet',
  allow_unresolved = false,
}) => {
  const point = await graphql(
    fetch_fn,
    endpoint,
    'query SnapshotCheckpoint { checkpoint { sequenceNumber timestamp } }',
    {}
  )
  const checkpoint = point.checkpoint.sequenceNumber
  const checkpoint_timestamp = point.checkpoint.timestamp
  const listed = []
  for (const type of types) listed.push(await list_type_objects(fetch_fn, endpoint, type, checkpoint))
  const object_ids = [...new Set(listed.flat())]
  const cache = new Map()
  if (recipient === 'wallet') await populate_owner_chain(fetch_fn, endpoint, object_ids, checkpoint, cache)
  const staking_owners = await read_staking_owners(fetch_fn, endpoint, object_ids, checkpoint, cache)
  const resolved = snapshot_recipients(object_ids, cache, staking_owners, recipient, allow_unresolved)
  return Object.freeze({
    endpoint,
    types: Object.freeze([...types]),
    checkpoint,
    checkpoint_timestamp,
    object_count: object_ids.length,
    recipient,
    ...resolved,
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
