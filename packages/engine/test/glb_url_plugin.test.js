// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { DEFAULT_CHARACTER_GLB_URL } from '../src/player/character_avatar.js'

test('the demo avatar imports without a missing local GLB module', () => {
  expect(DEFAULT_CHARACTER_GLB_URL).toBe('/models/characters/senshi_male.glb')
})
