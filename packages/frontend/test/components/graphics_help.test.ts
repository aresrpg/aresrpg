// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { graphics_help, graphics_help_topic } from '../../src/components/graphics_help.ts'
import { load_app_copy } from '../../src/i18n/copy.ts'
import { LOCALES } from '../../src/i18n/locale.ts'

const UA = {
  // The reported failure: Firefox 136 on an Apple silicon Mac with dom.webgpu.enabled forced on (2026-10-26).
  firefox_mac_136: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:136.0) Gecko/20100101 Firefox/136.0',
  firefox_mac_148: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:148.0) Gecko/20100101 Firefox/148.0',
  firefox_windows_140: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0',
  firefox_linux: 'Mozilla/5.0 (X11; Linux x86_64; rv:150.0) Gecko/20100101 Firefox/150.0',
  chrome_mac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  chrome_linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  chrome_os:
    'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  edge_windows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
  chrome_android:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  safari_mac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15',
  firefox_ios:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/136.0 Mobile/15E148 Safari/605.1.15',
}

test('an outdated Firefox is told its version and the release that ships WebGPU on its platform', () => {
  expect(graphics_help_topic(UA.firefox_mac_136)).toEqual({ key: 'firefox_update', version: 136, required: 147 })
  expect(graphics_help_topic(UA.firefox_windows_140)).toEqual({ key: 'firefox_update', version: 140, required: 142 })
  expect(graphics_help_topic(UA.firefox_mac_148)).toEqual({ key: 'firefox_settings' })
  expect(graphics_help_topic(UA.firefox_linux)).toEqual({ key: 'firefox_unsupported' })
})

test('Chromium browsers get the acceleration setting; Linux also gets the flags; iOS browsers follow Safari', () => {
  expect(graphics_help_topic(UA.chrome_mac).key).toBe('chromium')
  expect(graphics_help_topic(UA.edge_windows).key).toBe('chromium')
  expect(graphics_help_topic(UA.chrome_os).key).toBe('chromium')
  expect(graphics_help_topic(UA.chrome_linux).key).toBe('chromium_linux')
  expect(graphics_help_topic(UA.chrome_android).key).toBe('other')
  expect(graphics_help_topic(UA.safari_mac).key).toBe('safari')
  expect(graphics_help_topic(UA.firefox_ios).key).toBe('safari')
  expect(graphics_help_topic('').key).toBe('other')
})

test('help appears only for WebGPU support failures, never for unrelated engine failures', async () => {
  const copy = await load_app_copy('en')
  expect(graphics_help({ code: 'terrain_failed' }, copy, UA.firefox_mac_136)).toBeNull()
  expect(graphics_help(undefined, copy, UA.firefox_mac_136)).toBeNull()
  expect(graphics_help({ code: 'webgpu_unavailable' }, copy, UA.chrome_mac)).toBe(copy.graphics_help.chromium)
  const firefox = graphics_help({ code: 'webgpu_initialization_failed' }, copy, UA.firefox_mac_136)
  expect(firefox).toContain('Firefox 136')
  expect(firefox).toContain('Firefox 147')
})

for (const { code: locale } of LOCALES)
  test(`${locale}: every graphics help line is authored and keeps its placeholders`, async () => {
    const { graphics_help: help } = await load_app_copy(locale)
    const keys = [
      'firefox_update',
      'firefox_unsupported',
      'firefox_settings',
      'safari',
      'chromium',
      'chromium_linux',
      'other',
    ]
    expect(Object.keys(help).toSorted()).toEqual(keys.toSorted())
    keys.forEach((key) => expect(help[key as keyof typeof help].length).toBeGreaterThan(20))
    expect(help.firefox_update).toContain('{version}')
    expect(help.firefox_update).toContain('{required}')
  })
