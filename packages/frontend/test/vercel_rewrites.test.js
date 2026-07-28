// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { readFileSync } from 'node:fs'

import { expect, test } from 'bun:test'

const vercel_config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf-8'))
const spa_rewrite = vercel_config.rewrites.find(({ destination }) => destination === '/index.html')
const matches_spa = (path) => new RegExp(`^${spa_rewrite.source}/?$`).test(path)

test('the SPA rewrite never claims build assets or root PWA files', () => {
  expect(matches_spa('/assets/index-DEADBEEF.js')).toBe(false)
  expect(matches_spa('/assets/index-DEADBEEF.css')).toBe(false)
  expect(matches_spa('/assets/items/vanilla_sword.png')).toBe(false)
  expect(matches_spa('/sw.js')).toBe(false)
  expect(matches_spa('/workbox-12345.js')).toBe(false)
  expect(matches_spa('/discord-callback.html')).toBe(false)
})

test('the SPA rewrite still serves every deep link', () => {
  for (const deep_link of ['/', '/encyclopedia', '/encyclopedia/items/sword', '/shop/listing/0xabc', '/assets'])
    expect(matches_spa(deep_link)).toBe(true)
})

test('the excluded prefix is the prefix Vite actually builds into', () => {
  const vite_config = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf-8')

  expect(vite_config).not.toMatch(/assetsDir/)
  expect(spa_rewrite.source).toContain('assets/')
})
