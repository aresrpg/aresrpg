// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { browser_checks_for_diff, browser_checks_required } from '../browser_inputs.mjs'

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
  'scripts/browser_inputs.mjs',
])
  test(`${path} requires browser verification`, () => expect(browser_checks_required([path], () => true)).toBe(true))

test('version-only bumps skip browsers but dependency and script changes do not', () => {
  const git = (updated) => (args) => {
    if (args[0] === 'diff') return 'package.json\0'
    if (args[0] === 'ls-tree') return 'package.json'
    return JSON.stringify(args[1].startsWith('base:') ? { version: '1.0.0', scripts: { dev: 'vite' } } : updated)
  }
  expect(browser_checks_for_diff('base', 'head', git({ version: '1.0.1', scripts: { dev: 'vite' } }))).toBe(false)
  expect(browser_checks_for_diff('base', 'head', git({ version: '1.0.1', scripts: { dev: 'other' } }))).toBe(true)
})

test('missing baseline fails safe and Git errors never become a skip', () => {
  expect(
    browser_checks_for_diff('', 'head', () => {
      throw new Error('must not read')
    })
  ).toBe(true)
  expect(() =>
    browser_checks_for_diff('base', 'head', () => {
      throw new Error('missing history')
    })
  ).toThrow('missing history')
})

test('a rendering edit remains required across a later version-only commit', () => {
  expect(browser_checks_required(['package.json', 'packages/engine/src/renderer.ts'], () => false)).toBe(true)
})
