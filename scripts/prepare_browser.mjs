// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const chrome = {
  darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  linux: '/opt/google/chrome/chrome',
}[process.platform]
const [command, ...args] =
  chrome && existsSync(chrome) ? [chrome, '--version'] : ['bunx', 'playwright', 'install', '--with-deps', 'chrome']
const result = spawnSync(command, args, { stdio: 'inherit' })
if (result.error) throw result.error
process.exitCode = result.status ?? 1
