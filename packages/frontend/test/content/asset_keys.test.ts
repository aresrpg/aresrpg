// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { indexed_asset_key, spell_asset_key } from '../../src/content/asset_keys.ts'

test('spell icon identity ignores word-boundary underscores in seed filenames', () => {
  expect(spell_asset_key('yogan', 'Sunpiercer')).toBe(indexed_asset_key('yogen_sun_piercer'))
})
