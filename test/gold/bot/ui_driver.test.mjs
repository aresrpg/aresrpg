// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { make_ui_verb_driver } from './ui_driver.mjs'

const locator = (calls, name) => ({
  click: async () => calls.push(`click:${name}`),
  fill: async (value) => calls.push(`fill:${name}:${value}`),
  boundingBox: async () => ({ x: name === '#from' ? 10 : 50, y: 20, width: 10, height: 10 }),
})

describe('real Playwright UI verbs', () => {
  test('click, type, and drag use locators/mouse and emit digest plus DOM checkpoints', async () => {
    const calls = []
    const checkpoints = []
    const page = {
      locator: (selector) => locator(calls, selector),
      mouse: {
        move: async (x, y) => calls.push(`move:${x}:${y}`),
        down: async () => calls.push('down'),
        up: async () => calls.push('up'),
      },
      url: () => 'http://127.0.0.1:5174/market',
      title: async () => 'AresRPG',
      locator_snapshot: async () => 'listed',
    }
    const driver = make_ui_verb_driver({
      page,
      read_digest: async () => '0xdigest',
      checkpoint: (row) => checkpoints.push(row),
    })

    await driver.run([
      { click: '#list' },
      { type: { locator: '#price', value: '100000000' } },
      { drag: { from: '#from', to: '#to' } },
    ])

    expect(calls).toContain('click:#list')
    expect(calls).toContain('fill:#price:100000000')
    expect(calls).toContain('down')
    expect(calls).toContain('up')
    expect(checkpoints).toHaveLength(3)
    expect(checkpoints.every((row) => row.digest === '0xdigest' && row.dom.url.includes('/market'))).toBe(true)
  })
})
