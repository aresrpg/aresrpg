// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { ci_checks_for_diff, browser_checks_required } from '../ci_inputs.mjs'

for (const path of [
  'seed/content/items.json',
  'seed/content/worlds.json',
  'packages/move/sources/fight.move',
  'packages/move/Move.lock',
  'packages/seed/Move.toml',
  'pins.json',
  'README.md',
])
  test(`${path} does not launch browser workloads`, () =>
    expect(browser_checks_required([path], () => true)).toBe(false))

for (const path of [
  'packages/engine/src/renderer.ts',
  'packages/frontend/src/app.tsx',
  'packages/sdk/src/client.ts',
  'packages/fight/src/index.ts',
  'packages/immutable/src/index.ts',
  'packages/protocol/src/index.ts',
  'packages/frontend/e2e/playwright.config.ts',
  'seed/models/body.glb',
  'bun.lock',
  '.github/workflows/gate.yml',
  'scripts/ci_inputs.mjs',
])
  test(`${path} requires browser verification`, () => expect(browser_checks_required([path], () => true)).toBe(true))

test('version-only bumps skip browsers but dependency and script changes do not', () => {
  const git = (updated) => (args) => {
    if (args[0] === 'diff') return 'package.json\0'
    if (args[0] === 'ls-tree') return 'package.json'
    return JSON.stringify(args[1].startsWith('base:') ? { version: '1.0.0', scripts: { dev: 'vite' } } : updated)
  }
  expect(ci_checks_for_diff('base', 'head', git({ version: '1.0.1', scripts: { dev: 'vite' } })).browsers).toBe(false)
  expect(ci_checks_for_diff('base', 'head', git({ version: '1.0.1', scripts: { dev: 'other' } })).browsers).toBe(true)
})

test('missing baseline fails safe and Git errors never become a skip', () => {
  expect(
    ci_checks_for_diff('', 'head', () => {
      throw new Error('must not read')
    })
  ).toEqual({ browsers: true, move: true, indexer: true })
  expect(() =>
    ci_checks_for_diff('base', 'head', () => {
      throw new Error('missing history')
    })
  ).toThrow('missing history')
})

test('a rendering edit remains required across a later version-only commit', () => {
  expect(browser_checks_required(['package.json', 'packages/engine/src/renderer.ts'], () => false)).toBe(true)
})

for (const path of ['seed/content/mobs.json', 'seed/content/spells.json', 'pins.json', 'README.md'])
  test(`${path} does not rerun unchanged compiled-language checks`, () => {
    expect(ci_checks_for_diff('verified', 'head', () => `${path}\0`)).toEqual({
      browsers: false,
      move: false,
      indexer: false,
    })
  })

for (const path of [
  'packages/move/sources/world.move',
  'packages/move-math/Move.lock',
  'packages/seed/Move.toml',
  'packages/control/sources/version.move',
  'packages/kares/sources/staking.move',
  'packages/move-combat/tests/fight.move',
  'scripts/coverage_move.sh',
  'move-packages.json',
  '.github/workflows/gate.yml',
  'scripts/ci_inputs.mjs',
])
  test(`${path} requires Move and its indexer parity checks`, () => {
    const checks = ci_checks_for_diff('verified', 'head', () => `${path}\0`)
    expect(checks.move).toBe(true)
    expect(checks.indexer).toBe(true)
  })

for (const path of [
  'packages/indexer/Cargo.lock',
  'packages/indexer/tests/layout_snapshot.txt',
  'packages/protocol/src/leaderboards.ts',
  'scripts/coverage_indexer.sh',
  'rust-toolchain.toml',
  '.cargo/config.toml',
])
  test(`${path} requires indexer verification`, () => {
    expect(ci_checks_for_diff('verified', 'head', () => `${path}\0`).indexer).toBe(true)
  })

test('a failed Move edit still runs when followed by a content-only update', () => {
  const git = (args) => {
    expect(args).toEqual(['diff', '--name-only', '--no-renames', '-z', 'last-success', 'head'])
    return 'packages/move/sources/world.move\0seed/content/mobs.json\0'
  }
  expect(ci_checks_for_diff('last-success', 'head', git)).toEqual({ browsers: false, move: true, indexer: true })
})
