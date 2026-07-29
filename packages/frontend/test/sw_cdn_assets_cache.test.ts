// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1598 — the `cdn-assets` runtime cache matched by URL only, so the first no-cors `<img>` load stored an
// OPAQUE response that every later cors-mode consumer (Three.js crossorigin textures, programmatic fetch)
// then received → `Failed to fetch` → workbox `no-response` → net::ERR_FAILED. Exercise the strategy's
// cache-match guard directly: config-shape checks alone cannot prove an opaque hit is rejected.
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'bun:test'

import { cdn_assets_cache_guard, cdn_assets_runtime_cache } from '../sw_cdn_assets_cache'

describe('#1598 cdn-assets runtime cache', () => {
  const { options } = cdn_assets_runtime_cache

  it('fetches in cors mode so a no-cors consumer never stores an opaque response', () => {
    expect(options.fetchOptions).toEqual({ mode: 'cors' })
  })

  it('caches 200s only — an opaque or failed response is never stored', () => {
    expect(options.cacheableResponse).toEqual({ statuses: [200] })
  })

  it('carries a versioned cache name so already-poisoned clients abandon the old cache', () => {
    expect(options.cacheName).toBe('cdn-assets-v2')
  })

  it('treats an opaque cached entry as a miss for a cors consumer', () => {
    // Bun currently reports `navigate` for `new Request(url, {mode: 'cors'})`; a plain request fixture keeps
    // the browser's actual FetchEvent shape explicit while exercising Workbox's callback contract.
    const request = { mode: 'cors' } as Request
    const opaque_response = { type: 'opaque' } as Response
    const cors_response = { type: 'cors' } as Response

    expect(options.plugins).toContain(cdn_assets_cache_guard)
    expect(cdn_assets_cache_guard.cachedResponseWillBeUsed({ request, cachedResponse: opaque_response })).toBeNull()
    expect(cdn_assets_cache_guard.cachedResponseWillBeUsed({ request, cachedResponse: cors_response })).toBe(
      cors_response
    )
  })
})

describe('#1598 poisoned-cache cleanup', () => {
  it('deletes the orphaned cdn-assets cache at boot', () => {
    const sw_source = readFileSync(new URL('../src/sw.ts', import.meta.url), 'utf8')
    expect(sw_source).toContain("caches.delete('cdn-assets')")
  })
})
