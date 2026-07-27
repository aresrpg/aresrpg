// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import default_avatar_url from '../../engine/assets/characters/senshi_male.glb?url'

test('Bun resolves the absent default avatar GLB to the Vite CDN route', () => {
  expect(default_avatar_url).toBe('/sprites/characters/senshi_male.glb')
})
