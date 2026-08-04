// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createHash } from 'node:crypto'

import { describe, expect, test } from 'bun:test'

import { probe_corpus } from '../../scripts/corpus_probe.mjs'

const blob_text = '[{"id":"served-corpus-positive-control"}]\n'
const blob_bytes = new TextEncoder().encode(blob_text)
const blob_sha256 = createHash('sha256').update(blob_bytes).digest('hex')

const origin = 'https://fixture.invalid'

const json_response = (body, init = {}) =>
  new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    ...init,
  })

const fixture_base = (fixture) => `${origin}/${fixture}/data/`

const fixture_fetch = (fixture) => {
  const requests = []
  const fetch_impl = async (input) => {
    const url = String(input)
    requests.push(url)
    const { pathname } = new URL(url)
    const [, requested_fixture, data, filename] = pathname.split('/')
    if (requested_fixture !== fixture || data !== 'data') return new Response('not found', { status: 404 })

    if (filename === 'corpus_version.json') {
      if (fixture === 'dead-pointer')
        return json_response({ version: 'missing', sha256: blob_sha256, size: blob_bytes.byteLength })
      if (fixture === 'sha-mismatch')
        return json_response({ version: 'fixture', sha256: '0'.repeat(64), size: blob_bytes.byteLength })
      if (fixture === 'size-mismatch')
        return json_response({ version: 'fixture', sha256: blob_sha256, size: blob_bytes.byteLength + 1 })
      if (fixture === 'missing-claim') return json_response({ version: 'fixture', size: blob_bytes.byteLength })
      if (fixture === 'malformed-json') return new Response('{')
      if (fixture === 'dead-pointer-leg') return new Response('not found', { status: 503 })
      if (fixture === 'empty-scan') {
        const empty = new TextEncoder().encode('[]')
        return json_response({
          version: 'fixture',
          sha256: createHash('sha256').update(empty).digest('hex'),
          size: empty.byteLength,
        })
      }
      return json_response({ version: 'fixture', sha256: blob_sha256, size: blob_bytes.byteLength })
    }

    if (filename === 'spell_corpus.missing.json') return new Response('not found', { status: 404 })
    if (filename === 'spell_corpus.fixture.json') {
      if (fixture === 'empty-scan') return new Response('[]', { headers: { 'content-type': 'application/json' } })
      return new Response(blob_bytes, { headers: { 'content-type': 'application/json' } })
    }
    return new Response('not found', { status: 404 })
  }
  return { fetch_impl, requests }
}

const run_fixture = (fixture) => {
  const control = fixture_fetch(fixture)
  return { ...control, result: probe_corpus(fixture_base(fixture), control.fetch_impl) }
}

describe('served-corpus probe', () => {
  test('RED: a pointer naming a nonexistent blob fails on the blob leg distinctly', async () => {
    await expect(run_fixture('dead-pointer').result).rejects.toThrow(
      /FAIL: corpus blob HTTP 404 at .*\/dead-pointer\/data\/spell_corpus\.missing\.json/
    )
  })

  test('RED: matching byte size cannot hide a sha mismatch', async () => {
    await expect(run_fixture('sha-mismatch').result).rejects.toThrow(
      /FAIL: corpus blob sha256 mismatch \(pointer 0{64}, got [0-9a-f]{64}\) at /
    )
  })

  test('RED: matching sha cannot hide a size mismatch', async () => {
    await expect(run_fixture('size-mismatch').result).rejects.toThrow(
      new RegExp(
        `FAIL: corpus blob size mismatch \\(pointer ${blob_bytes.byteLength + 1} bytes, got ${blob_bytes.byteLength}\\) at `
      )
    )
  })

  test('RED: a missing pointer claim is malformed, never a zero', async () => {
    await expect(run_fixture('missing-claim').result).rejects.toThrow(
      'FAIL: malformed corpus pointer (sha256 must be 64 hexadecimal characters)'
    )
  })

  test('RED: a pointer HTTP failure is distinct from a dead blob', async () => {
    await expect(run_fixture('dead-pointer-leg').result).rejects.toThrow(
      /FAIL: corpus pointer HTTP 503 at .*\/dead-pointer-leg\/data\/corpus_version\.json/
    )
  })

  test('RED: malformed pointer JSON fails before any blob fetch', async () => {
    await expect(run_fixture('malformed-json').result).rejects.toThrow('FAIL: malformed corpus pointer JSON')
  })

  test('RED: a byte-valid empty corpus scan is not a plausible zero', async () => {
    await expect(run_fixture('empty-scan').result).rejects.toThrow(/FAIL: corpus blob scan is empty at /)
  })

  test('GREEN: exact pointer and nonempty blob response bytes pass every proof', async () => {
    const { requests, result } = run_fixture('good')
    await expect(result).resolves.toEqual({
      blob_url: `${origin}/good/data/spell_corpus.fixture.json`,
      bytes: blob_bytes.byteLength,
      pointer_url: `${origin}/good/data/corpus_version.json`,
      sha256: blob_sha256,
      version: 'fixture',
    })
    expect(requests).toEqual([
      `${origin}/good/data/corpus_version.json`,
      `${origin}/good/data/spell_corpus.fixture.json`,
    ])
  })
})
