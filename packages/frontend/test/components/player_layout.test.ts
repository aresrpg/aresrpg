// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { uses_mobile_overlays } from '../../src/player_layout.ts'

test('compact gameplay selects mobile overlays within the existing app', () => {
  for (const path of ['/', '/world', '/characters/stats', '/marketplace', '/settings', '/encyclopedia/items']) {
    expect(uses_mobile_overlays(path, true)).toBe(true)
    expect(uses_mobile_overlays(path, false)).toBe(false)
  }
})

test('demo, callback, gifts and finance keep their existing responsive routes', () => {
  for (const path of ['/play-demo', '/demo', '/enoki', '/gift', '/claim', '/kares', '/admin'])
    expect(uses_mobile_overlays(path, true)).toBe(false)
})
