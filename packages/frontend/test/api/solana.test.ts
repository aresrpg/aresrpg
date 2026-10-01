// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import endpoint from '../../api/solana.ts'
import { relay_solana_rpc } from '../../server/solana_rpc.ts'

const ORIGIN = 'https://aresrpg.world'
const PRIVATE_URL = 'https://rpc.example/v2/private-test-key'
const call = { jsonrpc: '2.0', id: 9, method: 'getSlot', params: [{ commitment: 'confirmed' }] }
const request = (body: unknown = call, origin = ORIGIN) =>
  new Request(`${ORIGIN}/api/solana`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify(body),
  })

test('writes and mixed batches never reach the upstream provider', async () => {
  let calls = 0
  const send = async () => {
    calls++
    return new Response('{}')
  }
  for (const body of [
    { ...call, method: 'sendTransaction' },
    { ...call, method: 'sendBundle' },
    [call, { ...call, method: 'sendTransaction' }],
  ]) {
    const response = await relay_solana_rpc(request(body), PRIVATE_URL, send)
    expect(await response.json()).toHaveProperty('error')
  }
  expect(calls).toBe(0)
})

test('foreign origins and oversized or malformed requests never call the provider', async () => {
  let calls = 0
  const send = async () => {
    calls++
    return new Response('{}')
  }
  const foreign = await relay_solana_rpc(request(call, 'https://foreign.example'), PRIVATE_URL, send)
  expect(foreign.status).toBe(403)
  const large = await relay_solana_rpc(request({ ...call, params: ['x'.repeat(5000)] }), PRIVATE_URL, send)
  expect(large.status).toBe(413)
  const malformed = await relay_solana_rpc(request({ ...call, params: 'not-an-array' }), PRIVATE_URL, send)
  expect(malformed.status).toBe(400)
  expect(calls).toBe(0)
})

test('missing configuration and provider failures never expose credentials or upstream errors', async () => {
  const unavailable = await relay_solana_rpc(request(), undefined, async () => {
    throw new Error('unexpected fetch')
  })
  expect(unavailable.status).toBe(503)
  for (const send of [
    async () => new Response(PRIVATE_URL, { status: 401 }),
    async () => Response.json({ jsonrpc: '2.0', id: 9, error: { code: -32000, message: PRIVATE_URL } }),
    async () => {
      throw new Error(PRIVATE_URL)
    },
  ]) {
    const response = await relay_solana_rpc(request(), PRIVATE_URL, send)
    expect(response.status).toBe(502)
    expect(await response.text()).not.toContain('private-test-key')
  }
})

test('successful reads preserve u64 response bytes and forward no browser credentials', async () => {
  const wire = '{"jsonrpc":"2.0","id":9,"result":{"value":18446744073709551615}}'
  let sent_url = '',
    sent_headers: Headers | null = null,
    sent_body = ''
  const source = request({ ...call, method: 'getBalance', params: ['11111111111111111111111111111111'] })
  source.headers.set('authorization', 'browser-private')
  source.headers.set('cookie', 'session=browser-private')
  const response = await relay_solana_rpc(source, PRIVATE_URL, async (url, options) => {
    sent_url = String(url)
    sent_headers = new Headers(options?.headers)
    sent_body = String(options?.body)
    return new Response(wire, { headers: { location: PRIVATE_URL } })
  })
  expect(sent_url).toBe(PRIVATE_URL)
  expect(sent_headers!.get('origin')).toBe(ORIGIN)
  expect(sent_headers!.get('authorization')).toBeNull()
  expect(sent_headers!.get('cookie')).toBeNull()
  expect(JSON.parse(sent_body).method).toBe('getBalance')
  expect(await response.text()).toBe(wire)
  expect(response.headers.get('location')).toBeNull()
  expect(response.headers.get('cache-control')).toBe('no-store')
})

test('the relay preserves a captured Solana response', async () => {
  // Solana mainnet getBalance(System Program), Alchemy, captured 2026-10-01.
  // The response context slot pins its ledger provenance; the fixture contains no RPC URL.
  const wire = await Bun.file(new URL('../fixtures/funding/solana_balance.json.txt', import.meta.url)).text()
  const response = await relay_solana_rpc(request(), PRIVATE_URL, async () => new Response(wire))
  expect(response.status).toBe(200)
  expect(await response.text()).toBe(wire)
})

test('oversized upstream streams are cancelled instead of buffering indefinitely', async () => {
  let cancelled = false,
    sent = 0
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      sent++
      controller.enqueue(new Uint8Array(1024 * 1024).fill(32))
    },
    cancel() {
      cancelled = true
    },
  })
  const response = await relay_solana_rpc(request(), PRIVATE_URL, async () => new Response(body))
  expect(response.status).toBe(502)
  expect(cancelled).toBe(true)
  expect(sent).toBeLessThanOrEqual(6)
})

test('only valid, matching JSON-RPC results are returned to the browser', async () => {
  for (const body of [
    'not JSON',
    JSON.stringify({ jsonrpc: '2.0', id: 8, result: 1 }),
    JSON.stringify({ jsonrpc: '2.0', id: 9, result: 1, debug: PRIVATE_URL }),
  ]) {
    const response = await relay_solana_rpc(request(), PRIVATE_URL, async () => new Response(body))
    expect(response.status).toBe(502)
    expect(await response.text()).not.toContain('private-test-key')
  }
})

test('the relay refuses non-POST requests and normalizes duplicate request fields', async () => {
  let sent = ''
  const send = async (_url: string, options: Readonly<RequestInit>) => {
    sent = String(options.body)
    return new Response('{"jsonrpc":"2.0","id":9,"result":1}')
  }
  expect((await relay_solana_rpc(new Request(`${ORIGIN}/api/solana`), PRIVATE_URL, send)).status).toBe(405)
  const duplicate = new Request(`${ORIGIN}/api/solana`, {
    method: 'POST',
    headers: { origin: ORIGIN },
    body: '{"jsonrpc":"2.0","id":9,"method":"sendTransaction","method":"getSlot","params":[]}',
  })
  expect((await relay_solana_rpc(duplicate, PRIVATE_URL, send)).status).toBe(200)
  expect(sent).not.toContain('sendTransaction')
})

test('the Vercel entry rejects non-RPC HTTP methods without reading upstream', async () => {
  const response = await endpoint.fetch(new Request(`${ORIGIN}/api/solana`))
  expect(response.status).toBe(405)
  expect(response.headers.get('allow')).toBe('POST')
})
