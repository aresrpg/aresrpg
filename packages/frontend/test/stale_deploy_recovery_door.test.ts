// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The door app code reports its OWN caught chunk failures through. It exists so a caller that has to catch its
// `import()` (the simulator's fight shim does, to keep a pressed button from dying silently) still reaches the
// single recovery — same event, same reload guard, same story. A second recovery path would be a second truth.

import { afterAll, describe, expect, test } from 'bun:test'

import { install_stale_deploy_recovery, report_chunk_load_failure } from '../src/core/stale_deploy_recovery'

const window_events = new EventTarget()
const previous_window = Object.getOwnPropertyDescriptor(globalThis, 'window')
Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: window_events })

afterAll(() => {
  if (previous_window) Object.defineProperty(globalThis, 'window', previous_window)
  else delete (globalThis as { window?: unknown }).window
})

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('report_chunk_load_failure', () => {
  test('drives the installed recovery exactly like a real preload failure', async () => {
    const calls: string[] = []
    const values = new Map<string, string>()
    const dispose = install_stale_deploy_recovery({
      target: window_events,
      storage: {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => void values.set(key, value),
      },
      build_id: 'build-live',
      update_service_worker: async () => void calls.push('update'),
      reload: () => calls.push('reload'),
      show_world_load_failed: () => calls.push('toast'),
    })

    try {
      report_chunk_load_failure()
      await settle()
    } finally {
      dispose()
    }

    expect(calls).toEqual(['update', 'reload'])
  })
})
