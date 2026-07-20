import { afterEach, describe, expect, mock, test } from 'bun:test'

import { ROUTES } from './routes.js'
import { fetch_address_from_chain } from './suins.js'
import { handle_suins } from './suins_view.js'

const ADDRESS = `0x${'a'.repeat(64)}`
const original_fetch = globalThis.fetch
const params = (name) => new URLSearchParams(name == null ? {} : { name })

afterEach(() => {
  globalThis.fetch = original_fetch
})

describe('GET /v1/suins', () => {
  test('the route resolves a name through the injected upstream read and returns its address', async () => {
    const upstream = mock(async () => ADDRESS)
    const route = ROUTES['/v1/suins']

    expect(route).toBe(handle_suins)
    const { status, data } = await route(params('alice.sui'), upstream)

    expect(status).toBe(200)
    expect(data).toEqual({ name: 'alice.sui', address: ADDRESS })
    expect(upstream).toHaveBeenCalledWith('alice.sui')
  })

  test('a missing or expired upstream record returns the not-found shape', async () => {
    const upstream = mock(async () => null)
    const { status, data } = await ROUTES['/v1/suins'](params('missing.sui'), upstream)

    expect(status).toBe(404)
    expect(data).toEqual({ found: false })
  })

  test('the forward chain reader uses the existing Mysten GraphQL lane', async () => {
    let request_body
    globalThis.fetch = mock(async (_url, init) => {
      request_body = JSON.parse(String(init.body))
      return new Response(JSON.stringify({ data: { nameRecord: { target: { address: ADDRESS } } } }), { status: 200 })
    })

    expect(await fetch_address_from_chain('alice.sui')).toBe(ADDRESS)
    expect(request_body.variables).toEqual({ name: 'alice.sui' })
    expect(request_body.query).toContain('nameRecord(name: $name)')
    expect(request_body.query).toContain('target { address }')
  })
})
