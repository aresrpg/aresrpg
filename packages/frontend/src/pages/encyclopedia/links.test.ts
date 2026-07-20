// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED-FIRST (ency deep-links): entity references — the dungeon key name, the world-picker
// counts — become clickable links INTO the encyclopedia. encyclopedia_path is the ONE link idiom (a single
// home, never two link systems): it builds the exact deep-link URL the EncyclopediaPage routes on
// (/encyclopedia/<tab>/:id), or the tab root when the id is absent (an honest link, never /.../undefined).
import { describe, expect, test } from 'bun:test'

import { encyclopedia_path } from './links'

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
