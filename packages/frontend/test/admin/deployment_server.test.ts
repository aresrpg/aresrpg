// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { describe, expect, test } from 'bun:test'

import {
  command_failure_message,
  create_contract_build_service,
  deployment_revision_of_pins,
  deployment_dev_plugin,
  merge_deployment_pins,
  merge_seed_ledger_pins,
  next_package_version_source,
  package_version_from_source,
  parse_contract_artifact,
  reset_deployment_pins,
  seed_ledger_from_pins,
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

  test('refuses oversized game bytecode before asking the wallet to publish it', () => {
    const oversized = JSON.stringify({
      modules: [Buffer.alloc(96_001).toString('base64')],
      dependencies: ['0x2'],
      digest: [1, 2, 3],
    })

    expect(() => parse_contract_artifact('aresrpg', oversized)).toThrow(
      'Game bytecode is 96001B; 96000B max preserves Sui metadata headroom'
    )
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
    await service.compile_game(
      'testnet',
      { package: '0xmath', upgrade_cap: '0xcap' },
      { package: '0xc011', upgrade_cap: '0xccap' },
      { package: '0x5eed', upgrade_cap: '0x5cap' }
    )

    expect(calls.some((args) => args.includes('--pubfile-path'))).toBeTrue()
    expect(calls.some((args) => args.includes('testnet'))).toBeTrue()
    expect(publication_context).toContain('chain-id = "4c78adac"')
    expect(publication_context).toContain('version = 3')
    expect(publication_context).toContain('source = { local = "/cache/kiosk" }')
    expect(publication_context).toContain('published-at = "0x1234"')
    expect(publication_context).toContain('original-id = "0x5678"')
    expect(publication_context).toContain('published-at = "0x5eed"')
    expect(publication_context).toContain('packages/seed')
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

  test('content addresses live in pins without invalidating package-operation revisions', () => {
    const pins = {
      testnet: { package: '0xgame' },
      mainnet: { package: null },
    }
    const revision = deployment_revision_of_pins(pins)
    const ledger = {
      '0xitem': { hash: 'abc', label: 'item wheat', addresses: ['0xitem'] },
      'board:0': { hash: 'def', label: 'board #0', addresses: ['0xcatalog'] },
    }
    const next = merge_seed_ledger_pins(pins, 'testnet', '0xroot', ledger, {
      '0xitem': 'item wheat',
      '0xcatalog': 'fight board catalog',
    })

    expect(seed_ledger_from_pins(next, 'testnet', '0xroot')).toEqual(ledger)
    expect(next.testnet.seed_addresses).toEqual({
      '0xroot': { '0xitem': 'item wheat', '0xcatalog': 'fight board catalog' },
    })
    expect(deployment_revision_of_pins(next)).toBe(revision)
    expect(next.mainnet).toEqual(pins.mainnet)
  })

  test('package version bump is retry-safe against the live Version value', () => {
    const source = 'module aresrpg::version {\n    const PACKAGE_VERSION: u64 = 7;\n}'
    const bumped = next_package_version_source(source, 7)

    expect(bumped.version).toBe(8)
    expect(bumped.changed).toBeTrue()
    expect(next_package_version_source(bumped.source, 7)).toEqual({ ...bumped, changed: false })
    expect(() => next_package_version_source(source, 8)).toThrow('behind the published game version')
  })

  test('reads the desired game version for interrupted activation recovery', () => {
    expect(package_version_from_source('module aresrpg::version { const PACKAGE_VERSION: u64 = 8; }')).toBe(8)
  })

  test('republish clears only the selected network deployment', () => {
    const pins = {
      testnet: {
        package: '0xtest',
        math_package: '0xmath',
        seed_package: '0xseed',
        seed_package_original: '0xseedoriginal',
        seed_upgrade_cap: '0xseedcap',
        seed_artifact_digest: 'seed-digest',
        content_root: { id: '0xroot', shared_version: '1' },
        worlds: { shore: { id: '0xworld' } },
        seed_ledgers: { '0xroot': { '0xitem': { hash: 'abc', label: 'item wheat' } } },
        seed_addresses: { '0xroot': { '0xitem': 'item wheat' } },
      },
      mainnet: { package: '0xmain', math_package: '0xmainmath' },
    }

    const reset = reset_deployment_pins(pins, 'testnet')
    expect(reset.mainnet).toEqual(pins.mainnet)
    expect(reset.testnet.math_package).toBeNull()
    expect(reset.testnet.seed_package).toBeNull()
    expect(reset.testnet.control_package).toBeNull()
    expect(reset.testnet.package).toBeNull()
    expect(reset.testnet.worlds).toBeUndefined()
    expect(reset.testnet.seed_ledgers).toEqual(pins.testnet.seed_ledgers)
    expect(reset.testnet.seed_addresses).toEqual(pins.testnet.seed_addresses)

    expect(reset.testnet.seed_package_original).toBeNull()
    expect(reset.testnet.seed_upgrade_cap).toBeNull()
    expect(reset.testnet.seed_artifact_digest).toBeNull()
    expect(reset.testnet.content_root).toEqual({ id: null, shared_version: null })
  })

  test('pin writes stay inside the admin reducer instead of reloading the app through HMR', async () => {
    const plugin = deployment_dev_plugin({ repo_dir: '/repo' })
    expect(plugin.hotUpdate).toBeFunction()
    const hot_update = plugin.hotUpdate as (context: { file: string }) => unknown

    expect(await hot_update({ file: '/repo/pins.json' })).toEqual([])
    expect(await hot_update({ file: '/repo/packages/frontend/src/app.tsx' })).toBeUndefined()
  })
})
