// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { LaunchOptions } from '@playwright/test'

/** Hosted compatibility jobs use real software WebGPU; performance runs retain the native GPU. */
export const browser_launch_options = (
  browser: 'chrome' | 'firefox' | 'webkit',
  platform: string,
  hardware: boolean
): LaunchOptions => {
  if (browser === 'firefox')
    return {
      firefoxUserPrefs: {
        'dom.webgpu.enabled': true,
        ...(platform === 'linux' ? { 'dom.webgpu.wgpu-backend': 'vulkan' } : {}),
      },
    }
  if (browser !== 'chrome') return {}
  return {
    args: [
      '--enable-unsafe-webgpu',
      ...(hardware ? ['--disable-frame-rate-limit', '--disable-gpu-vsync'] : []),
      ...(platform === 'linux' && !hardware
        ? [
            '--enable-features=Vulkan',
            '--use-angle=vulkan',
            '--use-vulkan=swiftshader',
            '--use-webgpu-adapter=swiftshader',
            '--disable-vulkan-surface',
          ]
        : []),
    ],
  }
}
