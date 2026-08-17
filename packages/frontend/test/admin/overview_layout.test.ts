// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

const overview_source = await Bun.file(new URL('../../src/admin/OverviewPage.tsx', import.meta.url)).text()

test('admin overview keeps the compact economy dashboard hierarchy', () => {
  for (const label of [
    'Collectable now',
    'Shop volume 30d',
    'Sales 30d',
    'MAU',
    'DAU',
    'Daily shop volume',
    'Revenue',
    'Players',
  ])
    expect(overview_source).toContain(label)

  expect(overview_source).not.toContain('rounded-full')
  expect(overview_source).not.toContain('admin_content_domains')
  expect(overview_source).not.toContain('Content constellation')
  expect(overview_source).not.toContain('zkLogin')
})
