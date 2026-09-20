// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { create_caption_slots } from '../src/caption_slots.ts'
import { caption_raster_key, wrap_caption } from '../src/caption_raster.ts'

test('caption slots are bounded, never overlap and reuse released rectangles', () => {
  const slots = create_caption_slots()
  const occupied = Array.from({ length: 63 }, () => slots.allocate(128)!)
  expect(occupied.every(Boolean)).toBeTrue()
  expect(new Set(occupied.map(({ column, row }) => `${column}:${row}`)).size).toBe(63)
  expect(occupied.some(({ column, row }) => column === 0 && row === 0)).toBeFalse()
  expect(slots.allocate(128)).toBeNull()
  slots.release(occupied[20]!)
  expect(slots.allocate(128)).toEqual(occupied[20])
  occupied.forEach(slots.release)
  expect(slots.empty()).toBeTrue()
})

test('large captions reserve contiguous rows without corrupting neighbors', () => {
  const slots = create_caption_slots()
  const large = slots.allocate(400)!
  const next = slots.allocate(128)!
  expect(large.rows).toBe(4)
  expect(next.column !== large.column || next.row >= large.row + large.rows).toBeTrue()
  slots.release(large)
  expect(slots.allocate(400)).toEqual(large)
  expect(slots.allocate(4096)).toBeNull()
})

test('caption wrapping retains grapheme clusters and limits abusive newline height', () => {
  const measure = (text: string) => [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].length
  expect(wrap_caption('你好吗한국어', measure, 2)).toEqual(['你好', '吗한', '국어'])
  expect(wrap_caption('á👨‍👩‍👧‍👦b', measure, 1)).toEqual(['á', '👨‍👩‍👧‍👦', 'b'])
  expect(wrap_caption('line\n'.repeat(100), measure, 20)).toHaveLength(7)
})

test('movement, opacity and health fraction do not rerasterize unchanged text', () => {
  const first = { name: 'Player', health: { fraction: 1, color: '#0f0' } }
  expect(caption_raster_key(first)).toBe(
    caption_raster_key({ ...first, opacity: 0.5, world_size: [2, 1], health: { fraction: 0.5, color: '#f00' } })
  )
  expect(caption_raster_key(first)).not.toBe(caption_raster_key({ ...first, speech: 'Hello' }))
})
