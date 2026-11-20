// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { blast_leaf, blast_proof_root } from '../../src/allocation/blast_allowlist.ts'

const rows = [
  { address: `0x${'a1'.repeat(32)}`, cap_mist: 125_000_000_000n },
  { address: `0x${'b2'.repeat(32)}`, cap_mist: 70_000_000_000n },
  { address: `0x${'c3'.repeat(32)}`, cap_mist: 70_000_000_000n },
]
const ROOT = '988d8aad84154dcbbc19e6d239cfe1e752fc19c37936ade66cf04aed92ab6630'
const first = {
  index: '0',
  cap_mist: '125000000000',
  siblings: [
    'af90e4171e97990b4cac6b346fb43baead82ef402f8c01ac21560a68fa9cb46d',
    '42d86783f8ead225d19a0c8c09a65a32c3eae317787ac8d0a85fca28046e0172',
  ],
}
// The third of three leaves: its level-0 sibling is itself, as Blast pairs an unpaired node.
const last = {
  index: '2',
  cap_mist: '70000000000',
  siblings: [
    '43b770ab1ae0caab611e596e1b613c16051b70aa73af6dfcf323ed58581a2e6e',
    '90c46005628b318a489371dad9fb8cc652b3382f655cc32fa6ea543243abb4c3',
  ],
}

// Provenance: `sui move test` (sui 1.82.3, 2026-10-29) accepted these exact digests and proofs
// with Blast's allowlist_leaf/node/verify copied from blast-v2-contracts main, and rejected cap 125 SUI for row 2.
// The same fold reproduced the KARES sale's on-chain root for all 164 published wallets from
// Blast's partner API on 2026-11-21 (presale 0x2d8a…9b7b, version 1101083029).
test('leaves and proofs fold to the root the Move verifier accepts', () => {
  expect(Buffer.from(blast_leaf(0, rows[0]!)).toString('hex')).toBe(
    '675cbf0651a61089a3389243351a70e2c3f03143b93f908cd575cb3449d73bc0'
  )
  expect(blast_proof_root(rows[0]!.address, first)).toBe(ROOT)
  expect(blast_proof_root(rows[2]!.address, last)).toBe(ROOT)
})

test('another wallet, cap, index or sibling never reaches the root', () => {
  expect(blast_proof_root(rows[1]!.address, first)).not.toBe(ROOT)
  expect(blast_proof_root(rows[2]!.address, { ...last, cap_mist: '125000000000' })).not.toBe(ROOT)
  expect(blast_proof_root(rows[0]!.address, { ...first, index: '1' })).not.toBe(ROOT)
  expect(blast_proof_root(rows[0]!.address, { ...first, siblings: [...first.siblings].reverse() })).not.toBe(ROOT)
})

test('a single-wallet list has an empty proof and its leaf is the root', () => {
  expect(blast_proof_root(rows[0]!.address, { ...first, siblings: [] })).toBe(
    '675cbf0651a61089a3389243351a70e2c3f03143b93f908cd575cb3449d73bc0'
  )
})
