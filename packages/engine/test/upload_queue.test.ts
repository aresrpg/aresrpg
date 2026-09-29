// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { create_upload_queue } from '../src/upload_queue.ts'

test('voxel and detail jobs consume one frame budget and cancelled jobs cannot upload', () => {
  const queue = create_upload_queue(() => 0)
  const applied: string[] = []
  for (const key of ['terrain:a', 'detail:a', 'detail:b'])
    queue.add({
      key,
      origin: [0, 0, 0],
      bytes: 80,
      upload: () => {
        applied.push(key)
        return true
      },
    })
  expect(queue.drain([0, 0, 0], 100, 1)).toBe(80)
  expect(applied).toEqual(['terrain:a'])
  expect(queue.size()).toBe(2)
  queue.remove('detail:a')
  queue.drain([0, 0, 0], 100, 1)
  expect(applied).toEqual(['terrain:a', 'detail:b'])
  expect(queue.size()).toBe(0)
})

test('capacity blocks retries until released, while newly queued details survive the current drain', () => {
  const queue = create_upload_queue(() => 0)
  let capacity = false
  let attempts = 0
  queue.add({
    key: 'terrain',
    origin: [0, 0, 0],
    bytes: 8,
    upload: () => {
      attempts++
      if (!capacity) return false
      queue.add({ key: 'detail', origin: [0, 0, 0], bytes: 10, upload: () => true })
      return true
    },
  })
  queue.drain([0, 0, 0], 100, 1)
  queue.drain([0, 0, 0], 100, 1)
  expect(attempts).toBe(1)
  expect(queue.blocked_count()).toBe(1)
  capacity = true
  queue.release()
  queue.drain([0, 0, 0], 100, 1)
  expect(queue.size()).toBe(1)
  expect(queue.drain([0, 0, 0], 100, 1)).toBe(10)
  queue.dispose()
  expect(queue.size()).toBe(0)
})

test('time bounds also apply to zero-byte jobs and replacement jobs keep their newest revision', () => {
  let clock = 0
  const queue = create_upload_queue(() => clock)
  const applied: string[] = []
  queue.add({
    key: 'a',
    origin: [0, 0, 0],
    bytes: 0,
    upload: () => {
      clock = 2
      return true
    },
  })
  queue.add({
    key: 'b',
    origin: [0, 0, 0],
    bytes: 8,
    upload: () => {
      applied.push('old')
      return true
    },
  })
  queue.add({
    key: 'b',
    origin: [0, 0, 0],
    bytes: 8,
    upload: () => {
      applied.push('new')
      return true
    },
  })
  queue.drain([0, 0, 0], 100, 1)
  expect(applied).toEqual([])
  queue.drain([0, 0, 0], 100, 1)
  expect(applied).toEqual(['new'])
})
