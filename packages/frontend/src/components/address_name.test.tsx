// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// address_name.test.tsx — D52 SuiNS display resolution.
//
// No DOM/RTL harness (none exists in this repo — see item_detail_view.test.tsx's own note; adding one
// for this would violate minimal-deps): react-dom/server's renderToStaticMarkup covers AddressName's
// pure prop→markup rendering with no jsdom needed. get_names is tested the same way get_taux is in
// item_detail_view.test.tsx — mock global.fetch, assert the parsed shape + the requested query param.
//
// useAddressNames (the hook) is intentionally NOT unit-tested here: it is a thin dedupe+useEffect
// wrapper around get_names, and exercising a real effect needs a render tree (RTL), which this repo
// doesn't carry. Its correctness rides get_names' own tests + plain React effect semantics.

import { describe, test, expect, mock, afterEach } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { get_names } from '../rpc/client'

import { AddressName } from './address_name'

const NAMED = '0x9036f4be5ca0d0c2b890f12b398c032a00952aa41c2776507db0d018002373a7'
const UNNAMED = '0x0000000000000000000000000000000000000000000000000000000000000002'
const OTHER = '0x00000000000000000000000000000000000000000000000000000000000000c1'

describe('AddressName', () => {
  test('renders "@handle" (the ".sui" suffix stripped) when a name resolves', () => {
    const html = renderToStaticMarkup(<AddressName address={NAMED} name="alice.sui" />)
    expect(html).toBe('@alice')
  })

  test('falls back to the house shortened-address format when unresolved (name null)', () => {
    const html = renderToStaticMarkup(<AddressName address={UNNAMED} name={null} />)
    expect(html).toBe(`${UNNAMED.slice(0, 6)}…${UNNAMED.slice(-4)}`)
  })

  test('falls back the same way while still resolving (name undefined)', () => {
    const html = renderToStaticMarkup(<AddressName address={UNNAMED} />)
    expect(html).toBe(`${UNNAMED.slice(0, 6)}…${UNNAMED.slice(-4)}`)
  })

  test('renders the house "—" default when address itself is falsy', () => {
    expect(renderToStaticMarkup(<AddressName address={null} />)).toBe('—')
  })

  test('a caller-supplied fallback overrides the default when address is falsy', () => {
    expect(renderToStaticMarkup(<AddressName address={undefined} fallback="Adventurer" />)).toBe('Adventurer')
  })

  test('wraps in a span with className only when one is passed (no nested-span noise otherwise)', () => {
    const bare = renderToStaticMarkup(<AddressName address={NAMED} name="alice.sui" />)
    expect(bare).not.toContain('<span')

    const classed = renderToStaticMarkup(<AddressName address={NAMED} name="alice.sui" className="gw-prow__name" />)
    expect(classed).toBe('<span class="gw-prow__name">@alice</span>')
  })

  test('a subdomain keeps its label, only the trailing ".sui" is stripped', () => {
    const html = renderToStaticMarkup(<AddressName address={NAMED} name="treasury.aresrpg.sui" />)
    expect(html).toBe('@treasury.aresrpg')
  })
})

describe('get_names (rpc/client.ts)', () => {
  const original_fetch = global.fetch
  afterEach(() => {
    global.fetch = original_fetch
  })

  test('parses the real /v1/names envelope: a flat address→name map, not an enveloped list', async () => {
    global.fetch = mock(
      async () => new Response(JSON.stringify({ [NAMED]: 'alice.sui', [UNNAMED]: null }), { status: 200 })
    ) as unknown as typeof fetch

    const data = await get_names([NAMED, UNNAMED])
    expect(data).toEqual({ [NAMED]: 'alice.sui', [UNNAMED]: null })
  })

  test('requests one comma-joined ?addresses= param, deduped', async () => {
    // A distinct address combo from the test above — rpc_get's LRU is keyed by full URL (module-level,
    // persists across tests in this file), so a repeated combo would cache-hit instead of hitting fetch.
    const fetch_mock = mock(async () => new Response(JSON.stringify({ [NAMED]: 'alice.sui' }), { status: 200 }))
    global.fetch = fetch_mock as unknown as typeof fetch

    await get_names([NAMED, NAMED, OTHER])
    const requested_url = String((fetch_mock.mock.calls[0] as unknown[])[0])
    expect(requested_url).toContain('/v1/names')
    expect(requested_url).toContain(`addresses=${encodeURIComponent(`${NAMED},${OTHER}`)}`)
  })

  test('short-circuits to {} without a network call when every address is null/undefined/empty', async () => {
    const fetch_mock = mock(async () => new Response('{}', { status: 200 }))
    global.fetch = fetch_mock as unknown as typeof fetch

    expect(await get_names([null, undefined, ''])).toEqual({})
    expect(fetch_mock).not.toHaveBeenCalled()
  })
})
