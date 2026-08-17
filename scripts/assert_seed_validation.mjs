// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo_dir = dirname(dirname(fileURLToPath(import.meta.url)))
const baseline = JSON.parse(readFileSync(join(repo_dir, 'scripts', 'seed_validation_baseline.json'), 'utf8'))
const validation_output = () => {
  try {
    return execFileSync('bun', ['scripts/validate_seed.mjs', '--json'], { cwd: repo_dir, encoding: 'utf8' })
  } catch (error) {
    return String(error.stdout ?? '')
  }
}
const output = validation_output()
const { reds } = JSON.parse(output)
const introduced = reds.filter((issue) => !baseline.includes(issue))
if (introduced.length) throw new Error(`Seed validation introduced new REDs:\n${introduced.join('\n')}`)
