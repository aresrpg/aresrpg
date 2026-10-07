// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { expect, test } from 'bun:test'

const root = resolve(import.meta.dirname, '../../../..')
const require = createRequire(await realpath(join(root, 'node_modules/vercel/package.json')))
const { build } = require('@vercel/node')
const { FileFsRef, download } = require('@vercel/build-utils')

// Use Vercel's real compiler and an isolated Node process: source imports alone miss broken exports.
test('the packaged gift function boots without workspace TypeScript exports', async () => {
  const target = await mkdtemp(join(tmpdir(), 'ares-gift-function-'))
  try {
    const { output } = await build({
      files: { 'api/gift.ts': new FileFsRef({ fsPath: join(root, 'packages/frontend/api/gift.ts') }) },
      entrypoint: 'api/gift.ts',
      workPath: join(root, 'packages/frontend'),
      repoRootPath: root,
      config: { projectSettings: { nodeVersion: '24.x' } },
      // Reuse installed dependencies without downloading or running installation hooks.
      meta: { isDev: true },
    })
    await download(output.files, target)
    const { stdout } = await promisify(execFile)(
      'node',
      [
        '--input-type=module',
        '--eval',
        `
      const { default: handler } = await import(${JSON.stringify(join(target, 'packages/frontend/api/gift.js'))});
      const response = await handler.fetch(new Request('https://aresrpg.world/api/gift'));
      console.log(response.status);
    `,
      ],
      { cwd: target }
    )
    expect(stdout.trim()).toBe('405')
  } finally {
    await rm(target, { recursive: true, force: true })
  }
}, 30_000)
