// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

for (const name of [
  'renderer_background',
  'renderer_failure',
  'fight_swords_lifecycle',
  'webgpu_cleanup',
  'generated_city_recovery',
]) {
  test(`${name} exercises production lifecycle owners with isolated hardware boundaries`, async () => {
    const child = Bun.spawn([process.execPath, `${import.meta.dir}/${name}_probe.ts`], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [code, output, errors] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    expect({ code, errors }).toEqual({ code: 0, errors: '' })
    expect(output).toContain('passed')
  })
}
