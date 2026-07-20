// suins.js / handle_names tests — SuiNS reverse resolution (D52).
//
// resolve_names hits Redis for real (the cache-through behavior IS the thing under test — a mocked
// Redis would just prove the mock), so this needs a throwaway instance, same law as views.test.js:
//
//   docker run -d --rm -p 6399:6379 redis:8
//   REDIS_URL=redis://127.0.0.1:6399 bun test src/suins.test.js   (run from packages/rpc/api)
//
// Flushing goes EXCLUSIVELY through `flush_test_redis()` — the per-call gate (a raw FLUSHALL here
// is a defect; the import-time throw alone failed to stop incident #2, see assert_test_redis.js).
// The chain call itself is mocked (global.fetch — same pattern as frontend/src/components/item_detail_view.test.tsx)
// so the suite never depends on network access or live testnet state.

import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from 'bun:test'

import { flush_test_redis } from './assert_test_redis.js'
import { redis } from './redis.js'
import { resolve_names } from './suins.js'
import { handle_names } from './views.js'

const P = (q) => new URLSearchParams(q)

const ADDR_NAMED = '0x9036f4be5ca0d0c2b890f12b398c032a00952aa41c2776507db0d018002373a7' // player.sui (live testnet)
const ADDR_NAMELESS = '0x0000000000000000000000000000000000000000000000000000000000000002'
const ADDR_OTHER = '0x00000000000000000000000000000000000000000000000000000000000000c1'

const original_fetch = global.fetch

/** Stub the GraphQL round trip: `resolved` maps address → name|null for whatever the batch asks.
 *  Returns `{ fetch_mock, requested }` — `requested` accumulates each call's address batch (push
 *  order), so callers assert on exactly what was sent without indexing into bun:test's own mock.calls. */
function stub_chain(resolved) {
  const requested = []
  const fetch_mock = mock(async (_url, opts) => {
    const body = JSON.parse(String(opts.body))
    const keys = body.variables.keys.map((k) => k.address)
    requested.push(keys)
    return new Response(
      JSON.stringify({
        data: {
          multiGetAddresses: keys.map((address) => ({
            address,
            defaultNameRecord: resolved[address] ? { domain: resolved[address] } : null,
          })),
        },
      }),
      { status: 200 }
    )
  })
  global.fetch = fetch_mock
  return { fetch_mock, requested }
}

beforeAll(async () => {
  await flush_test_redis()
}, 30000)

afterEach(async () => {
  global.fetch = original_fetch
  await flush_test_redis()
})

afterAll(async () => {
  await flush_test_redis()
  global.fetch = original_fetch
}, 30000)

describe('resolve_names', () => {
  test('empty input short-circuits without touching the network', async () => {
    const { fetch_mock } = stub_chain({})
    expect(await resolve_names([])).toEqual({})
    expect(fetch_mock).not.toHaveBeenCalled()
  })

  test('cold cache resolves a named + an unnamed address in one round trip and caches both', async () => {
    const { fetch_mock } = stub_chain({ [ADDR_NAMED]: 'player.sui' })
    const out = await resolve_names([ADDR_NAMED, ADDR_NAMELESS])
    expect(out).toEqual({ [ADDR_NAMED]: 'player.sui', [ADDR_NAMELESS]: null })
    expect(fetch_mock).toHaveBeenCalledTimes(1) // ONE batched call, not two

    // Second call hits the cache for both — no further network access at all.
    const { fetch_mock: fetch_mock_2 } = stub_chain({ [ADDR_NAMED]: 'player.sui' })
    const out_2 = await resolve_names([ADDR_NAMED, ADDR_NAMELESS])
    expect(out_2).toEqual({ [ADDR_NAMED]: 'player.sui', [ADDR_NAMELESS]: null })
    expect(fetch_mock_2).not.toHaveBeenCalled()
  })

  test('a mixed batch only queries the chain for the cache MISS, not the already-cached address', async () => {
    await redis.send('SET', [`rpc:name:${ADDR_NAMED}`, 'player.sui', 'EX', '3600']) // pre-warm one
    const { requested } = stub_chain({ [ADDR_OTHER]: 'other.sui' })

    const out = await resolve_names([ADDR_NAMED, ADDR_OTHER])
    expect(out).toEqual({ [ADDR_NAMED]: 'player.sui', [ADDR_OTHER]: 'other.sui' })
    expect(requested.at(-1)).toEqual([ADDR_OTHER]) // the pre-cached address never left this process
  })

  test('duplicate input addresses collapse to one cache/network lookup', async () => {
    const { requested } = stub_chain({ [ADDR_NAMED]: 'player.sui' })
    const out = await resolve_names([ADDR_NAMED, ADDR_NAMED, ADDR_NAMED])
    expect(out).toEqual({ [ADDR_NAMED]: 'player.sui' })
    expect(requested.at(-1)).toHaveLength(1)
  })

  test('an upstream failure degrades to null WITHOUT caching (retryable next call), never throws', async () => {
    global.fetch = mock(async () => {
      throw new Error('network down')
    })
    const out = await resolve_names([ADDR_NAMED])
    expect(out).toEqual({ [ADDR_NAMED]: null })

    // Not cached as a confirmed negative — a healthy retry resolves it for real.
    const { fetch_mock } = stub_chain({ [ADDR_NAMED]: 'player.sui' })
    const retry = await resolve_names([ADDR_NAMED])
    expect(retry).toEqual({ [ADDR_NAMED]: 'player.sui' })
    expect(fetch_mock).toHaveBeenCalledTimes(1)
  })
})

describe('handle_names', () => {
  test('missing addresses/address param is a 400', async () => {
    const { status } = await handle_names(P({}))
    expect(status).toBe(400)
  })

  test('?addresses= (csv) resolves the flat address→name map', async () => {
    stub_chain({ [ADDR_NAMED]: 'player.sui' })
    const { status, data } = await handle_names(P({ addresses: `${ADDR_NAMED},${ADDR_NAMELESS}` }))
    expect(status).toBe(200)
    expect(data).toEqual({ [ADDR_NAMED]: 'player.sui', [ADDR_NAMELESS]: null })
  })

  test('?address= (singular alias) resolves one', async () => {
    stub_chain({ [ADDR_NAMED]: 'player.sui' })
    const { data } = await handle_names(P({ address: ADDR_NAMED }))
    expect(data).toEqual({ [ADDR_NAMED]: 'player.sui' })
  })
})
