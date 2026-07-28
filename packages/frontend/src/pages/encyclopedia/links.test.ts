// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED-FIRST (ency deep-links): entity references — the dungeon key name, the world-picker
// counts — become clickable links INTO the encyclopedia. encyclopedia_path is the ONE link idiom (a single
// home, never two link systems): it builds the exact deep-link URL the EncyclopediaPage routes on
// (/encyclopedia/<tab>/:id), or the tab root when the id is absent (an honest link, never /.../undefined).
import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'bun:test'

import { encyclopedia_path } from './links'

const read_fixture = (relative_path: string) => readFileSync(new URL(relative_path, import.meta.url), 'utf8')

describe('encyclopedia_path — the ONE entity-link idiom', () => {
  test('item id → the items detail deep-link (the dungeon key)', () => {
    expect(encyclopedia_path('item', '0xabc')).toBe('/encyclopedia/items/0xabc')
  })
  test('world id → the worlds detail deep-link (the UNFOLD 5/17 world-picker rider)', () => {
    expect(encyclopedia_path('world', '0xworld')).toBe('/encyclopedia/worlds/0xworld')
  })
  test('mob id → the bestiary detail deep-link', () => {
    expect(encyclopedia_path('mob', '0xmob')).toBe('/encyclopedia/bestiary/0xmob')
  })
  test('null / undefined id → the tab root, never a dead /.../undefined link', () => {
    expect(encyclopedia_path('item', null)).toBe('/encyclopedia/items')
    expect(encyclopedia_path('world', undefined)).toBe('/encyclopedia/worlds')
  })
})

test('the legacy /encyclopedia/mobs URL redirects to the bestiary before the items fallback', () => {
  const source = read_fixture('./index.tsx')
  const mobs_alias = '<Route path="mobs" element={<Navigate to="/encyclopedia/bestiary" replace />} />'
  const alias_index = source.indexOf(mobs_alias)
  const fallback_index = source.indexOf('<Route path="*" element={<Navigate to="/encyclopedia/items" replace />} />')

  expect(alias_index).toBeGreaterThan(-1)
  expect(alias_index).toBeLessThan(fallback_index)
})
