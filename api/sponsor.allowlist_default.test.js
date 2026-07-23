// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// api/sponsor.mjs PTB-scope allowlist resolution — SPONSOR_ARESRPG_PACKAGES UNSET falls back to the
// release.json derivation (dev/local convenience), unchanged from before the env feature landed.
//
//   bun test api/sponsor.allowlist_default.test.js    (no Redis, no station — pure scope resolution)
//
// Own process on purpose (like the sibling suites): sponsor.mjs resolves the allowlist ONCE at
// module load.

import { describe, expect, test } from 'bun:test'
import { Transaction } from '@mysten/sui/transactions'
import { toBase64 } from '@mysten/sui/utils'

import release from '../packages/sdk/src/deployment/release.json' with { type: 'json' }

process.env.REDIS_URL = ''
delete process.env.SPONSOR_ARESRPG_PACKAGES // the scenario under test: truly unset

const boot_lines = []
const real_log = console.log
console.log = (...args) => boot_lines.push(args.join(' '))
const S = await import('./sponsor.mjs')
console.log = real_log

const ARES = release.networks.testnet.packages.aresrpg.latest

describe('SPONSOR_ARESRPG_PACKAGES unset — falls back to the release.json derivation', () => {
  test('boot line names the release.json source', () => {
    expect(boot_lines.some((line) => /sponsor allowlist: release\.json\(\d+\)/.test(line))).toBe(true)
  })
  test('a real release.json package (aresrpg latest) is allowlisted', async () => {
    const tx = new Transaction()
    tx.moveCall({ target: `${ARES}::whatever::call` })
    const k = toBase64(await tx.build({ onlyTransactionKind: true }))
    expect(() => S.assert_ptb_scope(k)).not.toThrow()
  })
})
