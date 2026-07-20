// SuiNS resolution for the /v1 read layer (D52, SPEC §13 "Identity"). Both directions stay
// SERVER-SIDE here: /v1/names resolves address → default @handle, while /v1/suins resolves a
// recipient name → target address. The frontend remains a thin /v1 client with zero chain-direct reads.
//
// Method: the Sui GraphQL RPC (no-json-rpc law) — the SAME testnet/mainnet endpoints
// packages/sdk/src/sui.js already uses for the SDK's GraphQL client. `Query.multiGetAddresses`
// resolves a whole batch in ONE round trip (verified live against testnet: query cost stays O(1)
// request text regardless of batch size, since addresses travel as a `keys` variable, not aliased
// fields) via `Address.defaultNameRecord.domain` — the schema's reverse-resolution field (the older
// `Address.defaultSuinsName` was removed from the live schema; NameRecord.domain is its replacement,
// confirmed by introspecting https://graphql.testnet.sui.io/graphql on 2026-07-10). No new dependency:
// this api package has zero npm deps today (Bun's global fetch + built-in RedisClient only), and a
// raw GraphQL POST needs nothing more.
//
// Redis is a TTL cache in front of the network call — SuiNS names change rarely, so a cache MISS is
// the rare path; a HIT never touches the network or the chain. Cache values are plain strings (not
// JSON): the domain string when named, '' (NONE) as the sentinel for "resolved, confirmed nameless"
// so that address is never re-queried until the TTL lapses (vs. a true cache-miss, which is `null`
// from MGET). TTLs are ABSOLUTE (`SET … EX`, never refreshed by a read) so a stale cached name
// self-heals within NAMES_CACHE_TTL_SEC of an on-chain default-name change.
//
// Graceful by design (names are decorative — SPEC §13 "addresses stay the identity"): an upstream
// GraphQL failure logs server-side and yields `null` for the affected addresses (NOT cached, so the
// next request retries) rather than failing the whole batch — every caller already falls back to the
// shortened-address rendering on a null, so a chain hiccup degrades silently and safely, never a
// broken row.

import { redis } from './redis.js'

const NETWORK = process.env.NETWORK ?? 'testnet'
// Mirrors packages/sdk/src/sui.js's graphql_client URL branch exactly (the proven-live testnet/
// mainnet endpoints already used for the SDK's own GraphQL reads).
const GRAPHQL_URL =
  NETWORK === 'mainnet' ? 'https://sui-mainnet.mystenlabs.com/graphql' : 'https://graphql.testnet.sui.io/graphql'

const GRAPHQL_TIMEOUT_MS = 5000

export const NAMES_CACHE_TTL_SEC = Number(process.env.NAMES_CACHE_TTL_SEC ?? 21_600) // 6h default (names change rarely)
const MAX_BATCH = 100 // defensive clamp on one outbound GraphQL round trip

const cache_key = (address) => `rpc:name:${address}`
const NONE = '' // sentinel: "resolved — confirmed no default SuiNS name" (MGET null means "never checked")

const QUERY = `query BatchNames($keys: [AddressKey!]!) {
  multiGetAddresses(keys: $keys) { address defaultNameRecord { domain } }
}`
const FORWARD_QUERY = `query ForwardName($name: String!) {
  nameRecord(name: $name) { target { address } }
}`

/** Resolve one canonical SuiNS domain to its target address through the same keyless Mysten GraphQL lane. */
export async function fetch_address_from_chain(name) {
  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: FORWARD_QUERY, variables: { name } }),
    signal: AbortSignal.timeout(GRAPHQL_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`suins graphql HTTP ${res.status}`)

  const { data, errors } = await res.json()
  if (errors?.length) throw new Error(`suins graphql: ${errors[0].message}`)
  return data?.nameRecord?.target?.address ?? null
}

// One GraphQL round trip for a whole batch of misses. Exported so tests can stub it without a real
// network call (Bun's global fetch is monkey-patchable — no DI parameter needed on resolve_names).
export async function fetch_names_from_chain(addresses) {
  if (addresses.length === 0) return {}

  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: QUERY, variables: { keys: addresses.map((address) => ({ address })) } }),
    signal: AbortSignal.timeout(GRAPHQL_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`suins graphql HTTP ${res.status}`)

  const { data, errors } = await res.json()
  if (errors?.length) throw new Error(`suins graphql: ${errors[0].message}`)

  const out = {}
  for (const row of data?.multiGetAddresses ?? []) {
    out[row.address] = row.defaultNameRecord?.domain ?? null
  }
  return out
}

/**
 * Batch-resolves addresses to their default SuiNS name (or null), reading through the Redis TTL
 * cache and only hitting the chain for misses. Returns `{ [address]: name | null }` for every input
 * address (deduped). Never throws — an upstream failure yields null for the affected addresses.
 */
export async function resolve_names(addresses) {
  const unique = [...new Set(addresses)].slice(0, MAX_BATCH)
  if (unique.length === 0) return {}

  const cached = await redis.send('MGET', unique.map(cache_key))
  const result = {}
  const misses = []
  unique.forEach((addr, i) => {
    const v = cached[i]
    if (v == null) misses.push(addr)
    else result[addr] = v === NONE ? null : v
  })

  if (misses.length > 0) {
    try {
      const resolved = await fetch_names_from_chain(misses)
      await Promise.all(
        misses.map((addr) => {
          const name = resolved[addr] ?? null
          result[addr] = name
          return redis.send('SET', [cache_key(addr), name ?? NONE, 'EX', String(NAMES_CACHE_TTL_SEC)])
        })
      )
    } catch (err) {
      // Ops-visible, never user-visible: the decorative name silently falls back (see file header).
      console.error(`[suins] resolution failed for ${misses.length} address(es):`, err.message)
      misses.forEach((addr) => {
        result[addr] = null
      })
    }
  }

  return result
}
