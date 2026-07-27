// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { afterEach, expect, test } from 'bun:test'

const original_window = Object.getOwnPropertyDescriptor(globalThis, 'window')

afterEach(() => {
  if (original_window) Object.defineProperty(globalThis, 'window', original_window)
  else delete globalThis.window
})

test('tx timing tolerates a truthy partial window from another test file', async () => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {},
    writable: true,
  })

  const { TX_TIMING_ON } = await import('../src/tx/latency.js?issue-731-partial-window')

  expect(TX_TIMING_ON).toBe(false)
})
