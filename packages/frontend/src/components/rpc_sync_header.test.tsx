// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { fold_lag_streak, is_sustained_lag, resolve_checkpoint_lag } from '../rpc/checkpoint_lag'

import { rpc_sync_header } from './rpc_sync_header'

const COMMITTER_CHECKPOINT = 1_000_000

/** Replay a series of observed lags through the REAL decision path the banner rides: per-sample threshold
 * resolution → consecutive-sample fold → sustained predicate → the chip renderer. '' means nothing mounts. */
function header_after_samples(lags: readonly number[]): string {
  let streak = 0
  let remaining = 0

  for (const lag of lags) {
    const sample = resolve_checkpoint_lag(COMMITTER_CHECKPOINT + lag, COMMITTER_CHECKPOINT)
    streak = fold_lag_streak(streak, sample?.lagging ?? false)
    remaining = sample?.remaining_checkpoints ?? 0
  }

  const syncing = is_sustained_lag(streak)
  return renderToStaticMarkup(
    rpc_sync_header({
      syncing,
      sync_label: 'Syncing',
      status_label: 'Measuring speed…',
      remaining: syncing ? remaining : undefined,
    })
  )
}

describe('rpc_sync_header', () => {
  test('mounts a full-width quiet header with spinner, label, and numeric progress while syncing', () => {
    const html = renderToStaticMarkup(
      rpc_sync_header({
        syncing: true,
        sync_label: 'Syncing',
        status_label: 'Measuring speed…',
        remaining: 42,
      })
    )

    expect(html).toContain('data-rpc-sync-header=""')
    expect(html).toContain('fixed inset-x-0 top-0')
    expect(html).toContain('h-7 w-full')
    expect(html).toContain('border-b border-border/60')
    expect(html).toContain('bg-surface/90')
    expect(html).toContain('animate-spin text-muted/50')
    expect(html).not.toContain('red-')
    expect(html).toContain('Syncing')
    expect(html).toContain('data-sync-progress=""')
    expect(html).toContain('42')
    expect(html).toContain('Measuring speed…')
  })

  test('returns null when syncing ends so the header unmounts cleanly', () => {
    expect(
      rpc_sync_header({
        syncing: false,
        sync_label: 'Syncing',
        status_label: 'Measuring speed…',
        remaining: 42,
      })
    ).toBeNull()
  })
})

describe('banner visibility over a sample series', () => {
  test('a small drift blip stays invisible however long it lasts', () => {
    expect(header_after_samples([8])).toBe('')
    expect(header_after_samples([8, 8, 8, 8])).toBe('')
  })

  test('a single deeply-late sample stays invisible — one spike is not an incident', () => {
    expect(header_after_samples([150])).toBe('')
    expect(header_after_samples([0, 150])).toBe('')
  })

  test('a lag that survives consecutive samples mounts the chip with its live count', () => {
    const html = header_after_samples([150, 150])

    expect(html).toContain('data-rpc-sync-header=""')
    expect(html).toContain('data-sync-progress=""')
    expect(html).toContain('150')
    expect(html).toContain('Syncing')
  })

  test('the count shown is the latest sample, not the peak of the episode', () => {
    expect(header_after_samples([26_510, 26_510, 12_000])).toContain('12,000')
  })

  test('catching up clears the chip on the very next healthy sample', () => {
    expect(header_after_samples([150, 150, 4])).toBe('')
  })
})

describe('RpcLagBanner persistence gate wiring', () => {
  test('the chip renders off the sustained predicate, never off a raw single sample', () => {
    // Same DOM-free seam lock as the estimator ingress below: the pure pipeline above stays green even if the
    // component forgot to consume it, so pin that the gate is what `lagging` — and thus the chip — rides on.
    const source = readFileSync(new URL('./RpcLagBanner.tsx', import.meta.url), 'utf8')

    expect(source).toContain('is_sustained_lag(lag_streak)')
    expect(source).toContain('fold_lag_streak(prev, sample_lagging)')
    expect(source).not.toMatch(/const lagging = data\?\.lagging/)
  })
})

describe('RpcLagBanner estimator ingress', () => {
  test('every landed lag sample re-enters the estimator when the remaining count is unchanged', () => {
    // This suite is intentionally DOM-free, so lock the hook wiring at its source seam and leave the
    // equal-sample transition itself to sync_eta.test.ts. A timestamp is the by-value identity of a sample:
    // without it in both places React collapses equal checkpoint counts before the reducer sees sample #2.
    const source = readFileSync(new URL('./RpcLagBanner.tsx', import.meta.url), 'utf8')
    const estimator_effect = source.match(/useEffect\(\(\) => \{([\s\S]*?fold_sync_sample[\s\S]*?)\}, \[([^\]]*)\]\)/)
    const dependencies = (estimator_effect?.[2] ?? '').split(',').map((dependency) => dependency.trim())

    expect(estimator_effect).not.toBeNull()
    expect(estimator_effect?.[1]).toContain('t: sampled_at')
    expect(dependencies).toContain('sampled_at')
  })
})
