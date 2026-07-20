import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'

import * as expedition_sdk from '../chain/sdk'
import { _reset_rpc_client_for_test } from '../rpc/client'

import { resolve_suins_address } from './suins'

const ADDRESS = `0x${'a'.repeat(64)}`
const original_fetch = globalThis.fetch

beforeEach(() => {
  _reset_rpc_client_for_test()
})

afterEach(() => {
  globalThis.fetch = original_fetch
  _reset_rpc_client_for_test()
})

describe('resolve_suins_address', () => {
  test('uses the /v1 view and never constructs a browser chain client', async () => {
    const get_sdk = spyOn(expedition_sdk, 'get_sdk').mockImplementation(async () => {
      throw new Error('browser chain client constructed')
    })
    const fetch_mock = mock(
      async () => new Response(JSON.stringify({ name: 'alice.sui', address: ADDRESS }), { status: 200 })
    )
    globalThis.fetch = fetch_mock as unknown as typeof fetch

    try {
      expect(await resolve_suins_address('@alice')).toBe(ADDRESS)
      expect(get_sdk).not.toHaveBeenCalled()
      expect(fetch_mock).toHaveBeenCalledTimes(1)

      const [[input, init]] = fetch_mock.mock.calls
      const url = new URL(String(input))
      expect(url.pathname).toBe('/v1/suins')
      expect(url.searchParams.get('name')).toBe('alice.sui')
      expect(init?.method).toBe('GET')
    } finally {
      get_sdk.mockRestore()
    }
  })
})
