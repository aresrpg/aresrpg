// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import DEPLOYMENT from '../../../pins.json' with { type: 'json' }
import { DEFAULT_NETWORK, resolve_pins } from '../src/pins.ts'

test('the committed deployment is mainnet only, with no archived deployments', () => {
  expect(DEFAULT_NETWORK).toBe('mainnet')
  expect(DEPLOYMENT).not.toHaveProperty('testnet')
  expect(DEPLOYMENT).not.toHaveProperty('mainnet')
  expect(DEPLOYMENT).not.toHaveProperty('seed_ledgers')
  expect(DEPLOYMENT).not.toHaveProperty('seed_addresses')
  expect(resolve_pins('mainnet').network).toBe('mainnet')
})

test('local consumers must supply their own pins; they cannot inherit production identities', () => {
  expect(() => resolve_pins('testnet')).toThrow('not testnet')
  const local = { network: 'testnet' as const, package: 'local-package' }
  expect(resolve_pins('testnet', local)).toBe(local)
  expect(() => resolve_pins('mainnet', local)).toThrow('not mainnet')
})
