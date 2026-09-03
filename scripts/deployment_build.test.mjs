// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { run_build_command } from './deployment_build.ts'

test('captures compiler output beyond the former twenty-megabyte ceiling', async () => {
  const bytes = 20 * 1024 * 1024 + 1
  const result = await run_build_command(
    process.execPath,
    ['-e', `process.stdout.write('x'.repeat(${String(bytes)}))`],
    import.meta.dir
  )

  expect(result.stdout.length).toBe(bytes)
})
