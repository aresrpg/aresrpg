// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { blast_allowlist, blast_leaf } from '../../src/allocation/blast_allowlist.ts'

const rows = [
  { address: `0x${'a1'.repeat(32)}`, cap_mist: 125_000_000_000n },
  { address: `0x${'b2'.repeat(32)}`, cap_mist: 70_000_000_000n },
  { address: `0x${'c3'.repeat(32)}`, cap_mist: 70_000_000_000n },
]

// Provenance: `sui move test` (sui 1.82.3, 2026-10-29) accepted these exact digests and proofs
// with Blast's allowlist_leaf/node/verify copied from blast-v2-contracts main, and rejected cap 125 SUI for row 2.
test('leaves, root and odd-width proofs match the Move verifier', () => {
  expect(Buffer.from(blast_leaf(0, rows[0]!)).toString('hex')).toBe(
    '675cbf0651a61089a3389243351a70e2c3f03143b93f908cd575cb3449d73bc0'
  )
  const tree = blast_allowlist(rows)
  expect(tree).toMatchObject({
    root: '988d8aad84154dcbbc19e6d239cfe1e752fc19c37936ade66cf04aed92ab6630',
    leaf_count: 3,
  })
  expect(tree.proof(rows[0]!.address)).toEqual({
    index: '0',
    cap_mist: '125000000000',
    siblings: [
      'af90e4171e97990b4cac6b346fb43baead82ef402f8c01ac21560a68fa9cb46d',
      '42d86783f8ead225d19a0c8c09a65a32c3eae317787ac8d0a85fca28046e0172',
    ],
  })
  expect(tree.proof(rows[2]!.address)?.siblings).toEqual([
    '43b770ab1ae0caab611e596e1b613c16051b70aa73af6dfcf323ed58581a2e6e',
    '90c46005628b318a489371dad9fb8cc652b3382f655cc32fa6ea543243abb4c3',
  ])
})

test('one leaf is its own root with an empty proof; unknown and empty lists refuse', () => {
  const single = blast_allowlist(rows.slice(0, 1))
  expect(single.root).toBe('675cbf0651a61089a3389243351a70e2c3f03143b93f908cd575cb3449d73bc0')
  expect(single.proof(rows[0]!.address)?.siblings).toEqual([])
  expect(single.proof(rows[1]!.address)).toBeNull()
  expect(() => blast_allowlist([])).toThrow('no rows')
})

test('proof depth is ceil(log2(leaf count)) for every width Blast accepts here', () => {
  for (const count of [2, 5, 8, 9, 200]) {
    const list = Array.from({ length: count }, (_, index) => ({
      address: `0x${index.toString(16).padStart(64, '0')}`,
      cap_mist: 70_000_000_000n,
    }))
    const tree = blast_allowlist(list)
    expect(tree.proof(list.at(-1)!.address)?.siblings).toHaveLength(Math.ceil(Math.log2(count)))
  }
})
