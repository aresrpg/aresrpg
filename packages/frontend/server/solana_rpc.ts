// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { SOLANA_RPC_READ_METHODS } from '../src/funding/solana_rpc_contract.ts'

type RpcId = string | number
type RpcCall = Readonly<{ jsonrpc: '2.0'; id: RpcId; method: string; params: readonly unknown[] }>
type RpcFetch = (url: string, options: Readonly<RequestInit>) => Promise<Response>
const MAX_REQUEST_BYTES = 4096
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024
const TIMEOUT_MS = 10_000

const json_response = (body: string, status = 200): Response =>
  new Response(body, {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      allow: 'POST',
    },
  })
const failure = (status: number, code: number, message: string, id: RpcId | null = null): Response =>
  json_response(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }), status)
const unavailable = (id: RpcId): Response => failure(502, -32000, 'Solana RPC is temporarily unavailable.', id)
const is_record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const valid_call = (value: Readonly<Record<string, unknown>>): boolean =>
  value.jsonrpc === '2.0' &&
  (typeof value.id === 'string' || Number.isSafeInteger(value.id)) &&
  typeof value.method === 'string' &&
  (value.params === undefined || Array.isArray(value.params))
const decode_call = (body: string): RpcCall | null => {
  try {
    const value: unknown = JSON.parse(body)
    if (!is_record(value) || !valid_call(value)) return null
    return {
      jsonrpc: '2.0',
      id: value.id as RpcId,
      method: value.method as string,
      params: (value.params ?? []) as readonly unknown[],
    }
  } catch {
    return null
  }
}

/** Both directions are bounded while reading, including bodies without Content-Length. */
const read_limited = async (body: ReadableStream<Uint8Array> | null, limit: number): Promise<string | null> => {
  if (!body) return ''
  const reader = body.getReader(),
    decoder = new TextDecoder()
  let size = 0,
    text = ''
  try {
    for (;;) {
      const part = await reader.read()
      if (part.done) return text + decoder.decode()
      size += part.value.byteLength
      if (size > limit) {
        await reader.cancel()
        return null
      }
      text += decoder.decode(part.value, { stream: true })
    }
  } finally {
    reader.releaseLock()
  }
}

const valid_result = (body: unknown, id: RpcId): boolean =>
  is_record(body) &&
  body.jsonrpc === '2.0' &&
  body.id === id &&
  'result' in body &&
  Object.keys(body).every((key) => ['jsonrpc', 'id', 'result'].includes(key))

const forward_read = async (
  request: Readonly<Request>,
  rpc_url: string,
  call: RpcCall,
  send: RpcFetch
): Promise<Response> => {
  try {
    const url = new URL(rpc_url)
    if (url.protocol !== 'https:') return unavailable(call.id)
    const upstream = await send(rpc_url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: new URL(request.url).origin },
      body: JSON.stringify(call),
      redirect: 'error',
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(TIMEOUT_MS)]),
    })
    if (!upstream.ok) {
      await upstream.body?.cancel()
      return unavailable(call.id)
    }
    const body = await read_limited(upstream.body, MAX_RESPONSE_BYTES)
    if (body === null || !valid_result(JSON.parse(body), call.id)) return unavailable(call.id)
    // Validation must not re-encode u64 balances through JavaScript numbers.
    return json_response(body)
  } catch {
    // Provider errors can contain the credential-bearing URL. Report failure without reflecting it.
    return unavailable(call.id)
  }
}

export const relay_solana_rpc = async (
  request: Readonly<Request>,
  rpc_url: string | undefined,
  send: RpcFetch = fetch
): Promise<Response> => {
  if (request.method !== 'POST') return failure(405, -32600, 'Use POST for Solana RPC reads.')
  if (request.headers.get('origin') !== new URL(request.url).origin)
    return failure(403, -32600, 'Cross-origin RPC requests are not allowed.')
  if (!rpc_url) return failure(503, -32000, 'Solana funding RPC is not configured.')
  const body = await read_limited(request.body, MAX_REQUEST_BYTES).catch(() => null)
  if (body === null) return failure(413, -32600, 'RPC request exceeds the read limit.')
  const call = decode_call(body)
  if (!call) return failure(400, -32600, 'Expected one JSON-RPC 2.0 request.')
  if (!SOLANA_RPC_READ_METHODS.includes(call.method))
    return failure(200, -32601, 'Method is not available on the read-only relay.', call.id)
  return forward_read(request, rpc_url, call, send)
}
