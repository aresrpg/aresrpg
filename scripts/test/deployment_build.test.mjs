// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import move_packages from '../../move-packages.json' with { type: 'json' }
import { create_contract_build_service, run_build_command } from '../deployment_build.ts'

test('captures compiler output beyond the former twenty-megabyte ceiling', async () => {
  const bytes = 20 * 1024 * 1024 + 1
  const result = await run_build_command(
    process.execPath,
    ['-e', `process.stdout.write('x'.repeat(${String(bytes)}))`],
    import.meta.dir
  )

  expect(result.stdout.length).toBe(bytes)
})

test('a different Sui compiler cannot produce a release artifact', async () => {
  const calls = []
  const compiler = create_contract_build_service({
    repo_dir: import.meta.dir,
    run: async (command, args) => {
      calls.push([command, ...args])
      return { stdout: 'sui 0.0.0-wrong', stderr: '' }
    },
  })
  await expect(compiler.compile_math('testnet')).rejects.toThrow('Sui compiler')
  expect(calls).toEqual([['sui', '--version']])
})

test('the pinned Sui compiler proceeds to the existing artifact build', async () => {
  const calls = []
  const compiler = create_contract_build_service({
    repo_dir: import.meta.dir,
    run: async (command, args) => {
      calls.push([command, ...args])
      return {
        stdout:
          args[0] === '--version'
            ? `sui ${move_packages.sui_cli.release.split('-v')[1]}-abc123`
            : JSON.stringify({ modules: ['AA=='], dependencies: ['0x2'], digest: [1] }),
        stderr: '',
      }
    },
  })
  expect((await compiler.compile_math('testnet')).modules).toEqual(['AA=='])
  expect(calls[0]).toEqual(['sui', '--version'])
  expect(calls[1].slice(0, 3)).toEqual(['sui', 'move', 'build'])
})
