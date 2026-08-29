// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  advance_indexing_catchup,
  IndexingCatchupModal,
  indexing_blocked,
  project_indexing_catchup,
} from '../../src/components/IndexingCatchupModal.tsx'
import { load_app_copy } from '../../src/i18n/copy.ts'

test('indexing blocks connected play only outside the safe 300-checkpoint window', () => {
  expect(indexing_blocked('connecting', null)).toBeFalse()
  expect(indexing_blocked('connected', null)).toBeTrue()
  expect(indexing_blocked('ready', 301)).toBeTrue()
  expect(indexing_blocked('ready', 300)).toBeFalse()
})

test('cached lag samples project monotonic progress and an ETA to the playable window', () => {
  const started = advance_indexing_catchup(null, 1_300, 0)
  const advanced = advance_indexing_catchup(started, 800, 10_000)
  const view = project_indexing_catchup(advanced, 12_000)

  expect(view.progress_percent).toBe(50)
  expect(view.eta_seconds).toBe(8)
  expect(view.remaining).toBe(500)
  expect(project_indexing_catchup(advanced, 20_001).eta_seconds).toBeNull()
})

test('the blocking surface reports live checkpoint progress without a dismiss door', async () => {
  const copy = await load_app_copy('en')
  const html = renderToStaticMarkup(<IndexingCatchupModal copy={copy} indexing_lag={1_300} />)

  expect(html).toContain('data-indexing-blocker=""')
  expect(html).toContain('Synchronizing the world')
  expect(html).toContain('1000')
  expect(html).not.toContain('<button')
})
