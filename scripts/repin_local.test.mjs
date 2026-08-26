// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { local_pin_env } from './repin_local.mjs'

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
