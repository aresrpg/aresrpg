// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { fileURLToPath } from 'node:url'

import { expect, test } from 'bun:test'
import { ESLint } from 'eslint'

test('repository lint excludes Git-ignored folders while retaining source files', async () => {
  const linter = new ESLint({ cwd: fileURLToPath(new URL('../../', import.meta.url)) })
  for (const path of ['work/probe.mjs', 'scratchpad/probe.ts', 'packages/frontend/build/probe.js'])
    expect(await linter.isPathIgnored(path)).toBe(true)
  for (const path of ['eslint.config.js', 'packages/frontend/src/modules/world.ts', 'scripts/new_probe.mjs'])
    expect(await linter.isPathIgnored(path)).toBe(false)
})
