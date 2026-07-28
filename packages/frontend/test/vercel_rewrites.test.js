// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The SPA catch-all rewrite must NOT swallow the build's asset chunks (#1410 rider): a missing
// /assets/* chunk answered with `200 text/html` is indistinguishable from a healthy deploy, so a
// broken build reads as green to every curl-shaped probe. Vercel gives the filesystem precedence
// over rewrites (vercel.json docs, "rewrites"), so excluding /assets/ from the catch-all cannot
// affect chunks that EXIST — it only turns the miss case into an honest 404.
//
// APPROXIMATION: Vercel compiles `source` with path-to-regexp (not a dependency of this repo), so
// this test anchors the literal source string with the JS regex engine instead. That is exact for
// the shape used here — a single unnamed capture group carrying a raw regex, which path-to-regexp
// passes through verbatim (the docs' own negative-lookahead example: `/((?!maintenance).*)`).
import { readFileSync } from 'node:fs'

import { expect, test } from 'bun:test'

const vercel_config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf-8'))
const spa_rewrite = vercel_config.rewrites.find(({ destination }) => destination === '/index.html')
const matches_spa = (path) => new RegExp(`^${spa_rewrite.source}/?$`).test(path)

test('the SPA rewrite never claims a build asset path', () => {
  expect(matches_spa('/assets/index-DEADBEEF.js')).toBe(false)
  expect(matches_spa('/assets/index-DEADBEEF.css')).toBe(false)
  expect(matches_spa('/assets/items/vanilla_sword.png')).toBe(false)
})

test('the SPA rewrite still serves every deep link', () => {
  for (const deep_link of ['/', '/encyclopedia', '/encyclopedia/items/sword', '/shop/listing/0xabc', '/assets'])
    expect(matches_spa(deep_link)).toBe(true)
})

// The exclusion above is only correct while Vite emits chunks under `assets/` — its default
// `build.assetsDir`. Setting assetsDir without updating vercel.json would silently re-arm the bug,
// so the coupling is pinned here rather than left to a reviewer's memory.
test('the excluded prefix is the prefix Vite actually builds into', () => {
  const vite_config = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf-8')

  expect(vite_config).not.toMatch(/assetsDir/)
  expect(spa_rewrite.source).toContain('assets/')
})
