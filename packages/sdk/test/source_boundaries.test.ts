// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { expect, test } from 'bun:test'

test('the SDK has no polling or wait-for-node API', () => {
  const source_dir = resolve(import.meta.dir, '../src')
  const sources = [...new Bun.Glob('**/*.ts').scanSync(source_dir)].map((file) =>
    readFileSync(resolve(source_dir, file), 'utf8')
  )
  const source = sources.join('\n')

  expect(source).not.toMatch(/\bset(?:Timeout|Interval)\s*\(/u)
  expect(source).not.toContain('hydrate_required')
  expect(source).not.toContain('hydrate_owned_current')
  expect(source).not.toContain('owned object node lag')
})
