// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { browser_launch_options } from '../../e2e/support/browser_launch.ts'

test('GPU-less Chrome uses WebGPU software Vulkan without changing production rendering', () => {
  const { args } = browser_launch_options('chrome', 'linux', false)
  expect(args).toContain('--enable-unsafe-webgpu')
  expect(args).toContain('--use-webgpu-adapter=swiftshader')
  expect(args).toContain('--use-vulkan=swiftshader')
})

test('native and hardware performance runs never force a software adapter', () => {
  for (const platform of ['darwin', 'linux', 'win32']) {
    const { args } = browser_launch_options('chrome', platform, true)
    expect(args).toContain('--disable-frame-rate-limit')
    expect(args?.some((arg) => arg.includes('swiftshader'))).toBe(false)
  }
  expect(browser_launch_options('chrome', 'darwin', false).args).toEqual(['--enable-unsafe-webgpu'])
})

test('Firefox exposes WebGPU and uses Vulkan on the Linux compatibility lane', () => {
  expect(browser_launch_options('firefox', 'linux', false).firefoxUserPrefs).toEqual({
    'dom.webgpu.enabled': true,
    'dom.webgpu.wgpu-backend': 'vulkan',
  })
  expect(browser_launch_options('webkit', 'darwin', false)).toEqual({})
})
