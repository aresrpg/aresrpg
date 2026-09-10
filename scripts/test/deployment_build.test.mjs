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

test('publication versions come from metadata reads instead of the flaky CLI object JSON path', async () => {
  const reads = []
  let publication_file = ''
  const compiler = create_contract_build_service({
    repo_dir: import.meta.dir,
    read_version: async (network, package_id) => {
      reads.push([network, package_id])
      return '2'
    },
    run: async (_command, args) => {
      if (args.includes('object')) throw new Error('EOF while parsing a value')
      if (args[0] === '--version')
        return { stdout: `sui ${move_packages.sui_cli.release.split('-v')[1]}-test`, stderr: '' }
      if (args.includes('chain-identifier')) return { stdout: '4c78adac', stderr: '' }
      publication_file = await Bun.file(args[args.indexOf('--pubfile-path') + 1]).text()
      return { stdout: JSON.stringify({ modules: ['AA=='], dependencies: ['0x2'], digest: [1] }), stderr: '' }
    },
  })
  await compiler.compile_math('testnet', { package: '0x123', original_package: '0xabc' })
  expect(reads).toEqual([['testnet', '0x123']])
  expect(publication_file).toContain('version = 2')
  expect(publication_file).toContain('original-id = "0xabc"')
})

test('failed or invalid package metadata stops compilation once with network and package context', async () => {
  for (const response of [new Error('metadata unavailable'), '0', '1.5', 'invalid', '9007199254740992']) {
    let reads = 0
    let builds = 0
    const compiler = create_contract_build_service({
      repo_dir: import.meta.dir,
      read_version: async () => {
        reads += 1
        if (response instanceof Error) throw response
        return response
      },
      run: async (_command, args) => {
        if (args[0] === 'move') builds += 1
        return {
          stdout: args[0] === '--version' ? `sui ${move_packages.sui_cli.release.split('-v')[1]}-test` : '4c78adac',
          stderr: '',
        }
      },
    })
    await expect(compiler.compile_math('testnet', { package: '0x123' })).rejects.toThrow(
      'Cannot read testnet package 0x123 version:'
    )
    expect(reads).toBe(1)
    expect(builds).toBe(0)
  }
})
