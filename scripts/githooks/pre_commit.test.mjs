// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test } from 'bun:test'

const hook = fileURLToPath(new URL('./pre-commit', import.meta.url))

const run_hook = async (staged, fail_tool = '') => {
  const directory = await mkdtemp(join(tmpdir(), 'ares-pre-commit-'))
  const bin = join(directory, 'bin')
  const log = join(directory, 'calls')
  try {
    await mkdir(bin)
    await writeFile(join(directory, 'regular.ts'), 'export const value = 1\n')
    await writeFile(join(directory, 'art.jpg'), 'image fixture')
    await symlink('art.jpg', join(directory, 'linked.jpg'))
    await symlink('regular.ts', join(directory, 'linked.ts'))
    await writeFile(join(directory, 'staged'), staged.join('\n'))
    await writeFile(log, '')
    await writeFile(join(bin, 'git'), '#!/bin/sh\ncat staged\n', { mode: 0o755 })
    await writeFile(
      join(bin, 'bunx'),
      '#!/bin/sh\nprintf "bunx %s\\n" "$*" >> "$HOOK_LOG"\nfor file in "$@"; do if [ -L "$file" ]; then exit 2; fi; done\nif [ "$1" = "$FAIL_TOOL" ]; then exit 3; fi\n',
      { mode: 0o755 }
    )
    await writeFile(join(bin, 'bun'), '#!/bin/sh\nprintf "bun %s\\n" "$*" >> "$HOOK_LOG"\n', { mode: 0o755 })
    const result = Bun.spawnSync(['sh', hook], {
      cwd: directory,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        HOOK_LOG: log,
        FAIL_TOOL: fail_tool,
      },
    })
    return { status: result.exitCode, calls: (await readFile(log, 'utf8')).trim().split('\n').filter(Boolean) }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('staged symlinks skip style tools while regular source keeps fast checks', async () => {
  expect(await run_hook(['regular.ts', 'linked.ts', 'linked.jpg'])).toEqual({
    status: 0,
    calls: ['bunx eslint regular.ts', 'bunx prettier --check --ignore-unknown regular.ts'],
  })
})

test.each([{ staged: [] }, { staged: ['linked.jpg'] }])(
  'empty style input never invokes a formatter on the whole checkout: %j',
  async ({ staged }) => {
    expect(await run_hook(staged)).toEqual({ status: 0, calls: [] })
  }
)

test('a formatting failure still rejects the commit', async () => {
  const result = await run_hook(['regular.ts', 'linked.jpg'], 'prettier')
  expect(result.status).not.toBe(0)
  expect(result.calls).toEqual(['bunx eslint regular.ts', 'bunx prettier --check --ignore-unknown regular.ts'])
})

test.each([
  'package.json',
  'packages/indexer/src/main.rs',
  'packages/move/sources/fight.move',
  'packages/rewards/sources/rewards.move',
])('staging %s leaves full-language coverage to CI', async (path) => {
  expect(await run_hook([path])).toEqual({
    status: 0,
    calls: [`bunx prettier --check --ignore-unknown ${path}`],
  })
})

test('an ESLint failure stops before formatting', async () => {
  const result = await run_hook(['regular.ts'], 'eslint')
  expect(result.status).not.toBe(0)
  expect(result.calls).toEqual(['bunx eslint regular.ts'])
})
