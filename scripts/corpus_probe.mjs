#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { createHash } from 'node:crypto'

export const DEFAULT_CORPUS_BASE = 'https://assets.aresrpg.world/data/'
export const PROBE_TIMEOUT_MS = 10_000

const POINTER_FILENAME = 'corpus_version.json'
const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const SHA256_PATTERN = /^[0-9a-f]{64}$/i

const error_detail = (error) => {
  if (!(error instanceof Error) || !error.message) return ''
  return error.message.replace(/\s+/g, ' ').trim()
}

const corpus_base_url = (value) => {
  if (typeof value !== 'string' || value.length === 0) throw new Error('FAIL: corpus probe base must be a nonempty URL')
  let url
  try {
    url = new URL(value)
  } catch (error) {
    const detail = error_detail(error)
    throw new Error(`FAIL: invalid corpus probe base${detail ? ` (${detail})` : ''}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new Error(`FAIL: invalid corpus probe base protocol (${url.protocol || 'none'})`)
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  return url
}

const fetch_leg = async (fetch_impl, url, leg, timeout_ms) => {
  let response
  try {
    response = await fetch_impl(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(timeout_ms),
    })
  } catch (error) {
    const detail = error_detail(error)
    throw new Error(`FAIL: corpus ${leg} request failed at ${url}${detail ? ` (${detail})` : ''}`)
  }
  if (!(response instanceof Response)) throw new Error(`FAIL: corpus ${leg} fetch returned a non-Response at ${url}`)
  if (!response.ok) throw new Error(`FAIL: corpus ${leg} HTTP ${response.status} at ${url}`)
  try {
    return new Uint8Array(await response.arrayBuffer())
  } catch (error) {
    const detail = error_detail(error)
    throw new Error(`FAIL: corpus ${leg} body read failed at ${url}${detail ? ` (${detail})` : ''}`)
  }
}

const decode_json = (bytes, label) => {
  let source
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (error) {
    const detail = error_detail(error)
    throw new Error(`FAIL: malformed corpus ${label} UTF-8${detail ? ` (${detail})` : ''}`)
  }
  try {
    return JSON.parse(source)
  } catch (error) {
    const detail = error_detail(error)
    throw new Error(`FAIL: malformed corpus ${label} JSON${detail ? ` (${detail})` : ''}`)
  }
}

/**
 * Decode the served pointer without defaults. `version` is the checked-in consumer's blob-name component;
 * `sha256` and `size` are the publish-time byte claims this instrument requires before it will report green.
 * @param {unknown} pointer
 * @returns {{ version: string, sha256: string, size: number }}
 */
export const decode_corpus_pointer = (pointer) => {
  if (!pointer || typeof pointer !== 'object' || Array.isArray(pointer))
    throw new Error('FAIL: malformed corpus pointer (expected a JSON object)')
  const { version, sha256, size } = pointer
  if (typeof version !== 'string' || !VERSION_PATTERN.test(version))
    throw new Error('FAIL: malformed corpus pointer (version must be a URL-safe blob version)')
  if (typeof sha256 !== 'string' || !SHA256_PATTERN.test(sha256))
    throw new Error('FAIL: malformed corpus pointer (sha256 must be 64 hexadecimal characters)')
  if (!Number.isSafeInteger(size) || size <= 0)
    throw new Error('FAIL: malformed corpus pointer (size must be a positive safe integer)')
  return { version, sha256: sha256.toLowerCase(), size }
}

const assert_nonempty_corpus = (bytes, blob_url) => {
  const corpus = decode_json(bytes, 'blob')
  if (!Array.isArray(corpus)) throw new Error(`FAIL: malformed corpus blob (expected a JSON row array) at ${blob_url}`)
  if (corpus.length === 0) throw new Error(`FAIL: corpus blob scan is empty at ${blob_url}`)
}

/**
 * Prove the served pointer and the exact spell-corpus blob it names. The fetch implementation is injectable for
 * sandboxes that cannot bind loopback; the command-line production path uses the runtime's real fetch.
 * @param {string} base
 * @param {typeof fetch} [fetch_impl]
 * @param {number} [timeout_ms]
 */
export async function probe_corpus(base, fetch_impl = globalThis.fetch, timeout_ms = PROBE_TIMEOUT_MS) {
  if (typeof fetch_impl !== 'function') throw new Error('FAIL: runtime lacks a fetch implementation')
  if (!Number.isSafeInteger(timeout_ms) || timeout_ms <= 0)
    throw new Error('FAIL: corpus probe timeout must be a positive safe integer')

  const base_url = corpus_base_url(base)
  const pointer_url = new URL(POINTER_FILENAME, base_url).href
  const pointer_bytes = await fetch_leg(fetch_impl, pointer_url, 'pointer', timeout_ms)
  if (pointer_bytes.byteLength === 0) throw new Error('FAIL: malformed corpus pointer (empty body)')
  const pointer = decode_corpus_pointer(decode_json(pointer_bytes, 'pointer'))

  // This is the exact filename rule used by packages/frontend/src/game/data/corpus_asset.js.
  const blob_url = new URL(`spell_corpus.${pointer.version}.json`, base_url).href
  const blob_bytes = await fetch_leg(fetch_impl, blob_url, 'blob', timeout_ms)
  if (blob_bytes.byteLength === 0) throw new Error(`FAIL: corpus blob body is empty at ${blob_url}`)
  if (blob_bytes.byteLength !== pointer.size)
    throw new Error(
      `FAIL: corpus blob size mismatch (pointer ${pointer.size} bytes, got ${blob_bytes.byteLength}) at ${blob_url}`
    )

  const sha256 = createHash('sha256').update(blob_bytes).digest('hex')
  if (sha256 !== pointer.sha256)
    throw new Error(`FAIL: corpus blob sha256 mismatch (pointer ${pointer.sha256}, got ${sha256}) at ${blob_url}`)
  assert_nonempty_corpus(blob_bytes, blob_url)

  return {
    blob_url,
    bytes: blob_bytes.byteLength,
    pointer_url,
    sha256,
    version: pointer.version,
  }
}

const is_main = process.argv[1] === new URL(import.meta.url).pathname

if (is_main) {
  const base = process.argv.length > 2 ? process.argv[2] : (process.env.CORPUS_PROBE_BASE ?? DEFAULT_CORPUS_BASE)
  probe_corpus(base)
    .then(({ blob_url, bytes, sha256 }) =>
      console.log(`PASS: served corpus pointer names ${blob_url} (${bytes} bytes, sha256 ${sha256})`)
    )
    .catch((error) => {
      console.error(error_detail(error) || 'FAIL: corpus probe failed without an Error reason')
      process.exitCode = 1
    })
}
