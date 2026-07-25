// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// @aresrpg/party — import-graph hermeticity (a module-boundary law): the headless core may
// import ITSELF (sibling files) and zustand/vanilla, NOTHING else — no React, no DOM, no three, no
// frontend, no engine. Also pins package.json dependencies exactly, so a drive-by `bun add` is a red
// test instead of silent drift.

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test } from 'bun:test'

const SRC = join(import.meta.dir, '..', 'src')
const source_files = readdirSync(SRC).filter((name) => name.endsWith('.js') && !name.endsWith('.test.js'))

const specifiers_of = (code) => [
  ...[...code.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]),
  ...[...code.matchAll(/import\(\s*['"]([^'"]+)['"]/g)].map((match) => match[1]),
  ...[...code.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)].map((match) => match[1]),
  ...[...code.matchAll(/require\(\s*['"]([^'"]+)['"]/g)].map((match) => match[1]),
]

const ALLOWED = [/^\.\/[a-z_]+\.js$/, /^zustand\/vanilla$/]

test('every src import sits inside the hermetic allowlist (self + zustand/vanilla)', () => {
  expect(source_files.length).toBeGreaterThan(0)
  const violations = []
  for (const name of source_files)
    for (const spec of specifiers_of(readFileSync(join(SRC, name), 'utf8')))
      if (!ALLOWED.some((rule) => rule.test(spec))) violations.push(`${name} → ${spec}`)
  expect(violations).toEqual([])
})

test('zero DOM/React/three/browser surfaces anywhere in the graph', () => {
  const denied = /^(react|react-dom|three|zustand)$|^react\/|^three\/|^@aresrpg\/(engine3|frontend)/
  const violations = []
  for (const name of source_files)
    for (const spec of specifiers_of(readFileSync(join(SRC, name), 'utf8')))
      if (denied.test(spec)) violations.push(`${name} → ${spec}`)
  expect(violations).toEqual([])
})

test('package.json dependencies are pinned to exactly { zustand }', () => {
  const pkg = JSON.parse(readFileSync(join(SRC, '..', 'package.json'), 'utf8'))
  expect(Object.keys(pkg.dependencies ?? {}).sort()).toEqual(['zustand'])
  expect(Object.keys(pkg.devDependencies ?? {})).toEqual([])
})
