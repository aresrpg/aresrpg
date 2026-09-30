// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { toggles_world_map } from '../../../src/game/hud/Minimap.tsx'

test('M toggles the world map unless the player is typing', () => {
  expect(toggles_world_map({ code: 'KeyM', repeat: false, target: null })).toBeTrue()
  expect(toggles_world_map({ code: 'KeyM', repeat: true, target: null })).toBeFalse()
  expect(toggles_world_map({ code: 'KeyM', repeat: false, target: { tagName: 'INPUT' } as never })).toBeFalse()
  expect(toggles_world_map({ code: 'KeyN', repeat: false, target: null })).toBeFalse()
})
