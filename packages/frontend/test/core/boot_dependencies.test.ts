// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { dirname, resolve } from 'node:path'

import { expect, test } from 'bun:test'

test('game boot reaches no Three.js runtime before loading a surface', async () => {
  const packages = resolve(import.meta.dir, '../../..')
  const pending = [resolve(import.meta.dir, '../../src/game_entry.tsx')]
  const visited = new Set<string>()
  const violations: string[] = []
  const transpilers = { ts: new Bun.Transpiler({ loader: 'ts' }), tsx: new Bun.Transpiler({ loader: 'tsx' }) }
  while (pending.length) {
    const file = pending.pop()!
    if (visited.has(file)) continue
    visited.add(file)
    // Erase type-only edges; lazy imports belong to their own lifecycle, not boot.
    const transpiler = file.endsWith('x') ? transpilers.tsx : transpilers.ts
    const source = transpiler.transformSync(await Bun.file(file).text())
    const imports = transpiler.scanImports(source).filter(({ kind }) => kind === 'import-statement')
    violations.push(...imports.filter(({ path }) => /^three(?:\/|$)/.test(path)).map(({ path }) => `${file}: ${path}`))
    pending.push(
      ...imports
        .filter(({ path }) => /^(?:\.|@aresrpg\/)/.test(path))
        .map(({ path }) => Bun.resolveSync(path, dirname(file)))
        .filter((path) => path.startsWith(`${packages}/`) && /\.[jt]sx?$/.test(path))
    )
  }
  expect(visited.size).toBeGreaterThan(1)
  expect(violations).toEqual([])
})
