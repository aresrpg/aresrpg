// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { browser_setup_command } from '../prepare_browser.mjs'

for (const [platform, executable] of [
  ['darwin', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
  ['linux', '/opt/google/chrome/chrome'],
]) {
  test(`${platform} reuses installed Chrome and reports its actual version`, () => {
    expect(browser_setup_command('chrome', platform, (path) => path === executable)).toEqual([executable, '--version'])
  })
  test(`${platform} installs Chrome when the runner does not provide it`, () => {
    expect(browser_setup_command('chrome', platform, () => false)).toEqual([
      'bunx',
      'playwright',
      'install',
      '--with-deps',
      'chrome',
    ])
  })
}

test('Firefox retains Playwright’s required patched browser and system dependencies', () => {
  expect(browser_setup_command('firefox', 'linux', () => true)).toEqual([
    'bunx',
    'playwright',
    'install',
    '--with-deps',
    'firefox',
  ])
})

test('unsupported browsers fail without executing an arbitrary install target', () => {
  expect(() => browser_setup_command('other', 'linux', () => false)).toThrow('Unsupported CI browser')
})
