// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { expect, test } from 'bun:test'

test('the UI package has no app, data, wallet, or engine dependency', () => {
  const directory = resolve(import.meta.dir, '../src')
  for (const file of readdirSync(directory).filter((name) => /\.tsx?$/.test(name))) {
    const source = readFileSync(resolve(directory, file), 'utf8')
    const imports = [...source.matchAll(/(?:from\s+|import\s*\()['"]([^'"]+)/g)].map((match) => match[1])
    expect(imports.filter((name) => !name.startsWith('./') && !['react', 'react-dom'].includes(name))).toEqual([])
  }
})
