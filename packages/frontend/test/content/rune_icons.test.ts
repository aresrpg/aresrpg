// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, test } from 'bun:test'

import items_source from '../../../../seed/content/items.json'

const png_dimensions = (path: string): Readonly<{ width: number; height: number }> => {
  const bytes = readFileSync(path)
  expect(bytes.subarray(1, 4).toString()).toBe('PNG')
  return Object.freeze({ width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) })
}

describe('rune icons', () => {
  test('every canonical rune owns an HD detail render and a 64px thumbnail', () => {
    const directory = resolve(import.meta.dir, '../../../../seed/icons/items')
    const runes = items_source.filter(({ category }) => category === 'rune')

    expect(runes).toHaveLength(35)
    for (const { item_type } of runes) {
      const detail = png_dimensions(resolve(directory, `${item_type}_hd.png`))
      const thumbnail = png_dimensions(resolve(directory, `${item_type}.png`))
      expect(detail.width).toBeGreaterThan(64)
      expect(detail.height).toBeGreaterThan(64)
      expect(Math.max(thumbnail.width, thumbnail.height)).toBe(64)
      expect(Math.min(thumbnail.width, thumbnail.height)).toBeGreaterThan(0)
    }
  })
})
