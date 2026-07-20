// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { create_upload_queue } from './upload_queue.js'

describe('upload queue wall-clock budget', () => {
  test('always uploads one item, then carries work after the measured slice is spent', () => {
    let clock = 0
    /** @type {number[]} */
    const uploaded = []
    const queue = create_upload_queue({ time_budget_ms: 3, now: () => clock })
    for (let i = 0; i < 3; i += 1) {
      queue.enqueue({
        key: String(i),
        byte_size: 10,
        priority: i,
        upload: () => {
          uploaded.push(i)
          clock += 4
        },
      })
    }

    expect(queue.drain_frame(100)).toBe(10)
    expect(uploaded).toEqual([0])
    expect(queue.pending_count()).toBe(2)
    expect(queue.drain_frame(100)).toBe(10)
    expect(uploaded).toEqual([0, 1])
  })

  test('retains nearest-first ordering while the time slice is unspent', () => {
    /** @type {string[]} */
    const uploaded = []
    const queue = create_upload_queue({ time_budget_ms: 3, now: () => 0 })
    queue.enqueue({ key: 'far', byte_size: 4, priority: 9, upload: () => uploaded.push('far') })
    queue.enqueue({ key: 'near', byte_size: 4, priority: 1, upload: () => uploaded.push('near') })
    expect(queue.drain_frame(8)).toBe(8)
    expect(uploaded).toEqual(['near', 'far'])
  })
})
