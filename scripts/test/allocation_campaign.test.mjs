// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { fileURLToPath } from 'node:url'

import { expect, test } from 'bun:test'

test('the allocation CLI resolves its dependencies from the repository root before validating arguments', async () => {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const process_handle = Bun.spawn([process.execPath, 'scripts/allocation_campaign.ts'], {
    cwd: root,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [code, output, error] = await Promise.all([
    process_handle.exited,
    new Response(process_handle.stdout).text(),
    new Response(process_handle.stderr).text(),
  ])
  expect(code).toBe(1)
  expect(output + error).toContain('Usage: bun scripts/allocation_campaign.ts')
  expect(output + error).not.toContain('Cannot find module')
})
