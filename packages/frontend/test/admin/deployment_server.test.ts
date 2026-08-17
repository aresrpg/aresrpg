// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import {
  command_failure_message,
  create_contract_build_service,
  deployment_dev_plugin,
  merge_deployment_pins,
  parse_contract_artifact,
} from '../../deployment_dev_server.ts'

const output = `compiler note\n${JSON.stringify({ modules: ['AA=='], dependencies: ['0x2'], digest: [1, 2, 3] })}`
const repo_dir = resolve(import.meta.dir, '../../../..')

describe('local deployment compiler', () => {
  test('extracts the wallet-safe package artifact from compiler output', () => {
    expect(parse_contract_artifact('aresrpg_math', output)).toEqual({
      package_name: 'aresrpg_math',
      modules: ['AA=='],
      dependencies: ['0x2'],
      digest: [1, 2, 3],
    })
  })

  test('surfaces compiler output instead of the child-process wrapper', () => {
    const error = Object.assign(new Error('Command failed: sui move build'), {
      stdout: 'Move compiler failure',
      stderr: '',
    })
    expect(command_failure_message(error)).toBe('Move compiler failure')
  })

  test('the game compilation receives the published math package through an ephemeral pubfile', async () => {
    const calls: readonly string[][] = []
    const mutable_calls = calls as string[][]
    let publication_context = ''
    const service = create_contract_build_service({
      repo_dir,
      run: async (_command, args) => {
        mutable_calls.push([...args])
        if (args.includes('chain-identifier')) return { stdout: '4c78adac\n', stderr: '' }
        if (args.includes('cache-package'))
          return {
            stdout: JSON.stringify({
              name: 'kiosk',
              path: '/cache/kiosk',
              'published-at': '0x1234',
              'original-id': '0x5678',
              chain_id: '4c78adac',
            }),
            stderr: '',
          }
        if (args.includes('object')) return { stdout: JSON.stringify({ version: 3 }), stderr: '' }
        const pubfile_index = args.indexOf('--pubfile-path')
        if (pubfile_index >= 0) publication_context = await readFile(args[pubfile_index + 1]!, 'utf8')
        return { stdout: output, stderr: '' }
      },
    })
    await service.compile_game('testnet', { package: '0xmath', upgrade_cap: '0xcap' })

    expect(calls.some((args) => args.includes('--pubfile-path'))).toBeTrue()
    expect(calls.some((args) => args.includes('testnet'))).toBeTrue()
    expect(publication_context).toContain('chain-id = "4c78adac"')
    expect(publication_context).toContain('version = 1')
    expect(publication_context).toContain('source = { local = "/cache/kiosk" }')
    expect(publication_context).toContain('published-at = "0x1234"')
    expect(publication_context).toContain('original-id = "0x5678"')
    expect(publication_context).toContain('version = 3')
  })

  test('pin updates preserve the other network and unrelated deployment facts', () => {
    const pins = {
      testnet: { package: null, version: { id: null, shared_version: null } },
      mainnet: { package: '0xmain' },
    }
    expect(merge_deployment_pins(pins, 'testnet', { package: '0xtest' })).toEqual({
      testnet: { package: '0xtest', version: { id: null, shared_version: null } },
      mainnet: { package: '0xmain' },
    })
  })

  test('pin writes stay inside the admin reducer instead of reloading the app through HMR', async () => {
    const plugin = deployment_dev_plugin({ repo_dir: '/repo' })
    expect(plugin.handleHotUpdate).toBeFunction()
    const handle_hot_update = plugin.handleHotUpdate as (context: { file: string }) => unknown

    expect(await handle_hot_update({ file: '/repo/pins.json' })).toEqual([])
    expect(await handle_hot_update({ file: '/repo/packages/frontend/src/app.tsx' })).toBeUndefined()
  })
})
