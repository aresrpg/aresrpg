// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { beforeEach, expect, test } from 'bun:test'
import { walrus_asset_url } from '@aresrpg/sdk/jobs'

import { load_asset_manifest, reset_asset_manifest_for_test, subscribe } from './asset_manifest'

// bun shares module state across files (the boot test loads this module too) — reset so run order
// can never make the background-retry short-circuit on an already-'ready' status.
beforeEach(reset_asset_manifest_for_test)

// A url_class NO other test configures, so the resolver starts EMPTY (null) — the "cached absence"
// precondition. Recovery must flip it to a real Walrus URL with NO page refresh.
const CLASS = 'poison_probe_cosmetic'
const FILE = 'wanted.png'
const AGG = 'https://recovered.example'
const QUILT = 'poison-probe-quilt'
const EXPECTED = `${AGG}/v1/blobs/by-quilt-id/${QUILT}/${FILE}`

const manifest_response = () =>
  new Response(JSON.stringify({ aggregator: AGG, classes: { [CLASS]: { quilt: QUILT } } }))

// A manual scheduler captures the background-retry callbacks so the test drives "time passing"
// (NOT a page refresh) deterministically.
function make_scheduler() {
  const queue: Array<() => void> = []
  return {
    schedule: (fn: () => void) => {
      queue.push(fn)
    },
    drain: async () => {
      while (queue.length) await queue.shift()!()
    },
  }
}

test('a failed boot fetch never caches absence: the manifest recovers WITHOUT a page refresh', async () => {
  let calls = 0
  // The boot fetch FAILS (cold edge / offline); every later attempt would SUCCEED.
  const fetch_impl = (async () => {
    calls += 1
    if (calls === 1) throw new Error('cold edge / offline')
    return manifest_response()
  }) as unknown as typeof fetch

  const scheduler = make_scheduler()
  const fired: number[] = []
  const unsubscribe = subscribe(() => fired.push(1))

  // Pre-mount load: one blocking attempt, it fails.
  const ok = await load_asset_manifest({
    url: '/asset_manifest.json',
    fetch_impl,
    attempts: 1,
    delay_ms: 0,
    sleep: async () => {},
    schedule: scheduler.schedule,
  })

  const poisoned = walrus_asset_url(CLASS, FILE) // right after the failed boot — the resulting blank tile
  const after_remount = walrus_asset_url(CLASS, FILE) // "switch page" re-consults the resolver — still empty

  await scheduler.drain() // the background retry fires (time passes, NOT a refresh) and the edge is warm

  const recovered = walrus_asset_url(CLASS, FILE)
  unsubscribe()

  expect({ ok, poisoned, after_remount, recovered, fired: fired.length, calls }).toEqual({
    ok: false, // the boot attempt failed
    poisoned: null, // absence present right after the failed boot
    after_remount: null, // a remount alone cannot heal poisoned process-wide module state
    recovered: EXPECTED, // the background retry heals it WITHOUT a refresh  ← red at HEAD (one-shot boot)
    fired: 1, // and subscribers are notified to re-resolve                 ← red at HEAD (no notify on recovery)
    calls: 2, // exactly one boot attempt + one background attempt
  })
})
