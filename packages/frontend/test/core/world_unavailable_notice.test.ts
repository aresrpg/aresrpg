// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFileSync } from 'node:fs'

import { expect, test } from 'bun:test'

test('an unavailable authored world can be dismissed without weakening fatal renderer failures', () => {
  const source = readFileSync(new URL('../../src/app.tsx', import.meta.url), 'utf8')

  expect(source).toContain("engine_status.state === 'failed' && !world_unavailable")
  expect(source).toContain("world_unavailable || engine_status.state === 'degraded'")
  expect(source).toContain('set_graphics_notice_dismissed(true)')
})
