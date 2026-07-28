// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { rpc_sync_header } from './rpc_sync_header'

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
