// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { rpc_sync_header } from './rpc_sync_header'

describe('rpc_sync_header', () => {
  test('mounts a full-width thin red header with spinner, label, and numeric progress while syncing', () => {
    const html = renderToStaticMarkup(
      rpc_sync_header({
        syncing: true,
        stalled: false,
        sync_label: 'Syncing',
        status_label: 'Measuring speed…',
        remaining: 42,
      })
    )

    expect(html).toContain('data-rpc-sync-header=""')
    expect(html).toContain('fixed inset-x-0 top-0')
    expect(html).toContain('h-7 w-full')
    expect(html).toContain('border-b border-red-400/50')
    expect(html).toContain('bg-[#0a0a0f]/95')
    expect(html).toContain('animate-spin text-red-400')
    expect(html).toContain('Syncing')
    expect(html).toContain('data-sync-progress=""')
    expect(html).toContain('42')
    expect(html).toContain('Measuring speed…')
  })

  test('returns null when syncing ends so the header unmounts cleanly', () => {
    expect(
      rpc_sync_header({
        syncing: false,
        stalled: false,
        sync_label: 'Syncing',
        status_label: 'Measuring speed…',
        remaining: 42,
      })
    ).toBeNull()
  })
})
