// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// api/sponsor.mjs PTB-scope allowlist resolution — SPONSOR_ARESRPG_PACKAGES env WINS over the
// release.json derivation when SET (owner ruling 2026-07-24: "sponsor should take a config, not
// hardcoded values" — a ceremony/republish is now a config change, never an image rebuild).
// Proves the env value REPLACES (never merges with) the release.json scope, entries dedupe and
// case-normalize, and the boot line names the armed source + count.
//
//   bun test api/sponsor.allowlist_env.test.js        (no Redis, no station — pure scope resolution)
//
// Own process on purpose (like the sibling suites): sponsor.mjs resolves the allowlist ONCE at
// module load, from whatever SPONSOR_ARESRPG_PACKAGES holds at that moment.

import { describe, expect, test } from 'bun:test'
import { Transaction } from '@mysten/sui/transactions'
import { toBase64 } from '@mysten/sui/utils'

import release from '../packages/sdk/src/deployment/release.json' with { type: 'json' }

process.env.REDIS_URL = '' // no store needed — assert_ptb_scope never touches Redis/station

const PKG_A = '0x' + 'aa'.repeat(32)
const PKG_B = '0x' + 'bb'.repeat(32)
// PKG_A appears twice, once shouty-cased — proves dedupe + case-normalize in the same boot.
process.env.SPONSOR_ARESRPG_PACKAGES = `${PKG_A.toUpperCase()}, ${PKG_A}, ${PKG_B}`

const boot_lines = []
const real_log = console.log
console.log = (...args) => boot_lines.push(args.join(' '))
const S = await import('./sponsor.mjs')
console.log = real_log

const ARES = release.networks.testnet.packages.aresrpg.latest
const kind = async (target) => {
  const tx = new Transaction()
  tx.moveCall({ target: `${target}::whatever::call` })
  return toBase64(await tx.build({ onlyTransactionKind: true }))
}

describe('SPONSOR_ARESRPG_PACKAGES env — wins over release.json, dedupes, case-normalizes', () => {
  test('boot line names the env source and the DEDUPED count (3 entries, 2 unique)', () => {
    expect(boot_lines.some((line) => line.includes('sponsor allowlist: env(2)'))).toBe(true)
  })
  test('an env-listed package (any original casing) is allowlisted', async () => {
    const [a, b] = await Promise.all([kind(PKG_A), kind(PKG_B)])
    expect(() => S.assert_ptb_scope(a)).not.toThrow()
    expect(() => S.assert_ptb_scope(b)).not.toThrow()
  })
  test('a REAL release.json package is REFUSED — env REPLACES the scope, never merges', async () => {
    const k = await kind(ARES)
    expect(() => S.assert_ptb_scope(k)).toThrow(/sponsor-scope.*non-allowlisted/)
  })
})
