// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { expect, test } from 'bun:test'

const root = resolve(import.meta.dir, '..')

test('mobile consumes the shared presentation without importing the app entry or chain clients', () => {
  const forbidden = /(?:@mysten\/|frontend\/src\/(?:app|game_entry)\.tsx)/
  for (const file of new Bun.Glob('src/**/*.{ts,tsx}').scanSync({ cwd: root })) {
    const source = readFileSync(resolve(root, file), 'utf8')
    const imports = [...source.matchAll(/(?:from\s*|import\s*\(\s*)['"]([^'"]+)['"]/g)].map((match) => match[1]!)
    expect(imports.filter((path) => forbidden.test(path))).toEqual([])
  }
})
