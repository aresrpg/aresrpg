// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFileSync } from 'node:fs'

import { expect, test } from 'bun:test'

const source = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8')
const backend_plan = source.slice(source.indexOf('  backend-plan:'), source.indexOf('  build-server:'))

test('backend publication excludes client engine and frontend changes', () => {
  expect(backend_plan).toContain('packages/server seed/content seed/structures')
  expect(backend_plan).toContain('git diff --quiet "$previous_tag" "$GITHUB_SHA" -- packages/indexer')
  expect(backend_plan).not.toContain('packages/engine')
  expect(backend_plan).not.toContain('packages/frontend')
  expect(backend_plan).not.toContain('bun.lock')
})

test('an app-only tag marks both backend images unchanged', () => {
  expect(backend_plan).toContain('server=false')
  expect(backend_plan).toContain('indexer=false')
})
