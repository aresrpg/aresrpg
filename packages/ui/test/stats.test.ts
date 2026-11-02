// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { expect, test } from 'bun:test'

test('Stats and Jobs fit complete authored busts inside the shared responsive portrait frame', () => {
  const css = readFileSync(resolve(import.meta.dir, '../src/stats.css'), 'utf8')
  const portrait = css.match(/\.aui-character-portrait > img\s*\{([^}]+)\}/)?.[1] ?? ''

  expect(portrait).toContain('width: 100%;')
  expect(portrait).toContain('height: 100%;')
  expect(portrait).toContain('object-fit: contain;')
  expect(portrait).not.toMatch(/\b(?:position|left|top|transform)\s*:/)
})
