// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { assert_reload_lineage, local_pin_env, RELOAD_COMPOSE_COMMANDS, REPIN_STACK_COMMAND } from './repin_local.mjs'

const id = (digit) => `0x${digit.repeat(64)}`

describe('local Docker repin', () => {
  test('derives the indexer lineage from one network in pins.json', () => {
    expect(
      local_pin_env(
        {
          testnet: {
            package_original: id('1'),
            package: id('2'),
            seed_package_original: id('3'),
          },
        },
        'testnet'
      )
    ).toEqual({
      PACKAGE_ORIGINAL: id('1'),
      PACKAGE_LATEST: id('2'),
      SEED_PACKAGE_ORIGINAL: id('3'),
      SUI_NETWORK: 'testnet',
    })
  })

  test('refuses an incomplete deployment before touching Docker', () => {
    expect(() => local_pin_env({ testnet: { package: id('2') } }, 'testnet')).toThrow('testnet pins are incomplete')
  })
})

describe('local Docker reload', () => {
  test('accepts only the projection already bound to the selected original package', () => {
    expect(() => assert_reload_lineage(id('1'), id('1'))).not.toThrow()
    expect(() => assert_reload_lineage(null, id('1'))).toThrow('use bun run repin:local')
    expect(() => assert_reload_lineage(id('2'), id('1'))).toThrow('use bun run repin:local')
  })

  test('recreates only readers and never removes the database or its volumes', () => {
    const commands = Object.values(RELOAD_COMPOSE_COMMANDS)
    const tokens = commands.flat()
    expect(tokens).not.toContain('down')
    expect(tokens).not.toContain('--volumes')
    expect(tokens).not.toContain('falkordb')
    expect(RELOAD_COMPOSE_COMMANDS.restart_indexer).toContain('--force-recreate')
    expect(RELOAD_COMPOSE_COMMANDS.restart_server).toContain('--force-recreate')
  })

  test('starts the server immediately while either indexer catches up', () => {
    expect(REPIN_STACK_COMMAND).toEqual(['up', '-d', 'falkordb', 'indexer', 'server'])
    expect(RELOAD_COMPOSE_COMMANDS).not.toHaveProperty('stop_server')
  })
})
