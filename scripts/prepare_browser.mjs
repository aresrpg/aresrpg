// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

// Match the stable Chrome channel locations used by Playwright on our hosted runners.
const CHROME_EXECUTABLES = Object.freeze({
  darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  linux: '/opt/google/chrome/chrome',
})

export const browser_setup_commands = (browser, platform, exists = existsSync) => {
  if (!['chrome', 'firefox'].includes(browser)) throw new Error(`Unsupported CI browser: ${browser}`)
  const chrome = CHROME_EXECUTABLES[platform]
  if (browser === 'chrome' && chrome && exists(chrome)) return [[chrome, '--version']]
  return [
    ...(browser === 'firefox' && platform === 'linux'
      ? [
          ['sudo', 'apt-get', 'update'],
          ['sudo', 'apt-get', 'install', '-y', 'mesa-vulkan-drivers'],
        ]
      : []),
    ['bunx', 'playwright', 'install', '--with-deps', browser],
  ]
}

if (import.meta.main) {
  for (const [command, ...args] of browser_setup_commands(process.env.BROWSER, process.platform)) {
    const result = spawnSync(command, args, { stdio: 'inherit' })
    if (result.error) throw result.error
    if (result.status !== 0) throw new Error(`Browser setup failed: ${command} exited with ${result.status}`)
  }
}
