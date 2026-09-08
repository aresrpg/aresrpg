// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { funding_texture_size } from '../src/funding_texture.ts'

test('funding texture work stays bounded across phone, desktop and large resized bars', () => {
  for (const width of [0, 1, 240, 768, 1_440, 3_840, 10_000]) {
    for (const height of [0, 1, 48, 100, 1_000]) {
      const size = funding_texture_size(width, height)
      expect(size.width).toBeGreaterThanOrEqual(1)
      expect(size.height).toBeGreaterThanOrEqual(1)
      expect(size.width).toBeLessThanOrEqual(768)
      expect(size.height).toBeLessThanOrEqual(40)
      expect(size.width * size.height).toBeLessThanOrEqual(30_720)
    }
  }
})
