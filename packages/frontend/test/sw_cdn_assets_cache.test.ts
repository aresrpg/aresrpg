// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1598 — the `cdn-assets` runtime cache matched by URL only, so the first no-cors `<img>` load stored an
// OPAQUE response that every later cors-mode consumer (Three.js crossorigin textures, programmatic fetch)
// then received → `Failed to fetch` → workbox `no-response` → net::ERR_FAILED, for up to 86400s and across
// SW updates. The strategy must fetch in cors mode, cache only 200s, and carry a fresh cache name so
// poisoned clients abandon the old one. The deployed proof is the served-edge probe; this pins the config.
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'bun:test'

const CONFIG_PATH = new URL('../vite.config.ts', import.meta.url)

// Slices the runtimeCaching entry whose urlPattern names the asset host: walk back to the entry's opening
// brace, then brace-match forward. No brace appears inside that entry's regex literal or string values.
function cdn_assets_entry_source(source: string): string {
  const host_index = source.indexOf('assets\\.aresrpg\\.world')
  if (host_index === -1) throw new Error('no runtimeCaching entry matches the asset host')
  const start = source.lastIndexOf('{', host_index)
  let depth = 0
  for (let index = start; index < source.length; index++) {
    if (source[index] === '{') depth++
    else if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1)
  }
  throw new Error('unbalanced runtimeCaching entry')
}

describe('#1598 cdn-assets runtime cache', () => {
  const entry = cdn_assets_entry_source(readFileSync(CONFIG_PATH, 'utf8'))

  it('fetches in cors mode so a no-cors consumer never stores an opaque response', () => {
    expect(entry).toMatch(/fetchOptions:\s*\{\s*mode:\s*'cors'\s*,?\s*\}/)
  })

  it('caches 200s only — an opaque or failed response is never stored', () => {
    expect(entry).toMatch(/cacheableResponse:\s*\{\s*statuses:\s*\[\s*200\s*\]\s*,?\s*\}/)
  })

  it('carries a versioned cache name so already-poisoned clients abandon the old cache', () => {
    expect(entry).toMatch(/cacheName:\s*'cdn-assets-v2'/)
  })
})

describe('#1598 poisoned-cache cleanup', () => {
  it('deletes the orphaned cdn-assets cache at boot', () => {
    const sw_source = readFileSync(new URL('../src/sw.ts', import.meta.url), 'utf8')
    expect(sw_source).toContain("caches.delete('cdn-assets')")
  })
})
