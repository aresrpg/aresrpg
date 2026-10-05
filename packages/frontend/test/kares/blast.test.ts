// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { blast_phase, create_blast_runtime, initial_blast_state, reduce_blast } from '../../src/kares/blast.ts'

const snapshot = {
  version: '5',
  clock_ms: 100n,
  phase: 'live' as const,
  committed: 75n,
  target: 100n,
  progress_bps: 7500,
}

test('failed reads hide stale progress and never pretend that a configured sale is upcoming', () => {
  const live = reduce_blast(initial_blast_state(), { type: 'snapshot', url: 'https://www.blast.fun/', snapshot })
  const failed = reduce_blast(live, { type: 'failed', url: 'https://www.blast.fun/' })
  expect(blast_phase(failed)).toBe('unavailable')
  expect(failed.snapshot).toEqual(snapshot)
  expect(blast_phase(reduce_blast(failed, { type: 'snapshot', url: 'https://www.blast.fun/', snapshot: null }))).toBe(
    'soon'
  )
})

test('an older read cannot rewind certified sale progress', () => {
  const state = reduce_blast(initial_blast_state(), { type: 'snapshot', url: 'https://www.blast.fun/', snapshot })
  const older = reduce_blast(state, {
    type: 'snapshot',
    url: 'https://www.blast.fun/',
    snapshot: { ...snapshot, version: '4', committed: 0n },
  })
  expect(older.snapshot).toEqual(snapshot)
})

test('unmounting discards a delayed result and never schedules another read', async () => {
  let finish: (value: typeof snapshot) => void = () => undefined
  const runtime = create_blast_runtime({ network: 'testnet' }, () => ({
    configured: true,
    url: 'https://www.blast.fun/',
    read: () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  }))
  const stop = runtime.start()
  stop()
  const before = runtime.store.getState()
  finish(snapshot)
  await Promise.resolve()
  expect(runtime.store.getState()).toBe(before)
})

test('a read error retains the version floor while hiding its progress', () => {
  const live = reduce_blast(initial_blast_state(), { type: 'snapshot', url: 'https://www.blast.fun/', snapshot })
  const failed = reduce_blast(live, { type: 'failed', url: live.url })
  const stale = reduce_blast(failed, { type: 'snapshot', url: live.url, snapshot: { ...snapshot, version: '4' } })
  expect(blast_phase(stale)).toBe('unavailable')
  expect(stale.snapshot?.version).toBe('5')
})

test('an older clock cannot reopen an ended window when the sale object version is unchanged', () => {
  const ended = { ...snapshot, phase: 'closing' as const, clock_ms: 200n }
  const state = reduce_blast(initial_blast_state(), {
    type: 'snapshot',
    url: 'https://www.blast.fun/',
    snapshot: ended,
  })
  const stale = reduce_blast(state, { type: 'snapshot', url: state.url, snapshot: { ...snapshot, clock_ms: 100n } })
  expect(stale.snapshot?.phase).toBe('closing')
})
