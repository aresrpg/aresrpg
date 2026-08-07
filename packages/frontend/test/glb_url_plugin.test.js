// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { existsSync } from 'node:fs'

import { expect, test } from 'bun:test'

import { DEFAULT_CHARACTER_GLB_URL } from '../../engine/src/player/character_avatar.js'

test('the default avatar URL names a rig in the served model directory', () => {
  expect(DEFAULT_CHARACTER_GLB_URL).toBe('/models/characters/senshi_male.glb')
  expect(existsSync(new URL(`../public${DEFAULT_CHARACTER_GLB_URL}`, import.meta.url))).toBe(true)
})
